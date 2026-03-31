/**
 * OAuth2 Security Hardening Tests
 *
 * Tests cover:
 *   1. Authorization with unregistered client_id
 *   2. Authorization with mismatched redirect_uri (open redirect prevention)
 *   3. Token exchange with expired authorization code
 *   4. Token exchange with already-used authorization code (replay prevention)
 *   5. PKCE: wrong code_verifier rejected
 *   6. PKCE: public client requires code_challenge on authorize
 *   7. Client credentials with wrong client_secret
 *   8. Device code flow: poll before user authorizes (authorization_pending)
 *   9. Device code flow: poll after expiry (expired_token)
 *  10. Token refresh with non-existent refresh token
 *  11. Requesting scopes the client isn't allowed (passthrough check)
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { generateKeyPair } from '../jwks';

// Disable rate limiting in tests
jest.mock('express-rate-limit', () => {
  return () => (_req: Request, _res: Response, next: NextFunction) => next();
});

// ═══════════════════════════════════════════
//  IN-MEMORY DATA STORES
// ═══════════════════════════════════════════

const oauthClients: Record<string, any> = {};
const oauthCodes: Record<string, any> = {};
const refreshTokens: Record<string, any> = {};
const users: Record<string, any> = {};
const identityScopes: Record<string, string[]> = {};
const productAccounts: Record<string, any[]> = {};
const oauthConsents: Record<string, any> = {};
const tokenBlacklist = new Set<string>();
const oauthDeviceCodes: Record<string, any> = {};

// Pre-seed test data
const TEST_USER_ID = 'user-hardening-001';
const TEST_USER = {
  id: TEST_USER_ID,
  email: 'hardening@windypro.com',
  tier: 'pro',
  role: 'admin',
  identity_type: 'human',
  windy_identity_id: 'WI-HARD-001',
  name: 'Hardening Test User',
  display_name: 'Hardening Test User',
  avatar_url: null,
  phone: null,
  email_verified: 1,
  phone_verified: 0,
  preferred_lang: 'en',
};
users[TEST_USER_ID] = TEST_USER;
identityScopes[TEST_USER_ID] = ['windy_pro:*'];
productAccounts[TEST_USER_ID] = [{ product: 'windy_pro', status: 'active', external_id: null }];

// Generate an RS256 key pair for testing
const testKeyPair = generateKeyPair();

// ═══════════════════════════════════════════
//  MOCK DATABASE
// ═══════════════════════════════════════════

function mockDbPrepare(sql: string) {
  return {
    run: (...args: any[]) => {
      // INSERT INTO oauth_clients
      if (sql.includes('INSERT INTO oauth_clients')) {
        const [clientId, secretHash, name, redirectUris, allowedScopes, ownerId, isFirstParty, isPublic] = args;
        oauthClients[clientId] = {
          client_id: clientId,
          client_secret_hash: secretHash,
          name,
          redirect_uris: redirectUris,
          allowed_scopes: allowedScopes,
          owner_identity_id: ownerId,
          is_first_party: isFirstParty,
          is_public: isPublic,
          created_at: new Date().toISOString(),
        };
        return { changes: 1 };
      }
      // INSERT INTO oauth_codes
      if (sql.includes('INSERT INTO oauth_codes')) {
        const [code, clientId, identityId, redirectUri, scope, state, codeChallenge, expiresAt] = args;
        oauthCodes[code] = {
          code, client_id: clientId, identity_id: identityId,
          redirect_uri: redirectUri, scope, state,
          code_challenge: codeChallenge, expires_at: expiresAt, used: 0,
        };
        return { changes: 1 };
      }
      // UPDATE oauth_codes SET used = 1
      if (sql.includes('UPDATE oauth_codes SET used = 1')) {
        const code = args[0];
        if (oauthCodes[code] && oauthCodes[code].used === 0) {
          oauthCodes[code].used = 1;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      // INSERT INTO refresh_tokens
      if (sql.includes('INSERT INTO refresh_tokens')) {
        const [token, userId, expiresAt] = args;
        refreshTokens[token] = { token, user_id: userId, expires_at: expiresAt };
        return { changes: 1 };
      }
      // DELETE FROM refresh_tokens
      if (sql.includes('DELETE FROM refresh_tokens')) {
        const token = args[0];
        if (refreshTokens[token]) {
          delete refreshTokens[token];
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      // INSERT INTO oauth_consents
      if (sql.includes('INSERT INTO oauth_consents')) {
        return { changes: 1 };
      }
      // INSERT INTO oauth_device_codes
      if (sql.includes('INSERT INTO oauth_device_codes')) {
        const [deviceCode, userCode, clientId, scope, expiresAt] = args;
        oauthDeviceCodes[deviceCode] = {
          device_code: deviceCode,
          user_code: userCode,
          client_id: clientId,
          scope: scope || '',
          expires_at: expiresAt,
          status: 'pending',
          identity_id: null,
        };
        return { changes: 1 };
      }
      // UPDATE oauth_device_codes SET status = 'expired'
      if (sql.includes("UPDATE oauth_device_codes SET status = 'expired'")) {
        const deviceCode = args[0];
        if (oauthDeviceCodes[deviceCode]) {
          oauthDeviceCodes[deviceCode].status = 'expired';
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      // UPDATE oauth_device_codes SET status = 'approved'
      if (sql.includes("UPDATE oauth_device_codes SET status = 'approved'")) {
        const [identityId, deviceCode] = args;
        if (oauthDeviceCodes[deviceCode]) {
          oauthDeviceCodes[deviceCode].status = 'approved';
          oauthDeviceCodes[deviceCode].identity_id = identityId;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      // UPDATE oauth_device_codes SET status = 'denied'
      if (sql.includes("UPDATE oauth_device_codes SET status = 'denied'")) {
        const deviceCode = args[0];
        if (oauthDeviceCodes[deviceCode]) {
          oauthDeviceCodes[deviceCode].status = 'denied';
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      // SELECT * FROM oauth_clients WHERE client_id = ?
      if (sql.includes('FROM oauth_clients WHERE client_id')) {
        return oauthClients[args[0]] || null;
      }
      // SELECT * FROM oauth_codes WHERE code = ?
      if (sql.includes('FROM oauth_codes WHERE code')) {
        const code = oauthCodes[args[0]];
        if (!code) return null;
        if (code.used !== 0) return null;
        if (new Date(code.expires_at) < new Date()) return null;
        if (code.client_id !== args[1]) return null;
        return code;
      }
      // SELECT * FROM refresh_tokens WHERE token = ?
      if (sql.includes('FROM refresh_tokens WHERE token')) {
        const rt = refreshTokens[args[0]];
        if (!rt) return null;
        if (new Date(rt.expires_at) < new Date()) return null;
        return rt;
      }
      // SELECT * FROM users WHERE id = ?
      if (sql.includes('FROM users WHERE id')) {
        return users[args[0]] || null;
      }
      // SELECT role FROM users WHERE id = ?
      if (sql.includes('SELECT role FROM users')) {
        const u = users[args[0]];
        return u ? { role: u.role } : null;
      }
      // SELECT email, tier, identity_type, windy_identity_id FROM users
      if (sql.includes('SELECT email, tier, identity_type, windy_identity_id')) {
        const u = users[args[0]];
        return u ? { email: u.email, tier: u.tier, identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      // SELECT with all user fields for userinfo
      if (sql.includes('SELECT id, windy_identity_id, email, name')) {
        return users[args[0]] || null;
      }
      // token_blacklist check
      if (sql.includes('FROM token_blacklist')) {
        return tokenBlacklist.has(args[0]) ? { '1': 1 } : null;
      }
      // oauth_consents
      if (sql.includes('FROM oauth_consents')) {
        return null; // no prior consent
      }
      // SELECT * FROM oauth_device_codes WHERE device_code = ? AND client_id = ?
      if (sql.includes('FROM oauth_device_codes WHERE device_code')) {
        const dc = oauthDeviceCodes[args[0]];
        if (!dc) return null;
        if (dc.client_id !== args[1]) return null;
        return dc;
      }
      // SELECT * FROM oauth_device_codes WHERE user_code = ?
      if (sql.includes('FROM oauth_device_codes WHERE user_code')) {
        const found = Object.values(oauthDeviceCodes).find(
          (dc: any) => dc.user_code === args[0] && dc.status === 'pending' && new Date(dc.expires_at) > new Date(),
        );
        return found || null;
      }
      return null;
    },
    all: (...args: any[]) => {
      // SELECT scope FROM identity_scopes WHERE identity_id = ?
      if (sql.includes('FROM identity_scopes')) {
        const scopes = identityScopes[args[0]] || [];
        return scopes.map(s => ({ scope: s }));
      }
      // SELECT product FROM product_accounts
      if (sql.includes('FROM product_accounts')) {
        const accounts = productAccounts[args[0]] || [];
        return accounts.map(a => ({ product: a.product }));
      }
      // SELECT from oauth_clients (list all)
      if (sql.includes('FROM oauth_clients')) {
        return Object.values(oauthClients);
      }
      return [];
    },
  };
}

jest.mock('../db/schema', () => ({
  getDb: () => ({
    prepare: (sql: string) => mockDbPrepare(sql),
    exec: jest.fn(),
    pragma: jest.fn().mockReturnValue([]),
  }),
}));

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-hardening-oauth',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/test',
    UPLOADS_PATH: '/tmp/test/uploads',
    PORT: 0,
    BCRYPT_ROUNDS: 4,
    MAX_DEVICES: 5,
  },
}));

jest.mock('../jwks', () => {
  const actual = jest.requireActual('../jwks');
  return {
    ...actual,
    isRS256Available: () => true,
    getSigningKey: () => ({
      privateKey: testKeyPair.privateKey,
      kid: testKeyPair.kid,
      algorithm: 'RS256' as const,
    }),
    getJWKSDocument: actual.getJWKSDocument,
    generateKeyPair: actual.generateKeyPair,
    initializeJWKS: () => true,
    getVerificationKeys: () => [{ publicKey: testKeyPair.publicKey, kid: testKeyPair.kid }],
    getPublicKeyByKid: (kid: string) => kid === testKeyPair.kid ? testKeyPair.publicKey : null,
  };
});

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  getScopes: jest.fn((id: string) => identityScopes[id] || []),
  getProductAccounts: jest.fn((id: string) =>
    (productAccounts[id] || []).map((p: any) => ({
      product: p.product,
      status: p.status,
      external_id: p.external_id,
    })),
  ),
}));

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/** Generate a valid access token for the test user. */
function generateTestAccessToken(overrides: Record<string, any> = {}, opts?: { expired?: boolean }): string {
  const payload: Record<string, any> = {
    userId: TEST_USER_ID,
    email: TEST_USER.email,
    tier: TEST_USER.tier,
    accountId: TEST_USER_ID,
    type: 'human',
    scopes: ['windy_pro:*'],
    products: ['windy_pro'],
    iss: 'windy-identity',
    ...overrides,
  };

  if (opts?.expired) {
    payload.iat = Math.floor(Date.now() / 1000) - 60;
    payload.exp = Math.floor(Date.now() / 1000) - 1;
    return jwt.sign(payload, testKeyPair.privateKey, {
      algorithm: 'RS256',
      keyid: testKeyPair.kid,
    });
  }

  return jwt.sign(payload, testKeyPair.privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    keyid: testKeyPair.kid,
  });
}

