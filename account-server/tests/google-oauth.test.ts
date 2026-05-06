/**
 * Google OAuth ("Sign in with Google") consumer-side flow.
 *
 * Mocks Google's token + userinfo endpoints via fetch monkey-patching so
 * the test stays hermetic. Covers:
 *   - 503 when env not configured
 *   - /start redirects to Google with correct params
 *   - /callback rejects on missing/forged state
 *   - /callback surfaces Google's `error` param to SPA fragment
 *   - /callback creates a new user when email is novel
 *   - /callback re-uses an existing user when email matches
 *   - /callback returns Windy JWT in fragment
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:8098/api/v1/auth/oauth/google/callback';
process.env.GOOGLE_OAUTH_POST_LOGIN_REDIRECT = 'http://localhost:5173/auth/google/finish';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function mockGoogle(opts: {
    tokenStatus?: number;
    accessToken?: string;
    userStatus?: number;
    userBody?: any;
}) {
    global.fetch = jest.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u === GOOGLE_TOKEN_URL) {
            return new Response(
                JSON.stringify({ access_token: opts.accessToken ?? 'mock-google-access-token' }),
                { status: opts.tokenStatus ?? 200, headers: { 'Content-Type': 'application/json' } },
            );
        }
        if (u === GOOGLE_USERINFO_URL) {
            return new Response(
                JSON.stringify(opts.userBody ?? {}),
                { status: opts.userStatus ?? 200, headers: { 'Content-Type': 'application/json' } },
            );
        }
        throw new Error(`Unexpected fetch URL in test: ${u}`);
    }) as any;
}

// Re-derive the same HMAC the route uses, so we can craft a valid `state`
// for callback tests without driving the /start endpoint first.
function signValidState(secret = 'test-secret-for-jest'): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

function uniqueGoogleEmail(label: string) {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@gmail.com`;
}

describe('Google OAuth — /start', () => {
    test('redirects to Google with required OAuth params', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/google/start');
        expect(res.status).toBe(302);
        const loc = res.headers.location;
        expect(loc).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
        const url = new URL(loc);
        expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8098/api/v1/auth/oauth/google/callback');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('scope')).toBe('openid email profile');
        expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]+\.\d+\.[a-f0-9]+$/);
    });
});

describe('Google OAuth — /callback', () => {
    test('rejects when state is missing', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/google/callback?code=abc');
        expect(res.status).toBe(400);
    });

    test('rejects when state signature is forged', async () => {
        const forged = `aaaa.${Date.now()}.deadbeef`;
        const res = await request(app)
            .get(`/api/v1/auth/oauth/google/callback?code=abc&state=${forged}`);
        expect(res.status).toBe(400);
    });

    test('surfaces Google error param to SPA fragment', async () => {
        const res = await request(app)
            .get(`/api/v1/auth/oauth/google/callback?error=access_denied&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=access_denied');
    });

    test('creates a new user when Google email is novel', async () => {
        const email = uniqueGoogleEmail('newuser');
        mockGoogle({ userBody: { sub: '12345', email, name: 'Brand New', email_verified: true } });

        const res = await request(app)
            .get(`/api/v1/auth/oauth/google/callback?code=abc&state=${signValidState()}`);

        expect(res.status).toBe(302);
        const url = new URL(res.headers.location);
        expect(url.pathname).toBe('/auth/google/finish');
        const fragmentParams = new URLSearchParams(url.hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('1');
        expect(fragmentParams.get('email')).toBe(email);
        expect(fragmentParams.get('token')).toBeTruthy();
        expect(fragmentParams.get('refreshToken')).toBeTruthy();

        // User row landed
        const row = getDb().prepare('SELECT email FROM users WHERE email = ?').get(email);
        expect(row).toBeTruthy();
    });

    test('re-uses an existing user when email matches', async () => {
        const email = uniqueGoogleEmail('existing');
        // Seed a user via the regular register path.
        const reg = await request(app).post('/api/v1/auth/register')
            .send({ name: 'Existing User', email, password: 'StrongPass1A' });
        expect(reg.status).toBe(201);
        const existingUserId = reg.body.userId;

        mockGoogle({ userBody: { sub: '99999', email, name: 'Google Display', email_verified: true } });

        const res = await request(app)
            .get(`/api/v1/auth/oauth/google/callback?code=abc&state=${signValidState()}`);

        expect(res.status).toBe(302);
        const fragmentParams = new URLSearchParams(new URL(res.headers.location).hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('0');
        expect(fragmentParams.get('userId')).toBe(existingUserId);
    });

    test('redirects to fragment error when Google rejects the code', async () => {
        mockGoogle({ tokenStatus: 400 });
        const res = await request(app)
            .get(`/api/v1/auth/oauth/google/callback?code=bad&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=token_exchange_failed');
    });

    test('redirects to fragment error when userinfo has no email', async () => {
        mockGoogle({ userBody: { sub: '12345' } /* email missing */ });
        const res = await request(app)
            .get(`/api/v1/auth/oauth/google/callback?code=abc&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=no_email');
    });
});

describe('Google OAuth — unconfigured', () => {
    test('returns 503 when client id is blank', async () => {
        // Spin up a second app instance with the env unset to test the gate
        // without trampling on the rest of this suite's config.
        const originalId = process.env.GOOGLE_OAUTH_CLIENT_ID;
        delete process.env.GOOGLE_OAUTH_CLIENT_ID;
        jest.resetModules();
        const { app: bareApp } = require('../src/server');
        const res = await request(bareApp).get('/api/v1/auth/oauth/google/start');
        expect(res.status).toBe(503);
        process.env.GOOGLE_OAUTH_CLIENT_ID = originalId;
        jest.resetModules();
    });
});
