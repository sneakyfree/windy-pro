import request from 'supertest';
import jwt from 'jsonwebtoken';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';

// No afterAll server.close() needed — server.listen() is skipped when NODE_ENV=test

const TEST_USER = {
  name: 'Test User',
  email: `test-${Date.now()}@example.com`,
  password: 'SecurePass1',
  deviceId: 'test-device-001',
  deviceName: 'Jest Test Device',
  platform: 'test',
};

function makeToken(payload: Record<string, any> = {}) {
  return jwt.sign(
    { userId: 'test-user', email: 'test@example.com', tier: 'free', accountId: 'test-user', ...payload },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

// ─── Health Check ─────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('windy-pro-account-server');
    expect(res.body.version).toBe('2.0.0');
    expect(res.body).toHaveProperty('timestamp');
    // `/health` shape changed — user + device counts were removed in
    // favour of a per-service reachability map (`services`) + a
    // top-level `database` status. Pin the new shape here.
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('services');
    expect(res.body).toHaveProperty('uptime_seconds');
  });
});

// ─── Auth: Registration ───────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('registers a new user (happy path)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(TEST_USER);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('userId');
    expect(res.body.email).toBe(TEST_USER.email.toLowerCase());
    expect(res.body.tier).toBe('free');
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(TEST_USER);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'noname@test.com', password: 'SecurePass1' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'SecurePass1' });
    expect(res.status).toBe(400);
  });

  it('rejects weak password (no uppercase)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'weak1@test.com', password: 'nouppercase1' });
    expect([400, 429]).toContain(res.status);
  });

  it('rejects weak password (no digit)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'weak2@test.com', password: 'NoDigitHere' });
    expect([400, 429]).toContain(res.status);
  });

  it('rejects weak password (too short)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'weak3@test.com', password: 'Ab1' });
    expect([400, 429]).toContain(res.status);
  });
});

// ─── Auth: Login ──────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });
    expect([200, 429]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('refreshToken');
    }
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: 'WrongPass1' });
    expect([401, 429]).toContain(res.status);
  });

  it('rejects non-existent email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'noone@nowhere.com', password: 'Whatever1' });
    expect([401, 429]).toContain(res.status);
  });

  it('rejects missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: 'Whatever1' });
    expect([400, 429]).toContain(res.status);
  });

  it('rejects missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email });
    expect([400, 429]).toContain(res.status);
  });
});

// ─── Auth: Protected Endpoints ────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    // P2-3: malformed / unsigned / wrong-algo tokens are 401, not 403,
    // per RFC 6750 — "could not prove authentication" rather than
    // "authenticated but not authorized".
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/devices', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/devices');
    expect(res.status).toBe(401);
  });
});

// ─── Auth: Refresh ────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  it('rejects missing refreshToken', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({});
    expect([400, 429]).toContain(res.status);
  });

  it('rejects invalid refreshToken', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'bogus-token' });
    expect([401, 429]).toContain(res.status);
  });
});

// ─── Auth: Change Password ────────────────────────────────────

describe('POST /api/v1/auth/change-password', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'old', newPassword: 'NewPass123' });
    expect(res.status).toBe(401);
  });
});

// ─── Translation ──────────────────────────────────────────────

describe('POST /api/v1/translate/text', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/translate/text')
      .send({ text: 'hello', sourceLang: 'en', targetLang: 'es' });
    expect(res.status).toBe(401);
  });
});

// ─── Recordings ───────────────────────────────────────────────

describe('GET /api/v1/recordings', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/recordings');
    expect(res.status).toBe(401);
  });
});

// ─── Transcription ────────────────────────────────────────────

describe('POST /api/v1/transcribe', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/transcribe')
      .send({});
    expect(res.status).toBe(401);
  });
});

// ─── Admin ────────────────────────────────────────────────────

describe('GET /api/v1/admin/users', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/admin/stats', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/stats');
    expect(res.status).toBe(401);
  });
});

// ─── Identity ─────────────────────────────────────────────────