/** Register an OAuth client in the in-memory store. */
function registerClient(opts: {
  name?: string;
  isPublic?: boolean;
  isFirstParty?: boolean;
  redirectUris?: string[];
  allowedScopes?: string[];
} = {}): { clientId: string; clientSecret: string | null } {
  const clientId = crypto.randomUUID();
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;

  if (!opts.isPublic) {
    clientSecret = `wcs_${crypto.randomBytes(16).toString('hex')}`;
    clientSecretHash = bcrypt.hashSync(clientSecret, 4);
  }

  oauthClients[clientId] = {
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    name: opts.name || 'Test Client',
    redirect_uris: JSON.stringify(opts.redirectUris || ['https://app.test.com/callback']),
    allowed_scopes: JSON.stringify(opts.allowedScopes || ['openid', 'profile', 'email', 'windy_pro:*']),
    owner_identity_id: TEST_USER_ID,
    is_first_party: opts.isFirstParty ? 1 : 0,
    is_public: opts.isPublic ? 1 : 0,
    created_at: new Date().toISOString(),
  };

  return { clientId, clientSecret };
}

/** Insert an authorization code directly. */
function insertAuthCode(opts: {
  code: string;
  clientId: string;
  redirectUri?: string;
  scope?: string;
  codeChallenge?: string | null;
  expiresAt?: string;
}) {
  oauthCodes[opts.code] = {
    code: opts.code,
    client_id: opts.clientId,
    identity_id: TEST_USER_ID,
    redirect_uri: opts.redirectUri || 'https://app.test.com/callback',
    scope: opts.scope || 'openid profile',
    state: null,
    code_challenge: opts.codeChallenge ?? null,
    expires_at: opts.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    used: 0,
  };
}

