/**
 * OAuth helpers — shared building blocks for every "Sign in with X" provider
 * (Google, GitHub, Apple, Facebook, …).
 *
 * Each provider file owns its own /start + /callback shape, but everything
 * post-userinfo (state signing, user upsert, ecosystem provisioning, JWT
 * minting + fragment redirect) routes through here so behavior stays
 * identical across providers.
 *
 * Linkage strategy (matches the v1 design committed in feat/oauth-multi):
 *   1. Look up by (provider, provider_user_id) in oauth_identities first —
 *      this is the only stable identifier across renames / email changes.
 *   2. Fall back to email IF the IDP attests email_verified=true. We link
 *      the new (provider, provider_user_id) tuple to the existing user.
 *   3. Otherwise, mint a new user and link.
 *
 * Apple's quirk that name+email arrive only on the FIRST authorization is
 * handled by the (provider, provider_user_id) lookup on subsequent logins.
 * Facebook's "no email available" surfaces as OAUTH_NO_EMAIL — caller maps
 * to a fragment error and the SPA can prompt for an email.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { Response } from 'express';
import { config } from '../config';
import { getDb } from '../db/schema';
import { generateTokens } from './auth';
import { provisionProductAsync, grantScopesAsync } from '../identity-service';
import { provisionEcosystem } from '../services/ecosystem-provisioner';
import { trackEventAsync } from '../services/analytics';
import { enqueueIdentityEvent, attemptDelivery } from '../services/webhook-bus';
import { makeRateLimiter } from '../services/rate-limiter';

const STATE_TTL_MS = 10 * 60 * 1000;

// HMAC-signed stateless state. Avoids a state cookie because in dev the SPA
// at :5173 proxies /api/v1/* to the account-server at :8098, but the IDP
// redirects directly to :8098 — cookies set via the proxy don't carry to
// the direct origin. HMAC sidesteps this entirely.
export function signOAuthState(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = crypto.createHmac('sha256', config.JWT_SECRET).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string | undefined | null): boolean {
    if (!state) return false;
    const parts = state.split('.');
    if (parts.length !== 3) return false;
    const [nonce, ts, sig] = parts;
    if (!nonce || !ts || !sig) return false;
    const payload = `${nonce}.${ts}`;
    const expected = crypto.createHmac('sha256', config.JWT_SECRET).update(payload).digest('hex');
    if (sig.length !== expected.length) return false;
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false;
    } catch { return false; }
    const age = Date.now() - parseInt(ts, 10);
    return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_MS;
}

export type OAuthProvider = 'google' | 'github' | 'apple' | 'facebook';

export interface OAuthUserInfo {
    provider: OAuthProvider;
    providerUserId: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
}

export interface UpsertResult {
    user: { id: string; email: string; name: string; tier: string; windy_identity_id?: string };
    isNewUser: boolean;
}

export class OAuthNoEmailError extends Error {
    constructor() { super('OAUTH_NO_EMAIL'); this.name = 'OAuthNoEmailError'; }
}

/**
 * Find-or-create a Windy user for an OAuth identity. Idempotent: re-runs
 * with the same (provider, provider_user_id) always return the existing
 * user with isNewUser=false.
 */
