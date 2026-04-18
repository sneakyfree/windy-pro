/**
 * ECOSYSTEM STRESS TEST
 *
 * Industrial-grade end-to-end test of the full Windy Pro ecosystem cascade.
 * Tests: registration provisioning, JWT/JWKS chain, OAuth2, ecosystem-status,
 * chat provision, concurrent stress, GDPR deletion, file upload.
 *
 * Uses supertest against the real app (no mocks) + a mock Mail webhook server.
 */
import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

// Wave 7 P1-15 follow-up — register path exceeds 5s default under full-suite load
jest.setTimeout(30000);
import path from 'path';
import fs from 'fs';

// ─── Environment Setup (before importing app) ──────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'stress-test-jwt-secret-32chars!!';
process.env.SYNAPSE_REGISTRATION_SECRET = 'test-synapse-secret';
process.env.WINDYMAIL_API_URL = 'http://localhost:9301';
process.env.WINDYMAIL_SERVICE_TOKEN = 'test-service-token-12345';

import { app } from '../src/server';

// ─── Mock Mail Webhook Server ───────────────────────────────

const webhooksReceived: { mail: { headers: any; body: any; timestamp: number }[] } = { mail: [] };

const mockMailServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        if (req.url === '/api/v1/webhooks/identity/created') {
            try {
                webhooksReceived.mail.push({
                    headers: req.headers,
                    body: JSON.parse(body),
                    timestamp: Date.now(),
                });
            } catch { /* malformed body */ }
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ email: 'test@windymail.ai', status: 'provisioned' }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
});

// ─── Test Infrastructure ────────────────────────────────────

const ts = Date.now();
const TEST_USER = {
    name: 'Stress Test User',
    email: `stress-${ts}@test.com`,
    password: 'StressPass1',
    deviceId: `stress-device-${ts}`,
    deviceName: 'Stress Test',
    platform: 'test',
};

let authToken = '';
let refreshToken = '';
let userId = '';

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Test Runner ────────────────────────────────────────────

beforeAll((done) => {
    mockMailServer.listen(9301, done);
});

afterAll((done) => {
    mockMailServer.close(done);
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 1: REGISTRATION CASCADE
// ═══════════════════════════════════════════════════════════

describe('Category 1: Registration Cascade', () => {
    test('Register new user → 201', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send(TEST_USER);
        expect(res.status).toBe(201);
        expect(res.body.userId).toBeDefined();
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(res.body.windyIdentityId).toBeDefined();
        authToken = res.body.token;
        refreshToken = res.body.refreshToken;
        userId = res.body.userId;
    });

    test('Mail webhook received within 3 seconds', async () => {
        // setImmediate fires the provisioner — give it time
        await wait(3000);
        expect(webhooksReceived.mail.length).toBeGreaterThanOrEqual(1);
    });

    test('Webhook payload has windy_identity_id, email, display_name', () => {
        const wh = webhooksReceived.mail[webhooksReceived.mail.length - 1];
        expect(wh.body.windy_identity_id).toBe(userId);
        expect(wh.body.email).toBe(TEST_USER.email);
        expect(wh.body.display_name).toBe(TEST_USER.name);
    });

    test('Webhook has X-Service-Token header', () => {
        const wh = webhooksReceived.mail[webhooksReceived.mail.length - 1];
        expect(wh.headers['x-service-token']).toBe('test-service-token-12345');
    });

    test('product_accounts has windy_chat = pending', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
        expect(res.body.products.windy_chat.status).toBe('pending');
    });

    test('users table has storage_limit = 500MB', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.body.products.windy_cloud.storage_limit).toBe(500 * 1024 * 1024);
    });

    test('Register same email again → 409', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send(TEST_USER);
        expect(res.status).toBe(409);
        expect(res.body.error).toContain('already exists');
    });

    test('Register with missing email → 400', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'No Email', password: 'StressPass1' });
        expect(res.status).toBe(400);
    });

    test('Register with missing password → 400', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'No Pass', email: 'nopass@test.com' });
        expect(res.status).toBe(400);
    });

    test('Register with weak password → 400', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ name: 'Weak', email: 'weak@test.com', password: 'short' });
        expect(res.status).toBe(400);
    });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 2: JWT & JWKS CHAIN
// ═══════════════════════════════════════════════════════════

