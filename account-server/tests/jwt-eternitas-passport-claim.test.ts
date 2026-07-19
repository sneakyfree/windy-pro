/**
 * Code issue #9 — the JWT issued by /api/v1/oauth/token must carry an
 * `eternitas_passport` claim when the identity has an active passport.
 *
 * windy-code's agentBusServer (src/vs/windy/agentBus/agentBusServer.ts)
 * verifies `payload.eternitas_passport === expectedPassport` before
 * trusting an agent auth message. Missing claim → every agent connection
 * rejects, which is why Pink-center's WINDY_DEV_PASSPORT scaffold existed.
 *
 * This test covers both JWT-issuing paths so they stay in sync:
 *   - /api/v1/auth/login       (generateTokens in routes/auth.ts)
 *   - /api/v1/oauth/token      (generateOAuthTokens in routes/oauth.ts)
 *
 * Claim rules:
 *   - Identity has an `active` passport     → claim present, value = passport_number
 *   - Identity has a `suspended`/`revoked`  → claim ABSENT (stale JWTs shouldn't
 *                                             let a revoked bot keep authing)
 *   - Identity has no passport row          → claim ABSENT
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jwt-passport-claim';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

// bcrypt + register round trips need more than the 5s Jest default,
// same pattern as password-reset / mfa-totp / email-verification.
jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser() {
  const body = { name: 'Passport Claim Test', email: uniqueEmail('passport'), password: 'SecurePass1' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId, token: res.body.token };
}

function linkPassport(identityId: string, passportNumber: string, status: string = 'active') {
  getDb().prepare(`
    INSERT INTO eternitas_passports (id, identity_id, passport_number, status, birth_certificate, registered_at, last_verified_at)
    VALUES (?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
  `).run(crypto.randomUUID(), identityId, passportNumber, status);
}

/**
 * The REAL hatch shape: the passport row is keyed by the BOT's identity_id,
 * with the human operator in operator_identity_id. Every operator-facing
 * lookup (login/oauth JWT claim, /identity/me → PassportPanel) must resolve
 * the passport by operator here — matching only identity_id (as the code did)
 * meant operators never saw their agent's passport.
 */
