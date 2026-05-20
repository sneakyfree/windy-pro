/**
 * Tests for GET /api/v1/identity/owns-passport/:passport
 *
 * Ownership lookup backing the Mind runtime claim API (ADR-051 Phase A.2).
 * Per ADR-050, passport-bearing product_accounts rows have
 *   product='eternitas', external_id=<passport-id>
 *   identity_id=<bot>, operator_identity_id=<human operator or NULL>
 *
 * The endpoint returns owned=true when JWT identity matches either
 * the bot itself (self) or the bot's operator (operator).
 */
import jwt from 'jsonwebtoken';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { generateKeyPair } from '../jwks';

jest.mock('express-rate-limit', () => {
  return () => (_req: Request, _res: Response, next: NextFunction) => next();
});

// ═══════════════════════════════════════════
//  IN-MEMORY DATA STORE
// ═══════════════════════════════════════════

// Each row models a product_accounts row with the ADR-050 fields
// relevant to passport ownership.
type PassportRow = {
  passport: string;
  identity_id: string;
  operator_identity_id: string | null;
};

const passportRows: PassportRow[] = [];

const TEST_HUMAN_ID = 'human-operator-001';
const TEST_BOT_ID = 'bot-agent-001';
const OTHER_HUMAN_ID = 'unrelated-human-002';
const TEST_PASSPORT = 'ET26-TEST-AAAA';
const OTHER_PASSPORT = 'ET26-TEST-BBBB';

const testKeyPair = generateKeyPair();

// ═══════════════════════════════════════════
//  MOCK DATABASE
// ═══════════════════════════════════════════

function mockDbPrepare(sql: string) {
  return {
    get: (...args: any[]) => {
      // The owns-passport query: SELECT identity_id, operator_identity_id
      //   FROM product_accounts
      //   WHERE product = 'eternitas' AND external_id = ?
      //     AND (identity_id = ? OR operator_identity_id = ?)
      //   LIMIT 1
      // args: [passport, userId, userId]
      if (
        sql.includes('FROM product_accounts') &&
        sql.includes("product = 'eternitas'") &&
        sql.includes('identity_id') &&
        sql.includes('operator_identity_id')
      ) {
        const [passport, userId] = args;
        const row = passportRows.find(
          (r) =>
            r.passport === passport &&
            (r.identity_id === userId || r.operator_identity_id === userId),
        );
        return row
          ? {
              identity_id: row.identity_id,
              operator_identity_id: row.operator_identity_id,
            }
          : undefined;
      }
      // authenticateToken middleware paths
      if (sql.includes('FROM token_blacklist')) return null;
      if (sql.includes('FROM users WHERE id')) {
        return { id: args[0], email: 'test@test.com', tier: 'pro', role: 'user' };
      }
      return null;
    },
    run: () => ({ changes: 0 }),
    all: () => [],
  };
}

jest.mock('../db/schema', () => ({
  getDb: () => ({
    prepare: (sql: string) => mockDbPrepare(sql),
    exec: jest.fn(),
    pragma: jest.fn().mockReturnValue([]),
  }),
}));

jest.mock('../db/statements', () => ({
  getStatements: () => ({
    findUserById: { get: (id: string) => ({ id, email: 'test@test.com', tier: 'pro', role: 'user' }) },
  }),
}));

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-owns-passport',
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
    initializeJWKS: () => true,
    getVerificationKeys: () => [{ publicKey: testKeyPair.publicKey, kid: testKeyPair.kid }],
    getPublicKeyByKid: (kid: string) =>
      kid === testKeyPair.kid ? testKeyPair.publicKey : null,
  };
});

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  getProductAccounts: jest.fn(() => []),
  getScopes: jest.fn(() => []),
  hasScope: jest.fn(),
}));

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken: jest.fn().mockResolvedValue(undefined),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateToken(userId: string): string {
  return jwt.sign(
    {
      userId,
      email: 'test@test.com',
      tier: 'pro',
      accountId: userId,
      type: 'human',
      scopes: ['windy_pro:*'],
      products: ['windy_pro'],
      iss: 'windy-identity',
    },
    testKeyPair.privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '15m',
      keyid: testKeyPair.kid,
    },
  );
}

