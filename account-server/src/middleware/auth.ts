/**
 * Authentication middleware — JWT verification, optional auth, admin guard, scope checking.
 *
 * Phase 4: RS256 support with HS256 backward compatibility.
 * If RS256 keys are configured, tokens are verified against JWKS public keys first.
 * Falls back to HS256 with JWT_SECRET for legacy tokens.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { isRS256Available, getVerificationKeys, getPublicKeyByKid } from '../jwks';
import { isRedisAvailable, isTokenBlacklisted as redisIsBlacklisted } from '../redis';

export interface AuthUser {
    userId: string;
    email: string;
    tier: string;
    accountId: string;
    role?: string;
    // Phase 10.1: Unified Identity fields
    type?: 'human' | 'bot';
    scopes?: string[];
    products?: string[];
    iss?: string;
}

export interface AuthRequest extends Request {
    user: AuthUser;
}

/**
 * Verify a JWT token. Tries RS256 first (if available), then HS256 fallback.
 *
 * Phase 4: Multi-algorithm support for migration. Tokens signed with RS256
 * include a `kid` header that maps to a JWKS public key. Old HS256 tokens
 * have no `kid` and fall back to symmetric verification.
 */
function verifyToken(token: string): AuthUser {
    // If RS256 is available, try RS256 first
    if (isRS256Available()) {
        try {
            // Decode header to get kid
            const header = jwt.decode(token, { complete: true })?.header;

            if (header?.alg === 'RS256' && header?.kid) {
                const publicKey = getPublicKeyByKid(header.kid);
                if (publicKey) {
                    return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as AuthUser;
                }

                // kid not found — try all verification keys (rotation window)
                const keys = getVerificationKeys();
                for (const key of keys) {
                    try {
                        return jwt.verify(token, key.publicKey, { algorithms: ['RS256'] }) as AuthUser;
                    } catch {
                        continue;
                    }
                }
            }
        } catch (err: any) {
            // If RS256 verification fails with a specific error, don't fall back
            if (err.name === 'TokenExpiredError') throw err;
            // Otherwise try HS256 fallback below
        }
    }

    // HS256 fallback (backward compatible — always available)
    // SEC-H5: Whitelist HS256 to block algorithm confusion / 'alg: none' attacks
    return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as AuthUser;
}

/**
 * Require valid JWT Bearer token OR bot API key. Sets req.user on success.
 *
 * Supports two auth methods:
 *   1. JWT Bearer token: `Authorization: Bearer <jwt>`
 *   2. Bot API key: `Authorization: Bearer wk_<key>` (Phase 3)
 *
 * Bot API keys are identified by the `wk_` prefix.
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // Fallback: accept token from query param (needed for <audio>/<video> src URLs
    // that can't set Authorization headers)
    if (!token && req.query.token && typeof req.query.token === 'string') {
        token = req.query.token;
    }

    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    // Phase 3: Check if this is a bot API key (prefix: wk_)
    if (token.startsWith('wk_')) {
        try {
            const { validateBotApiKey } = require('../identity-service');
            const result = validateBotApiKey(token);

            if (!result.valid) {
                res.status(401).json({ error: 'Invalid or expired API key' });
                return;
            }

            (req as AuthRequest).user = {
                userId: result.identityId!,
                email: '',
                tier: 'bot',
                accountId: result.identityId!,
                role: undefined,
                type: (result.identityType as 'human' | 'bot') || 'bot',
                scopes: result.scopes || [],
                products: ['windy_chat', 'windy_mail'],
            };
            next();
            return;
        } catch (err) {
            res.status(401).json({ error: 'API key validation failed' });
            return;
        }
    }

    try {
        const decoded = verifyToken(token);

        // SEC-M6: Check token blacklist (logout invalidation)
        // Phase 7A-4: Use Redis if available, fall back to DB
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        if (isRedisAvailable()) {
            // Async Redis blacklist check
            redisIsBlacklisted(tokenHash).then(blacklisted => {
                if (blacklisted) {
                    if (!res.headersSent) res.status(401).json({ error: 'Token revoked' });
                    return;
                }
                if (!res.headersSent) finalizeAuth(decoded, req, res, next);
            }).catch(() => {
                // Redis error — fall back to DB check
                if (checkDbBlacklist(tokenHash)) {
                    if (!res.headersSent) res.status(401).json({ error: 'Token revoked' });
                    return;
                }
                if (!res.headersSent) finalizeAuth(decoded, req, res, next);
            });
            return;
        }

        // No Redis — use synchronous DB blacklist check
        if (checkDbBlacklist(tokenHash)) {
            res.status(401).json({ error: 'Token revoked' });
            return;
        }

        finalizeAuth(decoded, req, res, next);
    } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
            res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
            return;
        }
        res.status(403).json({ error: 'Invalid token' });
    }
}

/**
 * Check token blacklist in the database (synchronous).
 */
