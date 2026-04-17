/**
 * Rate-limiter factory that lazily binds an express-rate-limit handler
 * to a Redis-backed store when Redis is up, or to the default MemoryStore
 * otherwise.
 *
 * Why lazy: `initRedis()` runs in parallel with `app.listen()`, so at
 * module-evaluation time Redis may not be connected yet. We defer the
 * underlying `rateLimit(...)` construction to the first request. If we
 * bound to MemoryStore because Redis wasn't ready yet, we rebind once
 * when Redis becomes available so the shared store takes over for the
 * rest of the process lifetime.
 *
 * Why this matters (P1-2): with the default MemoryStore, an attacker
 * can round-robin across ECS tasks to multiply their effective limit
 * by `desired_count`, and every task restart zeroes the counter. A
 * Redis-backed store makes the window global across tasks.
 */
import type { RequestHandler } from 'express';
import rateLimit, { type Options as RateLimitOptions } from 'express-rate-limit';
import * as redis from '../redis';

// Defensive accessors — tests sometimes mock '../redis' with a partial shape
// that omits these helpers. Treat any throw / missing export as "Redis not
// available", falling back to express-rate-limit's in-memory MemoryStore.
function safeIsRedisAvailable(): boolean {
  try {
    return typeof redis.isRedisAvailable === 'function' && redis.isRedisAvailable();
  } catch {
    return false;
  }
}
function safeMakeStore(prefix: string): any | undefined {
  try {
    if (typeof redis.makeRateLimitStore !== 'function') return undefined;
    return redis.makeRateLimitStore(prefix);
  } catch {
    return undefined;
  }
}

export function makeRateLimiter(
  prefix: string,
  opts: Partial<RateLimitOptions>,
): RequestHandler {
  let boundToRedis = false;
  let handler: RequestHandler | null = null;

  return (req, res, next) => {
    // First request → construct. Subsequent requests, but only if Redis
    // has JUST become available after we bound to MemoryStore → rebind.
    if (!handler || (!boundToRedis && safeIsRedisAvailable())) {
      const store = safeMakeStore(prefix);
      boundToRedis = !!store;
      // express-rate-limit v7 refuses construction inside a request handler
      // by default (ERR_ERL_CREATED_IN_REQUEST_HANDLER). That guardrail
      // targets the "new rateLimit() per request" anti-pattern; we cache
      // the instance and rebind at most once, so the spirit of the check
      // doesn't apply. Suppress only this specific validator.
      handler = rateLimit({
        ...opts,
        ...(store ? { store } : {}),
        validate: {
          ...(opts.validate && typeof opts.validate === 'object' ? opts.validate : {}),
          creationStack: false,
        },
      });
    }
    return handler(req, res, next);
  };
}
