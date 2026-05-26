/**
 * GitHub OAuth ("Sign in with GitHub") consumer-side flow.
 *
 * Mocks GitHub's token + /user + /user/emails endpoints via fetch
 * monkey-patching. Covers:
 *   - 503 when env not configured
 *   - /start redirects to GitHub with correct params
 *   - /callback rejects on missing/forged state
 *   - /callback surfaces GitHub's `error` param to SPA fragment
 *   - /callback creates a new user when (provider,sub) is novel
 *   - /callback re-uses existing user when (provider,sub) matches
 *   - /callback links to existing email-based user when email is verified
 *   - /callback returns Windy JWT in fragment
 */
import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.GITHUB_OAUTH_CLIENT_ID = 'Iv1.test-github-client-id';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-github-client-secret';
process.env.GITHUB_OAUTH_REDIRECT_URI = 'http://localhost:8098/api/v1/auth/oauth/github/callback';
process.env.GITHUB_OAUTH_POST_LOGIN_REDIRECT = 'http://localhost:5173/auth/oauth/finish';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function mockGitHub(opts: {
    tokenStatus?: number;
    accessToken?: string;
    tokenError?: string;
    userStatus?: number;
    userBody?: any;
    emailsStatus?: number;
    emailsBody?: any;
}) {
    global.fetch = jest.fn(async (url: any) => {
        const u = String(url);
        if (u === GITHUB_TOKEN_URL) {
            const body = opts.tokenError
                ? { error: opts.tokenError }
                : { access_token: opts.accessToken ?? 'gho_mock-github-access-token' };
            return new Response(JSON.stringify(body), {
                status: opts.tokenStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (u === GITHUB_USER_URL) {
            return new Response(JSON.stringify(opts.userBody ?? {}), {
                status: opts.userStatus ?? 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (u === GITHUB_EMAILS_URL) {
            return new Response(JSON.stringify(opts.emailsBody ?? []), {
                status: opts.emailsStatus ?? 200,
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

function uniqueGithubEmail(label: string) {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@users.noreply.github.com`;
}

function uniqueGithubId(): number {
    return Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
}

describe('GitHub OAuth — /start', () => {
    test('redirects to GitHub with required OAuth params', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/github/start');
        expect(res.status).toBe(302);
        const loc = res.headers.location;
        expect(loc).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
        const url = new URL(loc);
        expect(url.searchParams.get('client_id')).toBe('Iv1.test-github-client-id');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8098/api/v1/auth/oauth/github/callback');
        expect(url.searchParams.get('scope')).toBe('read:user user:email');
        expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]+\.\d+\.[a-f0-9]+$/);
    });
});

describe('GitHub OAuth — /callback', () => {
    test('rejects when state is missing', async () => {
        const res = await request(app).get('/api/v1/auth/oauth/github/callback?code=abc');
        expect(res.status).toBe(400);
    });

    test('rejects when state signature is forged', async () => {
        const forged = `aaaa.${Date.now()}.deadbeef`;
        const res = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=abc&state=${forged}`);
        expect(res.status).toBe(400);
    });

    test('surfaces GitHub error param to SPA fragment', async () => {
        const res = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?error=access_denied&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=access_denied');
    });

    test('creates a new user when GitHub identity is novel', async () => {
        const email = uniqueGithubEmail('new');
        const githubId = uniqueGithubId();
        mockGitHub({
            userBody: { id: githubId, login: 'newgh', name: 'Brand New', email: null },
            emailsBody: [
                { email, primary: true, verified: true, visibility: 'private' },
            ],
        });

        const res = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=abc&state=${signValidState()}`);

        expect(res.status).toBe(302);
        const url = new URL(res.headers.location);
        expect(url.pathname).toBe('/auth/oauth/finish');
        const fragmentParams = new URLSearchParams(url.hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('1');
        expect(fragmentParams.get('email')).toBe(email);
        expect(fragmentParams.get('token')).toBeTruthy();
        expect(fragmentParams.get('refreshToken')).toBeTruthy();

        const row = getDb().prepare('SELECT email FROM users WHERE email = ?').get(email);
        expect(row).toBeTruthy();
        const link = getDb().prepare('SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?').get('github', String(githubId));
        expect(link).toBeTruthy();
    });

    test('re-uses existing user when (provider, github_id) matches a prior sign-in', async () => {
        const email = uniqueGithubEmail('repeat');
        const githubId = uniqueGithubId();
        mockGitHub({
            userBody: { id: githubId, login: 'repeatgh', name: 'Repeat User', email: null },
            emailsBody: [{ email, primary: true, verified: true, visibility: null }],
        });

        const first = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=abc&state=${signValidState()}`);
        const firstParams = new URLSearchParams(new URL(first.headers.location).hash.slice(1));
        const firstUserId = firstParams.get('userId');
        expect(firstParams.get('newUser')).toBe('1');

        // Second sign-in — same github_id, same email.
        mockGitHub({
            userBody: { id: githubId, login: 'repeatgh', name: 'Repeat User', email: null },
            emailsBody: [{ email, primary: true, verified: true, visibility: null }],
        });
        const second = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=def&state=${signValidState()}`);
        const secondParams = new URLSearchParams(new URL(second.headers.location).hash.slice(1));
        expect(secondParams.get('newUser')).toBe('0');
        expect(secondParams.get('userId')).toBe(firstUserId);
    });

    test('links to existing email-based user when email is verified', async () => {
        const email = uniqueGithubEmail('linked').toLowerCase();
        // Seed via the regular register path.
        const reg = await request(app).post('/api/v1/auth/register')
            .send({ name: 'Email First', email, password: 'StrongPass1A' });
        expect(reg.status).toBe(201);
        const existingUserId = reg.body.userId;

        const githubId = uniqueGithubId();
        mockGitHub({
            userBody: { id: githubId, login: 'linkedgh', name: 'GitHub Side', email: null },
            emailsBody: [{ email, primary: true, verified: true, visibility: null }],
        });

        const res = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=abc&state=${signValidState()}`);

        expect(res.status).toBe(302);
        const fragmentParams = new URLSearchParams(new URL(res.headers.location).hash.slice(1));
        expect(fragmentParams.get('newUser')).toBe('0');
        expect(fragmentParams.get('userId')).toBe(existingUserId);

        const link = getDb().prepare('SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?').get('github', String(githubId)) as any;
        expect(link).toBeTruthy();
        expect(link.user_id).toBe(existingUserId);
    });

    test('redirects to fragment error when GitHub returns no verified email', async () => {
        const githubId = uniqueGithubId();
        mockGitHub({
            userBody: { id: githubId, login: 'noemailgh', name: 'No Email', email: null },
            emailsBody: [{ email: 'unverified@example.com', primary: true, verified: false, visibility: null }],
        });
        // No verified emails at all → the helper's fallback uses the unverified
        // profile email but with emailVerified=false, so it gets created as a new
        // user (verification gated to FALSE). Re-mock without any email at all.
        mockGitHub({
            userBody: { id: githubId, login: 'noemailgh', name: 'No Email', email: null },
            emailsBody: [],
        });
        const res = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=abc&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=no_email');
    });

    test('redirects to fragment error when GitHub rejects the code', async () => {
        mockGitHub({ tokenStatus: 200, tokenError: 'bad_verification_code' });
        const res = await request(app)
            .get(`/api/v1/auth/oauth/github/callback?code=bad&state=${signValidState()}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('#error=bad_verification_code');
    });
});

describe('GitHub OAuth — unconfigured', () => {
    test('returns 503 when client id is blank', async () => {
        const originalId = process.env.GITHUB_OAUTH_CLIENT_ID;
        delete process.env.GITHUB_OAUTH_CLIENT_ID;
        jest.resetModules();
        const { app: bareApp } = require('../src/server');
        const res = await request(bareApp).get('/api/v1/auth/oauth/github/start');
        expect(res.status).toBe(503);
        process.env.GITHUB_OAUTH_CLIENT_ID = originalId;
        jest.resetModules();
    });
});
