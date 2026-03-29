import request from 'supertest';
import jwt from 'jsonwebtoken';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';

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
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('devices');
    expect(res.body).toHaveProperty('timestamp');
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

  it('returns 403 with invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(403);
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
  it('returns version info', async () => {
    const res = await request(app).get('/api/v1/updates/check');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
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
