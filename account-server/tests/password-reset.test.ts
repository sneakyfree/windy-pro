/**
 * PR2 — Password reset flow
 *
 * Covers:
 *   - forgot-password always returns 200 (even for unknown email)
 *   - forgot-password issues a reset token (dev stub returns _devToken)
 *   - reset-password rejects unknown / expired / consumed tokens
 *   - reset-password accepts valid token, hashes new password, login works
 *   - reset-password invalidates ALL refresh tokens for the user
 *   - reset-password rejects weak passwords via zod
 */
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser() {
  const body = { name: 'Reset Test', email: uniqueEmail('reset'), password: 'OldPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  // Pre-verify so login isn't blocked by the email gate during test
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId, refreshToken: res.body.refreshToken };
}

async function forgot(email: string) {
  return request(app).post('/api/v1/auth/forgot-password').send({ email });
}

async function reset(token: string, newPassword: string) {
  return request(app).post('/api/v1/auth/reset-password').send({ token, newPassword });
}

async function login(email: string, password: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

describe('PR2 — Password Reset', () => {
  describe('POST /api/v1/auth/forgot-password', () => {
    it('returns 200 for an unknown email (no enumeration)', async () => {
      const res = await forgot(uniqueEmail('does-not-exist'));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body._devToken).toBeUndefined(); // no token issued for unknown emails
    });

    it('returns 200 + dev token for a known email (stub mailer)', async () => {
      const u = await registerUser();
      const res = await forgot(u.email);
      expect(res.status).toBe(200);
      expect(res.body._devToken).toEqual(expect.any(String));
      expect(res.body._devToken.length).toBeGreaterThanOrEqual(20);
    });

    it('stores sha256 hash of the token, not the raw token', async () => {
      const u = await registerUser();
      const res = await forgot(u.email);
      const token = res.body._devToken;
      const row = getDb().prepare(
        "SELECT code_hash FROM otp_codes WHERE user_id = ? AND purpose = 'password_reset' ORDER BY created_at DESC LIMIT 1",
      ).get(u.userId) as any;
      expect(row.code_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
      expect(row.code_hash).not.toBe(token);
    });

    it('invalidates the previous reset token on resend', async () => {
      const u = await registerUser();
      const r1 = await forgot(u.email);
      const t1 = r1.body._devToken;
      await forgot(u.email); // resend invalidates t1
      const reset1 = await reset(t1, 'NewPass1B');
      expect(reset1.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('rejects an unknown token with 400', async () => {
      const res = await reset(crypto.randomBytes(32).toString('base64url'), 'NewPass1B');
      expect(res.status).toBe(400);
    });

    it('rejects a malformed token via schema (too short)', async () => {
      const res = await reset('short', 'NewPass1B');
      expect(res.status).toBe(400);
    });

    it('rejects a weak new password via PasswordSchema', async () => {
      const u = await registerUser();
      const r = await forgot(u.email);
      const res = await reset(r.body._devToken, 'weak');
      expect(res.status).toBe(400);
    });

    it('rejects an expired token', async () => {
      const u = await registerUser();
      const r = await forgot(u.email);
      const token = r.body._devToken;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      getDb().prepare(
        'UPDATE otp_codes SET expires_at = ? WHERE code_hash = ?',
      ).run(pastIso, tokenHash);
      const res = await reset(token, 'NewPass1B');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });

    it('accepts a valid token, sets new password, and old password no longer works', async () => {
      const u = await registerUser();
      const r = await forgot(u.email);
      const reset1 = await reset(r.body._devToken, 'BrandNew1C');
      expect(reset1.status).toBe(200);

      // Old password fails
      const oldLogin = await login(u.email, u.password);
      expect(oldLogin.status).toBe(401);

      // New password works
      const newLogin = await login(u.email, 'BrandNew1C');
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.token).toBeTruthy();
    });

    it('rejects token replay (consumed)', async () => {
      const u = await registerUser();
      const r = await forgot(u.email);
      const token = r.body._devToken;
      const ok = await reset(token, 'BrandNew1C');
      expect(ok.status).toBe(200);
      const replay = await reset(token, 'AnotherPass1D');
      expect(replay.status).toBe(400);
    });

    it('invalidates ALL existing refresh tokens for the user', async () => {
      const u = await registerUser();
      // Pre-condition: refresh token from registration should exist
      const before = getDb().prepare('SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ?').get(u.userId) as any;
      expect(before.c).toBeGreaterThan(0);

      const r = await forgot(u.email);
      const ok = await reset(r.body._devToken, 'BrandNew1C');
      expect(ok.status).toBe(200);

      const after = getDb().prepare('SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ?').get(u.userId) as any;
      expect(after.c).toBe(0);

      // The original refreshToken cannot be exchanged
      const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken });
      expect(refresh.status).toBe(401);
    });

    it('actually bcrypt-hashes the new password (not stored plain)', async () => {
      const u = await registerUser();
      const r = await forgot(u.email);
      await reset(r.body._devToken, 'BrandNew1C');
      const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(u.userId) as any;
      expect(row.password_hash).not.toBe('BrandNew1C');
      expect(await bcrypt.compare('BrandNew1C', row.password_hash)).toBe(true);
    });
  });
});
