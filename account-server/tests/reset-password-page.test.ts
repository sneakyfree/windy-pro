/**
 * P1-14 — /reset-password page must actually render + POST successfully.
 *
 * Before this route existed, users who clicked the reset-password link
 * in their email hit the SPA 404. This locks in:
 *   - GET /reset-password?token=X returns HTML with the token embedded
 *     so the form submission round-trips it
 *   - POST /reset-password with valid token + matching passwords
 *     actually updates the password (via the API)
 *   - POST with mismatched confirm returns 400 + renders the form again
 *     with the token still filled so the user can retry
 *   - GET with no token still renders (with an error banner), not 500
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

async function registerAndGetResetToken(email: string): Promise<string> {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Reset', email, password: 'GoodPass1A' });
  expect(reg.status).toBe(201);

  const f = await request(app).post('/api/v1/auth/forgot-password').send({ email });
  expect(f.status).toBe(200);
  expect(typeof f.body._devToken).toBe('string');
  return f.body._devToken as string;
}

describe('P1-14 /reset-password page', () => {
  it('GET renders HTML with the token pre-filled', async () => {
    const token = crypto.randomBytes(32).toString('base64url');
    const res = await request(app).get(`/reset-password?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Reset password');
    expect(res.text).toContain(`value="${token}"`);
  });

  it('GET with no token still renders (does not 500)', async () => {
    const res = await request(app).get('/reset-password');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Reset password');
  });

  it('POST with valid token + matching passwords succeeds', async () => {
    const email = uniqueEmail('reset-page');
    const token = await registerAndGetResetToken(email);

    const res = await request(app)
      .post('/reset-password')
      .type('form')
      .send({ token, password: 'NewGoodPass1B', confirm: 'NewGoodPass1B' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Password reset');

    // And the new password actually works.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewGoodPass1B' });
    expect(login.status).toBe(200);
  });

  it('POST with mismatched confirm → 400 and keeps the token in the form', async () => {
    const email = uniqueEmail('reset-page-mismatch');
    const token = await registerAndGetResetToken(email);

    const res = await request(app)
      .post('/reset-password')
      .type('form')
      .send({ token, password: 'NewGoodPass1B', confirm: 'DifferentPass1C' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/do not match/i);
    expect(res.text).toContain(`value="${token}"`);
  });

  it('POST with too-short password → 400', async () => {
    const res = await request(app)
      .post('/reset-password')
      .type('form')
      .send({ token: 'any-token', password: 'short', confirm: 'short' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/at least 8 characters/i);
  });

  it('POST with no token → 400', async () => {
    const res = await request(app)
      .post('/reset-password')
      .type('form')
      .send({ password: 'GoodPass1A', confirm: 'GoodPass1A' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Missing reset token/i);
  });

  it('sets Cache-Control: no-store so browsers never cache the form', async () => {
    const res = await request(app).get('/reset-password?token=x');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});
