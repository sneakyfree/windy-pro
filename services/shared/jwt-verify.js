/**
 * Shared JWT Verification Module — Unified Windy Identity
 *
 * Phase 6A: Replaces static CHAT_API_TOKEN with proper JWT validation
 * across all chat services (onboarding, directory, push-gateway, backup).
 *
 * Supports:
 *   1. JWT Bearer tokens (HS256 + RS256)
 *   2. Bot API keys (wk_ prefix)
 *   3. Legacy CHAT_API_TOKEN fallback (backward compat)
 *
 * Usage:
 *   const { createAuthMiddleware } = require('../shared/jwt-verify');
 *   const authMiddleware = createAuthMiddleware({ fallbackToken: process.env.CHAT_API_TOKEN });
 *   app.use('/api/v1/chat/verify', authMiddleware, verifyRoutes);
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Cache for JWKS public keys (fetched from account server)
let jwksCache = null;
let jwksCacheExpiry = 0;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch JWKS document from the account server.
 * Caches keys for 1 hour to avoid per-request HTTP calls.
 */
async function fetchJWKS() {
  const now = Date.now();
  if (jwksCache && now < jwksCacheExpiry) {
    return jwksCache;
  }

  const accountServerUrl = process.env.ACCOUNT_SERVER_URL || 'http://localhost:8098';
  const jwksUrl = `${accountServerUrl}/.well-known/jwks.json`;

  try {
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error(`[jwt-verify] JWKS fetch failed: ${res.status}`);
      return jwksCache; // Return stale cache if available
    }

    const doc = await res.json();
    jwksCache = doc;
    jwksCacheExpiry = now + JWKS_CACHE_TTL_MS;
    return doc;
  } catch (err) {
    console.error('[jwt-verify] JWKS fetch error:', err.message);
    return jwksCache; // Return stale cache if available
  }
}

/**
 * Convert a JWK RSA public key to PEM format.
 */
function jwkToPem(jwk) {
  // Use Node's built-in crypto to import the JWK
  try {
    const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return keyObject.export({ type: 'spki', format: 'pem' });
  } catch (err) {
    console.error('[jwt-verify] JWK to PEM conversion failed:', err.message);
    return null;
  }
}

/**
 * Verify a JWT token. Tries RS256 first (via JWKS), then HS256 fallback.
 *
 * @param {string} token - The JWT to verify
 * @returns {Promise<object>} Decoded token payload
 * @throws {Error} If verification fails
 */
async function verifyJWT(token) {
  const jwtSecret = process.env.JWT_SECRET;

  // Decode header to check algorithm
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) {
    throw new Error('Invalid JWT format');
  }

  const { header } = decoded;

  // Try RS256 verification if the token has a kid
  if (header.alg === 'RS256' && header.kid) {
    const jwks = await fetchJWKS();
    if (jwks && jwks.keys) {
      const matchingKey = jwks.keys.find(k => k.kid === header.kid);
      if (matchingKey) {
        const pem = jwkToPem(matchingKey);
        if (pem) {
          return jwt.verify(token, pem, { algorithms: ['RS256'] });
        }
      }

      // Try all keys (rotation window)
      for (const key of jwks.keys) {
        try {
          const pem = jwkToPem(key);
          if (pem) {
            return jwt.verify(token, pem, { algorithms: ['RS256'] });
          }
        } catch {
          continue;
        }
      }
    }
  }

  // HS256 fallback
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not configured and RS256 verification failed');
  }

  return jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
}

/**
 * Validate a bot API key (wk_ prefix) against the account server.
 *
 * In production, this calls the account server's internal endpoint.
 * For simplicity and to avoid circular dependencies, we hash the key
 * and check against the account server's API.
 *
 * @param {string} apiKey - The bot API key (wk_...)
 * @returns {Promise<object|null>} Identity info if valid, null otherwise
 */
async function validateBotApiKey(apiKey) {
  const accountServerUrl = process.env.ACCOUNT_SERVER_URL || 'http://localhost:8098';

  try {
    // Use the identity/me endpoint with the API key as bearer token
    const res = await fetch(`${accountServerUrl}/api/v1/identity/me`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      userId: data.identity?.id,
      email: data.identity?.email || '',
      tier: data.identity?.tier || 'bot',
      type: data.identity?.identityType || 'bot',
      scopes: data.scopes || [],
      products: (data.products || []).map(p => p.product || p),
    };
  } catch (err) {
    console.error('[jwt-verify] Bot API key validation error:', err.message);
    return null;
  }
}

/**
 * Create an Express auth middleware that validates:
 *   1. JWT Bearer tokens (HS256 or RS256)
 *   2. Bot API keys (wk_ prefix)
 *   3. Legacy CHAT_API_TOKEN fallback
 *
 * Sets req.user on success with the decoded identity.
 *
 * @param {object} options
 * @param {string} [options.fallbackToken] - Legacy CHAT_API_TOKEN for backward compat
 * @returns {Function} Express middleware
 */
function createAuthMiddleware(options = {}) {
  const { fallbackToken } = options;

  return async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);

    // 1. Try JWT verification first (includes bot API keys via wk_ prefix)
    if (token.startsWith('wk_')) {
      // Bot API key
      try {
        const identity = await validateBotApiKey(token);
        if (identity) {
          req.user = identity;
          return next();
        }
      } catch (err) {
        // Fall through to legacy check
      }
    } else if (token.length > 20 && token.includes('.')) {
      // Looks like a JWT (has dots and is long enough)
      try {
        const decoded = await verifyJWT(token);

        // Normalize identity fields for backward compatibility
        req.user = {
          userId: decoded.userId || decoded.sub,
          email: decoded.email || '',
          tier: decoded.tier || 'free',
          accountId: decoded.accountId || decoded.userId || decoded.sub,
          type: decoded.type || 'human',
          scopes: decoded.scopes || ['windy_pro:*'],
          products: decoded.products || ['windy_pro'],
          iss: decoded.iss,
        };
        return next();
      } catch (err) {
        // If JWT verification fails with expiry, return specific error
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        // Fall through to legacy check
      }
    }

    // 2. Legacy CHAT_API_TOKEN fallback (backward compat)
    if (fallbackToken && token === fallbackToken) {
      req.user = {
        userId: 'service-account',
        email: '',
        tier: 'service',
        accountId: 'service-account',
        type: 'service',
        scopes: ['windy_chat:*'],
        products: ['windy_chat'],
      };
      return next();
    }

    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  };
}

/**
 * Create a scope-checking middleware.
 * Must be used after auth middleware.
 *
 * @param {...string} requiredScopes - Scopes to check for
 * @returns {Function} Express middleware
 */
function requireScopes(...requiredScopes) {
  return function(req, res, next) {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userScopes = user.scopes || [];

    for (const required of requiredScopes) {
      if (!hasScope(userScopes, required)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: requiredScopes,
          granted: userScopes,
        });
      }
    }

    next();
  };
}

/**
 * Check if a user's scopes satisfy a required scope.
 * Supports wildcards: admin:* matches everything, product:* matches product:anything.
 */
function hasScope(userScopes, required) {
  if (userScopes.includes('admin:*')) return true;
  if (userScopes.includes(required)) return true;
  const [product] = required.split(':');
  if (userScopes.includes(`${product}:*`)) return true;
  return false;
}

module.exports = {
  createAuthMiddleware,
  requireScopes,
  verifyJWT,
  validateBotApiKey,
  hasScope,
  fetchJWKS,
};
