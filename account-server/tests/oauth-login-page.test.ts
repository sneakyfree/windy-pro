/**
 * OAuth login page — "Sign in with Windy" for browsers with no token.
 *
 * Before this feature, a full-page navigation to GET /api/v1/oauth/authorize
 * (what every ecosystem SPA does for SSO) dead-ended in 401 JSON because the
 * route demanded a Bearer token no browser navigation can carry. Covers:
 *   - GET /authorize (browser, no token) renders the login page
 *   - GET /authorize (API client, no token) keeps the 401 JSON contract
 *   - GET /authorize (browser, bad link) renders the error page, not the form
 *   - POST /login wrong password re-renders with a friendly error
 *   - POST /login tampered redirect_uri is rejected
 *   - POST /login happy path 302s back with a code; code exchanges at /token
 *     (full PKCE round-trip, public first-party client)
 *   - POST /login for a third-party client 302s to the consent page with a
 *     usable token; consent Allow completes with a browser 302 + code
 *   - MFA-enabled account: password alone prompts for the code; a backup
 *     code completes sign-in
 *   - Seeder: windy-chat registered with the SPA's redirect_uri; stale
 *     redirect_uris rows get re-synced
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { seedEcosystemClients } from '../src/routes/oauth';
import { encryptSecret, generateTotpSecret, hashBackupCodes } from '../src/services/mfa';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerUser(label = 'oauth-login') {
  const body = { name: 'OAuth Login Test', email: uniqueEmail(label), password: 'CorrectHorse1A' };
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
  getDb().prepare(`
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

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const CB = 'https://spa.example/auth/callback';

function authorizeQuery(clientId: string, extra: Record<string, string> = {}) {
  return {
    client_id: clientId,
    redirect_uri: CB,
    response_type: 'code',
    scope: 'openid profile email',
    state: 'state-abc',
    ...extra,
  };
}

describe('OAuth login page', () => {
  describe('GET /api/v1/oauth/authorize without a token', () => {
    it('renders the login page for browsers', async () => {
      const clientId = createClient({ name: 'Windy Chat', redirectUri: CB, isFirstParty: true, isPublic: true });
      const { challenge } = pkcePair();
      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query(authorizeQuery(clientId, { code_challenge: challenge, code_challenge_method: 'S256' }))
        .set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('Sign in to continue to');
      expect(res.text).toContain('Windy Chat');
      expect(res.text).toContain('action="/api/v1/oauth/login"');
      // Original params round-trip as hidden fields
      expect(res.text).toContain(`value="${clientId}"`);
      expect(res.text).toContain('name="state" value="state-abc"');
      expect(res.text).toContain(`name="code_challenge" value="${challenge}"`);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('keeps the 401 JSON contract for API clients', async () => {
      const clientId = createClient({ redirectUri: CB, isFirstParty: true });
      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query(authorizeQuery(clientId))
        .set('Accept', 'application/json');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Authentication required' });
    });

    it('renders the error page (not the login form) for an unknown client', async () => {
      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query(authorizeQuery('no-such-client'))
        .set('Accept', 'text/html');

      expect(res.status).toBe(400);
      expect(res.text).toContain("We couldn't start this sign-in");
      expect(res.text).not.toContain('action="/api/v1/oauth/login"');
    });

    it('renders the error page for an unregistered redirect_uri', async () => {
      const clientId = createClient({ redirectUri: CB, isFirstParty: true });
      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query(authorizeQuery(clientId, { redirect_uri: 'https://evil.example/steal' }))
        .set('Accept', 'text/html');

      expect(res.status).toBe(400);
      expect(res.text).toContain('redirect_uri not registered');
      expect(res.text).not.toContain('action="/api/v1/oauth/login"');
    });
  });

  describe('POST /api/v1/oauth/login', () => {
    it('re-renders with a friendly error on a wrong password', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: CB, isFirstParty: true });

      const res = await request(app)
        .post('/api/v1/oauth/login')
        .type('form')
        .set('Accept', 'text/html')
        .send({ ...authorizeQuery(clientId), email: u.email, password: 'WrongPass1A' });

      expect(res.status).toBe(401);
      expect(res.text).toContain('Incorrect email or password.');
      // Email is preserved so the user doesn't retype it; password never is.
      expect(res.text).toContain(u.email);
      expect(res.text).not.toContain('WrongPass1A');
    });

    it('rejects a tampered redirect_uri without processing credentials', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: CB, isFirstParty: true });

      const res = await request(app)
        .post('/api/v1/oauth/login')
        .type('form')
        .set('Accept', 'text/html')
        .send({
          ...authorizeQuery(clientId, { redirect_uri: 'https://evil.example/steal' }),
          email: u.email,
          password: u.password,
        });

      expect(res.status).toBe(400);
      expect(res.text).toContain('redirect_uri not registered');
    });

    it('completes the full PKCE round-trip: login → code → token', async () => {
      const u = await registerUser();
      const clientId = createClient({ redirectUri: CB, isFirstParty: true, isPublic: true });
      const { verifier, challenge } = pkcePair();

      const login = await request(app)
        .post('/api/v1/oauth/login')
        .type('form')
        .set('Accept', 'text/html')
        .send({
          ...authorizeQuery(clientId, { code_challenge: challenge, code_challenge_method: 'S256' }),
          email: u.email,
          password: u.password,
        });

      expect(login.status).toBe(302);
      const location = new URL(login.headers.location);
      expect(`${location.origin}${location.pathname}`).toBe(CB);
      expect(location.searchParams.get('state')).toBe('state-abc');
      const code = location.searchParams.get('code');
      expect(code).toBeTruthy();

      const token = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: CB,
          client_id: clientId,
          code_verifier: verifier,
        });

      expect(token.status).toBe(200);
      expect(token.body.access_token).toBeTruthy();
      expect(token.body.token_type).toBe('Bearer');
      const payload = JSON.parse(Buffer.from(token.body.access_token.split('.')[1], 'base64url').toString());
      expect(payload.email).toBe(u.email.toLowerCase());
    });

    it('routes third-party clients through the consent page, which completes in-browser', async () => {
      const u = await registerUser();
      const clientId = createClient({ name: 'Acme Corp', redirectUri: CB, isFirstParty: false, isPublic: false });

      const login = await request(app)
        .post('/api/v1/oauth/login')
        .type('form')
        .set('Accept', 'text/html')
        .send({ ...authorizeQuery(clientId), email: u.email, password: u.password });

      expect(login.status).toBe(302);
      expect(login.headers.location).toContain('/api/v1/oauth/consent');
      expect(login.headers.location).toContain('token=');

      // The consent page renders with the hop token…
      const consentPath = login.headers.location;
      const consent = await request(app).get(consentPath).set('Accept', 'text/html');
      expect(consent.status).toBe(200);
      expect(consent.text).toContain('Acme Corp');
      // …and its form action carries the token forward.
      expect(consent.text).toMatch(/action="\/api\/v1\/oauth\/authorize\?token=[^"]+"/);

      // Submitting Allow (browser form post) 302s back to the app with a code.
      const hopToken = new URL(consentPath, 'http://x').searchParams.get('token')!;
      const decision = await request(app)
        .post(`/api/v1/oauth/authorize?token=${encodeURIComponent(hopToken)}`)
        .type('form')
        .set('Accept', 'text/html')
        .send({
          client_id: clientId,
          redirect_uri: CB,
          scope: 'openid profile email',
          state: 'state-abc',
          approved: 'true',
        });

      expect(decision.status).toBe(302);
      const loc = new URL(decision.headers.location);
      expect(loc.searchParams.get('code')).toBeTruthy();
      expect(loc.searchParams.get('state')).toBe('state-abc');
    });

    it('prompts for the MFA code, then accepts a backup code', async () => {
      const u = await registerUser('oauth-mfa');
      const clientId = createClient({ redirectUri: CB, isFirstParty: true });

      // Enable TOTP directly (same wiring the MFA routes produce).
      const secret = generateTotpSecret();
      const enc = encryptSecret(secret);
      const backupCode = 'AAAA-BBBB-CCCC';
      const hashes = await hashBackupCodes([backupCode]);
      getDb().prepare(`
        INSERT INTO mfa_secrets (user_id, totp_secret_encrypted, totp_secret_iv, totp_secret_tag, backup_codes_hash, enabled_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(u.userId, enc.ciphertext, enc.iv, enc.tag, JSON.stringify(hashes));

      // Password alone → MFA prompt (no code minted).
      const prompt = await request(app)
        .post('/api/v1/oauth/login')
        .type('form')
        .set('Accept', 'text/html')
        .send({ ...authorizeQuery(clientId), email: u.email, password: u.password });

      expect(prompt.status).toBe(200);
      expect(prompt.text).toContain('name="mfaCode"');
      expect(prompt.text).toContain('two-step verification');

      // Password + backup code → straight through with a code.
      const done = await request(app)
        .post('/api/v1/oauth/login')
        .type('form')
        .set('Accept', 'text/html')
        .send({ ...authorizeQuery(clientId), email: u.email, password: u.password, mfaCode: backupCode });

      expect(done.status).toBe(302);
      expect(new URL(done.headers.location).searchParams.get('code')).toBeTruthy();
    });
  });

  describe('ecosystem seed', () => {
    it('registers windy-chat with the SPA callback the deployed app uses', () => {
      seedEcosystemClients();
      const row = getDb().prepare(
        'SELECT redirect_uris, is_first_party, is_public FROM oauth_clients WHERE client_id = ?',
      ).get('windy-chat') as any;
      expect(row).toBeDefined();
      expect(row.is_first_party).toBe(1);
      expect(row.is_public).toBe(1);
      expect(JSON.parse(row.redirect_uris)).toContain('https://app.windychat.ai/auth/callback');
    });

    it('re-syncs a stale redirect_uris row on the next seed pass', () => {
      const db = getDb();
      db.prepare("UPDATE oauth_clients SET redirect_uris = '[]' WHERE client_id = 'windy-chat'").run();
      seedEcosystemClients();
      const row = db.prepare('SELECT redirect_uris FROM oauth_clients WHERE client_id = ?').get('windy-chat') as any;
      expect(JSON.parse(row.redirect_uris)).toContain('https://app.windychat.ai/auth/callback');
    });
  });
});
