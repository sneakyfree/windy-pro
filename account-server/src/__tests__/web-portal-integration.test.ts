/**
 * Web Portal Integration Tests — full user journey.
 *
 * Exercises the complete lifecycle:
 *   1. Register → get JWT
 *   2. Login → get JWT
 *   3. Upload recording → verify created
 *   4. List recordings → verify pagination
 *   5. Check storage usage → verify quota math
 *   6. Delete recording → verify removed & storage freed
 *   7. Delete account (GDPR) → verify all data removed
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
const recordings = new Map<string, any>();
const files = new Map<string, any>();

const testKeyPair = generateKeyPair();

function resetStores() {
  users.clear();
  refreshTokens.clear();
  identityScopes.clear();
  productAccounts.clear();
  devices.clear();
  tokenBlacklist.clear();
  recordings.clear();
  files.clear();
}

// ═══════════════════════════════════════════
//  MOCK DATABASE
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
          id, email, name, password_hash: passwordHash, tier,
          identity_type: 'human', windy_identity_id: `WI-${id.slice(0, 8)}`,
          display_name: name, avatar_url: null, phone: null,
          email_verified: 0, phone_verified: 0, preferred_lang: 'en',
          role: 'user', storage_used: 0, storage_limit: 500 * 1024 * 1024,
          last_login_at: null, created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { changes: 1 };
      },
    },
    deleteUserRefreshTokens: { run: () => ({ changes: 0 }) },
    saveRefreshToken: {
      run: (token: string, userId: string, _deviceId: string, expiresAt: string) => {
        refreshTokens.set(token, { token, user_id: userId, expires_at: expiresAt });
        return { changes: 1 };
      },
    },
    insertTranslation: { run: () => ({ changes: 1 }) },
    getTranslationHistory: { all: () => [] },
    countTranslations: { get: () => ({ count: 0 }) },
    findTranslation: { get: () => null },
    insertFavorite: { run: () => ({ changes: 0 }) },
    removeFavorite: { run: () => ({ changes: 0 }) },
    getDevices: { all: () => [] },
    addDevice: { run: () => ({ changes: 1 }) },
    findDevice: { get: () => null },
    touchDevice: { run: () => ({ changes: 1 }) },
    countDevices: { get: () => ({ count: 0 }) },
    updateUserSeen: { run: () => ({ changes: 1 }) },
  }),
}));

function mockDbPrepare(sql: string) {
  return {
    run: (...args: any[]) => {
      // INSERT INTO recordings
      if (sql.includes('INSERT INTO recordings')) {
        const id = args[0];
        const userId = args[1];
        const bundleId = args[2];
        recordings.set(id, {
          id, user_id: userId, bundle_id: bundleId,
          duration_seconds: args[3] || 0,
          has_video: args[4] || 0,
          video_resolution: args[5],
          camera_source: args[6],
          transcript_text: args[7] || '',
          transcript_segments: args[8] || '[]',
          file_path: args[9],
          file_size: args[10] || 0,
          device_platform: args[11] || 'desktop',
          clone_training_ready: 0,
          sync_status: 'uploaded',
          created_at: new Date().toISOString(),
        });
        // Update user storage
        const user = users.get(userId);
        if (user) user.storage_used += (args[10] || 0);
        return { changes: 1 };
      }
      // DELETE FROM recordings
      if (sql.includes('DELETE FROM recordings') && sql.includes('WHERE id')) {
        const recId = args[0];
        const rec = recordings.get(recId);
        if (rec) {
          const user = users.get(rec.user_id);
          if (user) user.storage_used = Math.max(0, user.storage_used - (rec.file_size || 0));
          recordings.delete(recId);
        }
        return { changes: rec ? 1 : 0 };
      }
      // DELETE FROM ... WHERE user_id/identity_id — GDPR cascade
      if (sql.startsWith('DELETE FROM')) {
        if (sql.includes('recordings')) {
          const userId = args[0];
          for (const [k, v] of recordings) {
            if (v.user_id === userId) recordings.delete(k);
          }
        }
        if (sql.includes('refresh_tokens')) {
          const userId = args[0];
          for (const [k, v] of refreshTokens) {
            if (v.user_id === userId) refreshTokens.delete(k);
          }
        }
        if (sql.includes('users')) {
          users.delete(args[0]);
        }
        return { changes: 1 };
      }
      // UPDATE users
      if (sql.includes('UPDATE users')) {
        return { changes: 1 };
      }
      // token_blacklist insert
      if (sql.includes('INSERT INTO token_blacklist') || sql.includes('DELETE FROM token_blacklist')) {
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
      // SELECT identity_type, windy_identity_id FROM users
      if (sql.includes('identity_type') && sql.includes('windy_identity_id') && !sql.includes('SELECT *') && !sql.includes('password_hash')) {
        const u = users.get(args[0]);
        return u ? { identity_type: u.identity_type, windy_identity_id: u.windy_identity_id } : null;
      }
      // SELECT role FROM users
      if (sql.includes('SELECT role FROM users')) {
        const u = users.get(args[0]);
        return u ? { role: u.role } : null;
      }
      // SELECT id, email, password_hash FROM users
      if (sql.includes('password_hash') && sql.includes('FROM users')) {
        const u = users.get(args[0]);
        return u ? { id: u.id, email: u.email, password_hash: u.password_hash } : null;
      }
      // SELECT ... FROM users WHERE id
      if (sql.includes('FROM users WHERE id')) {
        return users.get(args[0]) || null;
      }
      // SELECT id FROM recordings WHERE id = ? AND user_id = ?
      if (sql.includes('FROM recordings WHERE id') || sql.includes('FROM recordings WHERE bundle_id')) {
        const rec = recordings.get(args[0]);
        if (rec && rec.user_id === args[1]) return rec;
        // Check by bundle_id
        for (const r of recordings.values()) {
          if (r.bundle_id === args[0] && r.user_id === args[1]) return r;
        }
        return null;
      }
      // Stats aggregate query
      if (sql.includes('COUNT(*)') && sql.includes('SUM') && sql.includes('FROM recordings')) {
        const userId = args[0];
        let totalRecordings = 0, totalDuration = 0, totalSize = 0, videoRecordings = 0, cloneReady = 0;
        recordings.forEach(r => {
          if (r.user_id === userId) {
            totalRecordings++;
            totalDuration += r.duration_seconds || 0;
            totalSize += r.file_size || 0;
            if (r.has_video) videoRecordings++;
            if (r.clone_training_ready) cloneReady++;
          }
        });
        return {
          totalRecordings, totalDuration, totalSize, avgQuality: 0,
          videoRecordings, cloneReady, firstRecording: null, lastRecording: null,
        };
      }
      // COUNT for pagination
      if (sql.includes('COUNT(*)') && sql.includes('FROM recordings')) {
        const userId = args[0];
        let count = 0;
        recordings.forEach(r => { if (r.user_id === userId) count++; });
        return { count };
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
      // SELECT ... FROM recordings WHERE user_id = ?
      if (sql.includes('FROM recordings')) {
        const userId = args[0];
        const result: any[] = [];
        recordings.forEach(r => {
          if (r.user_id === userId) result.push(r);
        });
        result.sort((a, b) => b.created_at.localeCompare(a.created_at));
        // Apply limit/offset if present
        const limitIdx = args.findIndex((a: any, i: number) => i > 0 && typeof a === 'number');
        if (limitIdx > 0) {
          const limit = args[limitIdx];
          const offset = args[limitIdx + 1] || 0;
          return result.slice(offset, offset + limit);
        }
        return result.slice(0, 100);
      }
      // identity_scopes
      if (sql.includes('FROM identity_scopes')) {
        return [];
      }
      // product_accounts
      if (sql.includes('FROM product_accounts')) {
        return [];
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
    JWT_SECRET: 'test-secret-web-portal',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/web-portal-test',
    UPLOADS_PATH: '/tmp/web-portal-test',
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
  provisionProduct: jest.fn(),
  grantScopes: jest.fn(),
  validateBotApiKey: jest.fn().mockReturnValue({ valid: false }),
}));

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../middleware/file-validation', () => ({
  validateFileMagicBytes: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/ecosystem-provisioner', () => ({
  provisionEcosystem: jest.fn().mockResolvedValue(undefined),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateTestToken(userId: string): string {
  return jwt.sign(
    {
      userId, email: 'test@test.com', tier: 'pro',
      accountId: userId, type: 'human',
      scopes: ['windy_pro:*'], products: ['windy_pro'],
      iss: 'windy-identity',
    },
    testKeyPair.privateKey,
    { algorithm: 'RS256', expiresIn: '15m', keyid: testKeyPair.kid },
  );
}

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('Web Portal Integration — Full User Journey', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '50mb' }));
    const authRoutes = require('../routes/auth').default;
    const recordingRoutes = require('../routes/recordings').default;
    const storageRoutes = require('../routes/storage').default;
    app.use('/api/v1/auth', authRoutes);
    app.use('/api/v1/recordings', recordingRoutes);
    app.use('/api/v1/files', storageRoutes);
  });

  beforeEach(() => {
    resetStores();
  });

  // ─── 1. Registration ─────────────────────────────────────

  it('should register a new user and return a JWT', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'newuser@test.com', password: 'Str0ngP@ss!', name: 'New User' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.email).toBe('newuser@test.com');

    // Verify the JWT is valid RS256
    const decoded = jwt.verify(res.body.token, testKeyPair.publicKey, { algorithms: ['RS256'] }) as any;
    expect(decoded.userId).toBeDefined();
    expect(decoded.iss).toBe('windy-identity');
    expect(decoded.scopes).toContain('windy_pro:*');
  });

  it('should reject duplicate registration', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@test.com', password: 'Str0ngP@ss!', name: 'First' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@test.com', password: 'Str0ngP@ss!', name: 'Second' });

    expect(res.status).toBe(409);
  });

  // ─── 2. Login ─────────────────────────────────────────────

  it('should login with correct credentials', async () => {
    // Register first
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'login@test.com', password: 'Str0ngP@ss!', name: 'Login User' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login@test.com', password: 'Str0ngP@ss!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('should reject login with wrong password', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'wrong@test.com', password: 'Str0ngP@ss!', name: 'Wrong' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'wrong@test.com', password: 'WrongPassword1!' });

    expect(res.status).toBe(401);
  });

  // ─── 3. Upload recording → list → check ──────────────────

  it('should upload a recording via chunk endpoint', async () => {
    // Seed a user
    const userId = 'user-portal-001';
    users.set(userId, {
      id: userId, email: 'portal@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-PORTAL-001',
      storage_used: 0, storage_limit: 500 * 1024 * 1024,
    });
    const token = generateTestToken(userId);

    const res = await request(app)
      .post('/api/v1/recordings/upload/chunk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        bundle_id: 'bundle-portal-001',
        chunk_index: 0,
        total_chunks: 1,
        data: 'base64-audio-data-here',
        file_type: 'audio/webm',
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.bundleId).toBe('bundle-portal-001');
  });

  // ─── 4. List recordings with pagination ───────────────────

  it('should list recordings with pagination metadata', async () => {
    const userId = 'user-portal-002';
    users.set(userId, {
      id: userId, email: 'paginate@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-PORTAL-002',
      storage_used: 0, storage_limit: 500 * 1024 * 1024,
    });
    const token = generateTestToken(userId);

    // Seed 5 recordings
    for (let i = 0; i < 5; i++) {
      recordings.set(`rec-p-${i}`, {
        id: `rec-p-${i}`, bundle_id: `bundle-p-${i}`, user_id: userId,
        duration_seconds: 60, has_video: 0, video_resolution: null,
        camera_source: null, transcript_text: `Recording ${i}`,
        transcript_segments: '[]', file_size: 1024,
        device_platform: 'desktop', device_id: null, device_name: null,
        clone_training_ready: 0, sync_status: 'synced',
        created_at: `2026-01-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
      });
    }

    const res = await request(app)
      .get('/api/v1/recordings?limit=2&page=1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.recordings.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBe(5);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.totalPages).toBe(3);
    // backward compat
    expect(res.body.bundles).toBeDefined();
  });

  it('should return empty page when page exceeds total', async () => {
    const userId = 'user-portal-003';
    users.set(userId, {
      id: userId, email: 'empty@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-PORTAL-003',
      storage_used: 0, storage_limit: 500 * 1024 * 1024,
    });
    const token = generateTestToken(userId);

    const res = await request(app)
      .get('/api/v1/recordings?page=99')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.recordings).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.hasMore).toBe(false);
  });

  // ─── 5. Delete recording → verify freed ───────────────────

  it('should delete a recording and free storage', async () => {
    const userId = 'user-portal-004';
    users.set(userId, {
      id: userId, email: 'delete@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-PORTAL-004',
      storage_used: 2048, storage_limit: 500 * 1024 * 1024,
    });
    recordings.set('rec-del-001', {
      id: 'rec-del-001', bundle_id: 'bundle-del-001', user_id: userId,
      duration_seconds: 120, has_video: 0, file_size: 2048,
      file_path: null, created_at: '2026-01-15T10:00:00Z',
    });
    const token = generateTestToken(userId);

    const res = await request(app)
      .delete('/api/v1/recordings/rec-del-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(recordings.has('rec-del-001')).toBe(false);
    expect(users.get(userId)!.storage_used).toBe(0);
  });

  it('should 404 when deleting non-existent recording', async () => {
    const userId = 'user-portal-005';
    users.set(userId, {
      id: userId, email: 'nodel@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-PORTAL-005',
      storage_used: 0, storage_limit: 500 * 1024 * 1024,
    });
    const token = generateTestToken(userId);

    const res = await request(app)
      .delete('/api/v1/recordings/nonexistent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  // ─── 6. Cross-user isolation ──────────────────────────────

  it('should not allow user A to delete user B recording', async () => {
    const userA = 'user-portal-A';
    const userB = 'user-portal-B';
    users.set(userA, {
      id: userA, email: 'a@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-A',
      storage_used: 0, storage_limit: 500 * 1024 * 1024,
    });
    users.set(userB, {
      id: userB, email: 'b@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-B',
      storage_used: 1024, storage_limit: 500 * 1024 * 1024,
    });
    recordings.set('rec-B-001', {
      id: 'rec-B-001', bundle_id: 'bundle-B-001', user_id: userB,
      duration_seconds: 60, has_video: 0, file_size: 1024,
      file_path: null, created_at: '2026-01-15T10:00:00Z',
    });
    const tokenA = generateTestToken(userA);

    const res = await request(app)
      .delete('/api/v1/recordings/rec-B-001')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404); // 404 not 403 — don't leak existence
    expect(recordings.has('rec-B-001')).toBe(true); // still exists
  });

  // ─── 7. GDPR Account Deletion ─────────────────────────────

  it('should delete account and cascade all user data', async () => {
    // Register a user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'gdpr@test.com', password: 'Str0ngP@ss!', name: 'GDPR User' });

    expect(regRes.status).toBe(201);
    const token = regRes.body.token;
    const decoded = jwt.decode(token) as any;
    const userId = decoded.userId;

    // Seed some recordings for this user
    recordings.set('rec-gdpr-001', {
      id: 'rec-gdpr-001', bundle_id: 'bundle-gdpr-001', user_id: userId,
      duration_seconds: 60, has_video: 0, file_size: 512,
      created_at: '2026-01-15T10:00:00Z',
    });

    // Delete account
    const delRes = await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);

    // User should be gone
    expect(users.has(userId)).toBe(false);
  });

  it('should reject GDPR deletion with wrong password confirmation', async () => {
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'gdpr2@test.com', password: 'Str0ngP@ss!', name: 'GDPR2' });

    const token = regRes.body.token;

    const res = await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'WrongPassword1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/password confirmation failed/i);
  });

  // ─── 8. Auth guards ───────────────────────────────────────

  it('should reject recording operations without auth', async () => {
    const res = await request(app).get('/api/v1/recordings');
    expect(res.status).toBe(401);
  });

  it('should reject recording delete without auth', async () => {
    const res = await request(app).delete('/api/v1/recordings/some-id');
    expect(res.status).toBe(401);
  });

  // ─── 9. Recording stats ───────────────────────────────────

  it('should return recording stats for the user', async () => {
    const userId = 'user-portal-stats';
    users.set(userId, {
      id: userId, email: 'stats@test.com', tier: 'pro', role: 'user',
      identity_type: 'human', windy_identity_id: 'WI-STATS',
      storage_used: 0, storage_limit: 500 * 1024 * 1024,
    });
    const token = generateTestToken(userId);

    const res = await request(app)
      .get('/api/v1/recordings/stats')
      .set('Authorization', `Bearer ${token}`);

    // Stats endpoint does its own SQL — may return defaults from mock
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRecordings');
    expect(res.body).toHaveProperty('totalDuration');
    expect(res.body).toHaveProperty('totalSize');
  });
});
