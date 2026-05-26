/**
 * Facebook OAuth ("Sign in with Facebook") consumer-side flow.
 *
 * Coverage:
 *   - 503 when env not configured
 *   - /start redirects to FB with correct params
 *   - /callback rejects missing/forged state
 *   - /callback creates a new user when FB returns email
 *   - /callback redirects to #error=no_email when FB withholds email
 *   - /callback surfaces FB error param to fragment
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.FACEBOOK_OAUTH_CLIENT_ID = '1234567890123456';
process.env.FACEBOOK_OAUTH_CLIENT_SECRET = 'test-fb-secret';
process.env.FACEBOOK_OAUTH_REDIRECT_URI = 'http://localhost:8098/api/v1/auth/oauth/facebook/callback';
process.env.FACEBOOK_OAUTH_POST_LOGIN_REDIRECT = 'http://localhost:5173/auth/oauth/finish';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

const FB_API_VERSION = 'v19.0';
const FB_TOKEN_URL = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`;
const FB_USER_URL = `https://graph.facebook.com/${FB_API_VERSION}/me`;
const FB_AUTH_URL_PREFIX = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`;

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function mockFacebook(opts: {
    tokenStatus?: number;
    accessToken?: string;
    userStatus?: number;
    userBody?: any;
}) {
    global.fetch = jest.fn(async (url: any) => {
        const u = String(url).split('?')[0];   // strip query for matching
        if (u === FB_TOKEN_URL) {
            return new Response(JSON.stringify({ access_token: opts.accessToken ?? 'EAAfaketoken' }), {
                status: opts.tokenStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (u === FB_USER_URL) {
            return new Response(JSON.stringify(opts.userBody ?? {}), {
                status: opts.userStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        throw new Error(`Unexpected fetch URL in test: ${String(url)}`);
    }) as any;
}

function signValidState(secret = 'test-secret-for-jest'): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

function uniqueFbId(): string {
    return String(Math.floor(Math.random() * 1_000_000_000_000) + 1_000_000_000);
}

function uniqueFbEmail(label: string): string {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@facebook-test.com`;
}

describe('Facebook OAuth — /start', () => {
    test('redirects to Facebook with required OAuth params', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/facebook/start');
        expect(res.status).toBe(302);
        const loc = res.headers.location;
        expect(loc.startsWith(FB_AUTH_URL_PREFIX)).toBe(true);
        const url = new URL(loc);
        expect(url.searchParams.get('client_id')).toBe('1234567890123456');
        expect(url.searchParams.get('scope')).toBe('email,public_profile');
        expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]+\.\d+\.[a-f0-9]+$/);
    });
});

describe('Facebook OAuth — /callback', () => {
    test('rejects when state is missing', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/facebook/callback?code=abc');
        expect(res.status).toBe(400);
    });

    test('rejects when state signature is forged', async () => {
        const forged = `aaaa.${Date.now()}.deadbeef`;
        const res = await request(app)
            .get(`/api/v1/auth/oauth/facebook/callback?code=abc&state=${forged}`);
        expect(res.status).toBe(400);
    });

    test('creates a new user when FB returns email', async () => {
        const email = uniqueFbEmail('newfb');
        const fbId = uniqueFbId();
        mockFacebook({ userBody: { id: fbId, name: 'Facebook User', email } });

        const res = await request(app)
            .get(`/api/v1/auth/oauth/facebook/callback?code=abc&state=${signValidState()}`);

        expect(res.status).toBe(302);
        const url = new URL(res.headers.location);
        expect(url.pathname).toBe('/auth/oauth/finish');
        const fragmentParams = new URLSearchParams(url.hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('1');
        expect(fragmentParams.get('email')).toBe(email.toLowerCase());

        const link = getDb().prepare('SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?').get('facebook', fbId);
        expect(link).toBeTruthy();
    });

    test('redirects to #error=no_email when FB withholds email', async () => {
        const fbId = uniqueFbId();
        mockFacebook({ userBody: { id: fbId, name: 'No Email User' /* no email field */ } });

        const res = await request(app)
            .get(`/api/v1/auth/oauth/facebook/callback?code=abc&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=no_email');
    });

    test('surfaces Facebook error param to fragment', async () => {
        const res = await request(app)
            .get(`/api/v1/auth/oauth/facebook/callback?error=access_denied&error_reason=user_denied&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=user_denied');
    });

    test('redirects to fragment error when FB token endpoint 400s', async () => {
        mockFacebook({ tokenStatus: 400 });
        const res = await request(app)
            .get(`/api/v1/auth/oauth/facebook/callback?code=bad&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=token_exchange_failed');
    });
});

describe('Facebook OAuth — unconfigured', () => {
    test('returns 503 when client id is blank', async () => {
        const original = process.env.FACEBOOK_OAUTH_CLIENT_ID;
        delete process.env.FACEBOOK_OAUTH_CLIENT_ID;
        jest.resetModules();
        const { app: bareApp } = require('../src/server');
        const res = await request(bareApp).get('/api/v1/auth/oauth/facebook/start');
        expect(res.status).toBe(503);
        process.env.FACEBOOK_OAUTH_CLIENT_ID = original;
        jest.resetModules();
    });
});
