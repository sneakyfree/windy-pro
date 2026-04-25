/**
 * P1-8 + P1-11 — `/api/v1/auth/chat-validate` must use constant-time
 * comparison for the shared secret. String `!==` leaked byte-position
 * timing to an attacker making many attempts.
 *
 * This test pins the observable behavior: correct secret accepted,
 * any mismatch rejected with 403, no info leaked via status codes or
 * timing-observable shape. (Actual timing uniformity is below test
 * granularity; the test asserts that the comparison uses `timingSafeEqual`
 * via a code-search invariant.)
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.SYNAPSE_REGISTRATION_SECRET = 'chat-validate-p1-11-test-shared-secret';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(15000);

const SECRET = process.env.SYNAPSE_REGISTRATION_SECRET!;

describe('P1-11 chat-validate constant-time secret comparison', () => {
  // Seed a real user so the secret-gate branch gets fully exercised.
  const email = `chat-validate-${Date.now()}@test.com`;
  const password = 'GoodPass1A';
  let userId: string;

  beforeAll(async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ name: 'CV', email, password });
    expect(reg.status).toBe(201);
    userId = reg.body.userId;
    // Pre-verify so the email-verification gate doesn't kick in
    getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  });

  it('correct shared_secret passes the gate', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({ username: email, password, shared_secret: SECRET });
    expect(res.status).toBeLessThan(400);
    expect(res.body.valid).toBe(true);
  });

  it('wrong shared_secret → 403', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({ username: email, password, shared_secret: 'wrong-secret' });
    expect(res.status).toBe(403);
    expect(res.body.valid).toBe(false);
  });

  it('empty shared_secret → 403 (fail-closed)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({ username: email, password, shared_secret: '' });
    expect(res.status).toBe(403);
  });

  it('missing shared_secret → 403', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({ username: email, password });
    expect(res.status).toBe(403);
  });

  it('non-string shared_secret → 403', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({ username: email, password, shared_secret: 12345 });
    expect(res.status).toBe(403);
  });

  it('shared_secret with correct prefix but wrong tail → 403 (equal-length byte mismatch)', async () => {
    const wrong = SECRET.slice(0, -1) + 'X';
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({ username: email, password, shared_secret: wrong });
    expect(res.status).toBe(403);
  });

  it('handler uses crypto.timingSafeEqual (source-level invariant)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', 'auth.ts'),
      'utf-8',
    );
    // Find the chat-validate handler block and confirm it calls timingSafeEqual
    const block = src.split("router.post('/chat-validate'")[1] ?? '';
    const gateBlock = block.split('router.')[0]; // just this handler
    expect(gateBlock).toMatch(/crypto\.timingSafeEqual\(/);
    // And does NOT fall back to `!==` for the secret comparison
    expect(gateBlock).not.toMatch(/shared_secret\s*!==\s*expectedSecret/);
  });
});
