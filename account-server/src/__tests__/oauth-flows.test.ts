/**
 * OAuth2 Grant Type Tests — end-to-end for all 4 grant types.
 *
 * Exercises:
 *   1. Authorization Code + PKCE (full flow)
 *   2. Client Credentials (service-to-service)
 *   3. Refresh Token rotation
 *   4. Device Code polling flow
 *   5. Edge cases: expired codes, wrong verifier, unknown client
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

const users = new Map<string, any>();
const oauthClients = new Map<string, any>();
const oauthCodes = new Map<string, any>();
const oauthDeviceCodes = new Map<string, any>();
const oauthConsents = new Map<string, any>();
const refreshTokens = new Map<string, any>();
const identityScopes = new Map<string, any>();
const productAccounts = new Map<string, any>();
const tokenBlacklist = new Set<string>();

const TEST_USER_ID = 'user-oauth-001';
const testKeyPair = generateKeyPair();

// Pre-computed client secret
const TEST_CLIENT_SECRET = 'wcs_test-secret-for-oauth-flows';
const TEST_CLIENT_SECRET_HASH = bcrypt.hashSync(TEST_CLIENT_SECRET, 4);

function resetStores() {
  users.clear();
  oauthClients.clear();
  oauthCodes.clear();
  oauthDeviceCodes.clear();
  oauthConsents.clear();
  refreshTokens.clear();
  identityScopes.clear();
  productAccounts.clear();
  tokenBlacklist.clear();

  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: 'oauth@test.com',
    name: 'OAuth User',
    tier: 'pro',
    role: 'admin',
    identity_type: 'human',
    windy_identity_id: 'WI-OAUTH-001',
    storage_used: 0,
    storage_limit: 500 * 1024 * 1024,
    display_name: 'OAuth User',
    avatar_url: null,
    phone: null,
    email_verified: 1,
    phone_verified: 0,
    preferred_lang: 'en',
  });

  // Confidential client (has secret)
  oauthClients.set('test-confidential', {
    client_id: 'test-confidential',
    client_secret_hash: TEST_CLIENT_SECRET_HASH,
    name: 'Test Confidential App',
    redirect_uris: JSON.stringify(['https://app.test/callback']),
    allowed_scopes: JSON.stringify(['openid', 'profile', 'email']),
    is_first_party: 1,
    is_public: 0,
    owner_identity_id: TEST_USER_ID,
    created_at: new Date().toISOString(),
  });

  // Public client (PKCE required)
  oauthClients.set('test-public', {
    client_id: 'test-public',
    client_secret_hash: null,
    name: 'Test Public App',
    redirect_uris: JSON.stringify(['https://mobile.test/callback']),
    allowed_scopes: JSON.stringify(['openid', 'profile']),
    is_first_party: 1,
    is_public: 1,
    owner_identity_id: TEST_USER_ID,
    created_at: new Date().toISOString(),
  });

  // Third-party client (consent required)
  oauthClients.set('test-thirdparty', {
    client_id: 'test-thirdparty',
    client_secret_hash: TEST_CLIENT_SECRET_HASH,
    name: 'Third Party App',
    redirect_uris: JSON.stringify(['https://thirdparty.test/callback']),
    allowed_scopes: JSON.stringify(['openid', 'profile', 'email']),
    is_first_party: 0,
    is_public: 0,
    owner_identity_id: 'other-user',
    created_at: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════
//  MOCK DATABASE
// ═══════════════════════════════════════════

function mockDbPrepare(sql: string) {
  return {
    run: (...args: any[]) => {
      // INSERT INTO oauth_codes
      if (sql.includes('INSERT INTO oauth_codes')) {
        const [code, clientId, identityId, redirectUri, scope, state, codeChallenge, expiresAt] = args;
        oauthCodes.set(code, {
          code, client_id: clientId, identity_id: identityId,
          redirect_uri: redirectUri, scope, state, code_challenge: codeChallenge,
          expires_at: expiresAt, used: 0,
        });
        return { changes: 1 };
      }
      // UPDATE oauth_codes SET used = 1
      if (sql.includes('UPDATE oauth_codes SET used')) {
        const code = args[0];
        const entry = oauthCodes.get(code);
        if (entry && entry.used === 0) {
          entry.used = 1;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      // INSERT INTO refresh_tokens
      if (sql.includes('INSERT INTO refresh_tokens')) {
        const [token, userId, expiresAt] = args;
        refreshTokens.set(token, { token, user_id: userId, expires_at: expiresAt });
        return { changes: 1 };
      }
      // DELETE FROM refresh_tokens
      if (sql.includes('DELETE FROM refresh_tokens')) {
        refreshTokens.delete(args[0]);
        return { changes: 1 };
      }
      // INSERT INTO oauth_consents
      if (sql.includes('INSERT INTO oauth_consents')) {
        const [id, identityId, clientId, scopes] = args;
        oauthConsents.set(`${identityId}:${clientId}`, {
          id, identity_id: identityId, client_id: clientId,
          scopes, granted_at: new Date().toISOString(), revoked_at: null,
        });
        return { changes: 1 };
      }
      // UPDATE oauth_consents SET revoked_at
      if (sql.includes('UPDATE oauth_consents SET revoked_at')) {
        const key = `${args[0]}:${args[1]}`;
        const consent = oauthConsents.get(key);
        if (consent && !consent.revoked_at) {
          consent.revoked_at = new Date().toISOString();
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      // INSERT INTO oauth_device_codes
      if (sql.includes('INSERT INTO oauth_device_codes')) {
        const [deviceCode, userCode, clientId, scope, expiresAt] = args;
        oauthDeviceCodes.set(deviceCode, {
          device_code: deviceCode, user_code: userCode,
          client_id: clientId, scope, expires_at: expiresAt,
          status: 'pending', identity_id: null,
        });
        return { changes: 1 };
      }
      // UPDATE oauth_device_codes SET status = 'approved'
      if (sql.includes("status = 'approved'")) {
        const [identityId, deviceCode] = args;
        const entry = oauthDeviceCodes.get(deviceCode);
        if (entry) {
          entry.status = 'approved';
          entry.identity_id = identityId;
        }
        return { changes: entry ? 1 : 0 };
      }
      // UPDATE oauth_device_codes SET status = 'denied'
      if (sql.includes("status = 'denied'")) {
        const entry = oauthDeviceCodes.get(args[0]);
        if (entry) entry.status = 'denied';
        return { changes: entry ? 1 : 0 };
      }
      // UPDATE oauth_device_codes SET status = 'expired'
      if (sql.includes("status = 'expired'")) {
        const entry = oauthDeviceCodes.get(args[0]);
        if (entry) entry.status = 'expired';
        return { changes: entry ? 1 : 0 };
      }
      // INSERT INTO oauth_clients
      if (sql.includes('INSERT INTO oauth_clients')) {
        const clientId = args[0];
        oauthClients.set(clientId, {
          client_id: clientId,
          client_secret_hash: args[1],
          name: args[2],
          redirect_uris: args[3],
          allowed_scopes: args[4],
          owner_identity_id: args[5] || null,
          is_first_party: args[6] || 0,
          is_public: args[7] || 0,
          created_at: new Date().toISOString(),
        });
        return { changes: 1 };
      }
      // token_blacklist
      if (sql.includes('token_blacklist')) {
        if (args[0]) tokenBlacklist.add(args[0]);
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      // token_blacklist check
      if (sql.includes('FROM token_blacklist')) {
        return tokenBlacklist.has(args[0]) ? { '1': 1 } : null;
      }
      // SELECT * FROM oauth_clients WHERE client_id = ?
      if (sql.includes('FROM oauth_clients WHERE client_id')) {
        return oauthClients.get(args[0]) || null;
      }
      // SELECT * FROM oauth_codes WHERE code = ? AND client_id = ? AND used = 0
      if (sql.includes('FROM oauth_codes') && sql.includes('used = 0')) {
        const entry = oauthCodes.get(args[0]);
        if (entry && entry.client_id === args[1] && entry.used === 0) {
          // Check expiry
          if (new Date(entry.expires_at) > new Date()) return entry;
        }
        return null;
      }
      // SELECT * FROM oauth_device_codes WHERE device_code = ? AND client_id = ?
      if (sql.includes('FROM oauth_device_codes') && sql.includes('device_code = ?') && sql.includes('client_id')) {
        const entry = oauthDeviceCodes.get(args[0]);
        if (entry && entry.client_id === args[1]) return entry;
        return null;
      }
      // SELECT * FROM oauth_device_codes WHERE user_code = ? AND status = 'pending'
      if (sql.includes('FROM oauth_device_codes') && sql.includes('user_code')) {
        for (const entry of oauthDeviceCodes.values()) {
          if (entry.user_code === args[0] && entry.status === 'pending') {
            if (new Date(entry.expires_at) > new Date()) return entry;
          }
        }
        return null;
      }
      // SELECT * FROM refresh_tokens WHERE token = ?
      if (sql.includes('FROM refresh_tokens')) {
        const entry = refreshTokens.get(args[0]);
        if (entry && new Date(entry.expires_at) > new Date()) return entry;
        return null;
      }
      // SELECT * FROM users WHERE id = ?
      if (sql.includes('FROM users WHERE id')) {
        return users.get(args[0]) || null;
      }
      // SELECT identity_type, windy_identity_id FROM users
      if (sql.includes('identity_type') && sql.includes('windy_identity_id')) {
        const u = users.get(args[0]);
        return u ? { identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      // SELECT role FROM users
      if (sql.includes('SELECT role FROM users')) {
        const u = users.get(args[0]);
        return u ? { role: u.role } : null;
      }
      // SELECT scopes FROM oauth_consents
      if (sql.includes('FROM oauth_consents')) {
        const key = `${args[0]}:${args[1]}`;
        const consent = oauthConsents.get(key);
        if (consent && !consent.revoked_at) return consent;
        return null;
      }
      // FROM identity_scopes
      if (sql.includes('FROM identity_scopes')) {
        return null;
      }
      // FROM product_accounts
      if (sql.includes('FROM product_accounts')) {
        return null;
      }
      return null;
    },
    all: (...args: any[]) => {
      // SELECT ... FROM oauth_clients
      if (sql.includes('FROM oauth_clients') && !sql.includes('WHERE')) {
        return Array.from(oauthClients.values());
      }
      // identity_scopes
      if (sql.includes('FROM identity_scopes')) {
        return [];
      }
      // product_accounts
      if (sql.includes('FROM product_accounts')) {
        return [];
      }
      // oauth_consents JOIN
      if (sql.includes('FROM oauth_consents')) {
        const userId = args[0];
        const results: any[] = [];
        for (const consent of oauthConsents.values()) {
          if (consent.identity_id === userId && !consent.revoked_at) {
            const client = oauthClients.get(consent.client_id);
            results.push({
              ...consent,
              client_name: client?.name || 'Unknown',
              is_first_party: client?.is_first_party || 0,
            });
          }
        }
        return results;
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
    JWT_SECRET: 'test-secret-oauth-flows',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/oauth-flows-test',
    UPLOADS_PATH: '/tmp/oauth-flows-test',
    MAX_FILE_SIZE: 500 * 1024 * 1024,
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
    generateKeyPair: actual.generateKeyPair,
    initializeJWKS: () => true,
    getVerificationKeys: () => [{ publicKey: testKeyPair.publicKey, kid: testKeyPair.kid }],
    getPublicKeyByKid: (kid: string) => kid === testKeyPair.kid ? testKeyPair.publicKey : null,
  };
});

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  getScopes: jest.fn().mockReturnValue(['windy_pro:*']),
  getProductAccounts: jest.fn().mockReturnValue([]),
  validateBotApiKey: jest.fn().mockReturnValue({ valid: false }),
}));

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateTestAccessToken(userId = TEST_USER_ID): string {
  return jwt.sign(
    {
      userId, email: 'oauth@test.com', tier: 'pro',
      accountId: userId, type: 'human',
      scopes: ['windy_pro:*'], products: ['windy_pro'],
      iss: 'windy-identity',
    },
    testKeyPair.privateKey,
    { algorithm: 'RS256', expiresIn: '15m', keyid: testKeyPair.kid },
  );
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('OAuth2 Grant Type Flows', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    const oauthRoutes = require('../routes/oauth').default;
    app.use('/api/v1/oauth', oauthRoutes);
  });

  beforeEach(() => {
    resetStores();
  });

  // ═══════════════════════════════════════════
  //  1. AUTHORIZATION CODE + PKCE
  // ═══════════════════════════════════════════

  describe('Authorization Code + PKCE', () => {
    it('should complete full auth code flow with PKCE for public client', async () => {
      const token = generateTestAccessToken();
      const pkce = generatePKCE();

      // Step 1: GET /authorize — get code (first-party auto-approves)
      const authRes = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://mobile.test/callback',
          response_type: 'code',
          scope: 'openid profile',
          state: 'test-state-123',
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256',
        });

      expect(authRes.status).toBe(200);
      expect(authRes.body.code).toBeDefined();
      expect(authRes.body.state).toBe('test-state-123');

      const code = authRes.body.code;

      // Step 2: POST /token — exchange code for tokens
      const tokenRes = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://mobile.test/callback',
          client_id: 'test-public',
          code_verifier: pkce.verifier,
        });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.access_token).toBeDefined();
      expect(tokenRes.body.refresh_token).toBeDefined();
      expect(tokenRes.body.token_type).toBe('Bearer');
      expect(tokenRes.body.expires_in).toBe(900);

      // Verify the issued token is valid
      const decoded = jwt.verify(tokenRes.body.access_token, testKeyPair.publicKey, { algorithms: ['RS256'] }) as any;
      expect(decoded.userId).toBe(TEST_USER_ID);
      expect(decoded.iss).toBe('windy-identity');
    });

    it('should reject wrong PKCE verifier', async () => {
      const token = generateTestAccessToken();
      const pkce = generatePKCE();

      const authRes = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://mobile.test/callback',
          response_type: 'code',
          scope: 'openid',
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256',
        });

      const code = authRes.body.code;

      const tokenRes = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://mobile.test/callback',
          client_id: 'test-public',
          code_verifier: 'wrong-verifier-does-not-match',
        });

      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body.error).toBe('invalid_grant');
    });

    it('should reject reuse of authorization code', async () => {
      const token = generateTestAccessToken();
      const pkce = generatePKCE();

      const authRes = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://mobile.test/callback',
          response_type: 'code',
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256',
        });

      const code = authRes.body.code;

      // First use — should succeed
      await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://mobile.test/callback',
          client_id: 'test-public',
          code_verifier: pkce.verifier,
        });

      // Second use — should fail
      const replayRes = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://mobile.test/callback',
          client_id: 'test-public',
          code_verifier: pkce.verifier,
        });

      expect(replayRes.status).toBe(400);
      expect(replayRes.body.error).toBe('invalid_grant');
    });

    it('should require PKCE for public clients', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://mobile.test/callback',
          response_type: 'code',
          // No code_challenge
        });

      expect(res.status).toBe(400);
      expect(res.body.error_description).toMatch(/code_challenge.*required/i);
    });

    it('should reject invalid redirect_uri', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://evil.com/steal',
          response_type: 'code',
          code_challenge: 'test',
        });

      expect(res.status).toBe(400);
      expect(res.body.error_description).toMatch(/redirect_uri not registered/i);
    });
  });

  // ═══════════════════════════════════════════
  //  2. CLIENT CREDENTIALS
  // ═══════════════════════════════════════════

  describe('Client Credentials', () => {
    it('should issue token for valid client credentials', async () => {
      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-confidential',
          client_secret: TEST_CLIENT_SECRET,
          scope: 'openid profile',
        });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body.expires_in).toBe(3600);

      const decoded = jwt.verify(res.body.access_token, testKeyPair.publicKey, { algorithms: ['RS256'] }) as any;
      expect(decoded.type).toBe('client_credentials');
      expect(decoded.client_id).toBe('test-confidential');
    });

    it('should support HTTP Basic auth for client credentials', async () => {
      const basicAuth = Buffer.from(`test-confidential:${TEST_CLIENT_SECRET}`).toString('base64');

      const res = await request(app)
        .post('/api/v1/oauth/token')
        .set('Authorization', `Basic ${basicAuth}`)
        .send({
          grant_type: 'client_credentials',
          scope: 'openid',
        });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
    });

    it('should reject wrong client secret', async () => {
      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-confidential',
          client_secret: 'wrong-secret',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('should reject unknown client_id', async () => {
      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'nonexistent',
          client_secret: 'anything',
        });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════
  //  3. REFRESH TOKEN ROTATION
  // ═══════════════════════════════════════════

  describe('Refresh Token', () => {
    it('should rotate refresh token and issue new access token', async () => {
      // Seed a refresh token
      const oldRefresh = crypto.randomUUID();
      refreshTokens.set(oldRefresh, {
        token: oldRefresh,
        user_id: TEST_USER_ID,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: oldRefresh,
        });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(res.body.refresh_token).not.toBe(oldRefresh); // rotated

      // Old token should be deleted
      expect(refreshTokens.has(oldRefresh)).toBe(false);
    });

    it('should reject expired refresh token', async () => {
      const expired = crypto.randomUUID();
      refreshTokens.set(expired, {
        token: expired,
        user_id: TEST_USER_ID,
        expires_at: new Date(Date.now() - 1000).toISOString(), // expired
      });

      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: expired,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('should reject unknown refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: 'nonexistent-token',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });
  });

  // ═══════════════════════════════════════════
  //  4. DEVICE CODE FLOW
  // ═══════════════════════════════════════════

  describe('Device Code Flow', () => {
    it('should complete full device code flow', async () => {
      const token = generateTestAccessToken();

      // Step 1: Request device code
      const deviceRes = await request(app)
        .post('/api/v1/oauth/device')
        .send({ client_id: 'test-public', scope: 'openid profile' });

      expect(deviceRes.status).toBe(200);
      expect(deviceRes.body.device_code).toBeDefined();
      expect(deviceRes.body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(deviceRes.body.verification_uri).toBeDefined();
      expect(deviceRes.body.expires_in).toBe(900);
      expect(deviceRes.body.interval).toBe(5);

      const { device_code, user_code } = deviceRes.body;

      // Step 2: Poll before approval — should get authorization_pending
      const pendingRes = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: 'test-public',
        });

      expect(pendingRes.status).toBe(400);
      expect(pendingRes.body.error).toBe('authorization_pending');

      // Step 3: User approves
      const approveRes = await request(app)
        .post('/api/v1/oauth/device/approve')
        .set('Authorization', `Bearer ${token}`)
        .send({ user_code, approved: true });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.success).toBe(true);

      // Step 4: Poll again — should get tokens
      const tokenRes = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: 'test-public',
        });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.access_token).toBeDefined();
      expect(tokenRes.body.refresh_token).toBeDefined();
    });

    it('should handle device code denial', async () => {
      const token = generateTestAccessToken();

      const deviceRes = await request(app)
        .post('/api/v1/oauth/device')
        .send({ client_id: 'test-public' });

      const { device_code, user_code } = deviceRes.body;

      // User denies
      await request(app)
        .post('/api/v1/oauth/device/approve')
        .set('Authorization', `Bearer ${token}`)
        .send({ user_code, approved: false });

      // Poll — should get access_denied
      const tokenRes = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: 'test-public',
        });

      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body.error).toBe('access_denied');
    });

    it('should reject unknown device code', async () => {
      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: 'nonexistent',
          client_id: 'test-public',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });
  });

  // ═══════════════════════════════════════════
  //  5. CONSENT MANAGEMENT
  // ═══════════════════════════════════════════

  describe('Consent Management', () => {
    it('should require consent for third-party clients', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-thirdparty',
          redirect_uri: 'https://thirdparty.test/callback',
          response_type: 'code',
          scope: 'openid profile',
        });

      expect(res.status).toBe(200);
      expect(res.body.consent_required).toBe(true);
      expect(res.body.client.name).toBe('Third Party App');
      expect(res.body.requestedScopes).toEqual(['openid', 'profile']);
    });

    it('should grant consent and issue code via POST /authorize', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .post('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .send({
          client_id: 'test-thirdparty',
          redirect_uri: 'https://thirdparty.test/callback',
          scope: 'openid profile',
          approved: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBeDefined();
      expect(res.body.redirect).toContain('https://thirdparty.test/callback');
    });

    it('should list and revoke consents', async () => {
      const token = generateTestAccessToken();

      // Grant consent first
      await request(app)
        .post('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .send({
          client_id: 'test-thirdparty',
          redirect_uri: 'https://thirdparty.test/callback',
          scope: 'openid',
          approved: true,
        });

      // List consents
      const listRes = await request(app)
        .get('/api/v1/oauth/consents')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.consents.length).toBeGreaterThanOrEqual(1);

      // Revoke
      const revokeRes = await request(app)
        .delete('/api/v1/oauth/consents/test-thirdparty')
        .set('Authorization', `Bearer ${token}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.revoked).toBe(true);
    });
  });

  // ═══════════════════════════════════════════
  //  6. ERROR CASES
  // ═══════════════════════════════════════════

  describe('Error Cases', () => {
    it('should reject unsupported grant_type', async () => {
      const res = await request(app)
        .post('/api/v1/oauth/token')
        .send({ grant_type: 'implicit' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_grant_type');
    });

    it('should reject unsupported response_type', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://mobile.test/callback',
          response_type: 'token',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_response_type');
    });

    it('should reject authorize without auth token', async () => {
      const res = await request(app)
        .get('/api/v1/oauth/authorize')
        .query({
          client_id: 'test-public',
          redirect_uri: 'https://mobile.test/callback',
          response_type: 'code',
        });

      expect(res.status).toBe(401);
    });

    it('should serve consent page HTML', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .get('/api/v1/oauth/consent')
        .set('Authorization', `Bearer ${token}`)
        .query({
          client_id: 'test-thirdparty',
          redirect_uri: 'https://thirdparty.test/callback',
          scope: 'openid profile',
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Third Party App');
      expect(res.text).toContain('wants access');
    });

    it('should return OIDC userinfo', async () => {
      const token = generateTestAccessToken();

      const res = await request(app)
        .get('/api/v1/oauth/userinfo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sub).toBeDefined();
      expect(res.body.email).toBe('oauth@test.com');
      expect(res.body.name).toBe('OAuth User');
    });
  });
});
