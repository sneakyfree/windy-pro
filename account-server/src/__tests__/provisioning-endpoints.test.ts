/**
 * Tests for ecosystem provisioning endpoints:
 *   1. POST /api/v1/identity/mail/provision
 *   2. POST /api/v1/identity/agent/provision
 *   3. POST /api/v1/identity/ecosystem/provision-all
 *   4. GET  /api/v1/identity/ecosystem-status (enhanced with health checks)
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
const eternitasPassports = new Map<string, any>();
const chatProfiles = new Map<string, any>();

// Pre-seed constants
const TEST_USER_ID = 'provision-endpoints-001';
const TEST_USER_EMAIL = 'provtest@test.com';
const TEST_WINDY_IDENTITY_ID = 'WI-PROVTEST-001';

// Key pairs for JWT signing
const testKeyPair = generateKeyPair();

// ═══════════════════════════════════════════
//  MOCK DATABASE
// ═══════════════════════════════════════════

function mockDbPrepare(sql: string) {
  return {
    run: (...args: any[]) => {
      if (sql.includes('INSERT INTO users')) {
        const [id, email, name, displayName, , , windyId] = args;
        users.set(id, {
          id, email, name, display_name: displayName, tier: 'free',
          identity_type: 'bot', windy_identity_id: windyId,
          role: 'user', created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { changes: 1 };
      }
      if (sql.includes('UPDATE product_accounts SET status')) {
        const identityId = args[args.length - 1];
        let externalId = args.length > 1 ? args[0] : null;
        const accounts = productAccounts.get(identityId) || [];
        let product: string | null = null;
        if (sql.includes("'windy_chat'")) product = 'windy_chat';
        if (sql.includes("'windy_mail'")) product = 'windy_mail';
        if (sql.includes("'windy_cloud'")) product = 'windy_cloud';
        if (sql.includes("'eternitas'")) product = 'eternitas';
        if (product) {
          const acct = accounts.find((a: any) => a.product === product);
          if (acct) {
            acct.status = 'active';
            if (externalId !== identityId) acct.external_id = externalId;
          }
        }
        return { changes: 1 };
      }
      if (sql.includes('UPDATE users SET storage_limit')) {
        return { changes: 1 };
      }
      if (sql.includes('INSERT OR REPLACE INTO eternitas_passports')) {
        const [identityId, passportNumber, , operatorId] = args;
        eternitasPassports.set(identityId, {
          identity_id: identityId, passport_number: passportNumber,
          status: 'active', operator_identity_id: operatorId,
        });
        return { changes: 1 };
      }
      if (sql.includes('UPDATE users SET')) return { changes: 1 };
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      if (sql.includes('FROM token_blacklist')) {
        return tokenBlacklist.has(args[0]) ? { '1': 1 } : null;
      }
      if (sql.includes('FROM users WHERE windy_identity_id')) {
        for (const u of users.values()) {
          if (u.windy_identity_id === args[0]) return u;
        }
        return null;
      }
      if (sql.includes('FROM users WHERE id')) {
        return users.get(args[0]) || null;
      }
      if (sql.includes('SELECT role FROM users')) {
        const u = users.get(args[0]);
        return u ? { role: u.role } : null;
      }
      if (sql.includes('SELECT identity_type, windy_identity_id FROM users')) {
        const u = users.get(args[0]);
        return u ? { identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      if (sql.includes('SELECT email, tier, identity_type, windy_identity_id')) {
        const u = users.get(args[0]);
        return u ? { email: u.email, tier: u.tier, identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      if (sql.includes('FROM product_accounts WHERE identity_id') && sql.includes('windy_mail') && sql.includes('active')) {
        const accounts = productAccounts.get(args[0]) || [];
        const mail = accounts.find((a: any) => a.product === 'windy_mail' && a.status === 'active');
        return mail || null;
      }
      if (sql.includes('FROM chat_profiles')) return chatProfiles.get(args[0]) || null;
      if (sql.includes('FROM eternitas_passports')) return eternitasPassports.get(args[0]) || null;
      return null;
    },
    all: (...args: any[]) => {
      if (sql.includes('FROM identity_scopes')) {
        const scopes = identityScopes.get(args[0]) || [];
        return scopes.map((s: string) => ({ scope: s }));
      }
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
//  MOCK STATEMENTS
// ═══════════════════════════════════════════

jest.mock('../db/statements', () => ({
  getStatements: () => ({
    findUserByEmail: { get: (email: string) => { for (const u of users.values()) { if (u.email === email) return u; } return null; } },
    createUser: { run: () => ({ changes: 1 }) },
    countDevices: { get: () => ({ count: 0 }) },
    addDevice: { run: () => ({ changes: 1 }) },
    findDevice: { get: () => null },
    touchDevice: { run: () => ({ changes: 0 }) },
    updateUserSeen: { run: () => ({ changes: 1 }) },
    deleteUserRefreshTokens: { run: () => ({ changes: 0 }) },
    saveRefreshToken: { run: () => ({ changes: 1 }) },
    getDevices: { all: () => [] },
    findUserById: { get: (id: string) => users.get(id) || null },
  }),
}));

// ═══════════════════════════════════════════
//  MOCK CONFIG
// ═══════════════════════════════════════════

const mockConfig = {
  JWT_SECRET: 'test-secret-prov-endpoints',
  JWT_EXPIRY: '15m',
  DB_PATH: ':memory:',
  DATA_ROOT: '/tmp/test',
  UPLOADS_PATH: '/tmp/test/uploads',
  PORT: 0,
  BCRYPT_ROUNDS: 4,
  MAX_DEVICES: 5,
  WINDY_CHAT_WEBHOOK_URL: '',
  WINDY_MAIL_WEBHOOK_URL: '',
  WINDY_CHAT_URL: 'http://localhost:8101',
  WINDY_MAIL_URL: 'http://localhost:8200',
  WINDY_CLOUD_URL: 'http://localhost:8098',
  ETERNITAS_URL: 'http://localhost:8200',
};

jest.mock('../config', () => ({
  config: mockConfig,
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
  provisionProduct: jest.fn((userId: string, product: string) => {
    const accounts = productAccounts.get(userId) || [];
    const existing = accounts.find((a: any) => a.product === product);
    if (!existing) {
      accounts.push({ product, status: 'pending', external_id: null });
      productAccounts.set(userId, accounts);
    }
    return { id: 'pa-' + product, created: !existing };
  }),
  grantScopes: jest.fn(),
  revokeScope: jest.fn(),
  hasScope: jest.fn(),
  getAuditLog: jest.fn().mockReturnValue([]),
  getScopes: jest.fn((id: string) => identityScopes.get(id) || []),
  getProductAccounts: jest.fn((id: string) => (productAccounts.get(id) || []).map((p: any) => ({
    product: p.product, status: p.status, external_id: p.external_id || null,
  }))),
  updateProductStatus: jest.fn(),
  upsertChatProfile: jest.fn(),
  getChatProfile: jest.fn((id: string) => chatProfiles.get(id) || null),
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

function generateToken(overrides: Record<string, any> = {}): string {
  return jwt.sign({
    userId: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    tier: 'pro',
    accountId: TEST_USER_ID,
    type: 'human',
    scopes: ['windy_pro:*'],
    products: ['windy_pro'],
    iss: 'windy-identity',
    ...overrides,
  }, testKeyPair.privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    keyid: testKeyPair.kid,
  });
}

// ═══════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════

let app: Express;

beforeAll(async () => {
  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    name: 'Prov Test User',
    password_hash: await bcrypt.hash('Test123!', 4),
    tier: 'pro',
    identity_type: 'human',
    windy_identity_id: TEST_WINDY_IDENTITY_ID,
    display_name: 'Prov Test',
    avatar_url: null,
    phone: null,
    email_verified: 1,
    phone_verified: 0,
    preferred_lang: 'en',
    role: 'user',
    storage_used: 1024 * 1024 * 50,
    storage_limit: 500 * 1024 * 1024,
    last_login_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  identityScopes.set(TEST_USER_ID, ['windy_pro:*']);
  productAccounts.set(TEST_USER_ID, [
    { product: 'windy_pro', status: 'active', external_id: null },
  ]);

  app = express();
  app.use(express.json());
  const authRoutes = require('../routes/auth').default;
  const identityRoutes = require('../routes/identity').default;
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/identity', identityRoutes);
});

afterEach(() => {
  productAccounts.set(TEST_USER_ID, [
    { product: 'windy_pro', status: 'active', external_id: null },
  ]);
  eternitasPassports.clear();
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════
//  POST /api/v1/identity/mail/provision
// ═══════════════════════════════════════════

describe('POST /api/v1/identity/mail/provision', () => {
  test('provisions mail when service responds OK', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mail_address: 'provtest@windymail.ai' }),
    } as globalThis.Response);

    const res = await request(app)
      .post('/api/v1/identity/mail/provision')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ email_prefix: 'provtest' });

    expect(res.status).toBe(201);
    expect(res.body.mail_provisioned).toBe(true);
    expect(res.body.mail_address).toBe('provtest@windymail.ai');
  });

  test('returns 502 when mail service is down', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app)
      .post('/api/v1/identity/mail/provision')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.mail_provisioned).toBe(false);
    expect(res.body.error).toBe('service unavailable');
  });

  test('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/identity/mail/provision')
      .send({});

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
//  POST /api/v1/identity/agent/provision
// ═══════════════════════════════════════════

describe('POST /api/v1/identity/agent/provision', () => {
  test('provisions agent when Eternitas responds OK', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ passport_number: 'ET-BOT-001' }),
    } as globalThis.Response);

    const res = await request(app)
      .post('/api/v1/identity/agent/provision')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ agent_name: 'TestBot', owner_email: 'owner@test.com' });

    expect(res.status).toBe(201);
    expect(res.body.eternitas_provisioned).toBe(true);
    expect(res.body.passport_number).toBe('ET-BOT-001');
  });

  test('returns 400 without agent_name', async () => {
    const res = await request(app)
      .post('/api/v1/identity/agent/provision')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('agent_name is required');
  });

  test('returns 502 when Eternitas is down', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .post('/api/v1/identity/agent/provision')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({ agent_name: 'TestBot' });

    expect(res.status).toBe(502);
    expect(res.body.eternitas_provisioned).toBe(false);
    expect(res.body.error).toBe('service unavailable');
  });

  test('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/identity/agent/provision')
      .send({ agent_name: 'TestBot' });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
//  POST /api/v1/identity/ecosystem/provision-all
// ═══════════════════════════════════════════

describe('POST /api/v1/identity/ecosystem/provision-all', () => {
  test('provisions chat + mail + cloud in parallel', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('8101')) {
        return { ok: true, json: async () => ({ matrix_user_id: '@provtest:chat.windypro.com' }) } as globalThis.Response;
      }
      if (url.includes('8200')) {
        return { ok: true, json: async () => ({ mail_address: 'provtest@windymail.ai' }) } as globalThis.Response;
      }
      throw new Error(`Unexpected: ${url}`);
    });

    const res = await request(app)
      .post('/api/v1/identity/ecosystem/provision-all')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.provisioned.windy_chat.provisioned).toBe(true);
    expect(res.body.provisioned.windy_chat.matrix_user_id).toBe('@provtest:chat.windypro.com');
    expect(res.body.provisioned.windy_mail.provisioned).toBe(true);
    expect(res.body.provisioned.windy_mail.mail_address).toBe('provtest@windymail.ai');
    expect(res.body.provisioned.windy_cloud.provisioned).toBe(true);

    fetchMock.mockRestore();
  });

  test('partial failure — chat down, mail + cloud succeed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('8101')) throw new Error('ECONNREFUSED');
      if (url.includes('8200')) {
        return { ok: true, json: async () => ({ mail_address: 'provtest@windymail.ai' }) } as globalThis.Response;
      }
      throw new Error(`Unexpected: ${url}`);
    });

    const res = await request(app)
      .post('/api/v1/identity/ecosystem/provision-all')
      .set('Authorization', `Bearer ${generateToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.provisioned.windy_chat.provisioned).toBe(false);
    expect(res.body.provisioned.windy_chat.error).toBe('service unavailable');
    expect(res.body.provisioned.windy_mail.provisioned).toBe(true);
    expect(res.body.provisioned.windy_cloud.provisioned).toBe(true);

    fetchMock.mockRestore();
  });

  test('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/identity/ecosystem/provision-all')
      .send({});

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
//  GET /api/v1/identity/ecosystem-status
// ═══════════════════════════════════════════

describe('GET /api/v1/identity/ecosystem-status', () => {
  test('returns status with health checks for each service', async () => {
    // Mock health check fetches — all services healthy
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    } as globalThis.Response);

    const res = await request(app)
      .get('/api/v1/identity/ecosystem-status')
      .set('Authorization', `Bearer ${generateToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.windy_identity_id).toBe(TEST_WINDY_IDENTITY_ID);
    expect(res.body.tier).toBe('pro');

    // Check structure includes health + provisioned fields
    expect(res.body.products.windy_chat).toHaveProperty('health');
    expect(res.body.products.windy_chat).toHaveProperty('provisioned');
    expect(res.body.products.windy_mail).toHaveProperty('health');
    expect(res.body.products.windy_mail).toHaveProperty('provisioned');
    expect(res.body.products.windy_cloud).toHaveProperty('health', 'ok');
    expect(res.body.products.windy_cloud).toHaveProperty('provisioned', true);
    expect(res.body.products.windy_cloud).toHaveProperty('usage');
    expect(res.body.products.eternitas).toHaveProperty('health');
    expect(res.body.products.eternitas).toHaveProperty('provisioned');

    fetchMock.mockRestore();
  });

  test('marks services as down when health checks fail', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app)
      .get('/api/v1/identity/ecosystem-status')
      .set('Authorization', `Bearer ${generateToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.products.windy_chat.health).toBe('down');
    expect(res.body.products.windy_mail.health).toBe('down');
    expect(res.body.products.eternitas.health).toBe('down');
    // Cloud is always ok (local)
    expect(res.body.products.windy_cloud.health).toBe('ok');

    fetchMock.mockRestore();
  });

  test('returns 401 without auth', async () => {
    const res = await request(app)
      .get('/api/v1/identity/ecosystem-status');

    expect(res.status).toBe(401);
  });
});
