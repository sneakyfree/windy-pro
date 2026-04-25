/**
 * P1-9 — /api/v1/auth/verify-email now has an outer per-user hourly
 * cap on top of the per-code attempts counter. Without it, an attacker
 * with a stolen session token could burn through codes by calling
 * /send-verification (3/hr per user) and getting 5 attempts each time —
 * 15 guesses/hr against a 6-digit code. Still far from feasible, but
 * the per-user hourly cap on verify-email itself removes the amplification.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser() {
  const body = { name: 'P1-9', email: uniqueEmail('p1-9'), password: 'GoodPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId, token: res.body.token };
}

describe('P1-9 /verify-email outer rate limit', () => {
  it('emits RateLimit-* headers → limiter is attached', async () => {
    const u = await registerUser();
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ code: '000000' });
    // 400 because no real code exists, but the limiter middleware still ran
    // and set the RateLimit-* headers.
    expect(
      res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit'],
    ).toBeDefined();
  });

  it('still returns 400 on wrong code (limiter does not block first request)', async () => {
    const u = await registerUser();
    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ code: '000000' });
    expect(res.status).toBe(400);
  });

  it('source invariant: /verify-email uses verifyEmailLimiter (not reverted)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', 'auth.ts'),
      'utf-8',
    );
    // Find the handler line and confirm it includes verifyEmailLimiter
    const line = src
      .split('\n')
      .find(l => l.includes("router.post('/verify-email'"));
    expect(line).toBeDefined();
    expect(line).toContain('verifyEmailLimiter');
  });

  it('limiter is keyed by authed user id, not IP', () => {
    // Guard against someone changing the keyGenerator to req.ip, which
    // would let one attacker exhaust their own IP's bucket and block
    // legitimate users behind the same NAT/IP.
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', 'auth.ts'),
      'utf-8',
    );
    const block = src.split('const verifyEmailLimiter')[1] ?? '';
    const firstHandler = block.split('\n\n')[0];
    expect(firstHandler).toMatch(/user\?\.userId/);
  });
});
