/**
 * Apple OAuth ("Sign in with Apple") consumer-side flow.
 *
 * Apple's flow is harder to mock than Google/GitHub because:
 *   - client_secret is an ES256 JWT minted from our .p8 → we provide a
 *     real ES256 test key via APPLE_PRIVATE_KEY.
 *   - id_token is RS256-signed by Apple → we generate an ad-hoc RSA
 *     keypair, sign a fake id_token with it, and mock the JWKS endpoint
 *     to return our test public key.
 *   - Callback is POST form_post, not GET.
 *
 * Coverage:
 *   - 503 when env not configured
 *   - /start redirects to Apple with required params + response_mode=form_post
 *   - POST /callback rejects missing/forged state
 *   - POST /callback creates a new user on first auth (with `user` JSON)
 *   - POST /callback re-uses the same user on subsequent auth (sub-only)
 *   - POST /callback rejects invalid id_token
 */
import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// ─── Ad-hoc test keys ─────────────────────────────────────────────
// Generated per-test-run; never touch real Apple infra.
const APPLE_TEST_KID = 'test-apple-kid';
const APPLE_TEST_SERVICES_ID = 'ai.windyword.signin.test';
const APPLE_TEST_TEAM_ID = 'TEST00TEAM';
const APPLE_TEST_KEY_ID = 'TEST00KEY7';

// ES256 keypair — used for the (server-side) client_secret JWT to Apple.
const { privateKey: testES256Private, publicKey: testES256Public } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
});
const APPLE_TEST_PRIVATE_KEY_PEM = testES256Private.export({ type: 'pkcs8', format: 'pem' }) as string;
// Silence unused-key warning — we don't verify our own client_secret in this test.
void testES256Public;

// RSA keypair — stands in for Apple's id_token signing key.
const { privateKey: appleSimPrivate, publicKey: appleSimPublic } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
});
const appleSimPublicJwk = appleSimPublic.export({ format: 'jwk' }) as { n: string; e: string; kty: string };

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.APPLE_TEAM_ID = APPLE_TEST_TEAM_ID;
process.env.APPLE_SERVICES_ID = APPLE_TEST_SERVICES_ID;
process.env.APPLE_KEY_ID = APPLE_TEST_KEY_ID;
process.env.APPLE_PRIVATE_KEY = APPLE_TEST_PRIVATE_KEY_PEM;
process.env.APPLE_OAUTH_REDIRECT_URI = 'http://localhost:8098/api/v1/auth/oauth/apple/callback';
process.env.APPLE_OAUTH_POST_LOGIN_REDIRECT = 'http://localhost:5173/auth/oauth/finish';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_AUTH_URL_PREFIX = 'https://appleid.apple.com/auth/authorize';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function signFakeAppleIdToken(claims: Record<string, any>): string {
    return jwt.sign(claims, appleSimPrivate.export({ type: 'pkcs8', format: 'pem' }) as string, {
        algorithm: 'RS256',
        keyid: APPLE_TEST_KID,
    });
}

