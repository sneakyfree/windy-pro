/**
 * Hardening tests for the Windy Identity Hub.
 *
 * Tests cover:
 *   1. Registration input validation (email, password, duplicates, unicode)
 *   2. Login edge cases (wrong password, non-existent user, empty fields, device limits)
 *   3. Token validation (expired, wrong key, alg:none, deleted user, concurrency)
 *   4. Chat-validate endpoint (shared secret, wrong password, missing user)
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
const refreshTokens = new Map<string, any>();
const identityScopes = new Map<string, string[]>();
const productAccounts = new Map<string, any[]>();
const devices = new Map<string, any[]>();
const tokenBlacklist = new Set<string>();

// Pre-seed test user for login / token tests
const TEST_USER_ID = 'hardening-user-001';
const TEST_USER_EMAIL = 'test@hardening.com';
const TEST_USER_PASSWORD = 'Str0ngP@ss!';
let TEST_USER_HASH: string;

// Generate an RS256 key pair for testing
const testKeyPair = generateKeyPair();

// A separate key pair for "wrong key" tests
const wrongKeyPair = generateKeyPair();

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
      run: (id: string, email: string, name: string, passwordHash: string, tier: string) => {
        users.set(id, {
          id,
          email,
          name,
          password_hash: passwordHash,
          tier,
          identity_type: 'human',
          windy_identity_id: null,
          display_name: name,
          avatar_url: null,
          phone: null,
          email_verified: 0,
          phone_verified: 0,
          preferred_lang: 'en',
          role: 'user',
          last_login_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { changes: 1 };
      },
    },
    countDevices: {
      get: (userId: string) => {
        const userDevices = devices.get(userId) || [];
        return { count: userDevices.length };
      },
    },
    addDevice: {
      run: (deviceId: string, userId: string, deviceName: string, platform: string) => {
        const userDevices = devices.get(userId) || [];
        // Replace if exists
        const idx = userDevices.findIndex(d => d.id === deviceId);
        const device = {
          id: deviceId,
          user_id: userId,
          name: deviceName,
          platform,
          registered_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        };
        if (idx >= 0) {
          userDevices[idx] = device;
        } else {
          userDevices.push(device);
        }
        devices.set(userId, userDevices);
        return { changes: 1 };
      },
    },
    findDevice: {
      get: (deviceId: string, userId: string) => {
        const userDevices = devices.get(userId) || [];
        return userDevices.find(d => d.id === deviceId) || null;
      },
    },
    touchDevice: {
      run: (deviceId: string, userId: string) => {
        const userDevices = devices.get(userId) || [];
        const device = userDevices.find(d => d.id === deviceId);
        if (device) device.last_seen = new Date().toISOString();
        return { changes: device ? 1 : 0 };
      },
    },
    updateUserSeen: {
      run: () => ({ changes: 1 }),
    },
    deleteUserRefreshTokens: {
      run: (userId: string, _deviceId: string) => {
        for (const [key, val] of refreshTokens.entries()) {
          if (val.user_id === userId) refreshTokens.delete(key);
        }
        return { changes: 1 };
      },
    },
    saveRefreshToken: {
      run: (token: string, userId: string, deviceId: string, expiresAt: string) => {
        refreshTokens.set(token, { token, user_id: userId, device_id: deviceId, expires_at: expiresAt });
        return { changes: 1 };
      },
    },
    getDevices: {
      all: (userId: string) => devices.get(userId) || [],
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
      // UPDATE product_accounts SET status
      if (sql.includes('UPDATE product_accounts SET status')) {
        return { changes: 0 };
      }
      // UPDATE users SET last_login_at
      if (sql.includes('UPDATE users SET last_login_at')) {
        return { changes: 0 };
      }
      // UPDATE users SET (general — for PATCH /me)
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
      // SELECT ... FROM users WHERE id
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
        return scopes.map(s => ({ scope: s }));
      }
      // FROM product_accounts
      if (sql.includes('FROM product_accounts')) {
        const accounts = productAccounts.get(args[0]) || [];
        return accounts;
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
    JWT_SECRET: 'test-secret-hardening-identity',
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
    getPublicKeyByKid: (kid: string) => kid === testKeyPair.kid ? testKeyPair.publicKey : null,
  };
});

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  provisionProduct: jest.fn(),
  grantScopes: jest.fn(),
  revokeScope: jest.fn(),
  hasScope: jest.fn(),
  getAuditLog: jest.fn().mockReturnValue([]),
  getScopes: jest.fn((id: string) => {
    const scopes = identityScopes.get(id) || [];
    return scopes.map(s => ({ scope: s }));
  }),
  getProductAccounts: jest.fn((id: string) => {
    return (productAccounts.get(id) || []).map((p: any) => ({
      product: p.product,
      status: p.status,
      external_id: p.external_id || null,
    }));
  }),
  normalizeProductTier: jest.fn((tier: string) => tier),
  upsertChatProfile: jest.fn(),
  getChatProfile: jest.fn().mockReturnValue(null),
  processEternitasEvent: jest.fn(),
  hasSecretaryConsent: jest.fn().mockReturnValue(false),
  grantSecretaryConsent: jest.fn(),
  revokeSecretaryConsent: jest.fn(),
  createBotApiKey: jest.fn(),
  validateBotApiKey: jest.fn(),
  revokeBotApiKey: jest.fn(),
  updateProductStatus: jest.fn(),
  backfillExistingUsers: jest.fn(),
  executeRevocationCascade: jest.fn(),
  hasAllScopes: jest.fn(),
}));

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken: jest.fn().mockResolvedValue(undefined),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateTestAccessToken(overrides: Record<string, any> = {}, opts?: { expired?: boolean }): string {
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

// ═══════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════

let app: Express;

beforeAll(async () => {
  // Pre-hash the test user password
  TEST_USER_HASH = await bcrypt.hash(TEST_USER_PASSWORD, 4);

  // Seed the test user
  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    name: 'Hardening Test',
    password_hash: TEST_USER_HASH,
    tier: 'pro',
    identity_type: 'human',
    windy_identity_id: 'WI-HARD-001',
    display_name: 'Hardening Test',
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
  // Clean up any users created during registration tests (keep the seeded test user)
  for (const [key] of users.entries()) {
    if (key !== TEST_USER_ID) {
      users.delete(key);
      devices.delete(key);
      identityScopes.delete(key);
      productAccounts.delete(key);
    }
  }
  refreshTokens.clear();
  tokenBlacklist.clear();
  // Reset device list for test user between tests
  devices.delete(TEST_USER_ID);
});

// ═══════════════════════════════════════════
//  1. REGISTRATION HARDENING
// ═══════════════════════════════════════════

describe('Registration hardening', () => {
  test('rejects empty email with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: '', password: 'ValidP@ss1', name: 'Test' });

    expect(res.status).toBe(400);
  });

  test('rejects malformed email "notanemail" with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'notanemail', password: 'ValidP@ss1', name: 'Test' });

    expect(res.status).toBe(400);
  });

  test('rejects 1-character password with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'short@test.com', password: 'x', name: 'Test' });

    expect(res.status).toBe(400);
  });

  test('rejects password missing uppercase with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'noup@test.com', password: 'alllowercase1', name: 'Test' });

    expect(res.status).toBe(400);
  });

  test('rejects password missing lowercase with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'nolower@test.com', password: 'ALLUPPERCASE1', name: 'Test' });

    expect(res.status).toBe(400);
  });

  test('rejects password missing digit with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'nodigit@test.com', password: 'NoDigitsHere', name: 'Test' });

    expect(res.status).toBe(400);
  });

  test('accepts 200-character password meeting all requirements with 201', async () => {
    const longPass = 'Aa1' + 'x'.repeat(197);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'longpass@test.com', password: longPass, name: 'Long Pass' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.email).toBe('longpass@test.com');
  });

  test('rejects duplicate email with 409 and no stack trace', async () => {
    // First registration
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dupe@test.com', password: 'ValidP@ss1', name: 'First' });

    expect(res1.status).toBe(201);

    // Duplicate registration
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dupe@test.com', password: 'ValidP@ss1', name: 'Second' });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toBeDefined();
    // Must not leak stack traces
    expect(res2.body.stack).toBeUndefined();
    expect(JSON.stringify(res2.body)).not.toMatch(/at\s+\w+\s+\(/);
  });

  test('rejects unicode email (cafe@test.com with accented e) with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'caf\u00e9@test.com', password: 'ValidP@ss1', name: 'Unicode' });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════
//  2. LOGIN HARDENING
// ═══════════════════════════════════════════

describe('Login hardening', () => {
  test('wrong password returns 401 with "Invalid email or password"', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: 'WrongP@ss1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test('non-existent email returns 401 with same message as wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'noone@hardening.com', password: 'SomeP@ss1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test('error messages for wrong password and non-existent user are identical', async () => {
    const wrongPw = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: 'WrongP@ss1' });

    const noUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@hardening.com', password: 'SomeP@ss1' });

    expect(wrongPw.status).toBe(noUser.status);
    expect(wrongPw.body.error).toBe(noUser.body.error);
  });

  test('empty password returns 400 (Zod validation)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: '' });

    expect(res.status).toBe(400);
  });

  test('login from 6th device when 5 already registered — succeeds, device count stays at 5', async () => {
    // Pre-seed 5 devices for the test user
    const existingDevices: any[] = [];
    for (let i = 0; i < 5; i++) {
      existingDevices.push({
        id: `device-${i}`,
        user_id: TEST_USER_ID,
        name: `Device ${i}`,
        platform: 'test',
        registered_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });
    }
    devices.set(TEST_USER_ID, existingDevices);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        deviceId: 'device-new-6th',
        deviceName: 'Sixth Device',
        platform: 'test',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');

    // The 6th device should NOT have been added
    const userDevices = devices.get(TEST_USER_ID) || [];
    expect(userDevices.length).toBe(5);
    expect(userDevices.find((d: any) => d.id === 'device-new-6th')).toBeUndefined();
  });

  test('login with existing device touches it instead of adding a new one', async () => {
    const existingDevice = {
      id: 'existing-device',
      user_id: TEST_USER_ID,
      name: 'My Phone',
      platform: 'ios',
      registered_at: new Date().toISOString(),
      last_seen: '2024-01-01T00:00:00Z',
    };
    devices.set(TEST_USER_ID, [existingDevice]);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        deviceId: 'existing-device',
        deviceName: 'My Phone',
        platform: 'ios',
      });

    expect(res.status).toBe(200);

    const userDevices = devices.get(TEST_USER_ID) || [];
    expect(userDevices.length).toBe(1);
    // last_seen should have been updated (not the old 2024-01-01 value)
    expect(userDevices[0].last_seen).not.toBe('2024-01-01T00:00:00Z');
  });
});

// ═══════════════════════════════════════════
//  3. TOKEN VALIDATION HARDENING
// ═══════════════════════════════════════════

describe('Token validation hardening (GET /api/v1/identity/validate-token)', () => {
  test('expired JWT returns 401', async () => {
    const expiredToken = generateTestAccessToken({}, { expired: true });

    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  test('JWT signed by wrong key returns 401', async () => {
    const payload = {
      userId: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      tier: 'pro',
      accountId: TEST_USER_ID,
      type: 'human',
      scopes: ['windy_pro:*'],
      products: ['windy_pro'],
      iss: 'windy-identity',
    };

    const wrongKeyToken = jwt.sign(payload, wrongKeyPair.privateKey, {
      algorithm: 'RS256',
      expiresIn: '15m',
      keyid: wrongKeyPair.kid,
    });

    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', `Bearer ${wrongKeyToken}`);

    // Wrong kid means RS256 verification fails, falls back to HS256 which also fails
    expect([401, 403]).toContain(res.status);
  });

  test('JWT with alg:none is rejected', async () => {
    // Manually craft an unsigned token with alg: none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      userId: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      tier: 'pro',
      accountId: TEST_USER_ID,
      type: 'human',
      scopes: ['windy_pro:*'],
      products: ['windy_pro'],
      iss: 'windy-identity',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    })).toString('base64url');

    const noneToken = `${header}.${payload}.`;

    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', `Bearer ${noneToken}`);

    // Auth middleware returns 403 "Invalid token" for alg:none (not 401)
    expect([401, 403]).toContain(res.status);
  });

  test('valid JWT but user deleted from DB returns 404 "Identity not found"', async () => {
    // Create a token for a non-existent user
    const deletedUserId = 'deleted-user-999';
    const token = generateTestAccessToken({
      userId: deletedUserId,
      accountId: deletedUserId,
    });

    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Identity not found');
  });

  test('concurrent validate-token calls all succeed', async () => {
    const token = generateTestAccessToken();

    const promises = Array.from({ length: 10 }, () =>
      request(app)
        .get('/api/v1/identity/validate-token')
        .set('Authorization', `Bearer ${token}`),
    );

    const results = await Promise.all(promises);

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.email).toBe(TEST_USER_EMAIL);
    }
  });

  test('validate-token returns expected fields for valid token', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', true);
    expect(res.body).toHaveProperty('windy_identity_id');
    expect(res.body).toHaveProperty('email', TEST_USER_EMAIL);
    expect(res.body).toHaveProperty('tier');
    expect(res.body).toHaveProperty('type', 'human');
    expect(res.body).toHaveProperty('scopes');
    expect(res.body).toHaveProperty('products');
  });

  test('missing Authorization header returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/identity/validate-token');

    expect(res.status).toBe(401);
  });

  test('malformed Authorization header returns 401', async () => {
    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', 'NotBearer some-token');

    // "NotBearer" → token is undefined → 401 "Authentication required"
    // OR middleware splits on space, gets "some-token" which fails verify → 403
    expect([401, 403]).toContain(res.status);
  });

  test('completely garbage token returns 401 or 403', async () => {
    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', 'Bearer not.a.valid.jwt.at.all');

    // Invalid JWT structure → 403 "Invalid token"
    expect([401, 403]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════
//  4. CHAT-VALIDATE HARDENING
// ═══════════════════════════════════════════

describe('Chat-validate hardening (POST /api/v1/auth/chat-validate)', () => {
  const SHARED_SECRET = 'test-synapse-secret-hardening';

  beforeAll(() => {
    process.env.SYNAPSE_REGISTRATION_SECRET = SHARED_SECRET;
  });

  afterAll(() => {
    delete process.env.SYNAPSE_REGISTRATION_SECRET;
  });

  test('without SYNAPSE_REGISTRATION_SECRET set returns 403', async () => {
    const savedSecret = process.env.SYNAPSE_REGISTRATION_SECRET;
    delete process.env.SYNAPSE_REGISTRATION_SECRET;

    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        username: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        shared_secret: SHARED_SECRET,
      });

    expect(res.status).toBe(403);
    expect(res.body.valid).toBe(false);

    // Restore
    process.env.SYNAPSE_REGISTRATION_SECRET = savedSecret;
  });

  test('wrong shared secret returns 403', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        username: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        shared_secret: 'wrong-secret',
      });

    expect(res.status).toBe(403);
    expect(res.body.valid).toBe(false);
    expect(res.body.error).toBe('Invalid shared secret');
  });

  test('valid secret but wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        username: TEST_USER_EMAIL,
        password: 'TotallyWr0ng!',
        shared_secret: SHARED_SECRET,
      });

    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  test('user that does not exist returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        username: 'doesnotexist@hardening.com',
        password: 'SomeP@ss1',
        shared_secret: SHARED_SECRET,
      });

    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  test('valid credentials return user identity', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        username: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        shared_secret: SHARED_SECRET,
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.user_id).toBe(TEST_USER_ID);
    expect(res.body.windy_user_id).toBe('WI-HARD-001');
    expect(res.body.display_name).toBe('Hardening Test');
  });

  test('missing username or password returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        shared_secret: SHARED_SECRET,
      });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
  });

  test('empty shared_secret field returns 403', async () => {
    const res = await request(app)
      .post('/api/v1/auth/chat-validate')
      .send({
        username: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        shared_secret: '',
      });

    expect(res.status).toBe(403);
    expect(res.body.valid).toBe(false);
  });
});
