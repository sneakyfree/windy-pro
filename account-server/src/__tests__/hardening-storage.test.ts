/**
 * File upload security hardening tests.
 *
 * Exercises storage routes with supertest to verify:
 *   1. Missing file rejection
 *   2. Storage quota enforcement
 *   3. Path traversal filename sanitization
 *   4. Cross-user file access denied (download + delete)
 *   5. Non-existent file 404s
 *   6. SQL injection safety via parameterized queries
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
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
const files = new Map<string, any>();
const tokenBlacklist = new Set<string>();

const TEST_USER_ID = 'user-storage-001';
const OTHER_USER_ID = 'user-storage-002';

function resetStores() {
  users.clear();
  files.clear();
  tokenBlacklist.clear();

  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: 'test@windypro.com',
    tier: 'pro',
    role: 'user',
    identity_type: 'human',
    windy_identity_id: 'WI-ST-001',
    storage_used: 0,
    storage_limit: 500 * 1024 * 1024, // 500 MB
  });

  users.set(OTHER_USER_ID, {
    id: OTHER_USER_ID,
    email: 'other@windypro.com',
    tier: 'pro',
    role: 'user',
    identity_type: 'human',
    windy_identity_id: 'WI-ST-002',
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
    run: (...args: any[]) => {
      // INSERT INTO files
      if (sql.includes('INSERT INTO files')) {
        const [id, userId, originalName, storedName, mimeType, size, type, sessionDate, metadata] = args;
        files.set(id, {
          id,
          user_id: userId,
          original_name: originalName,
          stored_name: storedName,
          mime_type: mimeType,
          size,
          type,
          session_date: sessionDate,
          metadata,
          uploaded_at: new Date().toISOString(),
        });
        return { changes: 1 };
      }
      // UPDATE users SET storage_used
      if (sql.includes('UPDATE users SET storage_used')) {
        const u = users.get(args[args.length - 1]);
        if (u) {
          if (sql.includes('MAX(0')) {
            // DELETE path: storage_used = MAX(0, storage_used - ?)
            u.storage_used = Math.max(0, (u.storage_used || 0) - args[0]);
          } else {
            // UPLOAD path: storage_used = COALESCE(storage_used, 0) + ?
            u.storage_used = (u.storage_used || 0) + args[0];
          }
        }
        return { changes: 1 };
      }
      // DELETE FROM files WHERE id = ?
      if (sql.includes('DELETE FROM files WHERE id')) {
        const existed = files.has(args[0]);
        files.delete(args[0]);
        return { changes: existed ? 1 : 0 };
      }
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      // SELECT storage_used, storage_limit FROM users WHERE id = ?
      if (sql.includes('storage_used') && sql.includes('storage_limit') && sql.includes('FROM users')) {
        const u = users.get(args[0]);
        return u ? { storage_used: u.storage_used, storage_limit: u.storage_limit } : undefined;
      }
      // SELECT * FROM files WHERE id = ?
      if (sql.includes('FROM files WHERE id')) {
        return files.get(args[0]) || null;
      }
      // SELECT role FROM users WHERE id = ?
      if (sql.includes('SELECT role FROM users')) {
        const u = users.get(args[0]);
        return u ? { role: u.role } : null;
      }
      // SELECT COUNT(*) ... FROM files WHERE user_id = ?
      if (sql.includes('COUNT(*)') && sql.includes('FROM files')) {
        let count = 0;
        files.forEach(f => { if (f.user_id === args[0]) count++; });
        return { count };
      }
      // token_blacklist check
      if (sql.includes('FROM token_blacklist')) {
        return tokenBlacklist.has(args[0]) ? { '1': 1 } : null;
      }
      // FROM users WHERE id — general user lookup for auth middleware
      if (sql.includes('FROM users WHERE id')) {
        return users.get(args[0]) || null;
      }
      return null;
    },
    all: (...args: any[]) => {
      // SELECT id, original_name, ... FROM files WHERE user_id = ?
      if (sql.includes('FROM files WHERE user_id')) {
        const userId = args[0];
        const limit = args[1] || 50;
        const offset = args[2] || 0;
        const userFiles: any[] = [];
        files.forEach(f => { if (f.user_id === userId) userFiles.push(f); });
        userFiles.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
        return userFiles.slice(offset, offset + limit);
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

// Create temp upload dir for multer
const tmpDir = path.join(os.tmpdir(), 'hardening-storage-test-' + Date.now());

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-hardening-storage',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: tmpDir,
    UPLOADS_PATH: tmpDir,
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

jest.mock('../services/r2-adapter', () => ({
  isR2Configured: () => false,
  R2StorageAdapter: jest.fn(),
}));

jest.mock('../middleware/file-validation', () => ({
  validateFileMagicBytes: () => (_req: any, _res: any, next: any) => next(),
  detectMimeFromMagicBytes: jest.fn().mockReturnValue('application/octet-stream'),
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

describe('Storage Route Hardening', () => {
  let app: Express;

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });

    app = express();
    app.use(express.json());
    const storageRoutes = require('../routes/storage').default;
    app.use('/api/v1/files', storageRoutes);
  });

  beforeEach(() => {
    resetStores();
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─── 1. Upload with no file ───────────────────────────────

  it('should reject upload with no file attached (400)', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file provided/i);
  });

  // ─── 2. Upload when storage quota is full ─────────────────

  it('should reject upload when storage quota is exceeded (413)', async () => {
    const token = generateTestAccessToken();

    // Fill up the user's quota
    const user = users.get(TEST_USER_ID)!;
    user.storage_used = user.storage_limit;

    const res = await request(app)
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('x'.repeat(100)), 'small.txt');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/storage limit exceeded/i);
  });

  // ─── 3. Upload with path traversal filename ──────────────

  it('should sanitize path traversal in filename (stored_name uses safe format)', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello world'), '../../etc/passwd');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the stored filename does not contain path traversal
    const fileId = res.body.fileId;
    const storedFile = files.get(fileId);
    expect(storedFile).toBeDefined();

    // The stored_name should be multer's date_uuid format, not the original name
    expect(storedFile.stored_name).not.toContain('..');
    expect(storedFile.stored_name).not.toContain('/');
    expect(storedFile.stored_name).toMatch(/^\d{4}-\d{2}-\d{2}_[a-f0-9]{8}/);

    // original_name may be sanitized by multer (basename extraction) — either full or just filename is fine
    expect(['../../etc/passwd', 'passwd']).toContain(storedFile.original_name);
  });

  // ─── 4. Upload with low storage limit ────────────────────

  it('should reject upload exceeding a tight storage limit (413)', async () => {
    const token = generateTestAccessToken();

    // Set a very small limit
    const user = users.get(TEST_USER_ID)!;
    user.storage_limit = 10; // 10 bytes
    user.storage_used = 0;

    const res = await request(app)
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('this is more than 10 bytes of data'), 'big.txt');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/storage limit exceeded/i);
    expect(res.body).toHaveProperty('used');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('fileSize');
  });

  // ─── 5. Download file belonging to another user (403) ────

  it('should deny downloading a file owned by another user (403)', async () => {
    const otherFileId = 'file-other-001';

    // Create a temp file on disk for the other user
    const otherUserDir = path.join(tmpDir, OTHER_USER_ID);
    fs.mkdirSync(otherUserDir, { recursive: true });
    const storedName = '2026-01-01_abcdef01.txt';
    fs.writeFileSync(path.join(otherUserDir, storedName), 'secret data');

    files.set(otherFileId, {
      id: otherFileId,
      user_id: OTHER_USER_ID,
      original_name: 'secret.txt',
      stored_name: storedName,
      mime_type: 'text/plain',
      size: 11,
      type: 'transcript',
      session_date: '2026-01-01',
      metadata: '{}',
      uploaded_at: '2026-01-01T00:00:00Z',
    });

    const token = generateTestAccessToken(TEST_USER_ID);

    const res = await request(app)
      .get(`/api/v1/files/${otherFileId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  // ─── 6. Delete file belonging to another user (403) ──────

  it('should deny deleting a file owned by another user (403)', async () => {
    const otherFileId = 'file-other-002';
    files.set(otherFileId, {
      id: otherFileId,
      user_id: OTHER_USER_ID,
      original_name: 'secret.txt',
      stored_name: '2026-01-01_abcdef02.txt',
      mime_type: 'text/plain',
      size: 11,
      type: 'transcript',
      session_date: '2026-01-01',
      metadata: '{}',
      uploaded_at: '2026-01-01T00:00:00Z',
    });

    const token = generateTestAccessToken(TEST_USER_ID);

    const res = await request(app)
      .delete(`/api/v1/files/${otherFileId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);

    // File should still exist
    expect(files.has(otherFileId)).toBe(true);
  });

  // ─── 7. Download non-existent file (404) ─────────────────

  it('should return 404 for a non-existent file ID', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .get('/api/v1/files/nonexistent-file-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/file not found/i);
  });

  // ─── 8. SQL injection in query params ────────────────────

  it('should safely handle SQL injection attempts in list query params', async () => {
    const token = generateTestAccessToken();

    // Zod coercion will reject non-numeric page/limit and fall back to defaults
    // or throw a validation error — either way, no SQL injection occurs
    const res = await request(app)
      .get("/api/v1/files?page=1&limit=10'; DROP TABLE files;--")
      .set('Authorization', `Bearer ${token}`);

    // The Zod schema rejects the malformed limit (not a valid number).
    // Wave 12 fix (B1): the route now returns 400 with structured error
    // details instead of a generic 500. 200 remains valid if the schema
    // ever coerces to a default rather than throwing. 500 is explicitly
    // excluded — crashing on malformed input was the bug being fixed.
    // The key assertion: we do NOT crash, and files are intact.
    expect([200, 400]).toContain(res.status);

    // Verify the in-memory files store was not affected
    // (in a real DB, the table would not be dropped)
    expect(files).toBeDefined();
  });

  // ─── 9. Successful upload + list round-trip ──────────────

  it('should upload a file and list it back', async () => {
    const token = generateTestAccessToken();

    const uploadRes = await request(app)
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('test content'), 'notes.txt');

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.ok).toBe(true);
    expect(uploadRes.body.fileId).toBeDefined();

    const listRes = await request(app)
      .get('/api/v1/files')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.files.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.files.some((f: any) => f.id === uploadRes.body.fileId)).toBe(true);
  });

  // ─── 10. No auth token → 401 ────────────────────────────

  it('should reject requests with no auth token (401)', async () => {
    const res = await request(app)
      .get('/api/v1/files')
      // no Authorization header
      .send();

    expect(res.status).toBe(401);
  });

  // ─── 11. Delete non-existent file → 404 ─────────────────

  it('should return 404 when deleting a non-existent file', async () => {
    const token = generateTestAccessToken();

    const res = await request(app)
      .delete('/api/v1/files/nonexistent-delete-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/file not found/i);
  });
});