// ═══════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  const identityRoutes = require('../routes/identity').default;
  app.use('/api/v1/identity', identityRoutes);
});

beforeEach(() => {
  passportRows.length = 0;
  // Standard seed: TEST_BOT_ID owns TEST_PASSPORT, operated by TEST_HUMAN_ID.
  passportRows.push({
    passport: TEST_PASSPORT,
    identity_id: TEST_BOT_ID,
    operator_identity_id: TEST_HUMAN_ID,
  });
});

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('GET /api/v1/identity/owns-passport/:passport', () => {
  test('returns owned=true with relation=operator when JWT is the operator', async () => {
    const res = await request(app)
      .get(`/api/v1/identity/owns-passport/${TEST_PASSPORT}`)
      .set('Authorization', `Bearer ${generateToken(TEST_HUMAN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      owned: true,
      passport: TEST_PASSPORT,
      identity_id: TEST_HUMAN_ID,
      relation: 'operator',
    });
  });

  test('returns owned=true with relation=self when JWT is the bot itself', async () => {
    const res = await request(app)
      .get(`/api/v1/identity/owns-passport/${TEST_PASSPORT}`)
      .set('Authorization', `Bearer ${generateToken(TEST_BOT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      owned: true,
      passport: TEST_PASSPORT,
      identity_id: TEST_BOT_ID,
      relation: 'self',
    });
  });

  test('returns owned=false when JWT identity is unrelated to the passport', async () => {
    const res = await request(app)
      .get(`/api/v1/identity/owns-passport/${TEST_PASSPORT}`)
      .set('Authorization', `Bearer ${generateToken(OTHER_HUMAN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      owned: false,
      passport: TEST_PASSPORT,
      identity_id: OTHER_HUMAN_ID,
    });
    expect(res.body.relation).toBeUndefined();
  });

  test('returns owned=false when the passport does not exist in product_accounts', async () => {
    const res = await request(app)
      .get(`/api/v1/identity/owns-passport/${OTHER_PASSPORT}`)
      .set('Authorization', `Bearer ${generateToken(TEST_HUMAN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(false);
    expect(res.body.passport).toBe(OTHER_PASSPORT);
  });

  test('returns 401 without an Authorization header', async () => {
    const res = await request(app).get(
      `/api/v1/identity/owns-passport/${TEST_PASSPORT}`,
    );
    expect(res.status).toBe(401);
  });

  test('returns 400 for a malformed passport (no ET prefix)', async () => {
    const res = await request(app)
      .get('/api/v1/identity/owns-passport/NOT-A-PASSPORT')
      .set('Authorization', `Bearer ${generateToken(TEST_HUMAN_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/passport format/i);
  });

  test('returns 400 for an empty passport segment (path collision check)', async () => {
    const res = await request(app)
      .get('/api/v1/identity/owns-passport/ET')
      .set('Authorization', `Bearer ${generateToken(TEST_HUMAN_ID)}`);
    expect(res.status).toBe(400);
  });

  test('accepts mixed-case passport (case-insensitive validation)', async () => {
    passportRows.push({
      passport: 'et26-test-cccc',
      identity_id: TEST_BOT_ID,
      operator_identity_id: TEST_HUMAN_ID,
    });
    const res = await request(app)
      .get('/api/v1/identity/owns-passport/et26-test-cccc')
      .set('Authorization', `Bearer ${generateToken(TEST_HUMAN_ID)}`);
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(true);
  });

  test('only matches the exact passport, not a substring', async () => {
    // Add a second row whose passport is a substring of TEST_PASSPORT.
    passportRows.push({
      passport: 'ET26-TEST',
      identity_id: TEST_BOT_ID,
      operator_identity_id: TEST_HUMAN_ID,
    });
    // Query for the SUPERSTRING — the substring row should NOT match.
    const res = await request(app)
      .get(`/api/v1/identity/owns-passport/${TEST_PASSPORT}`)
      .set('Authorization', `Bearer ${generateToken(OTHER_HUMAN_ID)}`);
    expect(res.status).toBe(200);
    expect(res.body.owned).toBe(false);
  });
});
