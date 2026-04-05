/**
 * Hardening tests for POST /api/v1/identity/provision-all
 *
 * Covers:
 *   1. Provision with valid JWT, no webhook URLs -> pending status
 *   2. Provision always returns windy_chat and windy_mail
 *   3. Partial webhook failure (chat down, mail ok)
 *   4. No auth -> 401
 *   5. Non-existent user -> 404
 */
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
const productAccounts = new Map<string, any[]>();
const identityScopes = new Map<string, string[]>();
const tokenBlacklist = new Set<string>();

// Pre-seed constants
const TEST_USER_ID = 'provision-user-001';
const TEST_USER_EMAIL = 'provision@test.com';
const TEST_USER_PASSWORD = 'Str0ngP@ss!';
const TEST_WINDY_IDENTITY_ID = 'WI-PROV-001';
let TEST_USER_HASH: string;

// Key pairs for JWT signing
const testKeyPair = generateKeyPair();

// ═══════════════════════════════════════════
//  MOCK DATABASE — Statements
// ═══════════════════════════════════════════

jest.mock('../db/statements', () => ({
  getStatements: () => ({
    findUserByEmail: {
      get: (email: string) => {
        for (const u of users.values()) {
          if (u.email === email) return u;
        }
        return null;
      },
    },
    createUser: {
      run: () => ({ changes: 1 }),
    },
    countDevices: {
      get: () => ({ count: 0 }),
    },
    addDevice: {
      run: () => ({ changes: 1 }),
    },
    findDevice: {
      get: () => null,
    },
    touchDevice: {
      run: () => ({ changes: 0 }),
    },
    updateUserSeen: {
      run: () => ({ changes: 1 }),
    },
    deleteUserRefreshTokens: {
      run: () => ({ changes: 0 }),
    },
    saveRefreshToken: {
      run: () => ({ changes: 1 }),
    },
    getDevices: {
      all: () => [],
    },
    findUserById: {
      get: (id: string) => users.get(id) || null,
    },
  }),
}));

// ═══════════════════════════════════════════
//  MOCK DATABASE — Schema (prepare-based)
// ═══════════════════════════════════════════