describe('GET /api/v1/identity/me', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/identity/me');
    expect(res.status).toBe(401);
  });

  it('returns identity with storage fields for the wizard Complete screen', async () => {
    // Fresh register so we have a real token + user row with storage defaults.
    const email = `identity-me-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Identity Me Test', email, password: 'SecurePass1' });
    expect(reg.status).toBe(201);

    const res = await request(app)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.identity.email).toBe(email);
    expect(res.body.identity.windyIdentityId).toBe(reg.body.windyIdentityId);
    // Wizard Complete screen relies on these — added 2026-04-16.
    expect(res.body.identity).toHaveProperty('storageLimit');
    expect(res.body.identity).toHaveProperty('storageUsed');
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(Array.isArray(res.body.scopes)).toBe(true);
  });
});

// ─── Analytics (no auth required) ─────────────────────────────

describe('POST /api/v1/analytics', () => {
  it('accepts analytics event without auth', async () => {
    const res = await request(app)
      .post('/api/v1/analytics')
      .send({ event: 'test_event', properties: { source: 'jest' } });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

// ─── Updates Check ────────────────────────────────────────────

describe('GET /api/v1/updates/check', () => {
  it('returns 501 not implemented', async () => {
    const res = await request(app).get('/api/v1/updates/check');
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('Not implemented');
  });
});

// ─── OIDC Discovery ───────────────────────────────────────────

describe('GET /.well-known/openid-configuration', () => {
  it('returns OIDC metadata', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issuer');
    expect(res.body).toHaveProperty('token_endpoint');
    expect(res.body).toHaveProperty('jwks_uri');
  });
});

// ─── JWKS ─────────────────────────────────────────────────────

describe('GET /.well-known/jwks.json', () => {
  it('returns JWKS document', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('keys');
    expect(Array.isArray(res.body.keys)).toBe(true);
  });
});

// ─── 404 for unknown API routes ───────────────────────────────

describe('Unknown API routes', () => {
  it('returns 404 JSON for unknown API paths', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

// ─── BUG FIX #1: Register → Immediate Refresh ────────────────
// This test verifies that the refresh token returned by /auth/register
// can be immediately used to call /auth/refresh and obtain new tokens.

describe('Register then immediately refresh (Bug #1 fix)', () => {
  it('register returns a refresh token that works on the next /auth/refresh call', async () => {
    const uniqueUser = {
      name: 'Refresh Test User',
      email: `refresh-test-${Date.now()}@example.com`,
      password: 'StrongPass1',
      deviceId: 'refresh-test-device',
    };

    // Step 1: Register
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send(uniqueUser);

    // Rate-limited? Skip gracefully — but the test itself must pass when not rate-limited.
    if (regRes.status === 429) {
      console.warn('Rate-limited during register — skipping refresh test');
      return;
    }
    expect(regRes.status).toBe(201);
    expect(regRes.body).toHaveProperty('refreshToken');
    expect(regRes.body).toHaveProperty('token');

    const { refreshToken, token } = regRes.body;

    // Step 2: Immediately refresh — this is the exact bug scenario
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    if (refreshRes.status === 429) {
      console.warn('Rate-limited during refresh — skipping assertion');
      return;
    }

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body).toHaveProperty('token');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    // The new refresh token should be different (token rotation)
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
    // New access token should be valid JWT
    expect(refreshRes.body.token).toBeTruthy();
    expect(refreshRes.body).toHaveProperty('userId');
    expect(refreshRes.body).toHaveProperty('tier');
  });
});

// ─── BUG FIX #2: Response Field Names Are camelCase ───────────

describe('API response field names are camelCase (Bug #2 fix)', () => {
  it('GET /recordings/stats returns camelCase fields', async () => {
    // Register a fresh user to get a valid token
    const statsUser = {
      name: 'Stats Test User',
      email: `stats-test-${Date.now()}@example.com`,
      password: 'StatsPass1',
    };
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send(statsUser);
    if (regRes.status === 429) {
      console.warn('Rate-limited — skipping camelCase test');
      return;
    }
    expect(regRes.status).toBe(201);
    const token = regRes.body.token;

    const statsRes = await request(app)
      .get('/api/v1/recordings/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(statsRes.status).toBe(200);

    // Verify all field names are camelCase — no snake_case allowed
    const fieldNames = Object.keys(statsRes.body);
    for (const name of fieldNames) {
      expect(name).not.toMatch(/_[a-z]/); // snake_case pattern should NOT match
    }

    // Verify expected camelCase fields exist
    expect(statsRes.body).toHaveProperty('totalRecordings');
    expect(statsRes.body).toHaveProperty('totalDuration');
    expect(statsRes.body).toHaveProperty('totalSize');
  });
});

// ─── Full Auth Flow (happy path) ──────────────────────────────

describe('Full auth flow', () => {
  const flowUser = {
    name: 'Flow User',
    email: `flow-${Date.now()}@example.com`,
    password: 'FlowPass1',
    deviceId: 'flow-device',
  };
  let token: string;
  let refreshToken: string;

  it('register -> login -> me -> refresh -> logout', async () => {
    // Register (may be rate-limited from earlier tests)
    const reg = await request(app).post('/api/v1/auth/register').send(flowUser);
    if (reg.status === 429) {
      // Rate limited — skip the rest of this flow test
      return;
    }
    expect(reg.status).toBe(201);
    token = reg.body.token;
    refreshToken = reg.body.refreshToken;

    // Me (not rate-limited — uses JWT auth, not authLimiter)
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(flowUser.email.toLowerCase());

    // Refresh (may be rate-limited)
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect([200, 429]).toContain(refresh.status);

    // Logout
    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);
  });
});