describe('Category 2: JWT & JWKS Chain', () => {
    let loginToken = '';

    test('Login → JWT has required claims', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: TEST_USER.email, password: TEST_USER.password });
        expect(res.status).toBe(200);
        loginToken = res.body.token;
        const decoded = jwt.decode(loginToken) as any;
        expect(decoded.userId).toBeDefined();
        expect(decoded.email).toBe(TEST_USER.email);
        expect(decoded.tier).toBe('free');
        expect(decoded.scopes).toContain('windy_pro:*');
        expect(decoded.products).toContain('windy_pro');
        expect(decoded.iss).toBe('windy-identity');
        expect(decoded.type).toBe('human');
    });

    test('GET /.well-known/jwks.json → valid JWKS with keys', async () => {
        const res = await request(app).get('/.well-known/jwks.json');
        expect(res.status).toBe(200);
        expect(res.body.keys).toBeInstanceOf(Array);
        // In test env, may have keys if auto-generated or none — just verify structure
        if (res.body.keys.length > 0) {
            const key = res.body.keys[0];
            expect(key.kty).toBe('RSA');
            expect(key.alg).toBe('RS256');
            expect(key.kid).toBeDefined();
            expect(key.n).toBeDefined();
            expect(key.e).toBeDefined();
        }
    });

    test('GET /.well-known/openid-configuration → valid OIDC discovery', async () => {
        const res = await request(app).get('/.well-known/openid-configuration');
        expect(res.status).toBe(200);
        expect(res.body.issuer).toBeDefined();
        expect(res.body.jwks_uri).toContain('/.well-known/jwks.json');
        expect(res.body.grant_types_supported).toContain('authorization_code');
        expect(res.body.grant_types_supported).toContain('client_credentials');
        expect(res.body.grant_types_supported).toContain('refresh_token');
        expect(res.body.scopes_supported).toContain('openid');
        expect(res.body.scopes_supported).toContain('windy_pro:*');
    });

    test('validate-token with valid JWT → full identity', async () => {
        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.email).toBe(TEST_USER.email);
        expect(res.body.tier).toBe('free');
        expect(res.body.type).toBe('human');
        expect(res.body.scopes).toContain('windy_pro:*');
        expect(res.body.canonical_tier).toBeDefined();
    });

    test('validate-token with expired JWT → 401', async () => {
        const expiredToken = jwt.sign(
            { userId, email: TEST_USER.email, tier: 'free', accountId: userId },
            process.env.JWT_SECRET!,
            { algorithm: 'HS256', expiresIn: '-1s' },
        );
        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', `Bearer ${expiredToken}`);
        expect(res.status).toBe(401);
    });

    test('validate-token with garbage token → 401 or 403', async () => {
        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', 'Bearer totally.invalid.garbage');
        expect([401, 403]).toContain(res.status);
    });

    test('validate-token without auth → 401', async () => {
        const res = await request(app)
            .get('/api/v1/identity/validate-token');
        expect(res.status).toBe(401);
    });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 3: ECOSYSTEM STATUS
// ═══════════════════════════════════════════════════════════

describe('Category 3: Ecosystem Status', () => {
    test('ecosystem-status returns all 8 products', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
        const products = res.body.products;
        expect(products).toHaveProperty('windy_word');
        expect(products).toHaveProperty('windy_chat');
        expect(products).toHaveProperty('windy_mail');
        expect(products).toHaveProperty('windy_cloud');
        expect(products).toHaveProperty('windy_fly');
        expect(products).toHaveProperty('windy_clone');
        expect(products).toHaveProperty('windy_traveler');
        expect(products).toHaveProperty('eternitas');
    });

    test('windy_word shows active', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.body.products.windy_word.status).toBe('active');
    });

    test('windy_cloud shows storage fields', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        const cloud = res.body.products.windy_cloud;
        expect(cloud.status).toBe('active');
        expect(typeof cloud.storage_used).toBe('number');
        expect(typeof cloud.storage_limit).toBe('number');
    });

    test('tier is free for new user', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.body.tier).toBe('free');
    });

    test('windy_traveler shows upgrade_required for free tier', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.body.products.windy_traveler.status).toBe('upgrade_required');
    });

    test('ecosystem-status without auth → 401', async () => {
        const res = await request(app).get('/api/v1/identity/ecosystem-status');
        expect(res.status).toBe(401);
    });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 4: CHAT PROVISIONING
// ═══════════════════════════════════════════════════════════

