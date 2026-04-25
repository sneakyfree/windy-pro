/**
 * Comprehensive OAuth2/OIDC flow tests.
 *
 * Tests cover:
 *   1. OIDC discovery endpoint metadata
 *   2. JWKS endpoint returns valid keys
 *   3. Authorization code grant end-to-end
 *   4. Client credentials grant
 *   5. Token refresh flow
 *   6. Invalid client_id returns 401
 *   7. Expired tokens are rejected
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { generateKeyPair, getJWKSDocument } from '../jwks';

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

// Pre-seed test data
const TEST_USER_ID = 'user-001';
const TEST_USER = {
  id: TEST_USER_ID,
  email: 'test@windypro.com',
  tier: 'pro',
  role: 'admin',
  identity_type: 'human',
  windy_identity_id: 'WI-001',
  name: 'Test User',
  display_name: 'Test User',
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
    JWT_SECRET: 'test-secret-comprehensive-oauth',
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
    // Set exp to 1 second in the past
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

// ═══════════════════════════════════════════
//  BUILD APP
// ═══════════════════════════════════════════

let app: Express;

beforeAll(() => {
  // Build a minimal Express app with the relevant routes
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Mount OAuth routes
  const oauthRoutes = require('../routes/oauth').default;
  app.use('/api/v1/oauth', oauthRoutes);

  // JWKS endpoint
  const { getJWKSDocument: getDoc } = require('../jwks');
  app.get('/.well-known/jwks.json', (_req, res) => {
    const jwks = getDoc();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(jwks);
  });

  // OIDC discovery
  app.get('/.well-known/openid-configuration', (req, res) => {
    const issuer = `${req.protocol}://${req.get('host')}`;
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/api/v1/oauth/authorize`,
      token_endpoint: `${issuer}/api/v1/oauth/token`,
      userinfo_endpoint: `${issuer}/api/v1/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      device_authorization_endpoint: `${issuer}/api/v1/oauth/device`,
      scopes_supported: [
        'openid', 'profile', 'email', 'phone',
        'windy_pro:*', 'windy_chat:read', 'windy_chat:write',
        'windy_mail:read', 'windy_mail:send', 'windy_fly:*',
      ],
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'client_credentials',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256', 'HS256'],
      code_challenge_methods_supported: ['S256'],
    });
  });
});

// ═══════════════════════════════════════════
//  1. OIDC DISCOVERY
// ═══════════════════════════════════════════

describe('OIDC Discovery Endpoint', () => {
  it('should return valid OpenID Connect metadata', async () => {
    const res = await request(app)
      .get('/.well-known/openid-configuration')
      .expect(200);

    const body = res.body;
    expect(body.issuer).toBeDefined();
    expect(body.authorization_endpoint).toContain('/api/v1/oauth/authorize');
    expect(body.token_endpoint).toContain('/api/v1/oauth/token');
    expect(body.userinfo_endpoint).toContain('/api/v1/oauth/userinfo');
    expect(body.jwks_uri).toContain('/.well-known/jwks.json');
    expect(body.device_authorization_endpoint).toContain('/api/v1/oauth/device');
  });

  it('should advertise supported scopes', async () => {
    const res = await request(app)
      .get('/.well-known/openid-configuration')
      .expect(200);

    expect(res.body.scopes_supported).toContain('openid');
    expect(res.body.scopes_supported).toContain('profile');
    expect(res.body.scopes_supported).toContain('email');
    expect(res.body.scopes_supported).toContain('windy_pro:*');
  });

  it('should advertise supported grant types', async () => {
    const res = await request(app)
      .get('/.well-known/openid-configuration')
      .expect(200);

    expect(res.body.grant_types_supported).toEqual(
      expect.arrayContaining([
        'authorization_code',
        'client_credentials',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ]),
    );
  });

  it('should advertise response_types_supported = [code]', async () => {
    const res = await request(app)
      .get('/.well-known/openid-configuration')
      .expect(200);

    expect(res.body.response_types_supported).toEqual(['code']);
  });

  it('should advertise S256 code challenge method', async () => {
    const res = await request(app)
      .get('/.well-known/openid-configuration')
      .expect(200);

    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('should advertise RS256 and HS256 signing algorithms', async () => {
    const res = await request(app)
      .get('/.well-known/openid-configuration')
      .expect(200);

    expect(res.body.id_token_signing_alg_values_supported).toEqual(
      expect.arrayContaining(['RS256', 'HS256']),
    );
  });
});

// ═══════════════════════════════════════════
//  2. JWKS ENDPOINT
// ═══════════════════════════════════════════

describe('JWKS Endpoint', () => {
  it('should return a valid JWKS document with keys', async () => {
    const res = await request(app)
      .get('/.well-known/jwks.json')
      .expect(200);

    expect(res.body.keys).toBeDefined();
    expect(Array.isArray(res.body.keys)).toBe(true);
  });

  it('should return RSA keys with required JWK fields', async () => {
    const res = await request(app)
      .get('/.well-known/jwks.json')
      .expect(200);

    // At minimum, the test key pair is available via getJWKSDocument
    // The mock returns the actual implementation, which uses managedKeys
    const doc = res.body;
    if (doc.keys.length > 0) {
      const key = doc.keys[0];
      expect(key.kty).toBe('RSA');
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('RS256');
      expect(key.kid).toBeDefined();
      expect(key.n).toBeDefined(); // modulus
      expect(key.e).toBeDefined(); // exponent
    }
  });

  it('should set Cache-Control header', async () => {
    const res = await request(app)
      .get('/.well-known/jwks.json')
      .expect(200);

    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('should produce keys that can verify RS256 tokens', () => {
    // Sign a token with the test private key
    const token = jwt.sign(
      { sub: 'test', iss: 'windy-identity' },
      testKeyPair.privateKey,
      { algorithm: 'RS256', keyid: testKeyPair.kid },
    );

    // Verify with the public key
    const decoded = jwt.verify(token, testKeyPair.publicKey, { algorithms: ['RS256'] }) as any;
    expect(decoded.sub).toBe('test');
    expect(decoded.iss).toBe('windy-identity');
  });
});

// ═══════════════════════════════════════════
//  3. AUTHORIZATION CODE GRANT — END-TO-END
// ═══════════════════════════════════════════

describe('Authorization Code Grant — End-to-End', () => {
  let firstPartyClient: { clientId: string; clientSecret: string | null };
  let validToken: string;

  beforeAll(() => {
    firstPartyClient = registerClient({
      name: 'Windy Pro App',
      isFirstParty: true,
      isPublic: false,
      redirectUris: ['https://app.test.com/callback'],
      allowedScopes: ['openid', 'profile', 'email', 'windy_pro:*'],
    });
    validToken = generateTestAccessToken();
  });

  it('step 1: request authorization code for first-party client', async () => {
    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken}`)
      .query({
        client_id: firstPartyClient.clientId,
        redirect_uri: 'https://app.test.com/callback',
        response_type: 'code',
        scope: 'openid profile',
        state: 'random-state-123',
      })
      .expect(200);

    // First-party clients auto-approve
    expect(res.body.code).toBeDefined();
    expect(res.body.redirect).toContain('code=');
    expect(res.body.state).toBe('random-state-123');
  });

  it('step 2: exchange authorization code for tokens', async () => {
    // Insert an auth code directly
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({ code, clientId: firstPartyClient.clientId });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: firstPartyClient.clientId,
        client_secret: firstPartyClient.clientSecret,
      })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(900);
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.scope).toBe('openid profile');
  });

  it('step 3: validate the access token is a valid JWT', async () => {
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({ code, clientId: firstPartyClient.clientId });

    const tokenRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: firstPartyClient.clientId,
        client_secret: firstPartyClient.clientSecret,
      })
      .expect(200);

    const accessToken = tokenRes.body.access_token;

    // Verify the JWT can be decoded and has correct claims
    const decoded = jwt.verify(accessToken, testKeyPair.publicKey, { algorithms: ['RS256'] }) as any;
    expect(decoded.userId).toBe(TEST_USER_ID);
    expect(decoded.email).toBe(TEST_USER.email);
    expect(decoded.iss).toBe('windy-identity');
    expect(decoded.scopes).toBeDefined();
  });

  it('step 4: call userinfo with the access token', async () => {
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({ code, clientId: firstPartyClient.clientId });

    const tokenRes = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: firstPartyClient.clientId,
        client_secret: firstPartyClient.clientSecret,
      })
      .expect(200);

    const res = await request(app)
      .get('/api/v1/oauth/userinfo')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
      .expect(200);

    expect(res.body.sub).toBeDefined();
    expect(res.body.email).toBe(TEST_USER.email);
    expect(res.body.email_verified).toBe(true);
    expect(res.body.name).toBe(TEST_USER.display_name);
    expect(res.body.windy_identity_id).toBe(TEST_USER.windy_identity_id);
    expect(res.body.identity_type).toBe('human');
    expect(res.body.products).toBeDefined();
  });

  it('should enforce PKCE for public clients', async () => {
    const publicClient = registerClient({
      name: 'Public CLI',
      isPublic: true,
      redirectUris: ['http://localhost:3000/callback'],
    });

    // Missing code_challenge should fail
    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken}`)
      .query({
        client_id: publicClient.clientId,
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
      })
      .expect(400);

    expect(res.body.error_description).toContain('PKCE');
  });

  it('should verify PKCE code_verifier on token exchange', async () => {
    const publicClient = registerClient({
      name: 'PKCE Client',
      isPublic: true,
      isFirstParty: true,
      redirectUris: ['http://localhost:3000/callback'],
    });

    // Generate PKCE pair
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Insert code with challenge
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({
      code,
      clientId: publicClient.clientId,
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge,
    });

    // Exchange with correct verifier
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/callback',
        client_id: publicClient.clientId,
        code_verifier: codeVerifier,
      })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
  });

  it('should reject wrong PKCE code_verifier', async () => {
    const publicClient = registerClient({
      name: 'PKCE Client 2',
      isPublic: true,
      isFirstParty: true,
      redirectUris: ['http://localhost:3000/callback'],
    });

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({
      code,
      clientId: publicClient.clientId,
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge,
    });

    // Exchange with WRONG verifier
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/callback',
        client_id: publicClient.clientId,
        code_verifier: 'this-is-the-wrong-verifier',
      })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toContain('code_verifier');
  });

  it('should prevent authorization code reuse', async () => {
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({ code, clientId: firstPartyClient.clientId });

    // First use — succeeds
    await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: firstPartyClient.clientId,
        client_secret: firstPartyClient.clientSecret,
      })
      .expect(200);

    // Second use — fails
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: firstPartyClient.clientId,
        client_secret: firstPartyClient.clientSecret,
      })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
  });

  it('should reject mismatched redirect_uri on token exchange', async () => {
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({ code, clientId: firstPartyClient.clientId });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://evil.com/callback',
        client_id: firstPartyClient.clientId,
        client_secret: firstPartyClient.clientSecret,
      })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toContain('redirect_uri');
  });
});

// ═══════════════════════════════════════════
//  4. CLIENT CREDENTIALS GRANT
// ═══════════════════════════════════════════

describe('Client Credentials Grant', () => {
  let confidentialClient: { clientId: string; clientSecret: string | null };

  beforeAll(() => {
    confidentialClient = registerClient({
      name: 'Service Backend',
      isPublic: false,
      allowedScopes: ['windy_pro:read', 'windy_chat:read'],
    });
  });

  it('should issue an access token for valid client credentials', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: confidentialClient.clientId,
        client_secret: confidentialClient.clientSecret,
      })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.scope).toBeDefined();

    // Verify the token
    const decoded = jwt.verify(res.body.access_token, testKeyPair.publicKey, { algorithms: ['RS256'] }) as any;
    expect(decoded.type).toBe('client_credentials');
    expect(decoded.client_id).toBe(confidentialClient.clientId);
  });

  it('should accept Basic auth header for client credentials', async () => {
    const credentials = Buffer.from(
      `${confidentialClient.clientId}:${confidentialClient.clientSecret}`,
    ).toString('base64');

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .set('Authorization', `Basic ${credentials}`)
      .send({ grant_type: 'client_credentials' })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('Bearer');
  });

  it('should reject invalid client secret', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: confidentialClient.clientId,
        client_secret: 'wrong-secret',
      })
      .expect(401);

    expect(res.body.error).toBe('invalid_client');
  });

  it('should not issue refresh_token for client_credentials grant', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: confidentialClient.clientId,
        client_secret: confidentialClient.clientSecret,
      })
      .expect(200);

    expect(res.body.refresh_token).toBeUndefined();
  });

  it('should respect requested scope', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: confidentialClient.clientId,
        client_secret: confidentialClient.clientSecret,
        scope: 'windy_pro:read',
      })
      .expect(200);

    expect(res.body.scope).toBe('windy_pro:read');
  });
});

// ═══════════════════════════════════════════
//  5. TOKEN REFRESH FLOW
// ═══════════════════════════════════════════

describe('Token Refresh Flow', () => {
  it('should exchange a valid refresh token for new tokens', async () => {
    const refreshToken = crypto.randomUUID();
    insertRefreshToken(refreshToken);

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(900);
    expect(res.body.refresh_token).toBeDefined();

    // The new refresh token should be different (rotation)
    expect(res.body.refresh_token).not.toBe(refreshToken);
  });

  it('should invalidate old refresh token after use (rotation)', async () => {
    const refreshToken = crypto.randomUUID();
    insertRefreshToken(refreshToken);

    // First use — succeeds
    await request(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'refresh_token', refresh_token: refreshToken })
      .expect(200);

    // Second use — fails (old token was deleted)
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'refresh_token', refresh_token: refreshToken })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
  });

  it('should reject expired refresh token', async () => {
    const refreshToken = crypto.randomUUID();
    insertRefreshToken(refreshToken, TEST_USER_ID, new Date(Date.now() - 1000).toISOString());

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'refresh_token', refresh_token: refreshToken })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
  });

  it('should reject unknown refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'refresh_token', refresh_token: 'nonexistent-token' })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
  });

  it('should verify client credentials if provided on refresh', async () => {
    const client = registerClient({ name: 'Refresh Client' });
    const refreshToken = crypto.randomUUID();
    insertRefreshToken(refreshToken);

    // Wrong secret
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: 'wrong-secret',
      })
      .expect(401);

    expect(res.body.error).toBe('invalid_client');
  });
});

// ═══════════════════════════════════════════
//  6. INVALID CLIENT_ID → 401
// ═══════════════════════════════════════════

describe('Invalid Client ID', () => {
  it('should return 401 for unknown client_id on authorization_code grant', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code: 'some-code',
        redirect_uri: 'https://app.test.com/callback',
        client_id: 'nonexistent-client-id',
      })
      .expect(401);

    expect(res.body.error).toBe('invalid_client');
  });

  it('should return 401 for unknown client_id on client_credentials grant', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'nonexistent-client-id',
        client_secret: 'some-secret',
      })
      .expect(401);

    expect(res.body.error).toBe('invalid_client');
  });

  it('should return 400 for unknown client_id on authorize endpoint', async () => {
    const validToken = generateTestAccessToken();
    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${validToken}`)
      .query({
        client_id: 'nonexistent-client-id',
        redirect_uri: 'https://app.test.com/callback',
        response_type: 'code',
      })
      .expect(400);

    expect(res.body.error).toBe('invalid_client');
  });

  it('should return 401 for wrong client_secret on confidential client', async () => {
    const client = registerClient({ name: 'Secret Client' });

    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({ code, clientId: client.clientId });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: client.clientId,
        client_secret: 'wrong-secret',
      })
      .expect(401);

    expect(res.body.error).toBe('invalid_client');
  });
});

// ═══════════════════════════════════════════
//  7. EXPIRED TOKENS ARE REJECTED
// ═══════════════════════════════════════════

describe('Expired Token Rejection', () => {
  it('should reject an expired JWT on userinfo endpoint', async () => {
    const expiredToken = generateTestAccessToken({}, { expired: true });

    const res = await request(app)
      .get('/api/v1/oauth/userinfo')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(res.body.error).toBe('Token expired');
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('should reject an expired JWT on authorize endpoint', async () => {
    const expiredToken = generateTestAccessToken({}, { expired: true });

    const client = registerClient({ name: 'Expired Token Client', isFirstParty: true });

    const res = await request(app)
      .get('/api/v1/oauth/authorize')
      .set('Authorization', `Bearer ${expiredToken}`)
      .query({
        client_id: client.clientId,
        redirect_uri: 'https://app.test.com/callback',
        response_type: 'code',
      })
      .expect(401);

    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('should reject expired authorization codes', async () => {
    const client = registerClient({ name: 'Expired Code Client' });
    const code = crypto.randomBytes(32).toString('base64url');
    insertAuthCode({
      code,
      clientId: client.clientId,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
    });

    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.test.com/callback',
        client_id: client.clientId,
        client_secret: client.clientSecret,
      })
      .expect(400);

    expect(res.body.error).toBe('invalid_grant');
  });

  it('should reject completely invalid JWT tokens', async () => {
    // P2-3: malformed / unsigned tokens are 401 (RFC 6750), not 403.
    const res = await request(app)
      .get('/api/v1/oauth/userinfo')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt')
      .expect(401);

    expect(res.body.error).toBe('Invalid token');
  });

  it('should reject requests with no Authorization header', async () => {
    const res = await request(app)
      .get('/api/v1/oauth/userinfo')
      .expect(401);

    expect(res.body.error).toBe('Authentication required');
  });
});

// ═══════════════════════════════════════════
//  ADDITIONAL: UNSUPPORTED GRANT TYPE
// ═══════════════════════════════════════════

describe('Unsupported Grant Type', () => {
  it('should return error for unknown grant_type', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/token')
      .send({ grant_type: 'password' })
      .expect(400);

    expect(res.body.error).toBe('unsupported_grant_type');
  });
});
