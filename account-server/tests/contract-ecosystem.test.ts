/**
 * Cross-service contract tests.
 *
 * Verifies that account-server API responses match the shapes
 * every other ecosystem service (Mail, Chat, Fly, etc.) expects.
 */
import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'contract-test-secret-32chars!!';
process.env.SYNAPSE_REGISTRATION_SECRET = 'contract-synapse-secret';
process.env.WINDYMAIL_API_URL = 'http://localhost:9401';
process.env.WINDYMAIL_SERVICE_TOKEN = 'contract-service-token';

import { app } from '../src/server';

// ─── Mock Mail Webhook Server ───────────────────────────────

const webhooksReceived: { body: any; headers: any }[] = [];

const mockMail = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        if (req.url === '/api/v1/webhooks/identity/created') {
            try { webhooksReceived.push({ body: JSON.parse(body), headers: req.headers }); } catch {}
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ email: 'test@windymail.ai', status: 'provisioned' }));
        } else { res.writeHead(404); res.end(); }
    });
});

beforeAll(() => new Promise<void>(resolve => mockMail.listen(9401, resolve)));
afterAll(() => new Promise<void>(resolve => mockMail.close(() => resolve())));

// ─── Helpers ────────────────────────────────────────────────

const ts = Date.now();

async function registerUser(suffix: string) {
    const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
            name: `Contract ${suffix}`,
            email: `contract-${suffix}-${ts}@test.com`,
            password: 'ContractPass1',
        });
    return res;
}

