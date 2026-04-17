/**
 * P1-4 + P1-5 — body-parser errors produce well-formed 4xx, not 500.
 *
 * Wave 7 probe surfaced:
 *   POST /register with `{not json` → 500 {"error":"Internal server error"}
 *   POST /register with 1 MiB body  → 500 {"error":"Internal server error"}
 * Both should be 4xx with structured error codes.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';

jest.setTimeout(15000);

describe('P1-4 Malformed JSON → 400', () => {
  it('returns 400 invalid_json, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });

  it('also handles trailing garbage after valid JSON', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name":"x"}<garbage>');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });

  it('unquoted-key JSON is rejected 400 (not lax-parsed)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{name:"x"}');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });
});

describe('P1-5 Oversized body → 413', () => {
  it('returns 413 payload_too_large for bodies over 100kb', async () => {
    // 200 KiB name string — well over the 100kb limit
    const big = 'x'.repeat(200 * 1024);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: big, email: 'big@x.test', password: 'Aa1bcdefg' }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
    expect(res.body.limit).toBeDefined();
  });

  it('urlencoded body also respects the 100kb cap', async () => {
    // The admin-console form uses urlencoded — same limit.
    const big = 'x'.repeat(200 * 1024);
    const res = await request(app)
      .post('/admin/users/any/freeze')   // adminOnly — we only care about body-parser layer
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`reason=${encodeURIComponent(big)}`);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });
});

describe('valid requests still work (guard against breaking happy path)', () => {
  it('normal-sized valid JSON still reaches the route handler', async () => {
    // Will fail validation (missing fields) but should be 400 with the
    // route's schema-validation error — not 400 from body-parser.
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({}));
    expect(res.status).toBe(400);
    // invalid_json is the body-parser code; zod validation returns a
    // different shape → confirms we didn't short-circuit on valid JSON.
    expect(res.body.code).not.toBe('invalid_json');
  });
});
