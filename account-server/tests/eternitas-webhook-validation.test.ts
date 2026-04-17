/**
 * P1-6 — /api/v1/identity/eternitas/webhook must validate payload shape
 * BEFORE calling processEternitasEvent. Without this, a signature-verified
 * but malformed payload (e.g. `passport.registered` with no `agentName`)
 * hits an INSERT that violates `users.name NOT NULL` and bubbles a 500.
 *
 * With P0-2 already enforcing signatures, this is the second line of
 * defense: a trusted Eternitas instance that ships a buggy payload shape
 * shouldn't 500 — it should 400 with a specific message.
 */
import crypto from 'crypto';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.ETERNITAS_WEBHOOK_SECRET = 'test-eternitas-webhook-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

import { app } from '../src/server';

const SECRET = process.env.ETERNITAS_WEBHOOK_SECRET!;

function sign(event: string, passportNumber: string, timestamp: number): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${event}:${passportNumber}:${timestamp}`)
    .digest('hex');
}

describe('P1-6 /api/v1/identity/eternitas/webhook — payload validation', () => {
  it('rejects passport.registered with NO agentName (400 not 500)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const passportNumber = 'ET-NOAGENT' + Math.floor(Math.random() * 1e6);
    const sig = sign('passport.registered', passportNumber, now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.registered', passportNumber, timestamp: now, signature: sig });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agentName/i);
  });

  it('rejects passport.registered with EMPTY agentName (400)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const passportNumber = 'ET-EMPTY' + Math.floor(Math.random() * 1e6);
    const sig = sign('passport.registered', passportNumber, now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({
        event: 'passport.registered',
        passportNumber,
        agentName: '   ',
        timestamp: now,
        signature: sig,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agentName/i);
  });

  it('rejects passportNumber that does not match ET- format (400)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = 'NOT-A-PASSPORT';
    const sig = sign('passport.registered', bad, now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({
        event: 'passport.registered',
        passportNumber: bad,
        agentName: 'Rogue',
        timestamp: now,
        signature: sig,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ET-/);
  });

  it('rejects trust_updated with out-of-range trustScore (400)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const passportNumber = 'ET-TRUST' + Math.floor(Math.random() * 1e6);
    const sig = sign('trust_updated', passportNumber, now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({
        event: 'trust_updated',
        passportNumber,
        trustScore: 42,
        timestamp: now,
        signature: sig,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trustScore/i);
  });

  it('rejects trust_updated with non-numeric trustScore (400)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const passportNumber = 'ET-TRUSTX' + Math.floor(Math.random() * 1e6);
    const sig = sign('trust_updated', passportNumber, now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({
        event: 'trust_updated',
        passportNumber,
        trustScore: 'high',
        timestamp: now,
        signature: sig,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trustScore/i);
  });

  it('accepts a well-formed passport.revoked (no 400, no 500 at validation gate)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const passportNumber = 'ET-REVOK' + Math.floor(Math.random() * 1e6);
    const sig = sign('passport.revoked', passportNumber, now);
    const res = await request(app)
      .post('/api/v1/identity/eternitas/webhook')
      .send({ event: 'passport.revoked', passportNumber, timestamp: now, signature: sig });
    // passport doesn't exist → cascadeRevocation no-ops at 200
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(400);
  });
});
