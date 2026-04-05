/**
 * Hardening tests — JWKS & OIDC Discovery endpoints
 *
 * These tests build a minimal Express app that mounts the same handlers
 * as server.ts for /.well-known/jwks.json and /.well-known/openid-configuration.
 * A real RSA-2048 key pair is generated; no mocking of the jwks module.
 */
import crypto from 'crypto';
import express, { Express } from 'express';
import request from 'supertest';

import { generateKeyPair } from '../jwks';

let app: Express;
let testKeyPair: ReturnType<typeof generateKeyPair>;
let jwksDoc: { keys: Array<Record<string, string>> };

beforeAll(() => {
  testKeyPair = generateKeyPair();

  // Build a JWKS document from the generated key pair
  const pubKeyObj = crypto.createPublicKey(testKeyPair.publicKey);
  const jwk = pubKeyObj.export({ format: 'jwk' }) as Record<string, unknown>;

  jwksDoc = {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: testKeyPair.kid,
        n: jwk.n as string,
        e: jwk.e as string,
      },
    ],
  };

  app = express();

  // Mount the JWKS endpoint (mirrors server.ts)
  app.get('/.well-known/jwks.json', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(jwksDoc);
  });

  // Mount the OIDC discovery endpoint (mirrors server.ts)
  app.get('/.well-known/openid-configuration', (req, res) => {
    const issuer = `${req.protocol}://${req.get('host')}`;
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/api/v1/oauth/authorize`,
      token_endpoint: `${issuer}/api/v1/oauth/token`,
      userinfo_endpoint: `${issuer}/api/v1/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      device_authorization_endpoint: `${issuer}/api/v1/oauth/device`,
      scopes_supported: [
        'openid',
        'profile',
        'email',
        'phone',
        'windy_pro:*',
        'windy_chat:read',
        'windy_chat:write',
        'windy_mail:read',
        'windy_mail:send',
        'windy_fly:*',
      ],
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'client_credentials',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256', 'HS256'],
      code_challenge_methods_supported: ['S256'],
    });
  });
});

// ═══════════════════════════════════════════════════
//  JWKS endpoint
// ═══════════════════════════════════════════════════

describe('GET /.well-known/jwks.json', () => {
  it('returns 200 with a valid JWKS document containing at least one key', async () => {
    const res = await request(app).get('/.well-known/jwks.json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('keys');
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys.length).toBeGreaterThanOrEqual(1);
  });

  it('sets Cache-Control: public, max-age=3600', async () => {
    const res = await request(app).get('/.well-known/jwks.json');

    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('sets Access-Control-Allow-Origin: *', async () => {
    const res = await request(app).get('/.well-known/jwks.json');

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('each key has required JWK fields (kty, use, alg, kid, n, e)', async () => {
    const res = await request(app).get('/.well-known/jwks.json');

    for (const key of res.body.keys) {
      expect(key).toHaveProperty('kty', 'RSA');
      expect(key).toHaveProperty('use', 'sig');
      expect(key).toHaveProperty('alg', 'RS256');
      expect(key).toHaveProperty('kid');
      expect(key).toHaveProperty('n');
      expect(key).toHaveProperty('e');
      expect(typeof key.kid).toBe('string');
      expect(key.kid.length).toBeGreaterThan(0);
      expect(typeof key.n).toBe('string');
      expect(key.n.length).toBeGreaterThan(0);
    }
  });

  it('exponent (e) is AQAB (65537 in base64url)', async () => {
    const res = await request(app).get('/.well-known/jwks.json');

    for (const key of res.body.keys) {
      expect(key.e).toBe('AQAB');
    }
  });

  it('public key can be reconstructed from JWK n and e', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    const jwkKey = res.body.keys[0];

    // Reconstruct a KeyObject from the JWK fields
    const reconstructed = crypto.createPublicKey({
      key: {
        kty: jwkKey.kty,
        n: jwkKey.n,
        e: jwkKey.e,
      },
      format: 'jwk',
    });

    expect(reconstructed.type).toBe('public');
    expect(reconstructed.asymmetricKeyType).toBe('rsa');
  });

  it('returns content-type application/json', async () => {
    const res = await request(app).get('/.well-known/jwks.json');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ═══════════════════════════════════════════════════
//  OIDC Discovery endpoint
// ═══════════════════════════════════════════════════

describe('GET /.well-known/openid-configuration', () => {
  it('returns 200 with a valid OIDC discovery document', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issuer');
    expect(res.body).toHaveProperty('authorization_endpoint');
    expect(res.body).toHaveProperty('token_endpoint');
    expect(res.body).toHaveProperty('userinfo_endpoint');
    expect(res.body).toHaveProperty('jwks_uri');
  });

  it('issuer matches the request host', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    // supertest uses http://127.0.0.1:<port> by default
    expect(res.body.issuer).toMatch(/^http:\/\/127\.0\.0\.1/);
  });

  it('all endpoint URLs are rooted under the issuer', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');
    const { issuer } = res.body;

    expect(res.body.authorization_endpoint).toBe(`${issuer}/api/v1/oauth/authorize`);
    expect(res.body.token_endpoint).toBe(`${issuer}/api/v1/oauth/token`);
    expect(res.body.userinfo_endpoint).toBe(`${issuer}/api/v1/oauth/userinfo`);
    expect(res.body.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
    expect(res.body.device_authorization_endpoint).toBe(`${issuer}/api/v1/oauth/device`);
  });

  it('lists all supported grant types', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    const grantTypes: string[] = res.body.grant_types_supported;
    expect(grantTypes).toContain('authorization_code');
    expect(grantTypes).toContain('client_credentials');
    expect(grantTypes).toContain('refresh_token');
    expect(grantTypes).toContain('urn:ietf:params:oauth:grant-type:device_code');
  });

  it('lists all supported scopes including Windy-specific ones', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    const scopes: string[] = res.body.scopes_supported;
    // Standard OIDC scopes
    expect(scopes).toContain('openid');
    expect(scopes).toContain('profile');
    expect(scopes).toContain('email');
    expect(scopes).toContain('phone');
    // Windy-specific scopes
    expect(scopes).toContain('windy_pro:*');
    expect(scopes).toContain('windy_chat:read');
    expect(scopes).toContain('windy_chat:write');
    expect(scopes).toContain('windy_mail:read');
    expect(scopes).toContain('windy_mail:send');
    expect(scopes).toContain('windy_fly:*');
  });

  it('supports RS256 and HS256 for id_token signing', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.body.id_token_signing_alg_values_supported).toContain('RS256');
    expect(res.body.id_token_signing_alg_values_supported).toContain('HS256');
  });

  it('supports S256 code challenge method (PKCE)', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.body.code_challenge_methods_supported).toContain('S256');
  });

  it('response_types_supported includes code', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.body.response_types_supported).toContain('code');
  });

  it('subject_types_supported includes public', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.body.subject_types_supported).toContain('public');
  });

  it('returns content-type application/json', async () => {
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
