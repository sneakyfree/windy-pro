/**
 * GAP_ANALYSIS P2-5 — email verification consolidated onto the canonical
 * account flow. The identity-level path (/api/v1/identity/verify/*) now
 * returns 410 for type:'email' and keeps phone verification.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-verify-consolidation';
process.env.PORT = '0';
// TWILIO_* intentionally unset → sendSmsOTP falls back to the dev stub (success).

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

async function tokenFor(): Promise<string> {
  const email = `vc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register')
    .send({ name: 'VC', email, password: 'SecurePass1' });
  expect(reg.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(reg.body.userId);
  return reg.body.token;
}

describe('identity/verify email is retired → 410 (P2-5)', () => {
  let token = '';
  beforeAll(async () => { token = await tokenFor(); });

  it('POST /identity/verify/send with type:email → 410 pointing at the canonical send path', async () => {
    const res = await request(app)
      .post('/api/v1/identity/verify/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'email', identifier: 'someone@example.com' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('EMAIL_VERIFICATION_MOVED');
    expect(res.body.canonical).toBe('/api/v1/auth/send-verification');
  });

  it('POST /identity/verify/check with type:email → 410 pointing at the canonical verify path', async () => {
    const res = await request(app)
      .post('/api/v1/identity/verify/check')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'email', identifier: 'someone@example.com', code: '123456' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('EMAIL_VERIFICATION_MOVED');
    expect(res.body.canonical).toBe('/api/v1/auth/verify-email');
  });

  it('phone verification still works (send returns success via dev stub)', async () => {
    const res = await request(app)
      .post('/api/v1/identity/verify/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'phone', identifier: '+15555550123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.type).toBe('phone');
  });

  it('GET /identity/verify/status still reports both email and phone state', async () => {
    const res = await request(app)
      .get('/api/v1/identity/verify/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('emailVerified');
    expect(res.body).toHaveProperty('phoneVerified');
  });
});
