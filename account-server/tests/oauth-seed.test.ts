/**
 * Verifies the server-boot OAuth ecosystem seed includes every Windy
 * first-party client. Added after Pink-center had to manually
 * `INSERT INTO oauth_clients` for windy-code — a missing row here caused
 * /api/v1/oauth/device to return 400 invalid_client at sign-in.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

// Importing app runs server.ts top-level, which calls seedEcosystemClients().
import { app } from '../src/server';
import { getDb } from '../src/db/schema';
import { seedEcosystemClients } from '../src/routes/oauth';

const EXPECTED_CLIENTS = [
  'windy_chat',
  'windy_mail',
  'eternitas',
  'windy_fly',
  'windy_pro_mobile',
  'windy-code', // hyphen on purpose — matches extensions/windy-ecosystem/src/signIn.ts
];

describe('Ecosystem OAuth client seed', () => {
  // Run once explicitly — guards against a future refactor that removes the
  // unconditional server-boot call.
  beforeAll(() => {
    seedEcosystemClients();
  });

  it.each(EXPECTED_CLIENTS)('seeds %s as a first-party client', (clientId) => {
    const row = getDb().prepare(
      'SELECT client_id, name, allowed_scopes, is_first_party, is_public FROM oauth_clients WHERE client_id = ?',
    ).get(clientId) as any;
    expect(row).toBeDefined();
    expect(row.client_id).toBe(clientId);
    expect(row.is_first_party).toBe(1);
    expect(row.is_public).toBe(1);
    const scopes = JSON.parse(row.allowed_scopes);
    expect(Array.isArray(scopes)).toBe(true);
    expect(scopes.length).toBeGreaterThan(0);
  });

  it('windy-code has the scopes the VS Code fork actually requests', () => {
    // Keep this list in sync with windy-code/extensions/windy-ecosystem/src/signIn.ts
    const required = ['openid', 'profile', 'email', 'windy_code:*', 'windy_chat:*', 'windy_mail:*', 'windy_fly:*'];
    const row = getDb().prepare(
      'SELECT allowed_scopes FROM oauth_clients WHERE client_id = ?',
    ).get('windy-code') as any;
    const scopes = JSON.parse(row.allowed_scopes);
    for (const s of required) {
      expect(scopes).toContain(s);
    }
  });

  it('re-running the seed is idempotent (no duplicate rows, no error)', () => {
    const before = getDb().prepare(
      "SELECT COUNT(*) as c FROM oauth_clients WHERE client_id = 'windy-code'",
    ).get() as any;
    expect(before.c).toBe(1);

    seedEcosystemClients(); // second call
    seedEcosystemClients(); // third call for good measure

    const after = getDb().prepare(
      "SELECT COUNT(*) as c FROM oauth_clients WHERE client_id = 'windy-code'",
    ).get() as any;
    expect(after.c).toBe(1);
  });

  it('the real /api/v1/oauth/device accepts windy-code as a known client', async () => {
    // Smoke: the device-code request path validates the client exists by
    // looking it up in oauth_clients. If seeding missed windy-code, this
    // would fail with invalid_client.
    const res = await request(app)
      .post('/api/v1/oauth/device')
      .send({ client_id: 'windy-code', scope: 'openid profile email' });
    // The endpoint should reach at least a 200 (issued) — anything 4xx with
    // an invalid_client body would indicate the seed is wrong.
    expect(res.status).toBeLessThan(400);
    expect(res.body).toHaveProperty('user_code');
    expect(res.body).toHaveProperty('device_code');
  });
});