function mockDbPrepare(sql: string) {
  return {
    run: (...args: any[]) => {
      // UPDATE users SET windy_identity_id
      if (sql.includes('UPDATE users SET windy_identity_id')) {
        const [windyId, userId] = args;
        const user = users.get(userId);
        if (user) user.windy_identity_id = windyId;
        return { changes: user ? 1 : 0 };
      }
      // UPDATE product_accounts SET status = 'active', external_id = ?
      if (sql.includes('UPDATE product_accounts SET status')) {
        const [externalId, identityId] = args;
        const accounts = productAccounts.get(identityId) || [];
        // Determine product from SQL
        let product: string | null = null;
        if (sql.includes("'windy_chat'")) product = 'windy_chat';
        if (sql.includes("'windy_mail'")) product = 'windy_mail';
        if (product) {
          const acct = accounts.find((a: any) => a.product === product);
          if (acct) {
            acct.status = 'active';
            acct.external_id = externalId;
          }
        }
        return { changes: 1 };
      }
      // UPDATE users SET (general)
      if (sql.includes('UPDATE users SET')) {
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      // FROM token_blacklist
      if (sql.includes('FROM token_blacklist')) {
        return tokenBlacklist.has(args[0]) ? { '1': 1 } : null;
      }
      // SELECT ... FROM users WHERE windy_identity_id = ?
      if (sql.includes('FROM users WHERE windy_identity_id')) {
        for (const u of users.values()) {
          if (u.windy_identity_id === args[0]) return u;
        }
        return null;
      }
      // SELECT ... FROM users WHERE id = ?
      if (sql.includes('FROM users WHERE id')) {
        return users.get(args[0]) || null;
      }
      // SELECT identity_type, windy_identity_id FROM users
      if (sql.includes('SELECT identity_type, windy_identity_id FROM users')) {
        const u = users.get(args[0]);
        return u ? { identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      // SELECT role FROM users
      if (sql.includes('SELECT role FROM users')) {
        const u = users.get(args[0]);
        return u ? { role: u.role } : null;
      }
      // SELECT email, tier, identity_type, windy_identity_id FROM users
      if (sql.includes('SELECT email, tier, identity_type, windy_identity_id')) {
        const u = users.get(args[0]);
        return u ? { email: u.email, tier: u.tier, identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      // chat_profiles
      if (sql.includes('FROM chat_profiles')) {
        return null;
      }
      // eternitas_passports
      if (sql.includes('FROM eternitas_passports')) {
        return null;
      }
      return null;
    },
    all: (...args: any[]) => {
      // FROM identity_scopes
      if (sql.includes('FROM identity_scopes')) {
        const scopes = identityScopes.get(args[0]) || [];
        return scopes.map((s: string) => ({ scope: s }));
      }
      // FROM product_accounts
      if (sql.includes('FROM product_accounts')) {
        return productAccounts.get(args[0]) || [];
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

// ═══════════════════════════════════════════
//  MOCK CONFIG (mutable for webhook URL tests)
// ═══════════════════════════════════════════

const mockConfig = {
  JWT_SECRET: 'test-secret-provision',
  JWT_EXPIRY: '15m',
  DB_PATH: ':memory:',
  DATA_ROOT: '/tmp/test',
  UPLOADS_PATH: '/tmp/test/uploads',
  PORT: 0,
  BCRYPT_ROUNDS: 4,
  MAX_DEVICES: 5,
  WINDY_CHAT_WEBHOOK_URL: '',
  WINDY_MAIL_WEBHOOK_URL: '',
};

jest.mock('../config', () => ({
  config: mockConfig,
}));

// ═══════════════════════════════════════════
//  MOCK JWKS
// ═══════════════════════════════════════════

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
    initializeJWKS: () => true,
    getVerificationKeys: () => [{ publicKey: testKeyPair.publicKey, kid: testKeyPair.kid }],
    getPublicKeyByKid: (kid: string) => kid === testKeyPair.kid ? testKeyPair.publicKey : null,
  };
});

// ═══════════════════════════════════════════
//  MOCK IDENTITY SERVICE
// ═══════════════════════════════════════════

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  provisionProduct: jest.fn((userId: string, product: string) => {
    const accounts = productAccounts.get(userId) || [];
    const existing = accounts.find((a: any) => a.product === product);
    if (!existing) {
      accounts.push({ product, status: 'pending', external_id: null });
      productAccounts.set(userId, accounts);
    }
  }),
  grantScopes: jest.fn(),
  revokeScope: jest.fn(),
  hasScope: jest.fn(),
  getAuditLog: jest.fn().mockReturnValue([]),
  getScopes: jest.fn((id: string) => {
    const scopes = identityScopes.get(id) || [];
    return scopes.map((s: string) => ({ scope: s }));
  }),
  getProductAccounts: jest.fn((id: string) => {
    return (productAccounts.get(id) || []).map((p: any) => ({
      product: p.product,
      status: p.status,
      external_id: p.external_id || null,
    }));
  }),
  updateProductStatus: jest.fn(),
  upsertChatProfile: jest.fn(),
  getChatProfile: jest.fn().mockReturnValue(null),
  processEternitasEvent: jest.fn(),
  hasSecretaryConsent: jest.fn().mockReturnValue(false),
  grantSecretaryConsent: jest.fn(),
  revokeSecretaryConsent: jest.fn(),
  createBotApiKey: jest.fn(),
  validateBotApiKey: jest.fn(),
  revokeBotApiKey: jest.fn(),
  backfillExistingUsers: jest.fn(),
  executeRevocationCascade: jest.fn(),
  hasAllScopes: jest.fn(),
}));

jest.mock('@windy-pro/contracts', () => ({
  normalizeProductTier: jest.fn((tier: string) => tier),
}));

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken: jest.fn().mockResolvedValue(undefined),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateTestAccessToken(overrides: Record<string, any> = {}): string {
  const payload: Record<string, any> = {
    userId: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    tier: 'pro',
    accountId: TEST_USER_ID,
    type: 'human',
    scopes: ['windy_pro:*'],
    products: ['windy_pro'],
    iss: 'windy-identity',
    ...overrides,
  };

  return jwt.sign(payload, testKeyPair.privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    keyid: testKeyPair.kid,
  });
}

// ═══════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════

let app: Express;

beforeAll(async () => {
  TEST_USER_HASH = await bcrypt.hash(TEST_USER_PASSWORD, 4);

  // Seed the test user
  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    name: 'Provision Test',
    password_hash: TEST_USER_HASH,
    tier: 'pro',
    identity_type: 'human',
    windy_identity_id: TEST_WINDY_IDENTITY_ID,
    display_name: 'Provision Test',
    avatar_url: null,
    phone: null,
    email_verified: 1,
    phone_verified: 0,
    preferred_lang: 'en',
    role: 'user',
    last_login_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  identityScopes.set(TEST_USER_ID, ['windy_pro:*']);
  productAccounts.set(TEST_USER_ID, [
    { product: 'windy_pro', status: 'active', external_id: null },
  ]);

  // Build Express app
  app = express();
  app.use(express.json());

  const authRoutes = require('../routes/auth').default;
  const identityRoutes = require('../routes/identity').default;

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/identity', identityRoutes);
});

afterEach(() => {
  // Reset product accounts back to just windy_pro for the test user
  productAccounts.set(TEST_USER_ID, [
    { product: 'windy_pro', status: 'active', external_id: null },
  ]);

  // Reset webhook URLs
  mockConfig.WINDY_CHAT_WEBHOOK_URL = '';
  mockConfig.WINDY_MAIL_WEBHOOK_URL = '';

  // Restore global.fetch if it was mocked
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════
//  1. Provision with valid JWT, no webhooks
// ═══════════════════════════════════════════

describe('POST /api/v1/identity/provision-all', () => {
  test('with valid JWT and no webhook URLs → should return pending for both products', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/identity/provision-all')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.windyIdentityId).toBe(TEST_WINDY_IDENTITY_ID);

    // Both products should be pending since no webhook URLs are configured
    expect(res.body.provisioned).toBeDefined();
    expect(res.body.provisioned.windy_chat).toBeDefined();
    expect(res.body.provisioned.windy_chat.status).toBe('pending');
    expect(res.body.provisioned.windy_mail).toBeDefined();
    expect(res.body.provisioned.windy_mail.status).toBe('pending');

    // products array should be returned
    expect(res.body.products).toBeDefined();
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  // ═══════════════════════════════════════════
  //  2. Always provisions windy_chat and windy_mail
  // ═══════════════════════════════════════════

  test('always provisions windy_chat and windy_mail regardless of request body', async () => {
    const token = generateTestAccessToken();

    // Send an arbitrary products array — endpoint ignores it
    const res = await request(app)
      .post('/api/v1/identity/provision-all')
      .set('Authorization', `Bearer ${token}`)
      .send({ products: ['unknown_product', 'another_thing'] });

    expect(res.status).toBe(200);

    // Should still provision the standard two products
    const provisionedKeys = Object.keys(res.body.provisioned);
    expect(provisionedKeys).toContain('windy_chat');
    expect(provisionedKeys).toContain('windy_mail');
    expect(provisionedKeys).not.toContain('unknown_product');
    expect(provisionedKeys).not.toContain('another_thing');
  });

  // ═══════════════════════════════════════════
  //  3. Partial webhook failure
  // ═══════════════════════════════════════════

  test('when chat webhook fails but mail webhook succeeds → chat=webhook_error, mail=active', async () => {
    const token = generateTestAccessToken();

    // Configure webhook URLs
    mockConfig.WINDY_CHAT_WEBHOOK_URL = 'https://chat.test/provision';
    mockConfig.WINDY_MAIL_WEBHOOK_URL = 'https://mail.test/provision';

    // Mock global.fetch: chat throws, mail succeeds
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('chat.test')) {
        throw new Error('Connection refused');
      }
      if (url.includes('mail.test')) {
        return {
          ok: true,
          json: async () => ({ externalId: 'mail-ext-001', emailAddress: 'user@windy.mail' }),
        } as globalThis.Response;
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const res = await request(app)
      .post('/api/v1/identity/provision-all')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    // Chat should have webhook_error
    expect(res.body.provisioned.windy_chat.status).toBe('webhook_error');
    expect(res.body.provisioned.windy_chat.error).toBeDefined();

    // Mail should be active
    expect(res.body.provisioned.windy_mail.status).toBe('active');
    expect(res.body.provisioned.windy_mail.externalId).toBe('mail-ext-001');

    // Verify fetch was called for both URLs
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockRestore();
  });

  // ═══════════════════════════════════════════
  //  4. No auth → 401
  // ═══════════════════════════════════════════

  test('without auth token → 401', async () => {
    const res = await request(app)
      .post('/api/v1/identity/provision-all')
      .send({});

    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════
  //  5. Non-existent user → 404
  // ═══════════════════════════════════════════

  test('with windyIdentityId for non-existent user → 404', async () => {
    const token = generateTestAccessToken({ role: 'admin', scopes: ['admin:*'] });

    const res = await request(app)
      .post('/api/v1/identity/provision-all')
      .set('Authorization', `Bearer ${token}`)
      .send({ windyIdentityId: 'WI-DOES-NOT-EXIST' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Identity not found');
  });
});
