/**
 * PR5 — OAuth /authorize consent screen UI
 *
 * Covers:
 *   - GET /oauth/consent renders an HTML page with client name + scope rows
 *   - Page includes hidden inputs that POST back to /authorize on Allow
 *   - GET /authorize for browser (Accept: text/html) redirects to /consent
 *   - GET /authorize for API client (Accept: application/json) returns JSON +
 *     consent_url
 *   - First-party clients still auto-approve (no consent screen)
 *   - Pre-approved scopes don't show consent again
 *   - Scope descriptions: known scopes get human labels; unknown ones fall
 *     back to a sensible generic
 *   - Page escapes HTML in client name (XSS safety)
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
  const body = { name: 'OAuth Consent Test', email: uniqueEmail('oauth'), password: 'OldPass1A' };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(res.body.userId);
  return { ...body, userId: res.body.userId, token: res.body.token };
}

function createClient(opts: {
  name?: string;
  redirectUri: string;
  isFirstParty?: boolean;
  isPublic?: boolean;
}) {
  const clientId = `client-${crypto.randomBytes(8).toString('hex')}`;
  const db = getDb();
  db.prepare(`
    INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    clientId,
    opts.name ?? 'Test Client',
    JSON.stringify([opts.redirectUri]),
    JSON.stringify(['openid', 'profile', 'email']),
    opts.isFirstParty ? 1 : 0,
    opts.isPublic ? 1 : 0,
  );
  return clientId;
}

describe('PR5 — OAuth consent screen UI', () => {
  describe('GET /api/v1/oauth/consent', () => {
    it('renders HTML with client name and scope rows', async () => {
      const u = await registerUser();
      const clientId = createClient({ name: 'Acme Corp', redirectUri: 'https://acme.example/cb' });

      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .query({
          client_id: clientId,
          redirect_uri: 'https://acme.example/cb',
          scope: 'openid profile email',
          state: 'state-xyz',
        })
        .set('Authorization', `Bearer ${u.token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('Acme Corp');
      expect(res.text).toContain('OpenID');
      expect(res.text).toContain('Profile');
      expect(res.text).toContain('Email');
    });

    it('includes hidden inputs that POST back to /authorize', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: 'https://acme.example/cb' });

      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .query({
          client_id: clientId,
          redirect_uri: 'https://acme.example/cb',
          scope: 'openid',
          state: 'state-abc',
          code_challenge: 'challenge-123',
        })
        .set('Authorization', `Bearer ${u.token}`);

      expect(res.text).toContain('action="/api/v1/oauth/authorize"');
      expect(res.text).toContain(`name="client_id" value="${clientId}"`);
      expect(res.text).toContain('name="redirect_uri" value="https://acme.example/cb"');
      expect(res.text).toContain('name="state" value="state-abc"');
      expect(res.text).toContain('name="code_challenge" value="challenge-123"');
    });

    it('escapes HTML in the client name (XSS guard)', async () => {
      const u = await registerUser();
      const clientId = createClient({ name: '<script>alert(1)</script>', redirectUri: 'https://x.test/cb' });

      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .query({ client_id: clientId, redirect_uri: 'https://x.test/cb' })
        .set('Authorization', `Bearer ${u.token}`);

      expect(res.text).not.toContain('<script>alert(1)</script>');
      expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('returns 400 for unknown client_id', async () => {
      const u = await registerUser();
      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .query({ client_id: 'nope', redirect_uri: 'https://x.test/cb' })
        .set('Authorization', `Bearer ${u.token}`);
      expect(res.status).toBe(400);
    });

    it('returns 400 when client_id missing', async () => {
      const u = await registerUser();
      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .set('Authorization', `Bearer ${u.token}`);
      expect(res.status).toBe(400);
    });

    it('falls back to a generic label for unknown scopes', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: 'https://x.test/cb' });

      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .query({
          client_id: clientId,
          redirect_uri: 'https://x.test/cb',
          scope: 'custom_product:weird_perm',
        })
        .set('Authorization', `Bearer ${u.token}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('custom_product (weird_perm)');
    });
  });

  describe('GET /api/v1/oauth/authorize content negotiation', () => {
    it('redirects browsers (Accept: text/html) to /consent when consent_required', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: 'https://acme.example/cb' });

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: 'https://acme.example/cb',
          response_type: 'code',
          scope: 'openid profile',
          state: 'state-xyz',
        })
        .set('Authorization', `Bearer ${u.token}`)
        .set('Accept', 'text/html');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/api/v1/oauth/consent');
      expect(res.headers.location).toContain(`client_id=${clientId}`);
      expect(res.headers.location).toContain('state=state-xyz');
    });

    it('returns JSON (with consent_url helper) for API clients (Accept: application/json)', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: 'https://acme.example/cb' });

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: 'https://acme.example/cb',
          response_type: 'code',
          scope: 'openid',
        })
        .set('Authorization', `Bearer ${u.token}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.consent_required).toBe(true);
      expect(res.body.client.clientId).toBe(clientId);
      expect(res.body.consent_url).toContain('/api/v1/oauth/consent?');
      expect(res.body.consent_url).toContain(`client_id=${encodeURIComponent(clientId)}`);
    });

    it('first-party clients still auto-approve (no consent screen)', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: 'https://first.windy/cb', isFirstParty: true });

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: 'https://first.windy/cb',
          response_type: 'code',
          scope: 'openid',
        })
        .set('Authorization', `Bearer ${u.token}`)
        .set('Accept', 'text/html');

      // Auto-approve produces a JSON `redirect` URL (existing behavior); no 302 to /consent
      expect(res.status).toBe(200);
      expect(res.body.code).toBeTruthy();
      expect(res.body.redirect).toContain('https://first.windy/cb?code=');
    });

    it('pre-approved scopes skip the consent screen', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: 'https://acme.example/cb' });

      // Seed a consent row covering the requested scope
      getDb().prepare(`
        INSERT INTO oauth_consents (id, identity_id, client_id, scopes)
        VALUES (?, ?, ?, ?)
      `).run(crypto.randomUUID(), u.userId, clientId, 'openid profile');

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query({
          client_id: clientId,
          redirect_uri: 'https://acme.example/cb',
          response_type: 'code',
          scope: 'openid',
        })
        .set('Authorization', `Bearer ${u.token}`)
        .set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.body.code).toBeTruthy();
    });
  });
});
