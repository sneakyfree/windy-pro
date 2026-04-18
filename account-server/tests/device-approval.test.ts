/**
 * /device approval page — operator UI for OAuth device-code flow.
 *
 * Covers:
 *   - GET /device renders an HTML form (with optional code prefill)
 *   - POST /device/approve happy path: valid creds + valid code → success page
 *     and the device-code row flips to status='approved'
 *   - Wrong password → 401, generic "Email or password is incorrect" (no oracle)
 *   - Unknown email → 401, same generic error
 *   - Invalid user_code → 404 with retry guidance
 *   - Expired user_code → 400 with restart guidance
 *   - Deny action sets status='denied'
 *   - HTML output escapes user input (XSS guard)
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
  const body = { name: 'Device Test', email: uniqueEmail('device'), password: 'OldPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  // Pre-verify so login isn't blocked by PR1 email gate (irrelevant here, but keeps
  // the test deterministic if anything else checks it).
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId };
}

function createDeviceCode(opts: {
  userCode?: string;
  status?: string;
  expiresAtIso?: string;
}) {
  const userCode = (opts.userCode || `T${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`);
  const deviceCode = crypto.randomBytes(16).toString('hex');
  const clientId = `client-${crypto.randomBytes(4).toString('hex')}`;
  // Seed a client row so the FK in oauth_device_codes resolves
  getDb().prepare(`
    INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public)
    VALUES (?, NULL, 'Test Device Client', '[]', '[]', 0, 1)
  `).run(clientId);
  const expires = opts.expiresAtIso || new Date(Date.now() + 15 * 60 * 1000).toISOString();
  getDb().prepare(`
    INSERT INTO oauth_device_codes (device_code, user_code, client_id, scope, status, expires_at)
    VALUES (?, ?, ?, '', ?, ?)
  `).run(deviceCode, userCode, clientId, opts.status || 'pending', expires);
  return { deviceCode, userCode, clientId };
}

function getDeviceRow(userCode: string) {
  return getDb().prepare("SELECT status, identity_id FROM oauth_device_codes WHERE user_code = ?").get(userCode) as any;
}

describe('Device approval page (/device)', () => {
  describe('GET /device', () => {
    it('renders an HTML page with a code+credentials form', async () => {
      const res = await request(app).get('/device');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('action="/device/approve"');
      expect(res.text).toContain('name="user_code"');
      expect(res.text).toContain('name="email"');
      expect(res.text).toContain('name="password"');
      expect(res.text).toContain('Approve');
      expect(res.text).toContain('Deny');
    });

    it('prefills user_code from query string (uppercased)', async () => {
      const res = await request(app).get('/device').query({ user_code: 'abcd-1234' });
      expect(res.text).toContain('value="ABCD-1234"');
    });

    it('escapes HTML in the user_code prefill (XSS guard)', async () => {
      const res = await request(app).get('/device').query({ user_code: '<img src=x>' });
      // The code becomes uppercased + escaped
      expect(res.text).not.toContain('<img src=x>');
      expect(res.text).toMatch(/&lt;IMG SRC=X&gt;|&lt;img src=x&gt;/i);
    });
  });

  describe('POST /device/approve', () => {
    it('happy path: valid creds + valid user_code → success page + device flipped to approved', async () => {
      const u = await registerUser();
      const dc = createDeviceCode({});
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: dc.userCode,
          email: u.email,
          password: u.password,
          action: 'approve',
        });
      expect(res.status).toBe(200);
      expect(res.text).toContain('Approved');
      const row = getDeviceRow(dc.userCode);
      expect(row.status).toBe('approved');
      expect(row.identity_id).toBe(u.userId);
    });

    it('wrong password → 401 with generic "Email or password is incorrect"', async () => {
      const u = await registerUser();
      const dc = createDeviceCode({});
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: dc.userCode,
          email: u.email,
          password: 'WrongPass1Z',
          action: 'approve',
        });
      expect(res.status).toBe(401);
      expect(res.text).toContain('Email or password is incorrect');
      // Code remains pending
      expect(getDeviceRow(dc.userCode).status).toBe('pending');
    });

    it('unknown email → same 401 (no enumeration)', async () => {
      const dc = createDeviceCode({});
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: dc.userCode,
          email: uniqueEmail('does-not-exist'),
          password: 'AnyPass1A',
          action: 'approve',
        });
      expect(res.status).toBe(401);
      expect(res.text).toContain('Email or password is incorrect');
    });

    it('unknown user_code → 404 with retry guidance', async () => {
      const u = await registerUser();
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: 'NOPE-NOPE',
          email: u.email,
          password: u.password,
          action: 'approve',
        });
      expect(res.status).toBe(404);
      expect(res.text).toContain('does not exist');
    });

    it('expired user_code → 400 with restart guidance', async () => {
      const u = await registerUser();
      const dc = createDeviceCode({
        expiresAtIso: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: dc.userCode,
          email: u.email,
          password: u.password,
          action: 'approve',
        });
      expect(res.status).toBe(400);
      expect(res.text).toMatch(/expired/i);
    });

    it('deny action → status="denied", no identity_id set', async () => {
      const u = await registerUser();
      const dc = createDeviceCode({});
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: dc.userCode,
          email: u.email,
          password: u.password,
          action: 'deny',
        });
      expect(res.status).toBe(200);
      expect(res.text).toContain('Denied');
      const row = getDeviceRow(dc.userCode);
      expect(row.status).toBe('denied');
    });

    it('missing fields → 400 with form re-rendered', async () => {
      const res = await request(app).post('/device/approve').type('form').send({});
      expect(res.status).toBe(400);
      expect(res.text).toContain('Enter the code');
    });

    it('case-insensitive user_code (entered lowercase, stored uppercase)', async () => {
      const u = await registerUser();
      // Per-test unique code so the persistent DB doesn't collide on UNIQUE
      const upper = `LC${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      createDeviceCode({ userCode: upper });
      const res = await request(app)
        .post('/device/approve')
        .type('form')
        .send({
          user_code: upper.toLowerCase(),
          email: u.email,
          password: u.password,
          action: 'approve',
        });
      expect(res.status).toBe(200);
      expect(getDeviceRow(upper).status).toBe('approved');
    });
  });
});
