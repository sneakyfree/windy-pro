/**
 * POST /api/v1/oauth/register-client — ecosystem service registration.
 *
 * SECURITY (2026-07-19): this endpoint is now ADMIN ONLY. It mints a
 * FIRST-PARTY client (which skips user consent in the authorize flow), so an
 * unauthenticated version let anyone self-enroll a look-alike client with an
 * attacker redirect_uri and phish tokens. These tests pin the guard: 401
 * without a token, 403 for a non-admin, 201 for an admin — plus the original
 * validation/duplicate/storage behavior, now behind admin auth.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-register-client';
process.env.PORT = '0';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(30000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function makeToken(opts: { admin: boolean }): Promise<string> {
  const email = uniqueEmail(opts.admin ? 'rc-admin' : 'rc-user');
  const reg = await request(app).post('/api/v1/auth/register')
    .send({ name: 'RC Test', email, password: 'SecurePass1' });
  expect(reg.status).toBe(201);
  const db = getDb();
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(reg.body.userId);
  if (opts.admin) {
    // Set BOTH columns so the test passes independently of the RBAC-unify PR
    // (whether adminOnly reads role or admin_role).
    db.prepare("UPDATE users SET role = 'admin', admin_role = 'super_admin' WHERE id = ?").run(reg.body.userId);
  }
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'SecurePass1' });
  expect(login.status).toBe(200);
  return login.body.token || login.body.accessToken;
}

describe('POST /api/v1/oauth/register-client — admin only', () => {
  const validPayload = {
    client_id: 'test_service',
    client_name: 'Test Service',
    redirect_uris: ['https://test.example.com/callback'],
    allowed_scopes: ['test:*'],
    client_secret: 'super-secret-key-12345',
  };
  let adminToken = '';
  let userToken = '';

  beforeAll(async () => {
    adminToken = await makeToken({ admin: true });
    userToken = await makeToken({ admin: false });
  });

  afterAll(() => {
    const db = getDb();
    for (const id of ['test_service', 'test_dup', 'unique_1', 'unique_2', 'unique_3', 'unique_4']) {
      try { db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(id); } catch {}
    }
  });

  // ── The guard ──
  it('rejects an unauthenticated request (401)', async () => {
    await request(app).post('/api/v1/oauth/register-client').send(validPayload).expect(401);
  });

  it('rejects a non-admin token (403)', async () => {
    await request(app)
      .post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ...validPayload, client_id: 'test_dup' })
      .expect(403);
  });

  it('does NOT create the client when a non-admin is rejected', () => {
    const db = getDb();
    const row = db.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get('test_dup');
    expect(row).toBeUndefined();
  });

  // ── Happy path (admin) ──
  it('registers a new ecosystem client for an admin (201)', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload)
      .expect(201);

    expect(res.body.client_id).toBe('test_service');
    expect(res.body.client_name).toBe('Test Service');
    expect(res.body.redirect_uris).toEqual(['https://test.example.com/callback']);
    expect(res.body.allowed_scopes).toEqual(['test:*']);
    expect(res.body.registered).toBe(true);
  });

  it('rejects duplicate client_id (409)', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validPayload)
      .expect(409);
    expect(res.body.error).toMatch(/already registered/);
  });

  // ── Validation (still enforced, behind admin auth) ──
  it('rejects missing client_id (400)', async () => {
    const { client_id, ...rest } = validPayload;
    await request(app).post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`).send(rest).expect(400);
  });

  it('rejects missing client_name (400)', async () => {
    const { client_name, ...rest } = validPayload;
    await request(app).post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`).send({ ...rest, client_id: 'unique_1' }).expect(400);
  });

  it('rejects empty redirect_uris (400)', async () => {
    await request(app).post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validPayload, client_id: 'unique_2', redirect_uris: [] }).expect(400);
  });

  it('rejects missing allowed_scopes (400)', async () => {
    const { allowed_scopes, ...rest } = validPayload;
    await request(app).post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`).send({ ...rest, client_id: 'unique_3' }).expect(400);
  });

  it('rejects missing client_secret (400)', async () => {
    const { client_secret, ...rest } = validPayload;
    await request(app).post('/api/v1/oauth/register-client')
      .set('Authorization', `Bearer ${adminToken}`).send({ ...rest, client_id: 'unique_4' }).expect(400);
  });

  it('stores the client with a hashed secret and records the owner', async () => {
    const db = getDb();
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get('test_service') as any;
    expect(client).toBeDefined();
    expect(client.name).toBe('Test Service');
    expect(client.client_secret_hash).toBeTruthy();
    expect(client.client_secret_hash).not.toBe(validPayload.client_secret);
    expect(JSON.parse(client.redirect_uris)).toEqual(['https://test.example.com/callback']);
    expect(JSON.parse(client.allowed_scopes)).toEqual(['test:*']);
    expect(client.is_first_party).toBe(1);
    expect(client.owner_identity_id).toBeTruthy(); // now attributed to the admin
  });
});

describe('Ecosystem client seeding', () => {
  const expectedClients = ['windy_chat', 'windy_mail', 'eternitas', 'windy_fly'];

  for (const clientId of expectedClients) {
    it(`${clientId} exists as a first-party client with scopes`, () => {
      const db = getDb();
      const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as any;
      expect(client).toBeDefined();
      expect(client.is_first_party).toBe(1);
      const scopes: string[] = JSON.parse(client.allowed_scopes);
      expect(scopes.length).toBeGreaterThan(0);
    });
  }

  it('seedEcosystemClients is idempotent', () => {
    const { seedEcosystemClients } = require('../src/routes/oauth');
    const db = getDb();
    const countBefore = (db.prepare('SELECT COUNT(*) as c FROM oauth_clients WHERE client_id IN (?, ?, ?, ?)').get(
      'windy_chat', 'windy_mail', 'eternitas', 'windy_fly',
    ) as any).c;
    seedEcosystemClients();
    const countAfter = (db.prepare('SELECT COUNT(*) as c FROM oauth_clients WHERE client_id IN (?, ?, ?, ?)').get(
      'windy_chat', 'windy_mail', 'eternitas', 'windy_fly',
    ) as any).c;
    expect(countAfter).toBe(countBefore);
  });
});