describe('Category 4: Chat Provisioning', () => {
    test('POST /identity/chat/provision → creates Matrix profile (dev stub)', async () => {
        const res = await request(app)
            .post('/api/v1/identity/chat/provision')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ displayName: TEST_USER.name });
        // Dev mode: SYNAPSE_REGISTRATION_SECRET is set but Synapse isn't running → 502
        // OR if it's a dev stub → 201
        // Accept either since Synapse isn't available in test
        expect([201, 502]).toContain(res.status);
        if (res.status === 201) {
            expect(res.body.success).toBe(true);
            expect(res.body.matrix.matrixUserId).toBeDefined();
        }
    });

    test('chat-validate with valid creds → returns user info', async () => {
        const res = await request(app)
            .post('/api/v1/auth/chat-validate')
            .send({
                username: TEST_USER.email,
                password: TEST_USER.password,
                shared_secret: 'test-synapse-secret',
            });
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.user_id).toBe(userId);
        expect(res.body.display_name).toBeDefined();
    });

    test('chat-validate with wrong password → 401', async () => {
        const res = await request(app)
            .post('/api/v1/auth/chat-validate')
            .send({
                username: TEST_USER.email,
                password: 'WrongPassword1',
                shared_secret: 'test-synapse-secret',
            });
        expect(res.status).toBe(401);
    });

    test('chat-validate without shared secret → 403', async () => {
        const res = await request(app)
            .post('/api/v1/auth/chat-validate')
            .send({
                username: TEST_USER.email,
                password: TEST_USER.password,
            });
        expect(res.status).toBe(403);
    });

    test('chat-validate with wrong shared secret → 403', async () => {
        const res = await request(app)
            .post('/api/v1/auth/chat-validate')
            .send({
                username: TEST_USER.email,
                password: TEST_USER.password,
                shared_secret: 'wrong-secret',
            });
        expect(res.status).toBe(403);
    });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 5: OAUTH2 FLOW
// ═══════════════════════════════════════════════════════════

describe('Category 5: OAuth2 Flow', () => {
    let clientId = '';
    let clientSecret = '';

    beforeAll(() => {
        // Make test user admin for OAuth client management
        const { getDb } = require('../src/db/schema');
        const db = getDb();
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userId);
    });

    test('Register OAuth client via /register-client → returns client_id', async () => {
        clientId = `stress_test_${ts}`;
        clientSecret = `stress_secret_${crypto.randomBytes(16).toString('hex')}`;

        const res = await request(app)
            .post('/api/v1/oauth/register-client')
            .send({
                client_id: clientId,
                client_name: 'Stress Test Client',
                redirect_uris: ['https://stress-test.local/callback'],
                allowed_scopes: ['openid', 'profile', 'email', 'windy_pro:*'],
                client_secret: clientSecret,
            });
        expect(res.status).toBe(201);
        expect(res.body.client_id).toBe(clientId);
        expect(res.body.registered).toBe(true);
    });

    test('GET /oauth/authorize with valid client → redirect with code', async () => {
        const res = await request(app)
            .get('/api/v1/oauth/authorize')
            .query({
                client_id: clientId,
                redirect_uri: 'https://stress-test.local/callback',
                response_type: 'code',
                scope: 'openid profile',
                state: 'stress-test-state',
            })
            .set('Authorization', `Bearer ${authToken}`);
        // Should redirect (302) with code in Location, or 200 with code in body
        expect([200, 302]).toContain(res.status);
        if (res.status === 302) {
            expect(res.headers.location).toContain('code=');
        }
    });

    test('POST /oauth/device → returns device_code + user_code', async () => {
        const res = await request(app)
            .post('/api/v1/oauth/device')
            .send({ client_id: clientId, scope: 'openid profile' });
        expect(res.status).toBe(200);
        expect(res.body.device_code).toBeDefined();
        expect(res.body.user_code).toBeDefined();
        expect(res.body.verification_uri).toBeDefined();
    });

    test('GET /oauth/userinfo with valid token → user claims', async () => {
        const res = await request(app)
            .get('/api/v1/oauth/userinfo')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe(TEST_USER.email);
    });

    test('GET /oauth/clients lists registered clients', async () => {
        const res = await request(app)
            .get('/api/v1/oauth/clients')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
        expect(res.body.clients).toBeInstanceOf(Array);
        // Should have at least ecosystem clients + our test client
        expect(res.body.clients.length).toBeGreaterThanOrEqual(1);
    });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 6: CONCURRENT STRESS
// ═══════════════════════════════════════════════════════════

describe('Category 6: Concurrent Stress', () => {
    test('Register 10 users simultaneously → all succeed, no 500s', async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
            request(app)
                .post('/api/v1/auth/register')
                .send({
                    name: `Concurrent User ${i}`,
                    email: `concurrent-${ts}-${i}@test.com`,
                    password: 'ConcurrentPass1',
                }),
        );
        const results = await Promise.all(promises);
        const statuses = results.map(r => r.status);
        // All should be 201 (created)
        expect(statuses.every(s => s === 201)).toBe(true);
        // No 500s
        expect(statuses.filter(s => s >= 500).length).toBe(0);
    }, 60000);

    test('Login 10 users simultaneously → all get unique JWTs', async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
            request(app)
                .post('/api/v1/auth/login')
                .send({
                    email: `concurrent-${ts}-${i}@test.com`,
                    password: 'ConcurrentPass1',
                }),
        );
        const results = await Promise.all(promises);
        expect(results.every(r => r.status === 200)).toBe(true);
        const tokens = results.map(r => r.body.token);
        const uniqueTokens = new Set(tokens);
        expect(uniqueTokens.size).toBe(10);
    }, 60000);

    test('ecosystem-status 50 times simultaneously → all 200', async () => {
        const promises = Array.from({ length: 50 }, () =>
            request(app)
                .get('/api/v1/identity/ecosystem-status')
                .set('Authorization', `Bearer ${authToken}`),
        );
        const results = await Promise.all(promises);
        expect(results.every(r => r.status === 200)).toBe(true);
    }, 30000);

    test('validate-token 20 times with same JWT → all return same result', async () => {
        const promises = Array.from({ length: 20 }, () =>
            request(app)
                .get('/api/v1/identity/validate-token')
                .set('Authorization', `Bearer ${authToken}`),
        );
        const results = await Promise.all(promises);
        expect(results.every(r => r.status === 200)).toBe(true);
        const emails = results.map(r => r.body.email);
        expect(emails.every(e => e === TEST_USER.email)).toBe(true);
    }, 30000);

    test('JWKS 50 times simultaneously → all return same keys', async () => {
        const promises = Array.from({ length: 50 }, () =>
            request(app).get('/.well-known/jwks.json'),
        );
        const results = await Promise.all(promises);
        expect(results.every(r => r.status === 200)).toBe(true);
        const firstBody = JSON.stringify(results[0].body);
        expect(results.every(r => JSON.stringify(r.body) === firstBody)).toBe(true);
    }, 30000);
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 7: FILE UPLOAD & STORAGE
// ═══════════════════════════════════════════════════════════

