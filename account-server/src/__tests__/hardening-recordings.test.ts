/**
 * Recording & Clone route hardening tests.
 *
 * Exercises edge cases for:
 *   1. Empty recording list
 *   2. Invalid 'since' query param format
 *   3. Chunk upload exceeding MAX_CHUNK_DATA_BYTES (10 MB) → 413
 *   4. Chunk upload with missing required fields → 400
 *   5. Empty clone training-data response
 *   6. Start training with empty/too-few bundle_ids → 400 (Zod min 3)
 *   7. Start training with another user's bundles → 400
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
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
const recordings = new Map<string, any>();
const tokenBlacklist = new Set<string>();
const identityScopes = new Map<string, any>();
const productAccounts = new Map<string, any>();

const TEST_USER_ID = 'user-rec-001';
const OTHER_USER_ID = 'user-rec-002';

function resetStores() {
  users.clear();
  recordings.clear();
  tokenBlacklist.clear();
  identityScopes.clear();
  productAccounts.clear();

  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: 'test@windypro.com',
    tier: 'pro',
    role: 'user',
    identity_type: 'human',
    windy_identity_id: 'WI-REC-001',
    storage_used: 0,
    storage_limit: 500 * 1024 * 1024,
  });

  users.set(OTHER_USER_ID, {
    id: OTHER_USER_ID,
    email: 'other@windypro.com',
    tier: 'pro',
    role: 'user',
    identity_type: 'human',
    windy_identity_id: 'WI-REC-002',
    storage_used: 0,
    storage_limit: 500 * 1024 * 1024,
  });
}

// Generate RS256 key pair BEFORE jest.mock calls (hoisted but value captured)
const testKeyPair = generateKeyPair();

// ═══════════════════════════════════════════
//  MOCK DATABASE
// ═══════════════════════════════════════════

function mockDbPrepare(sql: string) {
  return {
    run: (..._args: any[]) => {
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      // token_blacklist check
      if (sql.includes('FROM token_blacklist')) {
        return tokenBlacklist.has(args[0]) ? { '1': 1 } : null;
      }
      // SELECT identity_type, windy_identity_id FROM users
      if (sql.includes('identity_type') && sql.includes('windy_identity_id')) {
        const u = users.get(args[0]);
        return u ? { identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      // SELECT role FROM users WHERE id = ?
      if (sql.includes('SELECT role FROM users')) {
        const u = users.get(args[0]);
        return u ? { role: u.role } : null;
      }
      // FROM users WHERE id — general user lookup for auth middleware
      if (sql.includes('FROM users WHERE id')) {
        return users.get(args[0]) || null;
      }
      // SELECT COUNT(*) ... FROM recordings WHERE bundle_id IN (...) AND user_id = ? AND clone_training_ready = 1
      if (sql.includes('COUNT(*)') && sql.includes('bundle_id IN')) {
        // Last arg is user_id, preceding args are bundle_ids
        const userId = args[args.length - 1];
        const bundleIds = args.slice(0, args.length - 1);
        let count = 0;
        recordings.forEach(r => {
          if (r.user_id === userId && r.clone_training_ready === 1 && bundleIds.includes(r.bundle_id)) {
            count++;
          }
        });
        return { count };
      }
      // FROM identity_scopes
      if (sql.includes('FROM identity_scopes')) {
        return identityScopes.get(args[0]) || null;
      }
      // FROM product_accounts
      if (sql.includes('FROM product_accounts')) {
        return productAccounts.get(args[0]) || null;
      }
      return null;
    },
    all: (...args: any[]) => {
      // SELECT ... FROM recordings WHERE user_id = ? AND created_at > ?
      if (sql.includes('FROM recordings') && sql.includes('created_at >')) {
        const userId = args[0];
        const since = args[1] || '1970-01-01T00:00:00Z';
        const result: any[] = [];
        recordings.forEach(r => {
          if (r.user_id === userId && r.created_at > since) {
            result.push(r);
          }
        });
        result.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return result;
      }
      // SELECT ... FROM recordings WHERE user_id = ? AND clone_training_ready = 1
      if (sql.includes('FROM recordings') && sql.includes('clone_training_ready = 1')) {
        const userId = args[0];
        const result: any[] = [];
        recordings.forEach(r => {
          if (r.user_id === userId && r.clone_training_ready === 1) {
            result.push(r);
          }
        });
        result.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return result;
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
    JWT_SECRET: 'test-secret-hardening-recordings',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/hardening-recordings-test',
    UPLOADS_PATH: '/tmp/hardening-recordings-test',
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

jest.mock('../middleware/file-validation', () => ({
  validateFileMagicBytes: () => (_req: any, _res: any, next: any) => next(),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateTestAccessToken(userId = TEST_USER_ID): string {
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
    { algorithm: 'RS256', expiresIn: '15m', keyid: testKeyPair.kid },
  );
}

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('Recording & Clone Route Hardening', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '50mb' }));
    const recordingRoutes = require('../routes/recordings').default;
    const cloneRoutes = require('../routes/clone').default;
    app.use('/api/v1/recordings', recordingRoutes);
    app.use('/api/v1/clone', cloneRoutes);
  });

  beforeEach(() => {
    resetStores();
  });

  // ─── 1. Empty recording list ─────────────────────────────────

  it('should return empty bundles array when user has no recordings', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .get('/api/v1/recordings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.bundles).toEqual([]);
    expect(res.body.recordings).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  // ─── 2. Invalid 'since' query param format ──────────────────

  it('should handle garbage since param without crashing (lexicographic comparison)', async () => {
    const token = generateTestAccessToken();

    // Seed a recording with a normal timestamp
    recordings.set('rec-001', {
      id: 'rec-001',
      bundle_id: 'bundle-001',
      user_id: TEST_USER_ID,
      duration_seconds: 120,
      has_video: 0,
      video_resolution: null,
      camera_source: null,
      transcript_text: 'Hello world',
      transcript_segments: '[]',
      file_size: 1024,
      device_platform: 'desktop',
      device_id: null,
      device_name: null,
      clone_training_ready: 0,
      sync_status: 'synced',
      created_at: '2026-01-15T10:00:00Z',
    });

    const res = await request(app)
      .get('/api/v1/recordings?since=not-a-date')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.since).toBe('not-a-date');
    // "not-a-date" > "2026-01-15T10:00:00Z" lexicographically, so no results
    expect(res.body.bundles).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  // ─── 3. Chunk upload exceeding 10 MB → 413 ──────────────────

  it('should reject chunk data larger than 10 MB with 413', async () => {
    const token = generateTestAccessToken();

    // Build a string just over 10 MB
    const oversizedData = 'x'.repeat(10 * 1024 * 1024 + 1);

    const res = await request(app)
      .post('/api/v1/recordings/upload/chunk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        bundle_id: 'bundle-oversized',
        chunk_index: 0,
        total_chunks: 1,
        data: oversizedData,
        file_type: 'audio/webm',
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/chunk data too large/i);
  });

  // ─── 4. Chunk upload with missing required fields → 400 ─────

  it('should reject chunk upload missing bundle_id with 400', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/recordings/upload/chunk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        chunk_index: 0,
        total_chunks: 1,
        data: 'some-data',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bundle_id.*chunk_index.*total_chunks.*required/i);
  });

  it('should reject chunk upload missing total_chunks with 400', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/recordings/upload/chunk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        bundle_id: 'bundle-missing-total',
        chunk_index: 0,
        data: 'some-data',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  // ─── 5. Empty clone training-data response ──────────────────

  it('should return empty bundles when no recordings are clone-training-ready', async () => {
    const token = generateTestAccessToken();

    // Seed a recording that is NOT training-ready
    recordings.set('rec-not-ready', {
      id: 'rec-not-ready',
      bundle_id: 'bundle-not-ready',
      user_id: TEST_USER_ID,
      duration_seconds: 60,
      has_video: 0,
      video_resolution: null,
      camera_source: null,
      transcript_text: 'Not ready',
      file_size: 512,
      device_platform: 'desktop',
      clone_training_ready: 0,
      created_at: '2026-02-01T10:00:00Z',
    });

    const res = await request(app)
      .get('/api/v1/clone/training-data')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bundles: [], total: 0 });
  });

  // ─── 6. Start training with too few bundle_ids → 400 ────────

  it('should reject start-training with empty bundle_ids (Zod min 3)', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/clone/start-training')
      .set('Authorization', `Bearer ${token}`)
      .send({ bundle_ids: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bundle_ids',
          message: expect.stringContaining('3'),
        }),
      ]),
    );
  });

  it('should reject start-training with fewer than 3 bundle_ids', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/clone/start-training')
      .set('Authorization', `Bearer ${token}`)
      .send({ bundle_ids: ['b1', 'b2'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  // ─── 7. Start training with another user's bundles → 400 ────

  it('should reject start-training when bundles belong to another user', async () => {
    const token = generateTestAccessToken(TEST_USER_ID);

    // Seed clone-ready recordings owned by OTHER_USER
    for (let i = 0; i < 3; i++) {
      const id = `rec-other-${i}`;
      recordings.set(id, {
        id,
        bundle_id: `bundle-other-${i}`,
        user_id: OTHER_USER_ID,
        duration_seconds: 300,
        has_video: 1,
        video_resolution: '1080p',
        camera_source: 'front',
        transcript_text: `Other user recording ${i}`,
        file_size: 2048,
        device_platform: 'ios',
        clone_training_ready: 1,
        created_at: `2026-03-0${i + 1}T10:00:00Z`,
      });
    }

    const res = await request(app)
      .post('/api/v1/clone/start-training')
      .set('Authorization', `Bearer ${token}`)
      .send({ bundle_ids: ['bundle-other-0', 'bundle-other-1', 'bundle-other-2'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Some bundles are not valid or training-ready');
  });

  // ─── Auth guard sanity checks ───────────────────────────────

  it('should reject recording list without auth token (401)', async () => {
    const res = await request(app)
      .get('/api/v1/recordings')
      .send();

    expect(res.status).toBe(401);
  });

  it('should reject clone training-data without auth token (401)', async () => {
    const res = await request(app)
      .get('/api/v1/clone/training-data')
      .send();

    expect(res.status).toBe(401);
  });
});
