/**
 * P1-7 — /.well-known/jwks.json and /.well-known/openid-configuration
 * now have a rate limit. Cheap-but-unauthenticated endpoints previously
 * had no throttle; an abuse loop could pin the event loop.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';

jest.setTimeout(15000);

describe('P1-7 well-known rate limit', () => {
  it('GET /.well-known/jwks.json still returns 200 under normal load', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('keys');
  });

  it('GET /.well-known/openid-configuration still returns 200', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issuer');
  });

  it('JWKS responses include the cache header so legitimate clients cache', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });

  it('Rate-limit middleware is attached (standard rate-limit headers appear)', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    // express-rate-limit 7.x emits RateLimit-* headers when standardHeaders=true
    expect(
      res.headers['ratelimit-limit'] || res.headers['ratelimit-remaining'],
    ).toBeDefined();
  });
});
