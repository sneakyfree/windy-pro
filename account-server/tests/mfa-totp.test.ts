/**
 * PR3 — MFA / TOTP flow
 *
 * Covers:
 *   - /mfa/setup returns secret + otpauthUrl + backup codes; row is unenabled
 *   - /mfa/verify-setup with wrong code → 400; with correct code → enabled_at set
 *   - Re-setup while pending → overwrites; re-setup while enabled → 409
 *   - Login w/o mfaCode for MFA user → 401 mfa_required
 *   - Login with valid TOTP → 200
 *   - Login with backup code → 200, backup code consumed (single-use)
 *   - Login with wrong code → 401 mfa_invalid
 *   - /mfa/disable wrong password → 401; correct → 200, MFA off
 *   - Secret stored encrypted (not plaintext base32)
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { generateTotpCodeForTest } from '../src/services/mfa';

// Each MFA setup hashes 10 backup codes with bcrypt; combined with the
// register-time password hash, individual tests can run >5s.
jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser() {
  const body = { name: 'MFA Test', email: uniqueEmail('mfa'), password: 'OldPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  // Pre-verify so login isn't blocked by PR1 email gate
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId, token: res.body.token };
}

async function setupMfa(token: string) {
  return request(app).post('/api/v1/auth/mfa/setup').set('Authorization', `Bearer ${token}`).send();
}

async function verifySetup(token: string, code: string) {
  return request(app).post('/api/v1/auth/mfa/verify-setup').set('Authorization', `Bearer ${token}`).send({ code });
}

async function disableMfa(token: string, password: string) {
  return request(app).post('/api/v1/auth/mfa/disable').set('Authorization', `Bearer ${token}`).send({ password });
}

async function login(email: string, password: string, mfaCode?: string) {
  const body: any = { email, password };
  if (mfaCode !== undefined) body.mfaCode = mfaCode;
  return request(app).post('/api/v1/auth/login').send(body);
}

/**
 * Walk a user from registration through enrolled MFA. Returns the secret +
 * backup codes so individual tests can simulate an authenticator app.
 */
async function enrollMfa() {
  const u = await registerUser();
  const setup = await setupMfa(u.token);
  expect(setup.status).toBe(200);
  const code = generateTotpCodeForTest(setup.body.secret);
  const verify = await verifySetup(u.token, code);
  expect(verify.status).toBe(200);
  return { ...u, secret: setup.body.secret, backupCodes: setup.body.backupCodes as string[] };
}

describe('PR3 — MFA / TOTP', () => {
  describe('POST /api/v1/auth/mfa/setup', () => {
    it('returns secret + otpauthUrl + 10 backup codes', async () => {
      const u = await registerUser();
      const res = await setupMfa(u.token);
      expect(res.status).toBe(200);
      expect(res.body.secret).toMatch(/^[A-Z2-7]+=*$/); // base32
      expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(res.body.backupCodes).toHaveLength(10);
      expect(res.body.backupCodes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it('stores secret encrypted (not plaintext base32)', async () => {
      const u = await registerUser();
      const res = await setupMfa(u.token);
      const row = getDb().prepare('SELECT totp_secret_encrypted FROM mfa_secrets WHERE user_id = ?').get(u.userId) as any;
      expect(row.totp_secret_encrypted).not.toBe(res.body.secret);
      // Hex ciphertext, not base32 plaintext
      expect(row.totp_secret_encrypted).toMatch(/^[0-9a-f]+$/);
    });

    it('row starts unenabled (enabled_at NULL)', async () => {
      const u = await registerUser();
      await setupMfa(u.token);
      const row = getDb().prepare('SELECT enabled_at FROM mfa_secrets WHERE user_id = ?').get(u.userId) as any;
      expect(row.enabled_at).toBeNull();
    });

    it('returns 409 when MFA is already enabled', async () => {
      const u = await enrollMfa();
      const res = await setupMfa(u.token);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('mfa_already_enabled');
    });

    it('overwrites a pending (unenabled) setup row when called again', async () => {
      const u = await registerUser();
      const r1 = await setupMfa(u.token);
      const r2 = await setupMfa(u.token);
      expect(r2.status).toBe(200);
      expect(r2.body.secret).not.toBe(r1.body.secret);
    });
  });

  describe('POST /api/v1/auth/mfa/verify-setup', () => {
    it('rejects wrong code with 400', async () => {
      const u = await registerUser();
      await setupMfa(u.token);
      const res = await verifySetup(u.token, '000000');
      expect(res.status).toBe(400);
    });

    it('rejects malformed code via schema', async () => {
      const u = await registerUser();
      await setupMfa(u.token);
      const res = await verifySetup(u.token, 'abc');
      expect(res.status).toBe(400);
    });

    it('returns 400 when no setup row exists', async () => {
      const u = await registerUser();
      const res = await verifySetup(u.token, '123456');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no mfa setup/i);
    });

    it('accepts correct TOTP and sets enabled_at', async () => {
      const u = await registerUser();
      const setup = await setupMfa(u.token);
      const code = generateTotpCodeForTest(setup.body.secret);
      const verify = await verifySetup(u.token, code);
      expect(verify.status).toBe(200);
      expect(verify.body.enabled).toBe(true);
      const row = getDb().prepare('SELECT enabled_at FROM mfa_secrets WHERE user_id = ?').get(u.userId) as any;
      expect(row.enabled_at).toBeTruthy();
    });
  });

  describe('Login MFA gate', () => {
    it('returns 401 mfa_required when MFA enabled and no mfaCode supplied', async () => {
      const u = await enrollMfa();
      const res = await login(u.email, u.password);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('mfa_required');
    });

    it('logs in with valid TOTP code', async () => {
      const u = await enrollMfa();
      const code = generateTotpCodeForTest(u.secret);
      const res = await login(u.email, u.password, code);
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('rejects invalid TOTP / backup code with 401 mfa_invalid', async () => {
      const u = await enrollMfa();
      const res = await login(u.email, u.password, '000000');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('mfa_invalid');
    });

    it('logs in with a backup code (single-use)', async () => {
      const u = await enrollMfa();
      const backup = u.backupCodes[0];
      const r1 = await login(u.email, u.password, backup);
      expect(r1.status).toBe(200);
      // Same backup code rejected on replay
      const r2 = await login(u.email, u.password, backup);
      expect(r2.status).toBe(401);
      expect(r2.body.code).toBe('mfa_invalid');
    });

    it('lowercase backup code is accepted (normalized)', async () => {
      const u = await enrollMfa();
      const res = await login(u.email, u.password, u.backupCodes[1].toLowerCase());
      expect(res.status).toBe(200);
    });

    it('non-MFA users are unaffected by mfaCode in body', async () => {
      const u = await registerUser();
      const res = await login(u.email, u.password, 'should-be-ignored');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/auth/mfa/disable', () => {
    it('rejects wrong password with 401', async () => {
      const u = await enrollMfa();
      const res = await disableMfa(u.token, 'WrongPass1Z');
      expect(res.status).toBe(401);
    });

    it('removes mfa_secrets row with correct password', async () => {
      const u = await enrollMfa();
      const res = await disableMfa(u.token, u.password);
      expect(res.status).toBe(200);
      const row = getDb().prepare('SELECT user_id FROM mfa_secrets WHERE user_id = ?').get(u.userId);
      expect(row).toBeUndefined();
      // Login no longer requires MFA
      const login1 = await login(u.email, u.password);
      expect(login1.status).toBe(200);
    });
  });
});
