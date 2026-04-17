/**
 * P0-4 — verify the JWT_PRIVATE_KEY env var path in src/jwks.ts works.
 *
 * In production behind the Wave-4 AWS Terraform scaffold, the RSA keypair
 * is generated at `terraform apply` time and the private-key PEM lands
 * in Secrets Manager under the JWT_PRIVATE_KEY key. ECS injects it as an
 * env var. src/jwks.ts Strategy 0 parses it inline — no filesystem mount.
 *
 * This test confirms:
 *   (a) initializeJWKS() accepts a PEM from JWT_PRIVATE_KEY
 *   (b) Works with both real-newlines and "\n"-escaped single-line PEMs
 *       (some secret stores return the latter)
 *   (c) JWKS document includes the derived kid
 *   (d) A token signed with the key verifies against the JWKS public key
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'hs256-fallback-test-secret';

describe('P0-4 JWT_PRIVATE_KEY env var (inline PEM) support', () => {
  // Generate a fresh keypair for this test — don't leak the real dev key.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const reinit = (pemEnv: string) => {
    jest.resetModules();
    const saved: Record<string, string | undefined> = {
      JWT_PRIVATE_KEY:       process.env.JWT_PRIVATE_KEY,
      JWT_PRIVATE_KEY_PATH:  process.env.JWT_PRIVATE_KEY_PATH,
      JWKS_KEY_DIR:          process.env.JWKS_KEY_DIR,
    };
    process.env.JWT_PRIVATE_KEY = pemEnv;
    delete process.env.JWT_PRIVATE_KEY_PATH;
    delete process.env.JWKS_KEY_DIR;
    try {
      const jwks = require('../src/jwks');
      const ok = jwks.initializeJWKS();
      return { ok, jwks };
    } finally {
      if (saved.JWT_PRIVATE_KEY === undefined) delete process.env.JWT_PRIVATE_KEY;
      else process.env.JWT_PRIVATE_KEY = saved.JWT_PRIVATE_KEY;
      if (saved.JWT_PRIVATE_KEY_PATH !== undefined) process.env.JWT_PRIVATE_KEY_PATH = saved.JWT_PRIVATE_KEY_PATH;
      if (saved.JWKS_KEY_DIR        !== undefined) process.env.JWKS_KEY_DIR        = saved.JWKS_KEY_DIR;
    }
  };

  it('accepts a standard multi-line PEM', () => {
    const { ok, jwks } = reinit(privateKey);
    expect(ok).toBe(true);
    expect(jwks.isRS256Available()).toBe(true);
    const doc = jwks.getJWKSDocument();
    expect(doc.keys.length).toBeGreaterThan(0);
    expect(doc.keys[0].kty).toBe('RSA');
    expect(doc.keys[0].alg).toBe('RS256');
    expect(doc.keys[0].kid).toMatch(/^[a-f0-9]+$/);
  });

  it('accepts a PEM with literal "\\n" escape sequences (Secrets-Manager style)', () => {
    const escaped = privateKey.replace(/\n/g, '\\n');
    const { ok, jwks } = reinit(escaped);
    expect(ok).toBe(true);
    expect(jwks.isRS256Available()).toBe(true);
  });

  it('a token signed with the env-var key verifies against the JWKS public key', () => {
    const { ok, jwks } = reinit(privateKey);
    expect(ok).toBe(true);
    const signingKey = jwks.getSigningKey();
    expect(signingKey).toBeTruthy();
    const token = jwt.sign({ sub: 'p0-4-test' }, signingKey.privateKey, {
      algorithm: 'RS256', keyid: signingKey.kid, expiresIn: '1m',
    });
    // Verify using the public key from the JWKS doc
    const pub = jwks.getPublicKeyByKid(signingKey.kid);
    expect(pub).toBeTruthy();
    const decoded = jwt.verify(token, pub!, { algorithms: ['RS256'] }) as any;
    expect(decoded.sub).toBe('p0-4-test');
  });

  it('derived kid is deterministic across restarts (same PEM → same kid)', () => {
    const first = reinit(privateKey).jwks.getSigningKey()!.kid;
    const second = reinit(privateKey).jwks.getSigningKey()!.kid;
    expect(first).toBe(second);
  });
});
