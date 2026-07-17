import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';

// POST /api/v1/auth/handoff — the tile-handoff credential mint.
//
// The dashboard calls this with its Bearer access token and passes the
// returned {token, refreshToken} to a sibling app in a URL fragment. The
// invariants under test:
//   1. an authenticated caller gets a fresh, working pair
//   2. the handoff refresh token is single-use (rotates on /auth/refresh)
//   3. minting does NOT evict the caller's own refresh token (the
//      generateTokens delete-before-insert trap)
//   4. unauthenticated calls are rejected

const TEST_USER = {
    name: 'Handoff Tester',
    email: `handoff-test-${Date.now()}@example.com`,
    password: 'SecurePass1',
    deviceId: 'handoff-test-device',
    deviceName: 'Jest Handoff Device',
    platform: 'test',
};

let accessToken: string;
let loginRefreshToken: string;

beforeAll(async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
    expect(res.status).toBe(201);
    accessToken = res.body.token;
    loginRefreshToken = res.body.refreshToken;
});

describe('POST /api/v1/auth/handoff', () => {
    it('rejects an unauthenticated call', async () => {
        const res = await request(app).post('/api/v1/auth/handoff');
        expect(res.status).toBe(401);
    });

    it('mints a fresh pair, keeps the caller session intact, and rotates single-use', async () => {
        const mint = await request(app)
            .post('/api/v1/auth/handoff')
            .set('Authorization', `Bearer ${accessToken}`);
        expect(mint.status).toBe(200);
        expect(mint.body).toHaveProperty('token');
        expect(mint.body).toHaveProperty('refreshToken');
        expect(mint.body.refreshToken).not.toBe(loginRefreshToken);

        // The minted access token works as a Bearer credential.
        const me = await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${mint.body.token}`);
        expect(me.status).toBe(200);
        expect(me.body.email).toBe(TEST_USER.email);

        // The handoff refresh token refreshes… once.
        const first = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: mint.body.refreshToken });
        expect(first.status).toBe(200);
        expect(first.body).toHaveProperty('token');
        expect(first.body).toHaveProperty('refreshToken');

        // …and is dead on the second use (single-use rotation).
        const replay = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: mint.body.refreshToken });
        expect(replay.status).toBe(401);

        // The rotated replacement keeps the chain alive.
        const second = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: first.body.refreshToken });
        expect(second.status).toBe(200);

        // CRITICAL: the caller's own login refresh token still works — the
        // handoff mint must not have evicted the dashboard's session row.
        const caller = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: loginRefreshToken, deviceId: TEST_USER.deviceId });
        expect(caller.status).toBe(200);
    });

    it('two mints coexist (parallel tile clicks get independent families)', async () => {
        // Re-authenticate: earlier test rotated the original login token.
        const login = await request(app).post('/api/v1/auth/login').send({
            email: TEST_USER.email,
            password: TEST_USER.password,
            deviceId: TEST_USER.deviceId,
        });
        expect(login.status).toBe(200);
        const jwt = login.body.token;

        const a = await request(app).post('/api/v1/auth/handoff').set('Authorization', `Bearer ${jwt}`);
        const b = await request(app).post('/api/v1/auth/handoff').set('Authorization', `Bearer ${jwt}`);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);

        // Both refresh independently — the second mint didn't evict the first.
        const ra = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: a.body.refreshToken });
        const rb = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: b.body.refreshToken });
        expect(ra.status).toBe(200);
        expect(rb.status).toBe(200);
    });
});
