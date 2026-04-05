/**
 * Hardening tests for cloud stub endpoints.
 *
 * Covers: phone provisioning, phone release, push send,
 * and authentication enforcement on all cloud routes.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// ═══════════════════════════════════════════
//  RATE-LIMIT MOCK (noop)
// ═══════════════════════════════════════════

jest.mock('express-rate-limit', () => {
  return () => (_req: Request, _res: Response, next: NextFunction) => next();
});

// ═══════════════════════════════════════════
//  IN-MEMORY DATA STORES
// ═══════════════════════════════════════════

const TEST_USER_ID = 'user-cloud-hardening-001';
const TEST_USER_EMAIL = 'cloud-test@windypro.com';

const users = new Map<string, any>();
const tokenBlacklist = new Set<string>();
const identityScopes = new Map<string, any[]>();
const productAccounts = new Map<string, any[]>();

function resetStores() {
  users.clear();
  tokenBlacklist.clear();
  identityScopes.clear();
  productAccounts.clear();

  // Pre-seed the test user
  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    name: 'Cloud Hardening User',
    tier: 'free',
    stripe_customer_id: null,
    storage_limit: 500 * 1024 * 1024,
    storage_used: 0,
    role: 'user',
  });

  identityScopes.set(TEST_USER_ID, [
    { scope: 'windy_pro:*', granted_by: 'registration' },
  ]);

  productAccounts.set(TEST_USER_ID, [
    { id: crypto.randomUUID(), identity_id: TEST_USER_ID, product: 'windy_pro', status: 'active' },
  ]);
}

// ═══════════════════════════════════════════
//  MOCK: ../db/schema
// ═══════════════════════════════════════════

jest.mock('../db/schema', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: () => ({ changes: 0 }),
      get: (...args: any[]) => {
        // Token blacklist
        if (sql.includes('FROM token_blacklist')) {
          return tokenBlacklist.has(args[0]) ? { token_hash: args[0] } : null;
        }
        // User lookups by id
        if (sql.includes('FROM users WHERE id')) {
          return users.get(args[0]) || null;
        }
        // User lookups by email
        if (sql.includes('FROM users WHERE email')) {
          for (const u of users.values()) {
            if (u.email === args[0]) return u;
          }
          return null;
        }
        return null;
      },
      all: (...args: any[]) => {
        // identity_scopes
        if (sql.includes('identity_scopes')) {
          return identityScopes.get(args[0]) || [];
        }
        // product_accounts
        if (sql.includes('product_accounts')) {
          return productAccounts.get(args[0]) || [];
        }
        return [];
      },
    }),
    exec: jest.fn(),
    pragma: jest.fn().mockReturnValue([]),
  }),
}));

// ═══════════════════════════════════════════
//  MOCK: ../config
// ═══════════════════════════════════════════

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-hardening-cloud',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/test',
    UPLOADS_PATH: '/tmp/test/uploads',
    PORT: 0,
    BCRYPT_ROUNDS: 4,
    MAX_DEVICES: 5,
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
  },
}));

// ═══════════════════════════════════════════
//  MOCK: ../jwks
// ═══════════════════════════════════════════

jest.mock('../jwks', () => ({
  isRS256Available: () => false,
  getSigningKey: () => null,
  getVerificationKeys: () => [],
  getPublicKeyByKid: () => null,
  initializeJWKS: () => false,
  generateKeyPair: jest.requireActual('../jwks').generateKeyPair,
}));

// ═══════════════════════════════════════════
//  MOCK: ../identity-service
// ═══════════════════════════════════════════

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  validateBotApiKey: jest.fn().mockReturnValue(null),
  getScopes: jest.fn().mockReturnValue(['windy_pro:*']),
  getProductAccounts: jest.fn().mockReturnValue([]),
}));

// ═══════════════════════════════════════════
//  MOCK: ../redis
// ═══════════════════════════════════════════

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
      userId,
      email: TEST_USER_EMAIL,
      tier: 'free',
      accountId: userId,
      role: 'user',
      type: 'human',
      scopes: ['windy_pro:*'],
      products: ['windy_pro'],
    },
    'test-secret-hardening-cloud',
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

// ═══════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════

describe('Cloud stub endpoint hardening', () => {
  let app: Express;
  let token: string;

  beforeAll(() => {
    resetStores();
    token = generateTestAccessToken();
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    const cloudRoutes = require('../routes/cloud').default;
    app.use('/api/v1/cloud', cloudRoutes);
  });

  // ─────────────────────────────────────────
  //  1. POST /api/v1/cloud/phone/provision
  // ─────────────────────────────────────────

  it('POST /api/v1/cloud/phone/provision → 501 Not Implemented', async () => {
    const res = await request(app)
      .post('/api/v1/cloud/phone/provision')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(501);
    expect(res.body.error).toBe('Not implemented');
  });

  // ─────────────────────────────────────────
  //  2. POST /api/v1/cloud/phone/release
  // ─────────────────────────────────────────

  it('POST /api/v1/cloud/phone/release → 501 Not Implemented', async () => {
    const res = await request(app)
      .post('/api/v1/cloud/phone/release')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(501);
    expect(res.body.error).toBe('Not implemented');
  });

  // ─────────────────────────────────────────
  //  3. POST /api/v1/cloud/push/send
  // ─────────────────────────────────────────

  it('POST /api/v1/cloud/push/send → 501 Not Implemented', async () => {
    const res = await request(app)
      .post('/api/v1/cloud/push/send')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(501);
    expect(res.body.error).toBe('Not implemented');
  });

  // ─────────────────────────────────────────
  //  4. All endpoints require authentication
  // ─────────────────────────────────────────

  describe('All should require authentication (no JWT → 401)', () => {
    const endpoints = [
      '/api/v1/cloud/phone/provision',
      '/api/v1/cloud/phone/release',
      '/api/v1/cloud/push/send',
    ];

    for (const endpoint of endpoints) {
      it(`POST ${endpoint} without Authorization → 401`, async () => {
        const res = await request(app)
          .post(endpoint)
          .send({});

        expect(res.status).toBe(401);
      });
    }
  });
});