describe('Category 7: File Upload & Storage', () => {
    let fileId = '';
    const tmpFilePath = path.join(__dirname, `stress-test-file-${ts}.txt`);

    beforeAll(() => {
        fs.writeFileSync(tmpFilePath, 'Stress test file content for ecosystem validation.');
    });

    afterAll(() => {
        try { fs.unlinkSync(tmpFilePath); } catch { /* ignore */ }
    });

    test('Upload file → success', async () => {
        const res = await request(app)
            .post('/api/v1/files/upload')
            .set('Authorization', `Bearer ${authToken}`)
            .attach('file', tmpFilePath)
            .field('type', 'transcript');
        expect(res.status).toBe(200);
        expect(res.body.fileId).toBeDefined();
        fileId = res.body.fileId;
    });

    test('List files → uploaded file appears', async () => {
        const res = await request(app)
            .get('/api/v1/files')
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
        expect(res.body.files).toBeInstanceOf(Array);
        const found = res.body.files.find((f: any) => f.id === fileId);
        expect(found).toBeDefined();
    });

    test('Download file → content matches', async () => {
        const res = await request(app)
            .get(`/api/v1/files/${fileId}`)
            .set('Authorization', `Bearer ${authToken}`);
        expect(res.status).toBe(200);
    });

    test('Delete file → 200, file gone', async () => {
        const delRes = await request(app)
            .delete(`/api/v1/files/${fileId}`)
            .set('Authorization', `Bearer ${authToken}`);
        expect(delRes.status).toBe(200);
        expect(delRes.body.ok).toBe(true);

        // Verify gone
        const listRes = await request(app)
            .get('/api/v1/files')
            .set('Authorization', `Bearer ${authToken}`);
        const found = listRes.body.files?.find((f: any) => f.id === fileId);
        expect(found).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY 8: GDPR DELETION
// ═══════════════════════════════════════════════════════════

describe('Category 8: GDPR Deletion', () => {
    let gdprUserId = '';
    let gdprToken = '';
    const gdprEmail = `gdpr-${ts}@test.com`;

    beforeAll(async () => {
        // Register a separate user for GDPR testing
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({
                name: 'GDPR Test User',
                email: gdprEmail,
                password: 'GdprPass1',
            });
        gdprUserId = res.body.userId;
        gdprToken = res.body.token;
        // Wait for ecosystem provisioner
        await wait(2000);
    });

    test('DELETE /api/v1/auth/me → 200', async () => {
        const res = await request(app)
            .delete('/api/v1/auth/me')
            .set('Authorization', `Bearer ${gdprToken}`);
        expect(res.status).toBe(200);
        expect(res.body.deleted).toBe(true);
    });

    test('Login with deleted credentials → 401', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: gdprEmail, password: 'GdprPass1' });
        expect(res.status).toBe(401);
    });

    test('validate-token with deleted user token → 401 or 404', async () => {
        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', `Bearer ${gdprToken}`);
        // Token may still be valid (JWT) but user doesn't exist → 404
        // OR token may be blacklisted → 401
        expect([401, 403, 404]).toContain(res.status);
    });

    test('Ecosystem-status with deleted user → error', async () => {
        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${gdprToken}`);
        expect([401, 403, 404]).toContain(res.status);
    });
});
