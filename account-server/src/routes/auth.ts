/**
 * Auth routes — register, login, logout, refresh, me, devices, change-password, billing.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { getDb } from '../db/schema';
import { getStatements } from '../db/statements';
import { logAuditEvent, provisionProduct, grantScopes } from '../identity-service';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { blacklistToken as redisBlacklistToken, isRedisAvailable } from '../redis';
import { isRS256Available, getSigningKey } from '../jwks';
import { provisionEcosystem } from '../services/ecosystem-provisioner';
import { validate } from '../middleware/validation';
import {
    RegisterRequestSchema,
    LoginRequestSchema,
    RefreshRequestSchema,
    RegisterDeviceRequestSchema,
    RemoveDeviceRequestSchema,
    ChangePasswordRequestSchema,
} from '@windy-pro/contracts';

const router = Router();

// Lazy getter — ensures statements are always from the current DB instance
// (avoids stale prepared statements if DB is re-initialized, e.g. in tests)
function stmts() { return getStatements(); }

// Rate limit on auth endpoints: 5 attempts per minute (disabled in test env)
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 5,
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Helpers ─────────────────────────────────────────────────

function generateTokens(user: { id: string; email: string; tier: string }, deviceId?: string) {
    // Phase 10.1: Build scoped identity token payload
    const db = getDb();

    // Fetch identity scopes (fallback to windy_pro:* if no scopes assigned yet)
    let scopes: string[];
    try {
        const scopeRows = db.prepare(
            'SELECT scope FROM identity_scopes WHERE identity_id = ?',
        ).all(user.id) as { scope: string }[];
        scopes = scopeRows.length > 0 ? scopeRows.map(r => r.scope) : ['windy_pro:*'];
    } catch { scopes = ['windy_pro:*']; }

    // Fetch active product accounts
    let products: string[];
    try {
        const productRows = db.prepare(
            "SELECT product FROM product_accounts WHERE identity_id = ? AND status = 'active'",
        ).all(user.id) as { product: string }[];
        products = productRows.length > 0 ? productRows.map(r => r.product) : ['windy_pro'];
    } catch { products = ['windy_pro']; }

    // Fetch identity type and windy_identity_id
    let identityType = 'human';
    let windyIdentityId: string | undefined;
    try {
        const identity = db.prepare(
            'SELECT identity_type, windy_identity_id FROM users WHERE id = ?',
        ).get(user.id) as { identity_type: string; windy_identity_id: string } | undefined;
        identityType = identity?.identity_type || 'human';
        windyIdentityId = identity?.windy_identity_id;
    } catch { /* default human */ }

    // Phase 4: Sign with RS256 if available, HS256 fallback
    const tokenPayload = {
        userId: user.id,
        email: user.email,
        tier: user.tier,
        accountId: user.id,
        windyIdentityId,
        // Phase 10.1: Unified Identity fields
        type: identityType,
        scopes,
        products,
        iss: 'windy-identity',
    };

    let accessToken: string;
    const signingKey = getSigningKey();

    if (signingKey) {
        // RS256 — asymmetric signing with key ID for JWKS verification
        accessToken = jwt.sign(
            tokenPayload,
            signingKey.privateKey,
            {
                algorithm: 'RS256',
                expiresIn: config.JWT_EXPIRY,
                keyid: signingKey.kid,
            },
        );
    } else {
        // SEC-H5: HS256 fallback — lock algorithm to prevent algorithm confusion attacks
        accessToken = jwt.sign(
            tokenPayload,
            config.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: config.JWT_EXPIRY },
        );
    }

    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    stmts().deleteUserRefreshTokens.run(user.id, deviceId || '');
    stmts().saveRefreshToken.run(refreshToken, user.id, deviceId || '', expiresAt);

    // Update last_login_at
    try {
        db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    } catch { /* column may not exist yet */ }

    return { token: accessToken, refreshToken };

}