export async function upsertUserFromOAuth(info: OAuthUserInfo): Promise<UpsertResult> {
    const db = getDb();

    // 1) Existing linkage wins. This is the only path that handles Apple's
    //    "name+email only on first login" quirk for subsequent logins.
    const linked = await db.getAsync<any>(
        `SELECT u.* FROM users u
           JOIN oauth_identities oi ON oi.user_id = u.id
          WHERE oi.provider = ? AND oi.provider_user_id = ?`,
        info.provider, info.providerUserId,
    );
    if (linked) {
        return {
            user: {
                id: linked.id,
                email: linked.email,
                name: linked.name,
                tier: linked.tier || 'free',
                windy_identity_id: linked.windy_identity_id,
            },
            isNewUser: false,
        };
    }

    // 2) Verified-email linkage. Safe when the IDP attests verification; we
    //    refuse otherwise because an unverified provider-side email is
    //    spoofable and would enable account takeover.
    if (info.email && info.emailVerified) {
        const emailLower = info.email.toLowerCase();
        const existing = await db.getAsync<any>(
            'SELECT * FROM users WHERE email = ?', emailLower,
        );
        if (existing) {
            await db.runAsync(
                `INSERT OR IGNORE INTO oauth_identities
                    (user_id, provider, provider_user_id, email_at_link)
                 VALUES (?, ?, ?, ?)`,
                existing.id, info.provider, info.providerUserId, emailLower,
            );
            return {
                user: {
                    id: existing.id,
                    email: existing.email,
                    name: existing.name,
                    tier: existing.tier || 'free',
                    windy_identity_id: existing.windy_identity_id,
                },
                isNewUser: false,
            };
        }
    }

    // 3) New user. Email is required for first-time signup — no way to
    //    create a contactable Windy account without it.
    if (!info.email) {
        throw new OAuthNoEmailError();
    }

    const emailLower = info.email.toLowerCase();
    const userId = uuidv4();
    const windyIdentityId = crypto.randomUUID();
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, config.BCRYPT_ROUNDS);
    const displayName = info.name || emailLower.split('@')[0];

    await db.runAsync(
        'INSERT INTO users (id, email, name, password_hash, tier) VALUES (?, ?, ?, ?, ?)',
        userId, emailLower, displayName, passwordHash, 'free',
    );
    try { await db.runAsync('UPDATE users SET windy_identity_id = ? WHERE id = ?', windyIdentityId, userId); } catch { /* column may not exist on first migration cycle */ }
    if (info.emailVerified) {
        try { await db.runAsync("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?", userId); } catch { /* SQLite-only column */ }
        try { await db.runAsync('UPDATE users SET email_verified = 1 WHERE id = ?', userId); } catch { /* integer flag column */ }
    }
    await db.runAsync(
        `INSERT OR IGNORE INTO oauth_identities
            (user_id, provider, provider_user_id, email_at_link)
         VALUES (?, ?, ?, ?)`,
        userId, info.provider, info.providerUserId, emailLower,
    );

    await provisionProductAsync(userId, 'windy_pro', { tier: 'free', registeredVia: `${info.provider}_oauth` });
    await grantScopesAsync(userId, ['windy_pro:*'], 'registration');
    await provisionProductAsync(userId, 'windy_chat', { status: 'pending', registeredVia: `${info.provider}_oauth` });
    try {
        await db.runAsync(
            "UPDATE product_accounts SET status = 'pending' WHERE identity_id = ? AND product = 'windy_chat'",
            userId,
        );
    } catch { /* non-critical */ }

    await trackEventAsync('user_registered', userId);
    console.log(`✅ ${info.provider} sign-in registered: ${emailLower} (${userId.slice(0, 8)}...)`);

    // Fan out identity.created off the response path.
    try {
        const { deliveryIds } = enqueueIdentityEvent('identity.created', {
            windy_identity_id: windyIdentityId,
            email: emailLower,
            display_name: displayName,
            tier: 'free',
            created_at: new Date().toISOString(),
        });
        setImmediate(async () => {
            for (const id of deliveryIds) {
                try { await attemptDelivery(id); } catch { /* worker retries */ }
            }
        });
    } catch (e: any) {
        console.warn('[webhook-bus] identity.created enqueue failed:', e.message);
    }

    setImmediate(async () => {
        try { await provisionEcosystem(userId, emailLower, displayName); }
        catch (err: any) { console.warn('[Ecosystem] Auto-provision failed (non-fatal):', err.message); }
    });

    return {
        user: { id: userId, email: emailLower, name: displayName, tier: 'free', windy_identity_id: windyIdentityId },
        isNewUser: true,
    };
}

/**
 * Mint a Windy JWT for the OAuth user and 302 the browser back to the SPA
 * with tokens in the URL fragment. Fragments are not sent to the server in
 * subsequent requests and don't show up in access logs.
 */
export function redirectWithTokens(
    res: Response,
    postLoginRedirect: string,
    payload: { user: { id: string; email: string; name?: string | null; tier?: string }; isNewUser: boolean },
): void {
    const tokens = generateTokens({
        id: payload.user.id,
        email: payload.user.email,
        tier: payload.user.tier || 'free',
    });
    const params = new URLSearchParams({
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        userId: payload.user.id,
        email: payload.user.email,
        name: payload.user.name || payload.user.email.split('@')[0],
        tier: payload.user.tier || 'free',
        newUser: payload.isNewUser ? '1' : '0',
    });
    res.redirect(`${postLoginRedirect}#${params.toString()}`);
}

export function makeOAuthLimiters(provider: OAuthProvider) {
    return {
        start: makeRateLimiter(`oauth-${provider}-start`, {
            windowMs: 60 * 1000,
            max: 20,
            message: { error: 'Too many sign-in attempts. Try again shortly.' },
            standardHeaders: true,
            legacyHeaders: false,
        }),
        callback: makeRateLimiter(`oauth-${provider}-callback`, {
            windowMs: 60 * 1000,
            max: 30,
            message: { error: 'Too many callback requests.' },
            standardHeaders: true,
            legacyHeaders: false,
        }),
    };
}
