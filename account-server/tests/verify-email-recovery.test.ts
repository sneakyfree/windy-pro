/**
 * Lockout recovery — unauthenticated email verification
 *
 * THE BUG (launch blocker): an unverified account older than 24h gets
 * 403 email_verification_required at login (routes/auth.ts login gate),
 * but the only code-send endpoint (/send-verification) requires a Bearer
 * token — which the locked-out user can no longer obtain. Chicken-and-egg,
 * no exit. Password reset does not set email_verified, so it's no way out.
 *
 * THE FIX under test: two unauthenticated, rate-limited endpoints.
 * Possession of the emailed code proves control of the address, so no
 * token is needed:
 *   - POST /api/v1/auth/resend-verification {email} → ALWAYS a generic
 *     200 {ok:true} (no user enumeration); issues/reuses a code only for
 *     existing unverified accounts.
 *   - POST /api/v1/auth/verify-email-code {email, code} → validates the
 *     code exactly like the authed /verify-email (same otp_codes row,
 *     hash, expiry, 5-attempt cap) and flips users.email_verified=1.
 *
 * Conventions mirror tests/email-verification.test.ts.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
// RESEND_API_KEY intentionally unset so the mailer falls back to the stub.

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

// Registration uses bcrypt and the recovery-path test chains several
// requests — matches email-verification / password-reset suites.
jest.setTimeout(30000);

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser(overrides: Partial<{ email: string; name: string; password: string }> = {}) {
  const body = {
    name: overrides.name || 'Recovery Test',
    email: overrides.email || uniqueEmail('recovery'),
    password: overrides.password || 'SecurePass1',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  return { ...body, token: res.body.token, userId: res.body.userId };
}

// Authed send — used only to CAPTURE the dev-stub code (_devCode), since the
// unauthenticated resend deliberately never returns the code in the body.
async function sendVerificationAuthed(token: string) {
  return request(app)
    .post('/api/v1/auth/send-verification')
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

async function resendUnauthed(email: string) {
  return request(app).post('/api/v1/auth/resend-verification').send({ email });
}

async function verifyCodeUnauthed(email: string, code: string) {
  return request(app).post('/api/v1/auth/verify-email-code').send({ email, code });
}

async function login(email: string, password: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

function setUserCreatedAt(userId: string, createdAt: string) {
  getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, userId);
}

function setUserVerified(userId: string, verified: boolean) {
  getDb().prepare('UPDATE users SET email_verified = ? WHERE id = ?').run(verified ? 1 : 0, userId);
}

function getUserRow(userId: string) {
  return getDb().prepare('SELECT email_verified FROM users WHERE id = ?').get(userId) as any;
}

function getOtpRowsForUser(userId: string) {
  return getDb().prepare(
    "SELECT id, code_hash, expires_at, consumed_at, attempts FROM otp_codes WHERE user_id = ? AND purpose = 'email_verification' ORDER BY created_at DESC",
  ).all(userId) as any[];
}

describe('Lockout recovery — unauthenticated email verification', () => {
  describe('POST /api/v1/auth/resend-verification', () => {
    it('returns a generic 200 and creates an otp code for an unverified user', async () => {
      const u = await registerUser();
      // /register deliberately does not send a code, so there are none yet.
      expect(getOtpRowsForUser(u.userId).length).toBe(0);

      const res = await resendUnauthed(u.email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      // The raw code must NEVER be exposed on the unauthenticated path,
      // even in dev-stub mode.
      expect(res.body._devCode).toBeUndefined();

      const rows = getOtpRowsForUser(u.userId);
      expect(rows.length).toBe(1);
      expect(rows[0].consumed_at).toBeFalsy();
    });

    it('returns the same generic 200 for an already-verified user and mints no new code', async () => {
      const u = await registerUser();
      setUserVerified(u.userId, true);
      const before = getOtpRowsForUser(u.userId).length;

      const res = await resendUnauthed(u.email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(getOtpRowsForUser(u.userId).length).toBe(before);
    });

    it('returns the same generic 200 for an unknown email (no enumeration)', async () => {
      const res = await resendUnauthed(uniqueEmail('ghost'));
      expect(res.status).toBe(200);
      // Byte-identical shape to the known-unverified case above.
      expect(res.body).toEqual({ ok: true });
    });

    it('reuses a still-valid code instead of invalidating the one in the inbox', async () => {
      const u = await registerUser();
      const sent = await sendVerificationAuthed(u.token);
      expect(sent.status).toBe(200);
      const hashBefore = getOtpRowsForUser(u.userId)[0].code_hash;

      const res = await resendUnauthed(u.email);
      expect(res.status).toBe(200);

      const rows = getOtpRowsForUser(u.userId);
      expect(rows.length).toBe(1);
      expect(rows[0].code_hash).toBe(hashBefore);
      expect(rows[0].consumed_at).toBeFalsy();
    });
  });

  describe('POST /api/v1/auth/verify-email-code', () => {
    it('rejects a wrong code with a generic 400 and leaves the account unverified', async () => {
      const u = await registerUser();
      await sendVerificationAuthed(u.token);

      // generateOtpCode() produces 100000–999999, so 000000 is never valid.
      const res = await verifyCodeUnauthed(u.email, '000000');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid verification code/);
      expect(getUserRow(u.userId).email_verified).toBe(0);
    });

    it('rejects an unknown email with the same generic 400 as a wrong code (no enumeration)', async () => {
      const res = await verifyCodeUnauthed(uniqueEmail('ghost'), '123456');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid verification code/);
    });

    it('honors the 5-wrong-attempts cap (429 + code invalidated), like the authed handler', async () => {
      const u = await registerUser();
      const sent = await sendVerificationAuthed(u.token);
      const code = sent.body._devCode;

      for (let i = 0; i < 4; i++) {
        const r = await verifyCodeUnauthed(u.email, '000000');
        expect(r.status).toBe(400);
      }
      const r5 = await verifyCodeUnauthed(u.email, '000000');
      expect(r5.status).toBe(429);

      // The outstanding (now-invalidated) code no longer works either.
      const stale = await verifyCodeUnauthed(u.email, code);
      expect(stale.status).toBe(400);
    });
  });

  describe('Full recovery path (the launch-blocker scenario)', () => {
    it('locked-out >24h unverified user verifies via {email, code} and can then log in', async () => {
      const u = await registerUser();

      // Capture the dev-stub code while we still hold the registration token
      // (the JWT stays valid; only LOGIN is gated at >24h).
      const sent = await sendVerificationAuthed(u.token);
      expect(sent.status).toBe(200);
      const code = sent.body._devCode;
      expect(code).toMatch(/^\d{6}$/);

      // Age the account past the grace window → the lockout reproduces.
      setUserCreatedAt(u.userId, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
      const blocked = await login(u.email, u.password);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('email_verification_required');

      // The unauthenticated resend keeps the inbox code alive (idempotent
      // reuse — it must NOT mint over the code she's about to type).
      const resend = await resendUnauthed(u.email);
      expect(resend.status).toBe(200);
      expect(resend.body).toEqual({ ok: true });

      // Possession of the emailed code proves address control — no token.
      const verify = await verifyCodeUnauthed(u.email, code);
      expect(verify.status).toBe(200);
      expect(verify.body.verified).toBe(true);
      expect(getUserRow(u.userId).email_verified).toBe(1);

      // The gate now opens.
      const unlocked = await login(u.email, u.password);
      expect(unlocked.status).toBe(200);
      expect(unlocked.body.token).toBeTruthy();
    });

    it('rejects the same code on second use (consumed), same as the authed flow', async () => {
      const u = await registerUser();
      const sent = await sendVerificationAuthed(u.token);
      const code = sent.body._devCode;

      const first = await verifyCodeUnauthed(u.email, code);
      expect(first.status).toBe(200);
      const second = await verifyCodeUnauthed(u.email, code);
      expect(second.status).toBe(400);
    });
  });
});