function linkPassportViaBot(operatorId: string, botId: string, passportNumber: string, status: string = 'active') {
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, name, password_hash, tier, identity_type, windy_identity_id, display_name)
              VALUES (?, ?, 'Bot', '', 'free', 'bot', ?, 'Bot')`)
    .run(botId, `agent-${botId.slice(0, 8)}@agents.windy.internal`, crypto.randomUUID());
  db.prepare(`
    INSERT INTO eternitas_passports (id, identity_id, passport_number, status, operator_identity_id, birth_certificate, registered_at, last_verified_at)
    VALUES (?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
  `).run(crypto.randomUUID(), botId, passportNumber, status, operatorId);
}

/** Decode a JWT without verifying — we only care about payload contents here. */
function decode(token: string): Record<string, any> {
  return jwt.decode(token) as Record<string, any>;
}

// ─── /api/v1/auth/login path (generateTokens) ──────────────────

describe('eternitas_passport claim on /api/v1/auth/login JWT', () => {
  it('omits the claim when the identity has no passport', async () => {
    const u = await registerUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const payload = decode(res.body.token);
    expect(payload).not.toHaveProperty('eternitas_passport');
  });

  it('includes the claim when an active passport is linked', async () => {
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassport(u.userId, passport, 'active');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const payload = decode(res.body.token);
    expect(payload.eternitas_passport).toBe(passport);
  });

  it('includes the claim for the REAL hatch shape (passport keyed by bot, operator in operator_identity_id)', async () => {
    // Regression: this is how a hatch actually stores the row. The old
    // `WHERE identity_id = ?` (operator) never matched → claim silently absent.
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassportViaBot(u.userId, crypto.randomUUID(), passport, 'active');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    expect(decode(res.body.token).eternitas_passport).toBe(passport);
  });

  it('omits the claim for a revoked passport', async () => {
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassport(u.userId, passport, 'revoked');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const payload = decode(res.body.token);
    expect(payload).not.toHaveProperty('eternitas_passport');
  });

  it('omits the claim for a suspended passport', async () => {
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassport(u.userId, passport, 'suspended');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const payload = decode(res.body.token);
    expect(payload).not.toHaveProperty('eternitas_passport');
  });
});

// ─── /api/v1/oauth/token path (generateOAuthTokens) ────────────
//
// Exercised through the device-code flow — we seed an approved row
// directly, then POST to /oauth/token to have it minted.

describe('eternitas_passport claim on /api/v1/oauth/token JWT (device-code)', () => {
  function seedApprovedDeviceCode(identityId: string, clientId = 'windy-code'): string {
    const db = getDb();
    const deviceCode = crypto.randomBytes(16).toString('hex');
    const userCode = `TT${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    // Ensure the oauth_clients row exists (the seed runs at boot; belt-and-suspenders).
    try {
      db.prepare(`
        INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public)
        VALUES (?, NULL, 'Test Client', '[]', '[]', 1, 1)
      `).run(clientId);
    } catch { /* already exists */ }
    db.prepare(`
      INSERT INTO oauth_device_codes (device_code, user_code, client_id, scope, status, identity_id, expires_at)
      VALUES (?, ?, ?, 'openid profile email', 'approved', ?, ?)
    `).run(deviceCode, userCode, clientId, identityId, expires);
    return deviceCode;
  }

  async function exchangeDeviceCode(deviceCode: string, clientId = 'windy-code') {
    return request(app)
      .post('/api/v1/oauth/token')
      .set('Content-Type', 'application/json')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: clientId,
      });
  }

  it('omits the claim when identity has no passport', async () => {
    const u = await registerUser();
    const dc = seedApprovedDeviceCode(u.userId);
    const res = await exchangeDeviceCode(dc);
    expect(res.status).toBe(200);
    const payload = decode(res.body.access_token);
    expect(payload).not.toHaveProperty('eternitas_passport');
  });

  it('includes the claim when identity has an active passport', async () => {
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassport(u.userId, passport, 'active');

    const dc = seedApprovedDeviceCode(u.userId);
    const res = await exchangeDeviceCode(dc);
    expect(res.status).toBe(200);
    const payload = decode(res.body.access_token);
    expect(payload.eternitas_passport).toBe(passport);
  });

  it('omits the claim after passport revocation', async () => {
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassport(u.userId, passport, 'active');
    // Revoke before the token is minted
    getDb().prepare(
      "UPDATE eternitas_passports SET status = 'revoked' WHERE passport_number = ?",
    ).run(passport);

    const dc = seedApprovedDeviceCode(u.userId);
    const res = await exchangeDeviceCode(dc);
    expect(res.status).toBe(200);
    const payload = decode(res.body.access_token);
    expect(payload).not.toHaveProperty('eternitas_passport');
  });

  it('claim value matches the live DB state, not a cached value', async () => {
    const u = await registerUser();
    // Two passports — only one active
    const revokedPassport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const activePassport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassport(u.userId, revokedPassport, 'revoked');
    linkPassport(u.userId, activePassport, 'active');

    const dc = seedApprovedDeviceCode(u.userId);
    const res = await exchangeDeviceCode(dc);
    expect(res.status).toBe(200);
    const payload = decode(res.body.access_token);
    expect(payload.eternitas_passport).toBe(activePassport);
    expect(payload.eternitas_passport).not.toBe(revokedPassport);
  });
});

// ─── /api/v1/identity/me — operator passport + isAdmin (PassportPanel) ──

describe('GET /api/v1/identity/me passport + isAdmin', () => {
  it('returns the operator\'s agent passport (real bot-keyed hatch shape)', async () => {
    const u = await registerUser();
    const passport = `ET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    linkPassportViaBot(u.userId, crypto.randomUUID(), passport, 'active');

    const res = await request(app)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    // Was undefined (→ "NO PASSPORT" panel) before the operator-lookup fix.
    expect(res.body.passport).toBeDefined();
    expect(res.body.passport.passport_number).toBe(passport);
    // passport_id is what PassportPanel actually renders — must be populated.
    expect(res.body.passport.passport_id).toBe(passport);
  });

  it('exposes isAdmin=false for a normal user', async () => {
    const u = await registerUser();
    const res = await request(app)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.identity.isAdmin).toBe(false);
  });

  it('exposes isAdmin=true for an admin user', async () => {
    const u = await registerUser();
    getDb().prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin' WHERE id = ?").run(u.userId);
    const res = await request(app)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.identity.isAdmin).toBe(true);
  });
});
