/**
 * ECOSYSTEM SMOKE TEST
 *
 * Lightweight end-to-end validation of the full Windy Pro ecosystem integration.
 * Tests: register, JWT claims, ecosystem-status, chat provision, token validation,
 * JWKS/OIDC discovery, health check, GDPR deletion.
 *
 * Run with: npx jest tests/smoke-ecosystem.test.ts
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

// ─── Environment Setup (before importing app) ──────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.SYNAPSE_REGISTRATION_SECRET = 'smoke-synapse-secret';

import { app } from '../src/server';

// ─── Shared State ──────────────────────────────────────────

const ts = Date.now();
const TEST_EMAIL = `smoketest+${ts}@test.windypro.com`;
const TEST_PASSWORD = 'SmokeTest1!';
const TEST_NAME = 'Smoke Test';

let authToken = '';
let userId = '';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════
//  ECOSYSTEM SMOKE TEST
// ═══════════════════════════════════════════════════════════

describe('Ecosystem Smoke Test', () => {

  // 1. Register test user
  test('Register test user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: TEST_NAME,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('windyIdentityId');

    authToken = res.body.token;
    userId = res.body.userId;

    // Wait for fire-and-forget ecosystem provisioner to complete
    await wait(2000);
  });

  // 2. JWT has required claims
  test('JWT has required claims', () => {
    const decoded = jwt.decode(authToken) as any;
    expect(decoded).not.toBeNull();
    expect(decoded.userId).toBeDefined();
    expect(decoded.email).toBe(TEST_EMAIL);
    expect(decoded.tier).toBeDefined();
    expect(decoded.scopes).toBeDefined();
    expect(decoded.products).toBeDefined();
    expect(decoded.iss).toBe('windy-identity');
    expect(decoded.type).toBe('human');
  });

  // 3. Ecosystem status
  test('Ecosystem status', async () => {
    const res = await request(app)
      .get('/api/v1/identity/ecosystem-status')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);

    const products = res.body.products;
    expect(products.windy_word.status).toBe('active');
    expect(['pending', 'active']).toContain(products.windy_chat.status);
    expect(products.windy_cloud.status).toBe('active');
    expect(products.windy_cloud.storage_limit).toBe(500 * 1024 * 1024);
    expect(res.body).toHaveProperty('creator_name');
    expect(res.body.tier).toBe('free');
  });

  // 4. Chat provision
  test('Chat provision', async () => {
    const res = await request(app)
      .post('/api/v1/identity/chat/provision')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    // Accept 201 (dev stub) or 502 (Synapse not running)
    expect([201, 502]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body.matrix.matrixUserId).toBeDefined();
      expect(res.body).toHaveProperty('creator_name');
    }
  });

  // 5. Validate token cross-service
  test('Validate token cross-service', async () => {
    const res = await request(app)
      .get('/api/v1/identity/validate-token')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(Array.isArray(res.body.scopes)).toBe(true);
    expect(res.body.tier).toBe('free');
  });

  // 6. JWKS endpoint
  let jwksKeys: any[] = [];
  test('JWKS endpoint', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    jwksKeys = res.body.keys;
    if (jwksKeys.length > 0) {
      const key = jwksKeys[0];
      expect(key.kty).toBe('RSA');
      expect(key.alg).toBe('RS256');
      expect(key.kid).toBeDefined();
      expect(key.n).toBeDefined();
      expect(key.e).toBeDefined();
    }
  });

  // 7. JWKS validates JWT
  test('JWKS validates JWT', () => {
    if (jwksKeys.length > 0) {
      // RS256 mode: reconstruct public key from JWK n/e fields
      const jwk = jwksKeys[0];
      const publicKey = crypto.createPublicKey({
        key: {
          kty: jwk.kty,
          n: jwk.n,
          e: jwk.e,
        },
        format: 'jwk',
      });
      const verified = jwt.verify(authToken, publicKey, { algorithms: ['RS256'] }) as any;
      expect(verified.userId).toBeDefined();
      expect(verified.email).toBe(TEST_EMAIL);
    } else {
      // HS256 mode: verify with JWT_SECRET
      const verified = jwt.verify(authToken, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;
      expect(verified.userId).toBeDefined();
      expect(verified.email).toBe(TEST_EMAIL);
    }
  });

  // 8. OIDC discovery
  test('OIDC discovery', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issuer');
    expect(res.body).toHaveProperty('jwks_uri');
    expect(res.body.grant_types_supported).toContain('authorization_code');
  });

  // 9. Health check
  test('Health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('windy-pro-account-server');
  });

  // 10. GDPR cleanup
  test('GDPR cleanup', async () => {
    const res = await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  // 11. Verify deletion
  test('Verify deletion', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });
});
