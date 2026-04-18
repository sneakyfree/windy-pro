/**
 * P2-1 — MFA backup codes are hashed at bcrypt rounds=6, not 8.
 *
 * Rationale (recorded in mfa.ts): backup codes have 32^8 ≈ 1.1e12 entropy
 * per code. An offline attacker's guess budget is dominated by entropy,
 * not bcrypt cost. Dropping from 8 → 6 rounds cuts MFA-setup latency ~4x
 * without meaningfully changing attacker economics.
 *
 * This test pins:
 *  - backup-code hashes carry the $2a$06 or $2b$06 bcrypt cost prefix
 *  - consumeBackupCode still round-trips cleanly at the new cost
 *  - the regular password path is NOT downgraded (routes/auth.ts keeps
 *    whatever rounds it uses — verified via a source invariant)
 */
import fs from 'fs';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import {
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from '../src/services/mfa';

jest.setTimeout(15000);

describe('P2-1 backup-code bcrypt rounds', () => {
  it('hashes backup codes at bcrypt cost 6', async () => {
    const codes = generateBackupCodes(3);
    const hashes = await hashBackupCodes(codes);
    expect(hashes).toHaveLength(3);
    for (const h of hashes) {
      // bcrypt hash format: $2[abxy]$NN$...
      expect(h).toMatch(/^\$2[aby]\$06\$/);
    }
  });

  it('consumeBackupCode still matches at the new cost', async () => {
    const codes = generateBackupCodes(5);
    const hashes = await hashBackupCodes(codes);

    // Each valid code should resolve to its original index.
    for (let i = 0; i < codes.length; i++) {
      const idx = await consumeBackupCode(codes[i], hashes);
      expect(idx).toBe(i);
    }

    // An unrelated candidate returns -1.
    const miss = await consumeBackupCode('AAAA-BBBB', hashes);
    expect(miss).toBe(-1);
  });

  it('consumeBackupCode skips already-consumed slots (empty string)', async () => {
    const codes = generateBackupCodes(3);
    const hashes = await hashBackupCodes(codes);
    hashes[1] = ''; // mark slot 1 consumed
    const idx = await consumeBackupCode(codes[1], hashes);
    expect(idx).toBe(-1);
  });

  it('source invariant: auth.ts password path uses config.BCRYPT_ROUNDS, not a lowered literal', () => {
    // We only want backup-code hashing to drop in cost. User passwords in
    // users.password_hash must remain at the config-level rounds (default
    // 10+) because their entropy floor is way lower than backup codes.
    // The guard here: every bcrypt.hash call in auth.ts must cite the
    // shared config symbol, NOT a numeric literal — that way no one can
    // sneak a `bcrypt.hash(pw, 6)` past review.
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', 'auth.ts'),
      'utf-8',
    );
    const hashCalls = Array.from(src.matchAll(/bcrypt\.hash(?:Sync)?\s*\(\s*[^,]+,\s*([^)]+?)\)/g));
    expect(hashCalls.length).toBeGreaterThan(0);
    for (const m of hashCalls) {
      const arg = m[1].trim();
      expect(arg).toBe('config.BCRYPT_ROUNDS');
    }
  });
});
