/**
 * P0-2 — Eternitas webhook signature must be REQUIRED regardless of NODE_ENV.
 *
 * Before Wave 7 hardening, both `/api/v1/identity/eternitas/webhook` and
 * `/api/v1/identity/webhooks/eternitas` skipped verification when the
 * secret was unset in non-production. That meant any unauthenticated POST
 * could trigger `processEternitasEvent` / `cascadeRevocation` — an attacker
 * on the network could kill a target bot's product accounts.
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.ETERNITAS_WEBHOOK_SECRET = 'test-eternitas-webhook-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

import { app } from '../src/server';

const SECRET = process.env.ETERNITAS_WEBHOOK_SECRET!;

function sign(event: string, passport: string, timestamp: number): string {
  return crypto.createHmac('sha256', SECRET)
    .update(`${event}:${passport}:${timestamp}`)
    .digest('hex');
}

function signBody(body: any): string {
  return crypto.createHmac('sha256', SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

describe('POST /api/v1/identity/eternitas/webhook — signature enforcement', () => {
  it('rejects a request with NO signature (401 Missing)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.revoked', passportNumber: 'ET-ABCD1234', timestamp: now });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing/i);
  });

  it('rejects a request with WRONG signature (401 Invalid)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.revoked', passportNumber: 'ET-ABCD1234', timestamp: now, signature: 'not-a-signature' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/i);
  });

  it('accepts a request with CORRECT signature', async () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = sign('passport.revoked', 'ET-NOTFOUND', now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.revoked', passportNumber: 'ET-NOTFOUND', timestamp: now, signature: sig });
    // passport doesn't exist → cascadeRevocation logs a warning but still 200s
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(401);
  });

  it('rejects a replayed signature (timestamp > 5 min old)', async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const sig = sign('passport.revoked', 'ET-ABCD1234', oldTs);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.revoked', passportNumber: 'ET-ABCD1234', timestamp: oldTs, signature: sig });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/window|timestamp/i);
  });

  it('rejects a signature computed with a different secret', async () => {
    const now = Math.floor(Date.now() / 1000);
    const wrongSig = crypto.createHmac('sha256', 'some-other-secret')
      .update(`passport.revoked:ET-ABCD1234:${now}`)
      .digest('hex');
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.revoked', passportNumber: 'ET-ABCD1234', timestamp: now, signature: wrongSig });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/identity/webhooks/eternitas — signature enforcement', () => {
  it('rejects NO X-Eternitas-Signature header (401)', async () => {
    const res = await request(app)
      .post('/api/v1/identity/webhooks/eternitas')
      .send({ event: 'passport.revoked', passport_number: 'ET-ABCD1234', timestamp: Date.now() });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing|signature/i);
  });

  it('rejects WRONG header signature (401)', async () => {
    const body = { event: 'passport.revoked', passport_number: 'ET-ABCD1234', timestamp: Date.now() };
    const res = await request(app)
      .post('/api/v1/identity/webhooks/eternitas')
      .set('X-Eternitas-Signature', 'deadbeef'.repeat(8))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('accepts CORRECT header signature', async () => {
    const body = { event: 'passport.revoked', passport_number: 'ET-NOTFOUND', timestamp: Date.now() };
    const res = await request(app)
      .post('/api/v1/identity/webhooks/eternitas')
      .set('X-Eternitas-Signature', signBody(body))
      .send(body);
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(401);
  });

  it('P1-15: rejects a replayed timestamp >5 min old', async () => {
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 min ago (ms)
    const body = { event: 'passport.revoked', passport_number: 'ET-NOTFOUND', timestamp: oldTs };
    const res = await request(app)
      .post('/api/v1/identity/webhooks/eternitas')
      .set('X-Eternitas-Signature', signBody(body))
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/window|timestamp/i);
  });

  it('P1-15: accepts timestamp in seconds (not ms)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const body = { event: 'passport.revoked', passport_number: 'ET-NOTFOUND', timestamp: nowSec };
    const res = await request(app)
      .post('/api/v1/identity/webhooks/eternitas')
      .set('X-Eternitas-Signature', signBody(body))
      .send(body);
    expect(res.status).not.toBe(401);
  });

  it('P1-15: webhook with NO timestamp still allowed (back-compat)', async () => {
    const body = { event: 'passport.revoked', passport_number: 'ET-NOTFOUND' };
    const res = await request(app)
      .post('/api/v1/identity/webhooks/eternitas')
      .set('X-Eternitas-Signature', signBody(body))
      .send(body);
    expect(res.status).not.toBe(401);
  });
});
