/**
 * P1-2 — rate-limit store must be Redis-backed when REDIS_URL is set.
 *
 * Without Redis, every ECS task holds its own in-memory counter, so an
 * attacker round-robins across tasks and effectively multiplies the
 * rate limit by `desired_count`. Every task restart also zeroes the
 * counter. With Redis, the window is global across tasks and survives
 * restarts.
 *
 * These tests lock in:
 *   - the factory returns undefined (→ MemoryStore fallback) when Redis
 *     is unavailable, keeping local dev and single-instance working
 *   - every rate-limiter call site uses makeRateLimiter (so nobody can
 *     slip a raw rateLimit() back in and silently go MemoryStore-only)
 */
import fs from 'fs';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { makeRateLimitStore, isRedisAvailable } from '../src/redis';
import { makeRateLimiter } from '../src/services/rate-limiter';

describe('P1-2 makeRateLimitStore fallback behaviour', () => {
  it('returns undefined when Redis is unavailable (→ MemoryStore fallback)', () => {
    expect(isRedisAvailable()).toBe(false);
    const store = makeRateLimitStore('test-prefix');
    expect(store).toBeUndefined();
  });
});

describe('P1-2 makeRateLimiter returns a working middleware', () => {
  it('returns a RequestHandler function that binds lazily on first call', () => {
    const mw = makeRateLimiter('test', { windowMs: 60_000, max: 100 });
    expect(typeof mw).toBe('function');
    // 3 args (req, res, next) matches express.RequestHandler
    expect(mw.length).toBe(3);
  });
});

describe('P1-2 source invariants: every rate-limiter call site uses makeRateLimiter', () => {
  const routeFiles = [
    'routes/auth.ts',
    'routes/identity.ts',
    'routes/device-approval.ts',
    'routes/oauth.ts',
    'routes/misc.ts',
    'routes/verification.ts',
    'server.ts',
  ];

  for (const rel of routeFiles) {
    it(`src/${rel} does not call the raw rateLimit() factory`, () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', rel),
        'utf-8',
      );
      // The module may still import express-rate-limit types, but must
      // not invoke `rateLimit(` or `rl.default(` — those skip the Redis
      // store and go straight to MemoryStore.
      expect(src).not.toMatch(/^\s*import\s+rateLimit\s+from\s+'express-rate-limit'/m);
      expect(src).not.toMatch(/\brl\.default\s*\(\s*\{/);
      // And must actually use the wrapper.
      expect(src).toMatch(/makeRateLimiter\s*\(/);
    });
  }
});
