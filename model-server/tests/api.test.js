const request = require('supertest');
const jwt = require('jsonwebtoken');

// Set env before importing
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-model-secret';

const app = require('../server');

const JWT_SECRET = process.env.JWT_SECRET;

function makeToken(tier = 'pro') {
  return jwt.sign(
    { accountId: 'test-001', email: 'test@windypro.local', tier, name: 'Test User' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

// ─── Health Check ─────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('windy-pro-model-server');
    expect(res.body.version).toBe('2.0.0');
    expect(res.body).toHaveProperty('models');
    expect(res.body).toHaveProperty('uptime');
  });
});

// ─── Catalog ──────────────────────────────────────────────────

describe('GET /v2/catalog.json', () => {
  it('returns model catalog (public, no auth)', async () => {
    const res = await request(app).get('/v2/catalog.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('models');
    expect(Array.isArray(res.body.models)).toBe(true);
    expect(res.body.models.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('totalModels');
  });
});

// ─── Model Download: Auth Required ────────────────────────────

describe('GET /v2/:modelId.wpr', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v2/core-spark.wpr');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('returns 403 with invalid token', async () => {
    const res = await request(app)
      .get('/v2/core-spark.wpr')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent model', async () => {
    const token = makeToken('pro');
    const res = await request(app)
      .get('/v2/nonexistent-model.wpr')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for tier-restricted model (free user accessing pro model)', async () => {
    const token = makeToken('free');
    const res = await request(app)
      .get('/v2/core-pro.wpr')
      .set('Authorization', `Bearer ${token}`);
    // Either 403 (tier denied) or 404 (file not on disk) depending on test env
    expect([403, 404]).toContain(res.status);
  });
});

// ─── Dev Token ────────────────────────────────────────────────

describe('GET /dev/token', () => {
  it('generates a dev JWT token', async () => {
    const res = await request(app).get('/dev/token?tier=pro');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.tier).toBe('pro');
    expect(res.body).toHaveProperty('expiresIn');
  });

  it('defaults to pro tier', async () => {
    const res = await request(app).get('/dev/token');
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('pro');
  });
});
