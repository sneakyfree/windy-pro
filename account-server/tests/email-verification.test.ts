/**
 * PR1 — Email verification flow
 *
 * Covers:
 *   - send-verification issues a code (dev stub returns _devCode)
 *   - verify-email with wrong code → 400
 *   - verify-email with correct code → 200, sets users.email_verified=1
 *   - 5 wrong attempts invalidates the outstanding code
 *   - Login gate: unverified account >24h old → 403 email_verification_required
 *   - Login gate: unverified account <24h old → 200 (grace window)
 *   - Login gate: verified account → 200
 *   - Already-verified send-verification → returns alreadyVerified:true, no new code
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
// RESEND_API_KEY intentionally unset so the mailer falls back to the stub.

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

// Login-gate cases register users (bcrypt) and the brute-force test runs
// 5 verifies in a row. Under heavier full-suite load these can exceed the
// 5s default — matches password-reset / mfa-totp / webhook-fanout.
jest.setTimeout(30000);

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser(overrides: Partial<{ email: string; name: string; password: string }> = {}) {
  const body = {
    name: overrides.name || 'Verify Test',
    email: overrides.email || uniqueEmail('verify'),
    password: overrides.password || 'SecurePass1',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  return { ...body, token: res.body.token, userId: res.body.userId };
}

async function sendVerification(token: string) {
  const res = await request(app)
    .post('/api/v1/auth/send-verification')
    .set('Authorization', `Bearer ${token}`)
    .send();
  return res;
}

async function verifyEmail(token: string, code: string) {
  return request(app)
    .post('/api/v1/auth/verify-email')
    .set('Authorization', `Bearer ${token}`)
    .send({ code });
}

function setUserCreatedAt(userId: string, createdAt: string) {
  getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, userId);
}

function setUserVerified(userId: string, verified: boolean) {
  getDb().prepare('UPDATE users SET email_verified = ? WHERE id = ?').run(verified ? 1 : 0, userId);
}

function getOtpRowsForUser(userId: string) {
  return getDb().prepare(
    "SELECT id, code_hash, expires_at, consumed_at, attempts FROM otp_codes WHERE user_id = ? AND purpose = 'email_verification' ORDER BY created_at DESC",
  ).all(userId) as any[];
}

describe('PR1 — Email Verification', () => {
  describe('POST /api/v1/auth/send-verification', () => {
    it('issues a 6-digit code (dev stub returns _devCode)', async () => {
      const u = await registerUser();
      const res = await sendVerification(u.token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sent).toBe(true);
      expect(res.body._devCode).toMatch(/^\d{6}$/);
    });

    it('returns alreadyVerified:true for verified accounts', async () => {
      const u = await registerUser();
      setUserVerified(u.userId, true);
      const res = await sendVerification(u.token);
      expect(res.status).toBe(200);
      expect(res.body.alreadyVerified).toBe(true);
      expect(res.body.sent).toBeUndefined();
    });

    it('invalidates the previous unconsumed code on resend', async () => {
      const u = await registerUser();
      const r1 = await sendVerification(u.token);
      const code1 = r1.body._devCode;
      await sendVerification(u.token); // resend
      const wrong = await verifyEmail(u.token, code1);
      // The original code's row should now be consumed_at != NULL
      expect(wrong.status).toBe(400); // hash won't match the latest unconsumed row
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('rejects a wrong 6-digit code with 400', async () => {
      const u = await registerUser();
      await sendVerification(u.token);
      const res = await verifyEmail(u.token, '000000');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid verification code/);
    });

    it('rejects a malformed code via schema validation', async () => {
      const u = await registerUser();
      const res = await verifyEmail(u.token, 'abc');
      expect(res.status).toBe(400); // zod rejects pre-handler
    });

    it('accepts the correct code and flips users.email_verified=1', async () => {
      const u = await registerUser();
      const r = await sendVerification(u.token);
      const code = r.body._devCode;
      const verify = await verifyEmail(u.token, code);
      expect(verify.status).toBe(200);
      expect(verify.body.verified).toBe(true);

      const row = getDb().prepare('SELECT email_verified FROM users WHERE id = ?').get(u.userId) as any;
      expect(row.email_verified).toBe(1);
    });

    it('rejects the same code on second use (consumed)', async () => {
      const u = await registerUser();
      const r = await sendVerification(u.token);
      const code = r.body._devCode;
      await verifyEmail(u.token, code);
      const second = await verifyEmail(u.token, code);
      expect(second.status).toBe(400); // hash matches but row is consumed
    });

    it('after 5 wrong attempts, invalidates the code (429)', async () => {
      const u = await registerUser();
      await sendVerification(u.token);
      // 4 wrong attempts → still 400 each
      for (let i = 0; i < 4; i++) {
        const r = await verifyEmail(u.token, '000000');
        expect(r.status).toBe(400);
      }
      // 5th wrong attempt → 429 (code invalidated)
      const r5 = await verifyEmail(u.token, '000000');
      expect(r5.status).toBe(429);
    });

    it('rejects an expired code', async () => {
      const u = await registerUser();
      const r = await sendVerification(u.token);
      const code = r.body._devCode;
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      // Force-expire the row (use ISO string to match production INSERT format)
      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      getDb().prepare(
        'UPDATE otp_codes SET expires_at = ? WHERE user_id = ? AND code_hash = ?',
      ).run(pastIso, u.userId, codeHash);
      const verify = await verifyEmail(u.token, code);
      expect(verify.status).toBe(400);
      expect(verify.body.error).toMatch(/expired/i);
    });
  });

  describe('Login gate', () => {
    it('blocks unverified accounts older than 24h with 403 + code:email_verification_required', async () => {
      const u = await registerUser();
      // Ensure unverified, force created_at to 25h ago
      setUserVerified(u.userId, false);
      setUserCreatedAt(u.userId, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: u.email, password: u.password });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('email_verification_required');
      expect(res.body.email).toBe(u.email);
    });

    it('allows unverified accounts within the 24h grace window', async () => {
      const u = await registerUser();
      setUserVerified(u.userId, false);
      // created_at is now-ish from registration; should be < 24h
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: u.email, password: u.password });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('allows verified accounts regardless of age', async () => {
      const u = await registerUser();
      setUserVerified(u.userId, true);
      setUserCreatedAt(u.userId, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: u.email, password: u.password });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });
  });

  describe('OTP storage hygiene', () => {
    it('stores sha256 hash, never the raw code', async () => {
      const u = await registerUser();
      const r = await sendVerification(u.token);
      const code = r.body._devCode;
      const rows = getOtpRowsForUser(u.userId);
      const latest = rows[0];
      expect(latest.code_hash).not.toBe(code);
      expect(latest.code_hash).toBe(crypto.createHash('sha256').update(code).digest('hex'));
    });
  });
});