function getDeviceList(userId: string) {
    return stmts().getDevices.all(userId);
}

// ─── POST /api/v1/auth/register ──────────────────────────────

router.post('/register', authLimiter, validate(RegisterRequestSchema), async (req: Request, res: Response) => {
    try {
        const { name, email, password, deviceId, deviceName, platform } = req.body;

        const existing = stmts().findUserByEmail.get(email.toLowerCase()) as any;
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        const userId = uuidv4();
        const windyIdentityId = crypto.randomUUID();
        const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
        stmts().createUser.run(userId, email.toLowerCase(), name, passwordHash, 'free');

        // Set the universal cross-product identity ID
        try {
            const db = getDb();
            db.prepare('UPDATE users SET windy_identity_id = ? WHERE id = ?').run(windyIdentityId, userId);
        } catch { /* column may not exist during first migration cycle */ }

        if (deviceId) {
            stmts().addDevice.run(deviceId, userId, deviceName || 'Unknown Device', platform || 'unknown');
        }

        // Phase 10.0: Auto-provision Windy Pro product account + default scopes
        // NOTE: Provision BEFORE generateTokens so the access token includes correct scopes/products
        provisionProduct(userId, 'windy_pro', { tier: 'free', registeredVia: 'api' });
        grantScopes(userId, ['windy_pro:*'], 'registration');

        // Phase 2: Auto-create pending windy_chat product account
        provisionProduct(userId, 'windy_chat', { status: 'pending', registeredVia: 'api' });
        // Mark as pending (not yet provisioned on Matrix)
        try {
            const db = getDb();
            db.prepare("UPDATE product_accounts SET status = 'pending' WHERE identity_id = ? AND product = 'windy_chat'").run(userId);
        } catch { /* non-critical */ }

        const user = { id: userId, email: email.toLowerCase(), tier: 'free' };
        const tokens = generateTokens(user, deviceId);
        const devices = getDeviceList(userId);

        logAuditEvent('register', userId, {
            email: email.toLowerCase(),
            deviceId,
            platform: platform || 'unknown',
        }, req.ip, req.get('user-agent'));

        console.log(`✅ Registered: ${email} (${userId.slice(0, 8)}...)`);

        res.status(201).json({
            userId,
            windyIdentityId,
            name,
            email: email.toLowerCase(),
            tier: 'free',
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            devices,
        });

        // Fire-and-forget ecosystem provisioning (don't block registration)
        setImmediate(async () => {
            try {
                await provisionEcosystem(userId, email.toLowerCase(), name);
            } catch (err: any) {
                console.warn('[Ecosystem] Auto-provision failed (non-fatal):', err.message);
            }
        });
    } catch (err: any) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ─── POST /api/v1/auth/login ─────────────────────────────────

router.post('/login', authLimiter, validate(LoginRequestSchema), async (req: Request, res: Response) => {
    try {
        const { email, password, deviceId, deviceName, platform } = req.body;

        const user = stmts().findUserByEmail.get(email.toLowerCase()) as any;
        if (!user) {
            logAuditEvent('login_failed', null, { email: email.toLowerCase(), reason: 'user_not_found' }, req.ip, req.get('user-agent'));
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            logAuditEvent('login_failed', user.id, { email: email.toLowerCase(), reason: 'invalid_password' }, req.ip, req.get('user-agent'));
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (deviceId) {
            const existingDevice = stmts().findDevice.get(deviceId, user.id) as any;
            if (existingDevice) {
                stmts().touchDevice.run(deviceId, user.id);
            } else {
                const deviceCount = (stmts().countDevices.get(user.id) as any).count;
                if (deviceCount < config.MAX_DEVICES) {
                    stmts().addDevice.run(deviceId, user.id, deviceName || 'Unknown Device', platform || 'unknown');
                }
            }
        }

        stmts().updateUserSeen.run(user.id);

        const tokens = generateTokens(user, deviceId);
        const devices = getDeviceList(user.id);

        logAuditEvent('login', user.id, {
            email: email.toLowerCase(),
            deviceId,
            platform: platform || 'unknown',
        }, req.ip, req.get('user-agent'));

        console.log(`🔓 Login: ${email} (${user.id.slice(0, 8)}...)`);

        res.json({
            userId: user.id,
            windyIdentityId: user.windy_identity_id,
            name: user.name,
            email: user.email,
            tier: user.tier,
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            devices,
        });
    } catch (err: any) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ─── POST /api/v1/auth/chat-validate ────────────────────────
// Called by Synapse's windy_registration.py to authenticate Matrix logins
// against the Windy identity hub. Requires shared_secret to prevent abuse.

router.post('/chat-validate', authLimiter, async (req: Request, res: Response) => {
    try {
        const { username, password, shared_secret } = req.body;

        // Verify shared secret (same secret Synapse uses for registration)
        const expectedSecret = process.env.SYNAPSE_REGISTRATION_SECRET || '';
        if (!expectedSecret || shared_secret !== expectedSecret) {
            return res.status(403).json({ valid: false, error: 'Invalid shared secret' });
        }

        if (!username || !password) {
            return res.status(400).json({ valid: false, error: 'Missing username or password' });
        }

        // username can be an email or a user ID — try email first
        const db = getDb();
        const user = stmts().findUserByEmail.get(username.toLowerCase()) as any
            || db.prepare('SELECT * FROM users WHERE id = ?').get(username) as any;

        if (!user) {
            logAuditEvent('chat_login_failed', null, {
                username,
                reason: 'user_not_found',
            }, req.ip, req.get('user-agent'));
            return res.status(401).json({ valid: false, error: 'Invalid credentials' });
        }

        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            logAuditEvent('chat_login_failed', user.id, {
                username,
                reason: 'invalid_password',
            }, req.ip, req.get('user-agent'));
            return res.status(401).json({ valid: false, error: 'Invalid credentials' });
        }

        logAuditEvent('chat_login', user.id, { username }, req.ip, req.get('user-agent'));

        console.log(`💬 Chat validate: ${user.email} (${user.id.slice(0, 8)}...)`);

        res.json({
            valid: true,
            user_id: user.id,
            windy_user_id: user.windy_identity_id || user.id,
            display_name: user.display_name || user.name,
            avatar_url: user.avatar_url || null,
        });
    } catch (err: any) {
        console.error('Chat validate error:', err);
        res.status(500).json({ valid: false, error: 'Validation failed' });
    }
});

// ─── GET /api/v1/auth/me ─────────────────────────────────────

router.get('/me', authenticateToken, (req: Request, res: Response) => {
    const user = stmts().findUserById.get((req as AuthRequest).user.userId) as any;
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const devices = getDeviceList(user.id);

    res.json({
        userId: user.id,
        name: user.name,
        email: user.email,
        tier: user.tier,
        createdAt: user.created_at,
        devices,
        deviceLimit: config.MAX_DEVICES,
    });
});

// ─── GET /api/v1/auth/devices ────────────────────────────────

router.get('/devices', authenticateToken, (req: Request, res: Response) => {
    const devices = getDeviceList((req as AuthRequest).user.userId);
    res.json({
        devices,
        count: devices.length,
        limit: config.MAX_DEVICES,
        remaining: config.MAX_DEVICES - devices.length,
    });
});

// ─── POST /api/v1/auth/devices/register ──────────────────────

router.post('/devices/register', authenticateToken, validate(RegisterDeviceRequestSchema), (req: Request, res: Response) => {
    const { deviceId, deviceName, platform } = req.body;
    const userId = (req as AuthRequest).user.userId;

    const existing = stmts().findDevice.get(deviceId, userId) as any;
    if (existing) {
        stmts().touchDevice.run(deviceId, userId);
        const devices = getDeviceList(userId);
        return res.json({ message: 'Device already registered', devices });
    }

    const count = (stmts().countDevices.get(userId) as any).count;
    if (count >= config.MAX_DEVICES) {
        const devices = getDeviceList(userId);
        return res.status(403).json({
            error: 'Device limit reached',
            message: `You've reached the ${config.MAX_DEVICES}-device limit. Remove a device to add this one.`,
            devices,
            count,
            limit: config.MAX_DEVICES,
        });
    }

    stmts().addDevice.run(deviceId, userId, deviceName || 'Unknown Device', platform || 'unknown');
    const devices = getDeviceList(userId);

    logAuditEvent('device_add', userId, { deviceId, deviceName, platform }, req.ip, req.get('user-agent'));

    console.log(`📱 Device registered: ${deviceName || deviceId.slice(0, 8)} for user ${userId.slice(0, 8)}`);

    res.status(201).json({
        message: 'Device registered',
        devices,
        count: devices.length,
        limit: config.MAX_DEVICES,
    });
});

// ─── POST /api/v1/auth/devices/remove ────────────────────────

router.post('/devices/remove', authenticateToken, validate(RemoveDeviceRequestSchema), (req: Request, res: Response) => {
    const { deviceId } = req.body;
    const userId = (req as AuthRequest).user.userId;

    const existing = stmts().findDevice.get(deviceId, userId) as any;
    if (!existing) {
        return res.status(404).json({ error: 'Device not found on this account' });
    }

    stmts().removeDevice.run(deviceId, userId);
    const devices = getDeviceList(userId);

    logAuditEvent('device_remove', userId, { deviceId }, req.ip, req.get('user-agent'));

    console.log(`🗑️  Device removed: ${deviceId.slice(0, 8)} from user ${userId.slice(0, 8)}`);

    res.json({
        message: 'Device removed',
        devices,
        count: devices.length,
        limit: config.MAX_DEVICES,
        remaining: config.MAX_DEVICES - devices.length,
    });
});

// ─── POST /api/v1/auth/refresh ───────────────────────────────

router.post('/refresh', authLimiter, validate(RefreshRequestSchema), (req: Request, res: Response) => {
    const { refreshToken, deviceId } = req.body;

    stmts().cleanExpiredTokens.run();

    const stored = stmts().findRefreshToken.get(refreshToken) as any;
    if (!stored) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (new Date(stored.expires_at) < new Date()) {
        stmts().deleteRefreshToken.run(refreshToken);
        return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = stmts().findUserById.get(stored.user_id) as any;
    if (!user) {
        stmts().deleteRefreshToken.run(refreshToken);
        return res.status(401).json({ error: 'User not found' });
    }

    stmts().deleteRefreshToken.run(refreshToken);
    const tokens = generateTokens(user, deviceId || stored.device_id);

    if (deviceId) {
        stmts().touchDevice.run(deviceId, user.id);
    }

    logAuditEvent('token_refresh', user.id, { deviceId: deviceId || stored.device_id }, req.ip, req.get('user-agent'));

    console.log(`🔄 Token refresh: ${user.email}`);

    res.json({
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        tier: user.tier,
        userId: user.id,
        name: user.name,
    });
});

// ─── POST /api/v1/auth/logout ────────────────────────────────

router.post('/logout', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;

        // Delete refresh tokens
        db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);

        // SEC-M6: Blacklist the current access token
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const ttlSeconds = 15 * 60; // 15 minutes — matches token expiry

            // Phase 7A-4: Blacklist in Redis if available
            if (isRedisAvailable()) {
                redisBlacklistToken(tokenHash, ttlSeconds).catch(() => {});
            }

            // Also blacklist in DB (belt-and-suspenders for Redis downtime)
            const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
            try {
                db.prepare('INSERT OR IGNORE INTO token_blacklist (token_hash, expires_at) VALUES (?, ?)').run(tokenHash, expiresAt);
            } catch { /* table may not exist on first run */ }
        }

        // Periodically clean expired blacklist entries
        try {
            db.prepare("DELETE FROM token_blacklist WHERE expires_at < datetime('now')").run();
        } catch { /* ignore */ }

        logAuditEvent('logout', userId, {}, req.ip, req.get('user-agent'));

        console.log(`🔒 Logout: user ${userId.slice(0, 8)}`);
        res.json({ success: true });
    } catch (err: any) {
        // SEC-H7: Don't expose internal error details
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ─── POST /api/v1/auth/change-password ───────────────────────

router.post('/change-password', authenticateToken, validate(ChangePasswordRequestSchema), async (req: Request, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();

        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const newHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);

        logAuditEvent('password_change', userId, {}, req.ip, req.get('user-agent'));

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: 'Password change failed' });
    }
});

