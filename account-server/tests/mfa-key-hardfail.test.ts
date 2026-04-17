/**
 * P1-1 — MFA_ENCRYPTION_KEY is hard-required in production.
 *
 * Before this change, missing MFA_ENCRYPTION_KEY in prod derived an AES key
 * from sha256(JWT_SECRET) and only logged a warning. Rotating JWT_SECRET
 * would then silently brick every enrolled MFA user. Operators miss warnings.
 * Production now throws.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { encryptSecret } from '../src/services/mfa';

describe('P1-1 MFA_ENCRYPTION_KEY hard-fail in production', () => {
  const bootWithEnv = (env: Record<string, string | undefined>): Error | undefined => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    let err: Error | undefined;
    try {
      // encryptSecret calls getEncryptionKey() which runs the guard.
      encryptSecret('probe-plaintext');
    } catch (e) {
      err = e as Error;
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    return err;
  };

  it('throws in production when MFA_ENCRYPTION_KEY is unset', () => {
    const err = bootWithEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: undefined });
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/MFA_ENCRYPTION_KEY is required in production/);
  });

  it('throws in production when MFA_ENCRYPTION_KEY is not 64-char hex', () => {
    const err = bootWithEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'too-short' });
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/not a valid 32-byte hex/);
  });

  it('accepts a valid 64-char hex key in production', () => {
    const validKey = 'a'.repeat(64);
    const err = bootWithEnv({ NODE_ENV: 'production', MFA_ENCRYPTION_KEY: validKey });
    expect(err).toBeUndefined();
  });

  it('dev mode still accepts missing key (derives from JWT_SECRET)', () => {
    const err = bootWithEnv({ NODE_ENV: 'development', MFA_ENCRYPTION_KEY: undefined });
    expect(err).toBeUndefined();
  });

  it('test mode still accepts missing key (no warn, no throw)', () => {
    const err = bootWithEnv({ NODE_ENV: 'test', MFA_ENCRYPTION_KEY: undefined });
    expect(err).toBeUndefined();
  });
});