async function deleteUser(token: string) {
    await request(app).delete('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════
//  1. MAIL WEBHOOK CONTRACT
// ═══════════════════════════════════════════════════════════

describe('Contract 1: Mail webhook payload', () => {
    let token = '';

    afterAll(async () => { if (token) await deleteUser(token); });

    test('provisioner sends correct payload to WINDYMAIL_API_URL', async () => {
        const before = webhooksReceived.length;
        const res = await registerUser('mail');
        expect(res.status).toBe(201);
        token = res.body.token;

        // Wait for fire-and-forget provisioner
        await wait(3000);

        expect(webhooksReceived.length).toBeGreaterThan(before);
        const wh = webhooksReceived[webhooksReceived.length - 1];

        // Shape: { windy_identity_id, email, display_name, creator_name }
        expect(typeof wh.body.windy_identity_id).toBe('string');
        expect(wh.body.email).toMatch(/@/);
        expect(typeof wh.body.display_name).toBe('string');
        expect(wh.body.display_name.length).toBeGreaterThan(0);
        expect(typeof wh.body.creator_name).toBe('string');

        // windy_identity_id is a valid UUID
        expect(wh.body.windy_identity_id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        // X-Service-Token header sent
        expect(wh.headers['x-service-token']).toBe('contract-service-token');
    }, 15000);
});

// ═══════════════════════════════════════════════════════════
//  2. CHAT UNIFIED-LOGIN CONTRACT (JWT claims)
// ═══════════════════════════════════════════════════════════

describe('Contract 2: JWT claims for Chat unified-login', () => {
    let token = '';

    afterAll(async () => { if (token) await deleteUser(token); });

    test('JWT contains all claims Chat expects', async () => {
        const res = await registerUser('jwt');
        expect(res.status).toBe(201);
        token = res.body.token;

        const decoded = jwt.decode(token) as any;

        // Claims Chat's unified-login reads
        expect(decoded.userId).toBeDefined();
        expect(typeof decoded.userId).toBe('string');
        expect(decoded.email).toMatch(/@/);
        expect(decoded.tier).toBe('free');
        expect(decoded.type).toBe('human');
        expect(decoded.iss).toBe('windy-identity');
        expect(decoded.scopes).toBeInstanceOf(Array);
        expect(decoded.scopes).toContain('windy_pro:*');
        expect(decoded.products).toBeInstanceOf(Array);
        expect(decoded.products).toContain('windy_pro');

        // accountId matches userId (backward compat)
        expect(decoded.accountId).toBe(decoded.userId);

        // exp and iat present
        expect(typeof decoded.exp).toBe('number');
        expect(typeof decoded.iat).toBe('number');
    });
});

// ═══════════════════════════════════════════════════════════
//  3. JWKS CONTRACT
// ═══════════════════════════════════════════════════════════

describe('Contract 3: JWKS for cross-service token verification', () => {
    let token = '';

    afterAll(async () => { if (token) await deleteUser(token); });

    test('JWKS returns valid key set', async () => {
        const res = await request(app).get('/.well-known/jwks.json');
        expect(res.status).toBe(200);
        expect(res.body.keys).toBeInstanceOf(Array);

        if (res.body.keys.length > 0) {
            const key = res.body.keys[0];
            expect(key.kty).toBe('RSA');
            expect(key.alg).toBe('RS256');
            expect(key.use).toBe('sig');
            expect(typeof key.kid).toBe('string');
            expect(typeof key.n).toBe('string');
            expect(typeof key.e).toBe('string');
        }
    });

    test('JWT signed by server verifies against JWKS public key', async () => {
        const reg = await registerUser('jwks');
        expect(reg.status).toBe(201);
        token = reg.body.token;

        const jwksRes = await request(app).get('/.well-known/jwks.json');
        const keys = jwksRes.body.keys;

        if (keys.length > 0) {
            // Reconstruct public key from JWK
            const jwk = keys[0];
            const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
            const pem = pubKey.export({ type: 'spki', format: 'pem' }) as string;

            // Verify the token
            const decoded = jwt.verify(token, pem, { algorithms: ['RS256'] }) as any;
            expect(decoded.userId).toBeDefined();
            expect(decoded.email).toContain('contract-jwks');
        } else {
            // HS256 fallback — verify with JWT_SECRET
            const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;
            expect(decoded.userId).toBeDefined();
        }
    });
});

// ═══════════════════════════════════════════════════════════
//  4. ECOSYSTEM STATUS CONTRACT
// ═══════════════════════════════════════════════════════════

describe('Contract 4: Ecosystem status response shape', () => {
    let token = '';

    afterAll(async () => { if (token) await deleteUser(token); });

    test('returns all required products with correct shapes', async () => {
        const reg = await registerUser('eco');
        expect(reg.status).toBe(201);
        token = reg.body.token;
        await wait(2000);

        const res = await request(app)
            .get('/api/v1/identity/ecosystem-status')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);

        // Top-level fields
        expect(typeof res.body.windy_identity_id).toBe('string');
        expect(typeof res.body.email).toBe('string');
        expect(typeof res.body.tier).toBe('string');
        expect(typeof res.body.creator_name).toBe('string');

        // All products present
        const p = res.body.products;
        const requiredProducts = ['windy_word', 'windy_chat', 'windy_mail', 'windy_cloud', 'windy_fly', 'windy_clone', 'windy_traveler', 'eternitas'];
        for (const name of requiredProducts) {
            expect(p).toHaveProperty(name);
            expect(typeof p[name].status).toBe('string');
        }

        // windy_cloud has storage fields
        expect(typeof p.windy_cloud.storage_used).toBe('number');
        expect(typeof p.windy_cloud.storage_limit).toBe('number');
        expect(p.windy_cloud.storage_limit).toBe(500 * 1024 * 1024); // free tier

        // windy_word is always active
        expect(p.windy_word.status).toBe('active');

        // Tier is free for new user
        expect(res.body.tier).toBe('free');
    });
});

// ═══════════════════════════════════════════════════════════
//  5. CHAT PROVISION CONTRACT
// ═══════════════════════════════════════════════════════════

describe('Contract 5: Chat provision response shape', () => {
    let token = '';

    afterAll(async () => { if (token) await deleteUser(token); });

    test('provision returns Matrix credentials in expected format', async () => {
        const reg = await registerUser('chatprov');
        expect(reg.status).toBe(201);
        token = reg.body.token;

        const res = await request(app)
            .post('/api/v1/identity/chat/provision')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        // Accept 201 (dev stub) or 502 (no Synapse)
        expect([201, 502]).toContain(res.status);

        if (res.status === 201) {
            expect(res.body.success).toBe(true);
            expect(typeof res.body.creator_name).toBe('string');

            // Matrix credentials
            const m = res.body.matrix;
            expect(typeof m.matrixUserId).toBe('string');
            expect(typeof m.accessToken).toBe('string');
            expect(typeof m.deviceId).toBe('string');
            expect(typeof m.homeServer).toBe('string');

            // matrixUserId format: @windy_{localpart}:{server}
            expect(m.matrixUserId).toMatch(/^@windy_.+:.+$/);

            // SecureStore keys present (for mobile)
            expect(res.body.secureStoreKeys).toBeDefined();
            expect(res.body.secureStoreKeys.windy_matrix_token).toBe(m.accessToken);
            expect(res.body.secureStoreKeys.windy_matrix_user).toBe(m.matrixUserId);
        }
    });
});

// ═══════════════════════════════════════════════════════════
//  6. VALIDATE-TOKEN CONTRACT (cross-service auth)
// ═══════════════════════════════════════════════════════════

describe('Contract 6: validate-token for cross-service auth', () => {
    let token = '';
    let email = '';

    afterAll(async () => { if (token) await deleteUser(token); });

    test('valid token returns full identity claims', async () => {
        const reg = await registerUser('validate');
        expect(reg.status).toBe(201);
        token = reg.body.token;
        email = reg.body.email;

        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.email).toBe(email);
        expect(typeof res.body.windy_identity_id).toBe('string');
        expect(typeof res.body.tier).toBe('string');
        expect(typeof res.body.type).toBe('string');
        expect(res.body.scopes).toBeInstanceOf(Array);
        expect(res.body.products).toBeInstanceOf(Array);

        // Products have expected shape
        for (const p of res.body.products) {
            expect(typeof p.product).toBe('string');
            expect(typeof p.status).toBe('string');
        }
    });

    test('expired token returns 401', async () => {
        const expired = jwt.sign(
            { userId: 'fake', email: 'fake@test.com', tier: 'free', accountId: 'fake' },
            process.env.JWT_SECRET!,
            { algorithm: 'HS256', expiresIn: '-1s' },
        );
        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', `Bearer ${expired}`);
        expect(res.status).toBe(401);
    });

    test('invalid token returns 401 or 403', async () => {
        const res = await request(app)
            .get('/api/v1/identity/validate-token')
            .set('Authorization', 'Bearer invalid.garbage.token');
        expect([401, 403]).toContain(res.status);
    });

    test('no token returns 401', async () => {
        const res = await request(app).get('/api/v1/identity/validate-token');
        expect(res.status).toBe(401);
    });
});