// ─── DELETE /api/v1/auth/me — GDPR self-deletion ────────────

router.delete('/me', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();

        // Verify user exists
        const user = db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Require password confirmation if provided (recommended but optional for backward compat)
        if (req.body?.password) {
            const passwordValid = await bcrypt.compare(req.body.password, user.password_hash);
            if (!passwordValid) {
                return res.status(401).json({ error: 'Password confirmation failed' });
            }
        }

        // Cascade delete all user data
        const tables = [
            'DELETE FROM recordings WHERE user_id = ?',
            'DELETE FROM refresh_tokens WHERE user_id = ?',
            'DELETE FROM devices WHERE user_id = ?',
            'DELETE FROM product_accounts WHERE identity_id = ?',
            'DELETE FROM identity_scopes WHERE identity_id = ?',
            'DELETE FROM translations WHERE user_id = ?',
            'DELETE FROM favorites WHERE user_id = ?',
            'DELETE FROM files WHERE user_id = ?',
            'DELETE FROM transactions WHERE user_id = ?',
            'DELETE FROM chat_profiles WHERE identity_id = ?',
            'DELETE FROM bot_api_keys WHERE identity_id = ?',
            'DELETE FROM identity_audit_log WHERE identity_id = ?',
            'DELETE FROM eternitas_passports WHERE identity_id = ?',
        ];

        for (const sql of tables) {
            try { db.prepare(sql).run(userId); } catch { /* table may not exist */ }
        }

        // Delete the user record last
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        logAuditEvent('account_self_deleted', userId, { email: user.email }, req.ip, req.get('user-agent'));

        console.log(`🗑️  Account self-deleted: ${user.email} (${userId.slice(0, 8)}...)`);

        res.json({ deleted: true });
    } catch (err: any) {
        console.error('Account deletion error:', err);
        res.status(500).json({ error: 'Account deletion failed' });
    }
});

// ─── GET /api/v1/auth/billing ────────────────────────────────

router.get('/billing', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT email, tier, created_at, stripe_customer_id FROM users WHERE id = ?')
            .get((req as AuthRequest).user.userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({
            email: user.email,
            tier: user.tier || 'free',
            createdAt: user.created_at,
            stripeCustomerId: user.stripe_customer_id || null,
            payments: [],
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Failed to fetch billing info' });
    }
});

// ─── POST /api/v1/auth/create-portal-session ─────────────────
// Legacy path — redirects to the Stripe billing portal via /api/v1/stripe/create-portal-session.
// Kept for backward compat with the web Settings page.

router.post('/create-portal-session', authenticateToken, async (req: Request, res: Response) => {
    try {
        const Stripe = require('stripe');
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
            return res.json({ url: null, message: 'Stripe not configured. Set STRIPE_SECRET_KEY in environment.' });
        }

        const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' });
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();

        const user = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(userId) as any;
        if (!user?.stripe_customer_id) {
            return res.status(400).json({ url: null, error: 'No billing history found' });
        }

        const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://windypro.thewindstorm.uk/dashboard';
        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: returnUrl,
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('Portal session error:', err);
        res.json({ url: null, message: 'Failed to create portal session' });
    }
});

export default router;
