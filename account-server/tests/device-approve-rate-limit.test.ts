/**
 * P0-3 — /device/approve must not allow unlimited password brute-force.
 *
 * Before Wave 7 hardening, any attacker with a valid user_code (which is
 * issued freely at `POST /api/v1/oauth/device`) could hammer /device/approve
 * with a target email and a dictionary — no rate limit, no lockout.
 *
 * This PR adds:
 *   - A 5/10min rate limit keyed by (ip, email, user_code)
 *   - A per-(email, user_code) wrong-attempt counter that invalidates the
 *     user_code after 5 incorrect passwords (future correct password on
 *     same code no longer works; user has to restart sign-in)
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser() {
  const body = { name: 'Approve Rate Test', email: uniqueEmail('rl'), password: 'GoodPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId };
}

function seedDeviceCode(userCodeOverride?: string) {
  const userCode = userCodeOverride ?? `TP${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const deviceCode = crypto.randomBytes(16).toString('hex');
  const clientId = `client-${crypto.randomBytes(4).toString('hex')}`;
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public)
      VALUES (?, NULL, 'Test P0-3 Client', '[]', '[]', 1, 1)
    `).run(clientId);
  } catch { /* already exists */ }
  db.prepare(`
    INSERT INTO oauth_device_codes (device_code, user_code, client_id, scope, status, expires_at)
    VALUES (?, ?, ?, 'openid profile email', 'pending', ?)
  `).run(deviceCode, userCode, clientId, new Date(Date.now() + 15 * 60 * 1000).toISOString());
  return { deviceCode, userCode, clientId };
}

function statusFor(userCode: string) {
  return (getDb().prepare("SELECT status FROM oauth_device_codes WHERE user_code = ?").get(userCode) as any)?.status;
}

describe('P0-3 /device/approve brute-force protection', () => {
  // The rate limiter is disabled under NODE_ENV=test (max=10000), so the
  // handler-level WRONG_LIMIT is what we're primarily testing here.

  it('invalidates the user_code after 5 wrong password attempts', async () => {
    const u = await registerUser();
    const dc = seedDeviceCode();

    // 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/device/approve')
        .type('form')
        .send({ user_code: dc.userCode, email: u.email, password: `wrong-${i}`, action: 'approve' });
      expect(r.status).toBe(401);
    }

    // 6th attempt (even with correct password) should be blocked → code invalid
    const sixth = await request(app)
      .post('/device/approve')
      .type('form')
      .send({ user_code: dc.userCode, email: u.email, password: u.password, action: 'approve' });
    expect(sixth.status).toBe(429);
    expect(sixth.text).toMatch(/Too many/i);

    // DB state: user_code marked denied (so even a later /oauth/token poll
    // returns access_denied instead of dangling on authorization_pending).
    expect(statusFor(dc.userCode)).toBe('denied');
  });

  it('a correct password before the limit clears the counter', async () => {
    const u = await registerUser();
    const dc = seedDeviceCode();

    // 3 wrong attempts
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/device/approve')
        .type('form')
        .send({ user_code: dc.userCode, email: u.email, password: `wrong-${i}`, action: 'approve' });
    }

    // Correct password — should succeed and clear wrong-count
    const ok = await request(app)
      .post('/device/approve')
      .type('form')
      .send({ user_code: dc.userCode, email: u.email, password: u.password, action: 'approve' });
    expect(ok.status).toBe(200);
    expect(statusFor(dc.userCode)).toBe('approved');
  });

  it('wrong-attempt counters are per-(email, user_code), not global', async () => {
    const u1 = await registerUser();
    const u2 = await registerUser();
    const dc = seedDeviceCode();

    // u1 exhausts the counter
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/device/approve')
        .type('form')
        .send({ user_code: dc.userCode, email: u1.email, password: `x-${i}`, action: 'approve' });
    }
    expect(statusFor(dc.userCode)).toBe('denied');

    // u2 should NOT be affected by u1's lockout on a different code
    const dc2 = seedDeviceCode();
    const r = await request(app)
      .post('/device/approve')
      .type('form')
      .send({ user_code: dc2.userCode, email: u2.email, password: u2.password, action: 'approve' });
    expect(r.status).toBe(200);
  });

  it('deny action never triggers the wrong-counter', async () => {
    const u = await registerUser();
    const dc = seedDeviceCode();
    const r = await request(app)
      .post('/device/approve')
      .type('form')
      .send({ user_code: dc.userCode, email: u.email, password: u.password, action: 'deny' });
    expect(r.status).toBe(200);
    expect(statusFor(dc.userCode)).toBe('denied');
  });
});
