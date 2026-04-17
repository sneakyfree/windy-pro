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
import { trackEvent } from '../services/analytics';
import { validate } from '../middleware/validation';
import {
    RegisterRequestSchema,
    LoginRequestSchema,
    RefreshRequestSchema,
    RegisterDeviceRequestSchema,
    RemoveDeviceRequestSchema,
    ChangePasswordRequestSchema,
    VerifyEmailRequestSchema,
    ForgotPasswordRequestSchema,
    ResetPasswordRequestSchema,
    MfaVerifySetupRequestSchema,
    MfaDisableRequestSchema,
} from '@windy-pro/contracts';
import { sendMail, verificationEmail, passwordResetEmail } from '../services/mailer';
import {
    encryptSecret, decryptSecret,
    generateTotpSecret, buildOtpauthUri, verifyTotpCode,
    generateBackupCodes, hashBackupCodes, consumeBackupCode,
} from '../services/mfa';
import { enqueueIdentityEvent, attemptDelivery } from '../services/webhook-bus';

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

// PR1: send-verification rate limit — 3 per hour per user (or per IP if unauth slipped through)
const sendVerificationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 3,
    keyGenerator: (req) => (req as AuthRequest).user?.userId || req.ip || 'unknown',
    message: { error: 'Too many verification emails sent. Try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Email normalization — used by register/login/forgot-password/reset-password
// handlers AND the forgotPasswordLimiter keyGenerator so the rate-limit
// bucket collapses "Alice@Foo.com" and "  alice@foo.com " onto the same
// identity. P1-12: without trim(), an attacker could evade the per-email
// cap by appending/stripping whitespace on each request.
function normalizeEmail(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase();
}

// PR1: forgot-password rate limit — 3 per hour per email (no auth on this
// endpoint). keyGenerator uses normalizeEmail() so the bucket can't be
// evaded by case/whitespace permutations.
const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 3,
    keyGenerator: (req) => normalizeEmail((req.body as any)?.email) || req.ip || 'unknown',
    message: { error: 'Too many password reset attempts. Try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// PR1 follow-up (Wave 7 P1-9): outer cap on /verify-email itself.
// The OTP row already caps wrong guesses at 5 per code, but an attacker
// with a stolen session token can burn through codes by calling
// /send-verification (3/hr per user) and getting 5 attempts each time —
// 15 guesses/hr against a 6-digit code (10^6 entropy). Still far from
// feasible, but a per-user hourly cap on verify-email itself removes
// the amplification.
const verifyEmailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 30,
    keyGenerator: (req) => (req as AuthRequest).user?.userId || req.ip || 'unknown',
    message: { error: 'Too many verification attempts. Try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── PR1 helpers — email verification OTP lifecycle ───
//
// Stored as sha256(code) so the raw code is never persisted. 6-digit numeric
// codes (one of 900,000) are brute-forceable in theory, but the OTP row's
// attempts counter caps wrong tries at 5 before invalidation, expiry is 15 min,
// and rate limits cap send/verify volume.

function generateOtpCode(): string {
    return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
}

async function issueAndSendVerificationCode(
    userId: string,
    email: string,
): Promise<{ stub: boolean; code?: string }> {
    const db = getDb();
    const code = generateOtpCode();
    const codeHash = hashOtp(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Invalidate prior unconsumed verification codes for this user
    db.prepare(
        "UPDATE otp_codes SET consumed_at = datetime('now') WHERE user_id = ? AND purpose = 'email_verification' AND consumed_at IS NULL",
    ).run(userId);

    db.prepare(
        "INSERT INTO otp_codes (id, user_id, code_hash, purpose, expires_at) VALUES (?, ?, ?, 'email_verification', ?)",
    ).run(uuidv4(), userId, codeHash, expiresAt);

    const tpl = verificationEmail(code);
    const result = await sendMail({ ...tpl, to: email });
    return { stub: !!result.stub, code: result.stub ? code : undefined };
}

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
        try {
            stmts().createUser.run(userId, email.toLowerCase(), name, passwordHash, 'free');
        } catch (err: any) {
            // P0-8: TOCTOU between findUserByEmail and createUser. Two concurrent
            // registers for the same email can both pass the check, then race
            // the INSERT. The loser hits UNIQUE constraint — convert to 409
            // instead of letting it bubble up as a 500 "Registration failed".
            const msg = String(err?.message || '');
            if (/UNIQUE constraint failed: users\.email/i.test(msg) ||
                /duplicate key value violates.*users.*email/i.test(msg)) {
                return res.status(409).json({ error: 'An account with this email already exists' });
            }
            throw err;
        }

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

        trackEvent('user_registered', userId);
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

        // PR4: Fan out identity.created to all configured consumers. Enqueue
        // synchronously (cheap DB writes), then attempt immediate delivery
        // off the response path. The worker will pick up retries.
        try {
            const { deliveryIds } = enqueueIdentityEvent('identity.created', {
                windy_identity_id: windyIdentityId,
                email: email.toLowerCase(),
                display_name: name,
                tier: 'free',
                created_at: new Date().toISOString(),
            });
            setImmediate(async () => {
                for (const id of deliveryIds) {
                    try { await attemptDelivery(id); } catch { /* worker will retry */ }
                }
            });
        } catch (e: any) {
            console.warn('[webhook-bus] identity.created enqueue failed:', e.message);
        }

        // PR1: Verification email is sent on explicit POST /send-verification, not here.
        // Reason: setImmediate-queued sends race with the client's own resend
        // call — the later INSERT becomes "latest by created_at" and the code
        // the user sees from the first email no longer matches the latest row.
        // 24h login grace window covers the UX of "log in immediately after
        // register" without requiring the email to land first.
    } catch (err: any) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ─── POST /api/v1/auth/login ─────────────────────────────────

router.post('/login', authLimiter, validate(LoginRequestSchema), async (req: Request, res: Response) => {
    try {
        const { email, password, deviceId, deviceName, platform, mfaCode } = req.body;

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

        // PR1: Block login if email not verified AND account is older than 24h.
        // The 24h grace window lets the verify flow itself complete without
        // a chicken-and-egg lockout (user must log in to hit /send-verification).
        if (!user.email_verified) {
            const createdMs = user.created_at ? new Date(user.created_at).getTime() : Date.now();
            const ageHours = (Date.now() - createdMs) / (1000 * 60 * 60);
            if (ageHours > 24) {
                logAuditEvent('login_blocked', user.id, {
                    email: email.toLowerCase(),
                    reason: 'email_not_verified',
                    accountAgeHours: Math.round(ageHours),
                }, req.ip, req.get('user-agent'));
                return res.status(403).json({
                    error: 'Please verify your email before logging in.',
                    code: 'email_verification_required',
                    email: user.email,
                });
            }
        }

        // PR3: MFA gate. If the user has TOTP enabled, the first call (no
        // mfaCode) returns 401 mfa_required; the second call must include
        // mfaCode (TOTP digits OR a backup code).
        const mfa = getDb().prepare(
            'SELECT totp_secret_encrypted, totp_secret_iv, totp_secret_tag, backup_codes_hash, enabled_at FROM mfa_secrets WHERE user_id = ?',
        ).get(user.id) as any;

        if (mfa?.enabled_at) {
            if (!mfaCode) {
                logAuditEvent('mfa_login_challenge', user.id, { email: email.toLowerCase() }, req.ip, req.get('user-agent'));
                return res.status(401).json({
                    error: 'mfa_required',
                    code: 'mfa_required',
                    message: 'Multi-factor authentication required. Resubmit with mfaCode.',
                });
            }

            // Try TOTP first (cheap), then backup code (per-code bcrypt compare).
            let mfaPassed = false;
            try {
                const secret = decryptSecret({
                    ciphertext: mfa.totp_secret_encrypted,
                    iv: mfa.totp_secret_iv,
                    tag: mfa.totp_secret_tag,
                });
                if (verifyTotpCode(secret, mfaCode)) {
                    mfaPassed = true;
                }
            } catch (e) {
                // Decryption failed — corrupted secret, key rotation, etc. Fall
                // through to backup-code attempt rather than 500ing.
                console.error('[MFA] Failed to decrypt TOTP secret:', (e as any).message);
            }

            if (!mfaPassed) {
                const hashes: string[] = JSON.parse(mfa.backup_codes_hash || '[]');
                const idx = await consumeBackupCode(mfaCode, hashes);
                if (idx >= 0) {
                    hashes[idx] = ''; // mark consumed; keep array indices stable
                    getDb().prepare('UPDATE mfa_secrets SET backup_codes_hash = ? WHERE user_id = ?')
                        .run(JSON.stringify(hashes), user.id);
                    mfaPassed = true;
                }
            }

            if (!mfaPassed) {
                logAuditEvent('mfa_login_failed', user.id, { email: email.toLowerCase() }, req.ip, req.get('user-agent'));
                return res.status(401).json({ error: 'Invalid MFA code', code: 'mfa_invalid' });
            }

            logAuditEvent('mfa_login_success', user.id, { email: email.toLowerCase() }, req.ip, req.get('user-agent'));
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

        trackEvent('user_logged_in', user.id);
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

        // Verify shared secret (same secret Synapse uses for registration).
        // P1-11: constant-time compare — string !== would leak byte-position
        // timing to an attacker making many attempts. Length comparison
        // before timingSafeEqual is required (throws otherwise on mismatch).
        const expectedSecret = process.env.SYNAPSE_REGISTRATION_SECRET || '';
        const presented = typeof shared_secret === 'string' ? shared_secret : '';
        const ok =
            expectedSecret.length > 0 &&
            presented.length === expectedSecret.length &&
            crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expectedSecret));
        if (!ok) {
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

// ─── PATCH /api/v1/auth/me — Update profile ────────────────────

router.patch('/me', authenticateToken, (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();
        const { name, avatarUrl, phone, preferredLang } = req.body;

        const updates: string[] = [];
        const params: any[] = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (avatarUrl !== undefined) {
            updates.push('avatar_url = ?');
            params.push(avatarUrl);
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone);
        }
        if (preferredLang !== undefined) {
            updates.push('preferred_lang = ?');
            params.push(preferredLang);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push("updated_at = datetime('now')");
        params.push(userId);

        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        // Return updated profile
        const user = stmts().findUserById.get(userId) as any;

        // PR4: Fan out identity.updated. Send only the fields that actually
        // changed in this request so consumers can do targeted updates rather
        // than a full re-sync.
        try {
            const changed: Record<string, any> = {};
            if (name !== undefined) changed.display_name = name;
            if (avatarUrl !== undefined) changed.avatar_url = avatarUrl;
            if (phone !== undefined) changed.phone = phone;
            if (preferredLang !== undefined) changed.preferred_lang = preferredLang;
            const { deliveryIds } = enqueueIdentityEvent('identity.updated', {
                windy_identity_id: user.windy_identity_id || user.id,
                email: user.email,
                display_name: user.name,
                tier: user.tier,
                created_at: user.created_at,
            }, { changed });
            setImmediate(async () => {
                for (const id of deliveryIds) {
                    try { await attemptDelivery(id); } catch { /* worker retries */ }
                }
            });
        } catch (e: any) {
            console.warn('[webhook-bus] identity.updated enqueue failed:', e.message);
        }

        res.json({
            success: true,
            userId: user.id,
            name: user.name,
            email: user.email,
            tier: user.tier,
        });
    } catch (err: any) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
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

// ─── POST /api/v1/auth/send-verification ─────────────────────
//
// Issues a fresh 6-digit code and emails it to the authed user. Rate limited
// to 3/hour per user. Idempotent in spirit: if the user is already verified,
// returns 200 with alreadyVerified:true and skips sending.

router.post('/send-verification', authenticateToken, sendVerificationLimiter, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();
        const user = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.email_verified) return res.json({ success: true, alreadyVerified: true });

        const result = await issueAndSendVerificationCode(userId, user.email);

        logAuditEvent('verification_email_sent', userId, { stub: result.stub }, req.ip, req.get('user-agent'));

        res.json({
            success: true,
            sent: true,
            expiresInSeconds: 15 * 60,
            // _devCode is only included when no real mail provider is configured —
            // lets dev/test envs read the code without a real inbox.
            ...(result.stub && result.code ? { _devCode: result.code } : {}),
        });
    } catch (err: any) {
        console.error('Send verification error:', err);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

// ─── POST /api/v1/auth/verify-email ──────────────────────────
//
// Validates the 6-digit code against the latest unconsumed
// 'email_verification' otp_code for the authed user. On success, marks
// users.email_verified=1 and consumes the code.

router.post('/verify-email', authenticateToken, verifyEmailLimiter, validate(VerifyEmailRequestSchema), (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const { code } = req.body;
        const db = getDb();
        const codeHash = hashOtp(code);

        const row = db.prepare(
            "SELECT id, expires_at, consumed_at, attempts FROM otp_codes WHERE user_id = ? AND purpose = 'email_verification' AND code_hash = ? ORDER BY created_at DESC LIMIT 1",
        ).get(userId, codeHash) as { id: string; expires_at: string; consumed_at: string | null; attempts: number } | undefined;

        if (!row) {
            // Wrong code — bump attempts on the latest unconsumed row to bound brute force.
            // After 5 wrong attempts, invalidate the outstanding code.
            const latest = db.prepare(
                "SELECT id, attempts FROM otp_codes WHERE user_id = ? AND purpose = 'email_verification' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
            ).get(userId) as { id: string; attempts: number } | undefined;
            if (latest) {
                const newAttempts = latest.attempts + 1;
                if (newAttempts >= 5) {
                    db.prepare("UPDATE otp_codes SET consumed_at = datetime('now'), attempts = ? WHERE id = ?")
                        .run(newAttempts, latest.id);
                    return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
                }
                db.prepare('UPDATE otp_codes SET attempts = ? WHERE id = ?').run(newAttempts, latest.id);
            }
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        if (row.consumed_at) {
            return res.status(400).json({ error: 'Code already used. Request a new one.' });
        }
        if (new Date(row.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Code expired. Request a new one.' });
        }

        db.prepare("UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
        db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(userId);

        logAuditEvent('email_verified', userId, {}, req.ip, req.get('user-agent'));

        res.json({ success: true, verified: true });
    } catch (err: any) {
        console.error('Verify email error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// ─── POST /api/v1/auth/mfa/setup ─────────────────────────────
//
// Generates a fresh TOTP secret + 10 backup codes for the authed user. The
// secret is encrypted at rest (AES-256-GCM); backup codes are bcrypt-hashed.
// MFA is NOT yet active — the row's enabled_at stays NULL until the user
// confirms with /mfa/verify-setup.
//
// Returns the raw secret + provisioning URI + a pre-rendered QR data URL +
// backup codes (shown ONCE). Re-calling setup overwrites a pending (unenabled)
// row; once MFA is enabled, returns 409 — disable first.

router.post('/mfa/setup', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();
        const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        const existing = db.prepare('SELECT enabled_at FROM mfa_secrets WHERE user_id = ?').get(userId) as any;
        if (existing?.enabled_at) {
            return res.status(409).json({ error: 'MFA already enabled. Disable first to re-enroll.', code: 'mfa_already_enabled' });
        }

        const secret = generateTotpSecret();
        const enc = encryptSecret(secret);
        const otpauthUrl = buildOtpauthUri({ secret, accountLabel: user.email, issuer: 'Windy' });
        const backupCodes = generateBackupCodes();
        const backupHashes = await hashBackupCodes(backupCodes);

        db.prepare(
            "INSERT OR REPLACE INTO mfa_secrets (user_id, totp_secret_encrypted, totp_secret_iv, totp_secret_tag, backup_codes_hash, enabled_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))",
        ).run(userId, enc.ciphertext, enc.iv, enc.tag, JSON.stringify(backupHashes));

        // Lazy-load qrcode so test envs without it don't crash. PNG data URL
        // is convenient for HTML img tags in the setup screen.
        let qrCodeDataUrl: string | undefined;
        try {
            const QRCode = require('qrcode');
            qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 256, margin: 2 });
        } catch { /* qrcode optional */ }

        logAuditEvent('mfa_setup_started', userId, {}, req.ip, req.get('user-agent'));

        res.json({
            secret,         // base32 — for manual entry into authenticator apps
            otpauthUrl,     // for "scan QR" flow
            qrCodeDataUrl,  // pre-rendered PNG, optional
            backupCodes,    // shown ONCE — user must save them now
        });
    } catch (err: any) {
        console.error('MFA setup error:', err);
        res.status(500).json({ error: 'MFA setup failed' });
    }
});

// ─── POST /api/v1/auth/mfa/verify-setup ──────────────────────
//
// Confirms the user successfully enrolled their authenticator: validates a
// 6-digit TOTP code against the pending (unenabled) secret. On success, sets
// enabled_at — MFA is now active for login.

router.post('/mfa/verify-setup', authenticateToken, validate(MfaVerifySetupRequestSchema), (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const { code } = req.body;
        const db = getDb();
        const row = db.prepare('SELECT * FROM mfa_secrets WHERE user_id = ?').get(userId) as any;
        if (!row) return res.status(400).json({ error: 'No MFA setup in progress. Call /mfa/setup first.' });
        if (row.enabled_at) return res.status(409).json({ error: 'MFA already enabled.', code: 'mfa_already_enabled' });

        const secret = decryptSecret({
            ciphertext: row.totp_secret_encrypted,
            iv: row.totp_secret_iv,
            tag: row.totp_secret_tag,
        });
        if (!verifyTotpCode(secret, code)) {
            return res.status(400).json({ error: 'Invalid code. Make sure your authenticator clock is in sync.' });
        }

        db.prepare("UPDATE mfa_secrets SET enabled_at = datetime('now') WHERE user_id = ?").run(userId);
        logAuditEvent('mfa_enabled', userId, {}, req.ip, req.get('user-agent'));

        res.json({ success: true, enabled: true });
    } catch (err: any) {
        console.error('MFA verify-setup error:', err);
        res.status(500).json({ error: 'MFA verification failed' });
    }
});

// ─── POST /api/v1/auth/mfa/disable ───────────────────────────
//
// Removes the user's MFA row entirely. Requires password confirmation so a
// stolen access token alone can't disable MFA.

router.post('/mfa/disable', authenticateToken, validate(MfaDisableRequestSchema), async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const { password } = req.body;
        const db = getDb();
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Password incorrect' });
        }
        db.prepare('DELETE FROM mfa_secrets WHERE user_id = ?').run(userId);
        logAuditEvent('mfa_disabled', userId, {}, req.ip, req.get('user-agent'));
        res.json({ success: true });
    } catch (err: any) {
        console.error('MFA disable error:', err);
        res.status(500).json({ error: 'MFA disable failed' });
    }
});

// ─── POST /api/v1/auth/forgot-password ───────────────────────
//
// Always returns 200 (don't leak whether the email is registered). When the
// email IS known, generates a long random reset token, stores its sha256 in
// otp_codes (purpose='password_reset', 30min expiry), and emails the raw
// token. Rate limit: 3/hr per email + IP.

router.post('/forgot-password', forgotPasswordLimiter, validate(ForgotPasswordRequestSchema), async (req: Request, res: Response) => {
    try {
        // Same normalization function as the rate limiter's keyGenerator
        // — so per-email bucket and per-user DB lookup agree on identity.
        const email = normalizeEmail(req.body.email);
        const db = getDb();
        const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as any;

        if (user) {
            // 32-byte token base64url-encoded → ~43 chars, 256 bits of entropy.
            // Stored as sha256 hash; raw token only sent in the email.
            const token = crypto.randomBytes(32).toString('base64url');
            const tokenHash = hashOtp(token);
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

            // Invalidate prior unconsumed reset tokens for this user (one in flight at a time)
            db.prepare(
                "UPDATE otp_codes SET consumed_at = datetime('now') WHERE user_id = ? AND purpose = 'password_reset' AND consumed_at IS NULL",
            ).run(user.id);

            db.prepare(
                "INSERT INTO otp_codes (id, user_id, code_hash, purpose, expires_at) VALUES (?, ?, ?, 'password_reset', ?)",
            ).run(uuidv4(), user.id, tokenHash, expiresAt);

            const tpl = passwordResetEmail(token, process.env.PASSWORD_RESET_URL_BASE);
            const result = await sendMail({ ...tpl, to: user.email });

            logAuditEvent('password_reset_requested', user.id, { stub: !!result.stub }, req.ip, req.get('user-agent'));

            // Dev convenience: return raw token when no real mail provider is configured
            if (result.stub) {
                return res.json({ success: true, _devToken: token });
            }
        } else {
            // Even when the email is unknown, log the attempt for audit visibility
            // (without leaking via response shape) so abuse can be reviewed.
            logAuditEvent('password_reset_requested', null, { email, reason: 'email_not_found' }, req.ip, req.get('user-agent'));
        }

        res.json({ success: true });
    } catch (err: any) {
        console.error('Forgot password error:', err);
        // Even on internal error, don't leak — 200 keeps the email-existence oracle closed.
        res.json({ success: true });
    }
});

// ─── POST /api/v1/auth/reset-password ────────────────────────
//
// Consumes the reset token and sets the new password. Invalidates ALL refresh
// tokens for the user so any compromised session is forced off. The auth user
// herself will need to log in again on every device after reset.

router.post('/reset-password', validate(ResetPasswordRequestSchema), async (req: Request, res: Response) => {
    try {
        const { token, newPassword } = req.body;
        const tokenHash = hashOtp(token);
        const db = getDb();

        const row = db.prepare(
            "SELECT id, user_id, expires_at, consumed_at FROM otp_codes WHERE purpose = 'password_reset' AND code_hash = ? ORDER BY created_at DESC LIMIT 1",
        ).get(tokenHash) as { id: string; user_id: string; expires_at: string; consumed_at: string | null } | undefined;

        if (!row || row.consumed_at) {
            return res.status(400).json({ error: 'Invalid or already-used reset token' });
        }
        if (new Date(row.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Reset token expired. Request a new one.' });
        }

        const newHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);

        // Atomic-ish: consume the row, update password, kill all refresh tokens.
        // If any DB op fails, the user can retry — token is still consumed so
        // the same token can't be replayed.
        db.prepare("UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
        db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, row.user_id);
        db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(row.user_id);

        logAuditEvent('password_reset_completed', row.user_id, {}, req.ip, req.get('user-agent'));

        res.json({ success: true });
    } catch (err: any) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Password reset failed' });
    }
});

// ─── DELETE /api/v1/auth/me — GDPR self-deletion ────────────
// Also aliased as /delete-account for frontend compat (Profile.jsx)

const handleAccountDeletion = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();

        // Verify user exists. Pull the full identity row so we can fan out
        // identity.revoked BEFORE the cascade delete strips it.
        const user = db.prepare('SELECT id, email, password_hash, name, tier, created_at, windy_identity_id FROM users WHERE id = ?').get(userId) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Require password confirmation if provided (recommended but optional for backward compat)
        if (req.body?.password) {
            const passwordValid = await bcrypt.compare(req.body.password, user.password_hash);
            if (!passwordValid) {
                return res.status(401).json({ error: 'Password confirmation failed' });
            }
        }

        // PR4: Fan out identity.revoked BEFORE the cascade delete — we still
        // need email/identity for the consumers to deprovision their accounts.
        try {
            const { deliveryIds } = enqueueIdentityEvent('identity.revoked', {
                windy_identity_id: user.windy_identity_id || user.id,
                email: user.email,
                display_name: user.name,
                tier: user.tier,
                created_at: user.created_at,
            }, { revoked_at: new Date().toISOString(), reason: 'self_deleted' });
            setImmediate(async () => {
                for (const id of deliveryIds) {
                    try { await attemptDelivery(id); } catch { /* worker retries */ }
                }
            });
        } catch (e: any) {
            console.warn('[webhook-bus] identity.revoked enqueue failed:', e.message);
        }

        // Cascade delete all user data.
        //
        // Most user-scoped tables declare ON DELETE CASCADE on a foreign key
        // to users(id), and sqlite-adapter sets PRAGMA foreign_keys = ON at
        // boot — so the final `DELETE FROM users` would cascade them anyway.
        // We still run explicit DELETEs so:
        //   (a) tables that lack a FK declaration get cleaned (webhook_deliveries,
        //       analytics_events — both carry user identifying data and have
        //       no FK, so they'd survive the cascade);
        //   (b) Postgres-adapter (when we migrate) sees the same behavior
        //       regardless of whether we add FKs then.
        //
        // Wave 7 P0-5 added the three trailing entries. Any new user-scoped
        // table MUST be added here — tests/account-delete-cascade.test.ts
        // enforces "no rows matching deleted user across every user-scoped
        // table" so forgetting an entry fails the suite.
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
            // P0-5: GDPR right-to-erasure — these tables have no FK, so the
            // final DELETE FROM users wouldn't cascade-clean them.
            'DELETE FROM mfa_secrets WHERE user_id = ?',
            'DELETE FROM otp_codes WHERE user_id = ?',
            'DELETE FROM webhook_deliveries WHERE identity_id = ?',
            'DELETE FROM analytics_events WHERE user_id = ?',
            'DELETE FROM sync_queue WHERE session_id IN (SELECT bundle_id FROM recordings WHERE user_id = ?)',
            'DELETE FROM clone_training_jobs WHERE user_id = ?',
            'DELETE FROM oauth_consents WHERE identity_id = ?',
            'DELETE FROM oauth_codes WHERE identity_id = ?',
            'DELETE FROM oauth_device_codes WHERE identity_id = ?',
            'DELETE FROM secretary_consents WHERE owner_identity_id = ? OR bot_identity_id = ?',
            'DELETE FROM pending_provisions WHERE identity_id = ?',
        ];

        for (const sql of tables) {
            try {
                // secretary_consents takes userId twice (owner OR bot side)
                if (sql.includes('? OR bot_identity_id')) db.prepare(sql).run(userId, userId);
                else db.prepare(sql).run(userId);
            } catch { /* table may not exist on older migrations */ }
        }

        // Delete the user record last
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        // P0-5: Audit the deletion WITHOUT the user's own identity_id, so the
        // right-to-erasure invariant ("no rows matching deleted user id")
        // holds while we still keep a trail that the action happened.
        // Email is hashed for the audit entry so it stays traceable across a
        // support case without storing the plaintext address.
        const emailHash = crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 16);
        logAuditEvent('account_self_deleted', null, { emailHash }, req.ip, req.get('user-agent'));

        console.log(`🗑️  Account self-deleted: ${user.email} (${userId.slice(0, 8)}...)`);

        res.json({ deleted: true });
    } catch (err: any) {
        console.error('Account deletion error:', err);
        res.status(500).json({ error: 'Account deletion failed' });
    }
};

router.delete('/me', authenticateToken, handleAccountDeletion);
router.delete('/delete-account', authenticateToken, handleAccountDeletion);

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

        const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://windyword.ai/dashboard';
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
