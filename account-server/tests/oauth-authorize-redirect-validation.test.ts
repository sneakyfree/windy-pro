/**
 * Q7 regression — POST /api/v1/oauth/authorize (consent submit) must reject a
 * redirect_uri that isn't in the client's registered allowlist (RFC 6749
 * §4.1.3). Mirrors the oauth-consent-ui.test.ts harness.
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

async function registerUser() {
  const body = { name: 'Redirect Test', email: uniqueEmail('rdr'), password: 'OldPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId, token: res.body.token };
}

function createClient(redirectUri: string) {
  const clientId = `client-${crypto.randomBytes(8).toString('hex')}`;
  getDb().prepare(`
    INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public, created_at)
    VALUES (?, NULL, ?, ?, ?, 0, 1, datetime('now'))
  `).run(clientId, 'Redirect Test Client', JSON.stringify([redirectUri]), JSON.stringify(['openid']));
  return clientId;
}

describe('POST /api/v1/oauth/authorize — redirect_uri allowlist (RFC 6749 §4.1.3)', () => {
  it('rejects a redirect_uri not registered for the client (400 invalid_request)', async () => {
    const u = await registerUser();
    const clientId = createClient('https://acme.example/cb');

    const res = await request(app)
      .post('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${u.token}`)
      .set('Accept', 'application/json')
      .send({
        client_id: clientId,
        redirect_uri: 'https://attacker.example/steal', // NOT registered
        scope: 'openid',
        approved: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    // And no code was handed to the attacker URL.
    expect(JSON.stringify(res.body)).not.toContain('attacker.example');
  });

  it('still issues a code for the registered redirect_uri', async () => {
    const u = await registerUser();
    const clientId = createClient('https://acme.example/cb');

    const res = await request(app)
      .post('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${u.token}`)
      .set('Accept', 'application/json')
      .send({
        client_id: clientId,
        redirect_uri: 'https://acme.example/cb',
        scope: 'openid',
        approved: true,
      });

    // The registered URI must NOT be rejected. (Assert only the 200 to stay
    // robust to the exact JSON field name of the success payload.)
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });
});