function checkDbBlacklist(tokenHash: string): boolean {
    try {
        const { getDb } = require('../db/schema');
        const db = getDb();
        const blacklisted = db.prepare('SELECT 1 FROM token_blacklist WHERE token_hash = ?').get(tokenHash);
        return !!blacklisted;
    } catch {
        return false; // blacklist table may not exist yet — allow through
    }
}

/**
 * Finalize authentication by normalizing identity fields and attaching user to request.
 */
function finalizeAuth(decoded: AuthUser, req: Request, res: Response, next: NextFunction): void {
    // Phase 10.1: Normalize identity fields for backward compatibility
    // Old tokens without scopes -> treat as windy_pro:* (full access)
    if (!decoded.scopes) {
        decoded.scopes = ['windy_pro:*'];
    }
    if (!decoded.products) {
        decoded.products = ['windy_pro'];
    }
    if (!decoded.type) {
        decoded.type = 'human';
    }

    (req as AuthRequest).user = decoded;
    next();
}

/**
 * Optional auth — sets req.user if valid token present, otherwise continues.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        // Phase 3: Bot API key support
        if (token.startsWith('wk_')) {
            try {
                const { validateBotApiKey } = require('../identity-service');
                const result = validateBotApiKey(token);
                if (result.valid) {
                    (req as AuthRequest).user = {
                        userId: result.identityId!,
                        email: '',
                        tier: 'bot',
                        accountId: result.identityId!,
                        type: (result.identityType as 'human' | 'bot') || 'bot',
                        scopes: result.scopes || [],
                        products: ['windy_chat', 'windy_mail'],
                    };
                }
            } catch { /* ignore */ }
        } else {
            try {
                const decoded = verifyToken(token);
                if (!decoded.scopes) decoded.scopes = ['windy_pro:*'];
                if (!decoded.products) decoded.products = ['windy_pro'];
                if (!decoded.type) decoded.type = 'human';
                (req as AuthRequest).user = decoded;
            } catch { /* ignore invalid tokens */ }
        }
    }
    next();
}

/**
 * Admin-only guard — must be used after authenticateToken.
 */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
    const { getDb } = require('../db/schema');
    const db = getDb();
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get((req as AuthRequest).user.userId) as { role: string } | undefined;
    if (!user || user.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    next();
}

/**
 * Phase 10.1: Scope-checking middleware factory.
 *
 * Returns middleware that checks if the authenticated user has ALL required scopes.
 * Must be used after authenticateToken.
 *
 * Supports wildcards:
 *   - `admin:*` matches everything (superuser)
 *   - `windy_pro:*` matches any windy_pro permission (windy_pro:read, windy_pro:write, etc.)
 *
 * @example
 *   router.get('/chat/messages', authenticateToken, requireScopes('windy_chat:read'), handler);
 *   router.post('/chat/send', authenticateToken, requireScopes('windy_chat:write'), handler);
 *   router.delete('/admin/users', authenticateToken, requireScopes('admin:*'), handler);
 */
export function requireScopes(...requiredScopes: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const user = (req as AuthRequest).user;
        if (!user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        const userScopes = user.scopes || [];

        for (const required of requiredScopes) {
            if (!_hasScope(userScopes, required)) {
                res.status(403).json({
                    error: 'Insufficient permissions',
                    required: requiredScopes,
                    granted: userScopes,
                });
                return;
            }
        }

        next();
    };
}

/**
 * Check if a user's scopes satisfy a required scope.
 * - Direct match: 'windy_pro:read' matches 'windy_pro:read'
 * - Product wildcard: 'windy_pro:*' matches 'windy_pro:read'
 * - Admin wildcard: 'admin:*' matches everything
 */
function _hasScope(userScopes: string[], required: string): boolean {
    // Admin superuser
    if (userScopes.includes('admin:*')) return true;
    // Direct match
    if (userScopes.includes(required)) return true;
    // Product wildcard
    const [product] = required.split(':');
    if (userScopes.includes(`${product}:*`)) return true;
    return false;
}
