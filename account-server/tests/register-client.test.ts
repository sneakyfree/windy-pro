/**
 * Tests for POST /api/v1/oauth/register-client — ecosystem service registration.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-register-client';
process.env.PORT = '0'; // Random available port

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

describe('POST /api/v1/oauth/register-client', () => {
  const validPayload = {
    client_id: 'test_service',
    client_name: 'Test Service',
    redirect_uris: ['https://test.example.com/callback'],
    allowed_scopes: ['test:*'],
    client_secret: 'super-secret-key-12345',
  };

  afterAll(() => {
    // Clean up test client
    const db = getDb();
    try { db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run('test_service'); } catch {}
    try { db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run('test_dup'); } catch {}
  });

  it('registers a new ecosystem client (201)', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/register-client')
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
      .send(validPayload)
      .expect(409);

    expect(res.body.error).toMatch(/already registered/);
  });

  it('rejects missing client_id (400)', async () => {
    const { client_id, ...rest } = validPayload;
    await request(app)
      .post('/api/v1/oauth/register-client')
      .send(rest)
      .expect(400);
  });

  it('rejects missing client_name (400)', async () => {
    const { client_name, ...rest } = validPayload;
    await request(app)
      .post('/api/v1/oauth/register-client')
      .send({ ...rest, client_id: 'unique_1' })
      .expect(400);
  });

  it('rejects empty redirect_uris (400)', async () => {
    await request(app)
      .post('/api/v1/oauth/register-client')
      .send({ ...validPayload, client_id: 'unique_2', redirect_uris: [] })
      .expect(400);
  });

  it('rejects missing allowed_scopes (400)', async () => {
    const { allowed_scopes, ...rest } = validPayload;
    await request(app)
      .post('/api/v1/oauth/register-client')
      .send({ ...rest, client_id: 'unique_3' })
      .expect(400);
  });

  it('rejects missing client_secret (400)', async () => {
    const { client_secret, ...rest } = validPayload;
    await request(app)
      .post('/api/v1/oauth/register-client')
      .send({ ...rest, client_id: 'unique_4' })
      .expect(400);
  });

  it('stores the client in the database with hashed secret', async () => {
    const db = getDb();
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get('test_service') as any;

    expect(client).toBeDefined();
    expect(client.name).toBe('Test Service');
    expect(client.client_secret_hash).toBeTruthy();
    expect(client.client_secret_hash).not.toBe(validPayload.client_secret); // hashed, not plaintext
    expect(JSON.parse(client.redirect_uris)).toEqual(['https://test.example.com/callback']);
    expect(JSON.parse(client.allowed_scopes)).toEqual(['test:*']);
    expect(client.is_first_party).toBe(1);
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

    // Call again — should not fail or duplicate
    seedEcosystemClients();

    const countAfter = (db.prepare('SELECT COUNT(*) as c FROM oauth_clients WHERE client_id IN (?, ?, ?, ?)').get(
      'windy_chat', 'windy_mail', 'eternitas', 'windy_fly',
    ) as any).c;

    expect(countAfter).toBe(countBefore);
  });
});