function mockApple(opts: {
    tokenStatus?: number;
    idTokenClaims?: Record<string, any>;
    skipIdToken?: boolean;
}) {
    const idToken = opts.skipIdToken
        ? undefined
        : signFakeAppleIdToken(opts.idTokenClaims ?? {
            sub: '001234.somefakeapplesub.0001',
            email: 'test@privaterelay.appleid.com',
            email_verified: 'true',
            is_private_email: 'true',
            iss: 'https://appleid.apple.com',
            aud: APPLE_TEST_SERVICES_ID,
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
        });

    global.fetch = jest.fn(async (url: any) => {
        const u = String(url);
        if (u === APPLE_TOKEN_URL) {
            return new Response(JSON.stringify({ id_token: idToken, access_token: 'mock-access' }), {
                status: opts.tokenStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (u === APPLE_JWKS_URL) {
            return new Response(JSON.stringify({
                keys: [{
                    kid: APPLE_TEST_KID,
                    kty: appleSimPublicJwk.kty,
                    use: 'sig',
                    alg: 'RS256',
                    n: appleSimPublicJwk.n,
                    e: appleSimPublicJwk.e,
                }],
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        throw new Error(`Unexpected fetch URL in test: ${u}`);
    }) as any;
}

function signValidState(secret = 'test-secret-for-jest'): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

function uniqueAppleSub(): string {
    return `001234.${crypto.randomBytes(8).toString('hex')}.${Date.now() % 10000}`;
}

function uniqueAppleEmail(label: string): string {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@privaterelay.appleid.com`;
}

describe('Apple OAuth — /start', () => {
    test('redirects to Apple with required OAuth params + form_post', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/apple/start');
        expect(res.status).toBe(302);
        const loc = res.headers.location;
        expect(loc.startsWith(APPLE_AUTH_URL_PREFIX)).toBe(true);
        const url = new URL(loc);
        expect(url.searchParams.get('client_id')).toBe(APPLE_TEST_SERVICES_ID);
        expect(url.searchParams.get('response_type')).toBe('code id_token');
        expect(url.searchParams.get('response_mode')).toBe('form_post');
        expect(url.searchParams.get('scope')).toBe('name email');
        expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]+\.\d+\.[a-f0-9]+$/);
    });
});

describe('Apple OAuth — POST /callback', () => {
    test('rejects when state is missing', async () => {
        const res = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({ code: 'abc' });
        expect(res.status).toBe(400);
    });

    test('rejects when state signature is forged', async () => {
        const forged = `aaaa.${Date.now()}.deadbeef`;
        const res = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({ code: 'abc', state: forged });
        expect(res.status).toBe(400);
    });

    test('creates a new user on first auth with `user` JSON', async () => {
        const sub = uniqueAppleSub();
        const email = uniqueAppleEmail('newapple');
        mockApple({
            idTokenClaims: {
                sub, email, email_verified: 'true', is_private_email: 'true',
                iss: 'https://appleid.apple.com', aud: APPLE_TEST_SERVICES_ID,
                exp: Math.floor(Date.now() / 1000) + 3600,
                iat: Math.floor(Date.now() / 1000),
            },
        });

        const res = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({
                code: 'abc',
                state: signValidState(),
                user: JSON.stringify({ name: { firstName: 'Apple', lastName: 'User' }, email }),
            });

        expect(res.status).toBe(302);
        const url = new URL(res.headers.location);
        expect(url.pathname).toBe('/auth/oauth/finish');
        const fragmentParams = new URLSearchParams(url.hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('1');
        expect(fragmentParams.get('email')).toBe(email.toLowerCase());
        expect(fragmentParams.get('name')).toBe('Apple User');

        const link = getDb().prepare('SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?').get('apple', sub);
        expect(link).toBeTruthy();
    });

    test('re-uses existing user on subsequent auth (no `user` JSON)', async () => {
        const sub = uniqueAppleSub();
        const email = uniqueAppleEmail('repeatapple');

        // First call.
        mockApple({
            idTokenClaims: {
                sub, email, email_verified: 'true',
                iss: 'https://appleid.apple.com', aud: APPLE_TEST_SERVICES_ID,
                exp: Math.floor(Date.now() / 1000) + 3600,
            },
        });
        const first = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({
                code: 'abc',
                state: signValidState(),
                user: JSON.stringify({ name: { firstName: 'First', lastName: 'Time' }, email }),
            });
        const firstUserId = new URLSearchParams(new URL(first.headers.location).hash.slice(1)).get('userId');

        // Second call — Apple omits email on subsequent logins. Linkage is sub-only.
        mockApple({
            idTokenClaims: {
                sub,
                iss: 'https://appleid.apple.com', aud: APPLE_TEST_SERVICES_ID,
                exp: Math.floor(Date.now() / 1000) + 3600,
            },
        });
        const second = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({ code: 'def', state: signValidState() });

        expect(second.status).toBe(302);
        const fragmentParams = new URLSearchParams(new URL(second.headers.location).hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('0');
        expect(fragmentParams.get('userId')).toBe(firstUserId);
    });

    test('rejects when id_token signature is invalid', async () => {
        // Sign with a DIFFERENT key — our mocked JWKS won't validate it.
        const { privateKey: otherPriv } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const badToken = jwt.sign(
            { sub: 'attack', iss: 'https://appleid.apple.com', aud: APPLE_TEST_SERVICES_ID, exp: Math.floor(Date.now() / 1000) + 3600 },
            otherPriv.export({ type: 'pkcs8', format: 'pem' }) as string,
            { algorithm: 'RS256', keyid: APPLE_TEST_KID },
        );

        global.fetch = jest.fn(async (url: any) => {
            const u = String(url);
            if (u === APPLE_TOKEN_URL) {
                return new Response(JSON.stringify({ id_token: badToken }), {
                    status: 200, headers: { 'Content-Type': 'application/json' },
                });
            }
            if (u === APPLE_JWKS_URL) {
                return new Response(JSON.stringify({
                    keys: [{
                        kid: APPLE_TEST_KID,
                        kty: appleSimPublicJwk.kty, use: 'sig', alg: 'RS256',
                        n: appleSimPublicJwk.n, e: appleSimPublicJwk.e,
                    }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            throw new Error(`Unexpected fetch: ${u}`);
        }) as any;

        const res = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({ code: 'bad', state: signValidState() });
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=invalid_id_token');
    });

    test('surfaces Apple error param to SPA fragment', async () => {
        const res = await request(app)
            .post('/api/v1/auth/oauth/apple/callback')
            .type('form')
            .send({ error: 'user_cancelled_authorize', state: signValidState() });
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=user_cancelled_authorize');
    });
});

describe('Apple OAuth — unconfigured', () => {
    test('returns 503 when team id is blank', async () => {
        const original = process.env.APPLE_TEAM_ID;
        delete process.env.APPLE_TEAM_ID;
        jest.resetModules();
        const { app: bareApp } = require('../src/server');
        const res = await request(bareApp).get('/api/v1/auth/oauth/apple/start');
        expect(res.status).toBe(503);
        process.env.APPLE_TEAM_ID = original;
        jest.resetModules();
    });
});
