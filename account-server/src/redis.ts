/**
 * Redis Integration — OTP storage, token blacklist, JWKS cache, rate limiting.
 *
 * Phase 7A-4: Connects to Redis via REDIS_URL if set. Falls back to
 * in-memory Maps if Redis is not configured — matching existing behavior.
 *
 * Zero breaking changes: without REDIS_URL, everything works exactly as before.
 */

let redisClient: any = null;
let redisAvailable = false;

// ═══════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════

/**
 * Initialize Redis connection. Call once at startup.
 * Returns true if Redis is connected, false if using in-memory fallback.
 */
export async function initRedis(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('[redis] REDIS_URL not set — using in-memory fallback');
    return false;
  }

  try {
    const Redis = require('ioredis');
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 10) return null; // Stop retrying after 10 attempts
        return Math.min(times * 200, 5000); // Exponential backoff, max 5s
      },
      lazyConnect: false,
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      redisClient.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      redisClient.once('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    redisAvailable = true;
    console.log('[redis] Connected to Redis');

    // Handle reconnection events
    redisClient.on('error', (err: Error) => {
      console.error('[redis] Connection error:', err.message);
    });
    redisClient.on('reconnecting', () => {
      console.log('[redis] Reconnecting...');
    });

    return true;
  } catch (err: any) {
    console.warn(`[redis] Failed to connect (${err.message}) — using in-memory fallback`);
    redisClient = null;
    redisAvailable = false;
    return false;
  }
}

/**
 * Close Redis connection gracefully.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisAvailable = false;
  }
}

/**
 * Check if Redis is available.
 */
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

// ═══════════════════════════════════════════
//  IN-MEMORY FALLBACK STORES
// ═══════════════════════════════════════════

// OTP store: key -> { code, expiresAt, attempts, sentAt, type }
const memOtpStore = new Map<string, {
  code: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  type: 'phone' | 'email';
}>();

// Token blacklist: tokenHash -> expiresAt
const memBlacklist = new Map<string, number>();

// JWKS cache
let memJwksCache: { keys: any; expiresAt: number } | null = null;

// Rate limit: key -> { count, windowStart }
const memRateLimits = new Map<string, { count: number; windowStart: number }>();

// Periodic cleanup for in-memory stores (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memOtpStore) {
    if (now > val.expiresAt) memOtpStore.delete(key);
  }
  for (const [key, expiresAt] of memBlacklist) {
    if (now > expiresAt) memBlacklist.delete(key);
  }
  if (memJwksCache && now > memJwksCache.expiresAt) {
    memJwksCache = null;
  }
  for (const [key, val] of memRateLimits) {
    if (now - val.windowStart > 3600000) memRateLimits.delete(key); // 1h cleanup
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════
//  OTP STORAGE
// ═══════════════════════════════════════════

export interface OTPData {
  code: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  type: 'phone' | 'email';
}

/**
 * Store an OTP with TTL.
 */
export async function setOTP(key: string, data: OTPData, ttlSeconds: number = 600): Promise<void> {
  if (redisAvailable && redisClient) {
    await redisClient.set(
      `otp:${key}`,
      JSON.stringify(data),
      'EX',
      ttlSeconds,
    );
    return;
  }
  // In-memory fallback
  memOtpStore.set(key, data);
}

/**
 * Get stored OTP data.
 */
export async function getOTP(key: string): Promise<OTPData | null> {
  if (redisAvailable && redisClient) {
    const raw = await redisClient.get(`otp:${key}`);
    return raw ? JSON.parse(raw) : null;
  }
  // In-memory fallback
  const data = memOtpStore.get(key);
  if (!data) return null;
  if (Date.now() > data.expiresAt) {
    memOtpStore.delete(key);
    return null;
  }
  return data;
}

/**
 * Delete an OTP entry.
 */
export async function deleteOTP(key: string): Promise<void> {
  if (redisAvailable && redisClient) {
    await redisClient.del(`otp:${key}`);
    return;
  }
  memOtpStore.delete(key);
}

// ═══════════════════════════════════════════
//  TOKEN BLACKLIST
// ═══════════════════════════════════════════

/**
 * Blacklist a token hash (for logout invalidation).
 */
export async function blacklistToken(hash: string, ttlSeconds: number): Promise<void> {
  if (redisAvailable && redisClient) {
    await redisClient.set(`bl:${hash}`, '1', 'EX', ttlSeconds);
    return;
  }
  memBlacklist.set(hash, Date.now() + ttlSeconds * 1000);
}

/**
 * Check if a token hash is blacklisted.
 */
export async function isTokenBlacklisted(hash: string): Promise<boolean> {
  if (redisAvailable && redisClient) {
    const result = await redisClient.get(`bl:${hash}`);
    return result !== null;
  }
  const expiresAt = memBlacklist.get(hash);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    memBlacklist.delete(hash);
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════
//  JWKS CACHE
// ═══════════════════════════════════════════

/**
 * Cache JWKS keys with a TTL.
 */
export async function cacheJWKS(keys: any, ttlSeconds: number = 3600): Promise<void> {
  if (redisAvailable && redisClient) {
    await redisClient.set('jwks:keys', JSON.stringify(keys), 'EX', ttlSeconds);
    return;
  }
  memJwksCache = { keys, expiresAt: Date.now() + ttlSeconds * 1000 };
}

/**
 * Get cached JWKS keys.
 */
export async function getCachedJWKS(): Promise<any | null> {
  if (redisAvailable && redisClient) {
    const raw = await redisClient.get('jwks:keys');
    return raw ? JSON.parse(raw) : null;
  }
  if (!memJwksCache) return null;
  if (Date.now() > memJwksCache.expiresAt) {
    memJwksCache = null;
    return null;
  }
  return memJwksCache.keys;
}

// ═══════════════════════════════════════════
//  RATE LIMITING
// ═══════════════════════════════════════════

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Set up a rate limit window for a key.
 * Returns whether the request is allowed.
 */
export async function checkRateLimit(
  key: string,
  windowSeconds: number = 60,
  maxRequests: number = 10,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;

  if (redisAvailable && redisClient) {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - windowSeconds;

    // Use a sorted set with timestamps as scores
    const pipeline = redisClient.pipeline();
    pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
    pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);
    pipeline.zcard(redisKey);
    pipeline.expire(redisKey, windowSeconds);
    const results = await pipeline.exec();

    const count = results[2][1] as number;
    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);

    return {
      allowed,
      remaining,
      resetInSeconds: windowSeconds,
    };
  }

  // In-memory fallback
  const now = Date.now();
  const existing = memRateLimits.get(key);

  if (!existing || now - existing.windowStart > windowSeconds * 1000) {
    memRateLimits.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1, resetInSeconds: windowSeconds };
  }

  existing.count++;
  const allowed = existing.count <= maxRequests;
  const remaining = Math.max(0, maxRequests - existing.count);
  const elapsed = (now - existing.windowStart) / 1000;

  return {
    allowed,
    remaining,
    resetInSeconds: Math.ceil(windowSeconds - elapsed),
  };
}

/**
 * Reset rate limit for a key (e.g., after successful auth).
 */
export async function resetRateLimit(key: string): Promise<void> {
  if (redisAvailable && redisClient) {
    await redisClient.del(`rl:${key}`);
    return;
  }
  memRateLimits.delete(key);
}
