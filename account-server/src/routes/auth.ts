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
import { authenticateToken, AuthRequest } from '../middleware/auth';
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
const stmts = getStatements();

// Rate limit on auth endpoints: 5 attempts per minute
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Helpers ─────────────────────────────────────────────────

function generateTokens(user: { id: string; email: string; tier: string }, deviceId?: string) {
    // SEC-H5: Explicitly lock algorithm to HS256 to prevent algorithm confusion attacks
    const accessToken = jwt.sign(
        { userId: user.id, email: user.email, tier: user.tier, accountId: user.id },
        config.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: config.JWT_EXPIRY }
    );

    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    stmts.deleteUserRefreshTokens.run(user.id, deviceId || '');
    stmts.saveRefreshToken.run(refreshToken, user.id, deviceId || '', expiresAt);

    return { token: accessToken, refreshToken };
}

function getDeviceList(userId: string) {
    return stmts.getDevices.all(userId);
}

// ─── POST /api/v1/auth/register ──────────────────────────────

router.post('/register', authLimiter, validate(RegisterRequestSchema), async (req: Request, res: Response) => {
    try {
        const { name, email, password, deviceId, deviceName, platform } = req.body;

        const existing = stmts.findUserByEmail.get(email.toLowerCase()) as any;
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        const userId = uuidv4();
        const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
        stmts.createUser.run(userId, email.toLowerCase(), name, passwordHash, 'free');

        if (deviceId) {
            stmts.addDevice.run(deviceId, userId, deviceName || 'Unknown Device', platform || 'unknown');
        }

        const user = { id: userId, email: email.toLowerCase(), tier: 'free' };
        const tokens = generateTokens(user, deviceId);
        const devices = getDeviceList(userId);

        console.log(`✅ Registered: ${email} (${userId.slice(0, 8)}...)`);

        res.status(201).json({
            userId,
            name,
            email: email.toLowerCase(),
            tier: 'free',
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            devices,
        });
    } catch (err: any) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed: ' + err.message });
    }
});

// ─── POST /api/v1/auth/login ─────────────────────────────────

router.post('/login', authLimiter, validate(LoginRequestSchema), async (req: Request, res: Response) => {
    try {
        const { email, password, deviceId, deviceName, platform } = req.body;

        const user = stmts.findUserByEmail.get(email.toLowerCase()) as any;
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (deviceId) {
            const existingDevice = stmts.findDevice.get(deviceId, user.id) as any;
            if (existingDevice) {
                stmts.touchDevice.run(deviceId, user.id);
            } else {
                const deviceCount = (stmts.countDevices.get(user.id) as any).count;
                if (deviceCount < config.MAX_DEVICES) {
                    stmts.addDevice.run(deviceId, user.id, deviceName || 'Unknown Device', platform || 'unknown');
                }
            }
        }

        stmts.updateUserSeen.run(user.id);

        const tokens = generateTokens(user, deviceId);
        const devices = getDeviceList(user.id);

        console.log(`🔓 Login: ${email} (${user.id.slice(0, 8)}...)`);

        res.json({
            userId: user.id,
            name: user.name,
            email: user.email,
            tier: user.tier,
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            devices,
        });
    } catch (err: any) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed: ' + err.message });
    }
});

// ─── GET /api/v1/auth/me ─────────────────────────────────────

router.get('/me', authenticateToken, (req: Request, res: Response) => {
    const user = stmts.findUserById.get((req as AuthRequest).user.userId) as any;
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

    const existing = stmts.findDevice.get(deviceId, userId) as any;
    if (existing) {
        stmts.touchDevice.run(deviceId, userId);
        const devices = getDeviceList(userId);
        return res.json({ message: 'Device already registered', devices });
    }

    const count = (stmts.countDevices.get(userId) as any).count;
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

    stmts.addDevice.run(deviceId, userId, deviceName || 'Unknown Device', platform || 'unknown');
    const devices = getDeviceList(userId);

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

    const existing = stmts.findDevice.get(deviceId, userId) as any;
    if (!existing) {
        return res.status(404).json({ error: 'Device not found on this account' });
    }

    stmts.removeDevice.run(deviceId, userId);
    const devices = getDeviceList(userId);

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

router.post('/refresh', validate(RefreshRequestSchema), (req: Request, res: Response) => {
    const { refreshToken, deviceId } = req.body;

    stmts.cleanExpiredTokens.run();

    const stored = stmts.findRefreshToken.get(refreshToken) as any;
    if (!stored) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (new Date(stored.expires_at) < new Date()) {
        stmts.deleteRefreshToken.run(refreshToken);
        return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = stmts.findUserById.get(stored.user_id) as any;
    if (!user) {
        stmts.deleteRefreshToken.run(refreshToken);
        return res.status(401).json({ error: 'User not found' });
    }

    stmts.deleteRefreshToken.run(refreshToken);
    const tokens = generateTokens(user, deviceId || stored.device_id);

    if (deviceId) {
        stmts.touchDevice.run(deviceId, user.id);
    }

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
            // Set expiry to match token's own expiry (max 15 minutes from now)
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            try {
                db.prepare('INSERT OR IGNORE INTO token_blacklist (token_hash, expires_at) VALUES (?, ?)').run(tokenHash, expiresAt);
            } catch { /* table may not exist on first run */ }
        }

        // Periodically clean expired blacklist entries
        try {
            db.prepare("DELETE FROM token_blacklist WHERE expires_at < datetime('now')").run();
        } catch { /* ignore */ }

        console.log(`🔒 Logout: user ${userId.slice(0, 8)}`);
        res.json({ success: true });
    } catch (err: any) {
        // SEC-H7: Don't expose internal error details
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ─── POST /api/v1/auth/change-password ───────────────────────

router.post('/change-password', authenticateToken, validate(ChangePasswordRequestSchema), (req: Request, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();

        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const newHash = bcrypt.hashSync(newPassword, config.BCRYPT_ROUNDS);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/v1/auth/create-portal-session ─────────────────

router.post('/create-portal-session', authenticateToken, (_req: Request, res: Response) => {
    res.set('X-Stub', 'true');
    res.json({ url: null, message: 'Stripe portal not configured. Set STRIPE_SECRET_KEY in environment.' });
});

export default router;
