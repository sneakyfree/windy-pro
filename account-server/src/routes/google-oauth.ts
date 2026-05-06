/**
 * Google OAuth — "Sign in with Google" for windyword.ai
 *
 * Implements the OAuth 2.0 authorization code flow as a *consumer* (Google is
 * the provider). Distinct from src/routes/oauth.ts, which makes Windy itself
 * an OAuth provider — that's the "Sign in with Windy" path.
 *
 * Flow:
 *   1. Browser hits GET /api/v1/auth/oauth/google/start
 *      → we set a state cookie, 302 to Google's authorization endpoint.
 *   2. User consents, Google redirects to /callback?code=...&state=...
 *   3. We verify state, POST the code to Google's token endpoint, get an
 *      access token, GET userinfo, find-or-create the Windy user, mint a
 *      Windy JWT, and 302 to the SPA's finish page with the tokens in the
 *      URL fragment (so they're not sent to the server / not server-logged).
 *
 * Why not google-auth-library: avoiding the dep keeps the bundle lean and
 * the surface area small. Google's userinfo endpoint validates the access
 * token server-side; we don't need to verify the ID token cryptographically
 * for a basic signup/login flow.
 *
 * Pre-prod: this client is in Testing mode with hand-curated test users.
 * Before public traffic, rotate the secret and publish the consent screen.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { getDb } from '../db/schema';
import { generateTokens } from './auth';
import {
    logAuditEventAsync,
    provisionProductAsync,
    grantScopesAsync,
} from '../identity-service';
import { provisionEcosystem } from '../services/ecosystem-provisioner';
import { trackEventAsync } from '../services/analytics';
import { enqueueIdentityEvent, attemptDelivery } from '../services/webhook-bus';
import { makeRateLimiter } from '../services/rate-limiter';

const router = Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const STATE_TTL_MS = 10 * 60 * 1000;

// HMAC-signed stateless state. We avoid a state cookie because in dev the
// SPA at :5173 proxies /api/v1/* to the account-server at :8098, but Google
// redirects directly to :8098 — cookies set via the proxy don't carry to the
// direct origin. HMAC sidesteps this entirely.
function signState(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const ts = Date.now().toString();
    const payload = `${nonce}.${ts}`;
    const sig = crypto.createHmac('sha256', config.JWT_SECRET).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

function verifyState(state: string | undefined): boolean {
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

const startLimiter = makeRateLimiter('oauth-google-start', {
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Too many sign-in attempts. Try again shortly.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const callbackLimiter = makeRateLimiter('oauth-google-callback', {
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many callback requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

function configured(): boolean {
    return Boolean(config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET && config.GOOGLE_OAUTH_REDIRECT_URI);
}

function postLoginRedirect(): string {
    return config.GOOGLE_OAUTH_POST_LOGIN_REDIRECT || 'http://localhost:5173/auth/google/finish';
}

// ─── GET /api/v1/auth/oauth/google/start ──────────────────────
//
// Browser hits this when the user clicks "Continue with Google."
// We set a short-lived state cookie and 302 to Google.
router.get('/start', startLimiter, (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).json({
            error: 'Google sign-in is not configured on this server.',
        });
    }

    const state = signState();

    const params = new URLSearchParams({
        client_id: config.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
    });

    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

// ─── GET /api/v1/auth/oauth/google/callback ───────────────────
//
// Google redirects here after the user consents. We verify state, exchange
// the code for an access token, fetch userinfo, find-or-create the user,
// and bounce back to the SPA with a Windy JWT.
router.get('/callback', callbackLimiter, async (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).send('Google sign-in is not configured on this server.');
    }

    const { code, state, error: googleError } = req.query as { code?: string; state?: string; error?: string };

    if (googleError) {
        // User clicked "Cancel" on Google's consent page, or the project's
        // not in their test-user list. Surface the reason to the SPA so it
        // can show a friendly message instead of a blank screen.
        return res.redirect(`${postLoginRedirect()}#error=${encodeURIComponent(googleError)}`);
    }

    if (!code || !verifyState(state)) {
        return res.status(400).send('Invalid OAuth state. Please start the sign-in flow again.');
    }

    let userInfo: { sub: string; email: string; name?: string; picture?: string; email_verified?: boolean };
    try {
        // Exchange the auth code for an access token.
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: config.GOOGLE_OAUTH_CLIENT_ID,
                client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
                redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
                grant_type: 'authorization_code',
            }).toString(),
        });
        if (!tokenRes.ok) {
            const body = await tokenRes.text();
            console.error('[google-oauth] Token exchange failed:', tokenRes.status, body);
            return res.redirect(`${postLoginRedirect()}#error=token_exchange_failed`);
        }
        const tokenJson = await tokenRes.json() as { access_token?: string };
        if (!tokenJson.access_token) {
            return res.redirect(`${postLoginRedirect()}#error=no_access_token`);
        }

        // Use the access token to fetch the user's email + name + sub.
        const userRes = await fetch(GOOGLE_USERINFO_URL, {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        if (!userRes.ok) {
            return res.redirect(`${postLoginRedirect()}#error=userinfo_failed`);
        }
        userInfo = await userRes.json() as typeof userInfo;
    } catch (err: any) {
        console.error('[google-oauth] Network error during callback:', err);
        return res.redirect(`${postLoginRedirect()}#error=network`);
    }

    if (!userInfo.email) {
        return res.redirect(`${postLoginRedirect()}#error=no_email`);
    }

    const email = userInfo.email.toLowerCase();
    const db = getDb();

    // Find or create. We use email as the linkage key for v0 — Google enforces
    // email uniqueness within consumer accounts, and email-verified is true
    // for any account old enough to sign in. A future migration can add a
    // google_sub column for stricter linking.
    let user = await db.getAsync<any>('SELECT * FROM users WHERE email = ?', email);
    let isNewUser = false;

    if (!user) {
        // Create a fresh user. Random password — Google sign-in is the only
        // way in until they hit /forgot-password to set one explicitly.
        const userId = uuidv4();
        const windyIdentityId = crypto.randomUUID();
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, config.BCRYPT_ROUNDS);
        const displayName = userInfo.name || email.split('@')[0];

        await db.runAsync(
            'INSERT INTO users (id, email, name, password_hash, tier) VALUES (?, ?, ?, ?, ?)',
            userId, email, displayName, passwordHash, 'free',
        );
        try {
            await db.runAsync('UPDATE users SET windy_identity_id = ? WHERE id = ?', windyIdentityId, userId);
        } catch { /* column may not exist on first migration cycle */ }

        // Mark email as verified — Google already confirmed it.
        try {
            await db.runAsync("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?", userId);
        } catch { /* column may not exist yet */ }

        await provisionProductAsync(userId, 'windy_pro', { tier: 'free', registeredVia: 'google_oauth' });
        await grantScopesAsync(userId, ['windy_pro:*'], 'registration');
        await provisionProductAsync(userId, 'windy_chat', { status: 'pending', registeredVia: 'google_oauth' });
        try {
            await db.runAsync(
                "UPDATE product_accounts SET status = 'pending' WHERE identity_id = ? AND product = 'windy_chat'",
                userId,
            );
        } catch { /* non-critical */ }

        user = { id: userId, email, name: displayName, tier: 'free', windy_identity_id: windyIdentityId };
        isNewUser = true;

        await trackEventAsync('user_registered', userId);
        console.log(`✅ Google sign-in registered: ${email} (${userId.slice(0, 8)}...)`);

        // Fan out identity.created off the response path.
        try {
            const { deliveryIds } = enqueueIdentityEvent('identity.created', {
                windy_identity_id: windyIdentityId,
                email,
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
            try { await provisionEcosystem(userId, email, displayName); }
            catch (err: any) { console.warn('[Ecosystem] Auto-provision failed (non-fatal):', err.message); }
        });
    }

    const tokens = generateTokens({ id: user.id, email, tier: user.tier || 'free' });

    await logAuditEventAsync(
        isNewUser ? 'register' : 'login',
        user.id,
        { email, via: 'google_oauth', googleSub: userInfo.sub },
        req.ip,
        req.get('user-agent'),
    );

    // Tokens go in the URL fragment (after `#`) — fragments are not sent to
    // the server in subsequent requests and don't appear in server access logs.
    const params = new URLSearchParams({
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        userId: user.id,
        email,
        name: user.name || email.split('@')[0],
        tier: user.tier || 'free',
        newUser: isNewUser ? '1' : '0',
    });
    res.redirect(`${postLoginRedirect()}#${params.toString()}`);
});

export default router;