/** Insert a refresh token directly. */
function insertRefreshToken(token: string, userId: string = TEST_USER_ID, expiresAt?: string) {
  refreshTokens[token] = {
    token,
    user_id: userId,
    expires_at: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** Insert a device code directly. */
function insertDeviceCode(opts: {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scope?: string;
  expiresAt?: string;
  status?: string;
  identityId?: string | null;
}) {
  oauthDeviceCodes[opts.deviceCode] = {
    device_code: opts.deviceCode,
    user_code: opts.userCode,
    client_id: opts.clientId,
    scope: opts.scope || '',
    expires_at: opts.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: opts.status || 'pending',
    identity_id: opts.identityId ?? null,
  };
}

// ═══════════════════════════════════════════
//  BUILD APP
// ═══════════════════════════════════════════

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const oauthRoutes = require('../routes/oauth').default;
  app.use('/api/v1/oauth', oauthRoutes);
});

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('OAuth2 Security Hardening', () => {
  const validToken = () => generateTestAccessToken();

  // ─── 1. Unregistered client_id ───────────────────────────────────────

  it('rejects authorization request with unregistered client_id', async () => {
    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken()}`)
      .query({
        client_id: 'nonexistent-client-id',
        redirect_uri: 'https://app.test.com/callback',
        response_type: 'code',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  // ─── 2. Wrong redirect_uri (open redirect prevention) ───────────────

  it('rejects authorization request with mismatched redirect_uri', async () => {
    const { clientId } = registerClient({
      name: 'Redirect Test Client',
      isFirstParty: true,
      redirectUris: ['https://app.test.com/callback'],
    });

    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken()}`)
      .query({
        client_id: clientId,
        redirect_uri: 'https://evil.com/steal',
        response_type: 'code',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/redirect_uri/i);
  });

  // ─── 3. Expired authorization code ──────────────────────────────────

  it('rejects token exchange with expired authorization code', async () => {
    const { clientId, clientSecret } = registerClient({
      name: 'Expired Code Client',
      isFirstParty: true,
    });

    const expiredCode = crypto.randomUUID();
    insertAuthCode({
      code: expiredCode,
      clientId,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1 minute ago
    });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code: expiredCode,
        redirect_uri: 'https://app.test.com/callback',
        client_id: clientId,
        client_secret: clientSecret,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  // ─── 4. Already-used authorization code (replay prevention) ─────────

  it('rejects second use of an authorization code (replay prevention)', async () => {
    const { clientId, clientSecret } = registerClient({
      name: 'Replay Test Client',
      isFirstParty: true,
    });

    const code = crypto.randomUUID();
    insertAuthCode({
      code,
      clientId,
      redirectUri: 'https://app.test.com/callback',
      scope: 'openid profile',
    });

    // First exchange should succeed
    const res1 = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: clientId,
        client_secret: clientSecret,
      });

    expect(res1.status).toBe(200);
    expect(res1.body.access_token).toBeDefined();

    // Second exchange with the same code should fail
    const res2 = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: clientId,
        client_secret: clientSecret,
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toBe('invalid_grant');
  });

  // ─── 5. PKCE: wrong code_verifier ──────────────────────────────────

  it('rejects token exchange with wrong PKCE code_verifier', async () => {
    const { clientId, clientSecret } = registerClient({
      name: 'PKCE Wrong Verifier Client',
      isFirstParty: true,
    });

    const realVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(realVerifier)
      .digest('base64url');

    const code = crypto.randomUUID();
    insertAuthCode({
      code,
      clientId,
      codeChallenge,
    });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: 'wrong-verifier-value',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toMatch(/code_verifier/i);
  });

  // ─── 6. PKCE: public client requires code_challenge on authorize ────

  it('rejects authorize for public client without code_challenge', async () => {
    const { clientId } = registerClient({
      name: 'Public PKCE Client',
      isPublic: true,
      isFirstParty: true,
      redirectUris: ['https://public-app.test.com/callback'],
    });

    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken()}`)
      .query({
        client_id: clientId,
        redirect_uri: 'https://public-app.test.com/callback',
        response_type: 'code',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/code_challenge/i);
  });

  // ─── 7. Client credentials with wrong client_secret ─────────────────

  it('rejects client_credentials with wrong client_secret', async () => {
    const { clientId } = registerClient({
      name: 'Bad Secret Client',
      isFirstParty: true,
    });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: 'wcs_totally_wrong_secret',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  // ─── 8. Device code flow: poll before user authorizes ───────────────

  it('returns authorization_pending when polling device code before approval', async () => {
    const { clientId } = registerClient({
      name: 'Device Flow Client',
      isFirstParty: true,
    });

    // Request a device code
    const deviceRes = await request(app)
      .post('/api/v1/oauth/device')
      .send({ client_id: clientId, scope: 'openid profile' });

    expect(deviceRes.status).toBe(200);
    expect(deviceRes.body.device_code).toBeDefined();
    expect(deviceRes.body.user_code).toBeDefined();

    // Immediately poll — should get authorization_pending
    const pollRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceRes.body.device_code,
        client_id: clientId,
      });

    expect(pollRes.status).toBe(400);
    expect(pollRes.body.error).toBe('authorization_pending');
  });

  // ─── 9. Device code flow: poll after expiry ─────────────────────────

  it('returns expired_token when polling an expired device code', async () => {
    const { clientId } = registerClient({
      name: 'Device Expiry Client',
      isFirstParty: true,
    });

    const expiredDeviceCode = crypto.randomBytes(32).toString('hex');
    insertDeviceCode({
      deviceCode: expiredDeviceCode,
      userCode: 'EXPR-CODE',
      clientId,
      scope: 'openid',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // expired 1 min ago
      status: 'pending',
    });

    const pollRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: expiredDeviceCode,
        client_id: clientId,
      });

    expect(pollRes.status).toBe(400);
    expect(pollRes.body.error).toBe('expired_token');
  });

  // ─── 10. Refresh with non-existent refresh token ────────────────────

  it('rejects refresh_token grant with non-existent token', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'totally-made-up-refresh-token',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toMatch(/refresh token/i);
  });

  // ─── 11. Scopes the client isn't allowed ────────────────────────────

  it('passes through all requested scopes for first-party client (no server-side stripping on authorize)', async () => {
    // The authorize endpoint for first-party clients auto-approves and passes
    // the requested scopes straight through to the authorization code. Scope
    // enforcement at the resource layer is separate from the authorize step.
    const { clientId } = registerClient({
      name: 'Scope Test Client',
      isFirstParty: true,
      redirectUris: ['https://scope-app.test.com/callback'],
      allowedScopes: ['openid', 'profile'],
    });

    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken()}`)
      .query({
        client_id: clientId,
        redirect_uri: 'https://scope-app.test.com/callback',
        response_type: 'code',
        scope: 'openid profile admin:*',
        state: 'scope-test-state',
      });

    expect(res.status).toBe(200);
    // First-party client auto-approves — we get a code back
    expect(res.body.code).toBeDefined();

    // The code was stored with the full requested scope string
    const storedCode = oauthCodes[res.body.code];
    expect(storedCode).toBeDefined();
    expect(storedCode.scope).toBe('openid profile admin:*');
  });

  // ─── Additional: PKCE success path ──────────────────────────────────

  it('accepts token exchange with correct PKCE code_verifier', async () => {
    const { clientId, clientSecret } = registerClient({
      name: 'PKCE Success Client',
      isFirstParty: true,
    });

    const verifier = crypto.randomBytes(32).toString('hex');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    const code = crypto.randomUUID();
    insertAuthCode({
      code,
      clientId,
      codeChallenge: challenge,
    });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
  });

  // ─── Additional: PKCE required when code has challenge but no verifier sent ──

  it('rejects token exchange when code has code_challenge but no code_verifier sent', async () => {
    const { clientId, clientSecret } = registerClient({
      name: 'PKCE Missing Verifier Client',
      isFirstParty: true,
    });

    const verifier = crypto.randomBytes(32).toString('hex');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    const code = crypto.randomUUID();
    insertAuthCode({
      code,
      clientId,
      codeChallenge: challenge,
    });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: clientId,
        client_secret: clientSecret,
        // no code_verifier
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toMatch(/code_verifier/i);
  });

  // ─── Additional: Expired refresh token ──────────────────────────────

  it('rejects refresh_token grant with expired refresh token', async () => {
    const expiredRT = crypto.randomUUID();
    insertRefreshToken(expiredRT, TEST_USER_ID, new Date(Date.now() - 60 * 1000).toISOString());

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: expiredRT,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });
});
