/**
 * Apple OAuth — "Sign in with Apple" for windyword.ai (web flow).
 *
 * Apple's web flow has three quirks vs. Google/GitHub:
 *
 *   1. The OAuth client secret is NOT a static string. It's a short-lived
 *      ES256 JWT we mint server-side from APPLE_PRIVATE_KEY (.p8) +
 *      APPLE_KEY_ID + APPLE_TEAM_ID, audience appleid.apple.com.
 *
 *   2. There is no /userinfo endpoint. Identity claims (sub, email,
 *      email_verified, is_private_email) live inside the `id_token` returned
 *      by /auth/token. We verify it against the Apple JWKS at
 *      https://appleid.apple.com/auth/keys before trusting any claim.
 *
 *   3. The user's name+email arrive ONLY on the FIRST authorization, in a
 *      `user` form-post param. Subsequent authorizations expose only `sub`
 *      via the id_token. We persist immediately on first call; the
 *      (provider, provider_user_id) lookup in the OAuth helper handles
 *      every subsequent login.
 *
 *   4. Web flow uses response_mode=form_post → the callback is POST, not GET.
 *      Apple posts application/x-www-form-urlencoded with state + code +
 *      optional id_token + optional `user` JSON.
 *
 * Provisioning Apple Sign In (one-time, per environment):
 *   developer.apple.com → Certificates, Identifiers & Profiles →
 *     1. Identifiers → "+" → Services IDs → name "Windy Word Web"
 *        identifier `ai.windyword.signin` (or similar).
 *        Configure Sign In with Apple → primary App ID
 *        uk.thewindstorm.windypro, Domains: windyword.ai,
 *        Return URLs: https://account.windyword.ai/api/v1/auth/oauth/apple/callback
 *     2. Keys → "+" → name "Windy Word Sign In", enable Sign in with Apple,
 *        primary App ID uk.thewindstorm.windypro. Download the .p8
 *        (one-time only) — save to ACCESS_LOCKBOX.md §"Apple Sign In Key".
 *        Note the Key ID (10 chars) for APPLE_KEY_ID.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logAuditEventAsync } from '../identity-service';
import {
    signOAuthState,
    verifyOAuthState,
    upsertUserFromOAuth,
    redirectWithTokens,
    makeOAuthLimiters,
    OAuthNoEmailError,
} from './_oauth-helpers';

const router = Router();

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

const limiters = makeOAuthLimiters('apple');

function configured(): boolean {
    const hasKey = Boolean(config.APPLE_PRIVATE_KEY || config.APPLE_PRIVATE_KEY_PATH);
    return Boolean(
        config.APPLE_TEAM_ID
        && config.APPLE_SERVICES_ID
        && config.APPLE_KEY_ID
        && hasKey
        && config.APPLE_OAUTH_REDIRECT_URI,
    );
}

function postLoginRedirect(): string {
    return config.APPLE_OAUTH_POST_LOGIN_REDIRECT || 'http://localhost:5173/auth/oauth/finish';
}

function loadApplePrivateKey(): string {
    if (config.APPLE_PRIVATE_KEY) {
        // Allow .env to ship the key with literal \n escapes.
        return config.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    }
    if (config.APPLE_PRIVATE_KEY_PATH) {
        return fs.readFileSync(config.APPLE_PRIVATE_KEY_PATH, 'utf8');
    }
    throw new Error('Apple private key not configured');
}

/**
 * Apple's client_secret is an ES256 JWT, max 6 months TTL. We re-mint per
 * token-exchange call (cheap; ~1ms) to avoid managing key rotation in app
 * memory.
 */
function mintAppleClientSecret(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: config.APPLE_TEAM_ID,
        iat: now,
        exp: now + 5 * 60,                          // 5 min — Apple accepts up to 6 months
        aud: APPLE_ISSUER,
        sub: config.APPLE_SERVICES_ID,
    };
    const privateKey = loadApplePrivateKey();
    return jwt.sign(payload, privateKey, {
        algorithm: 'ES256',
        keyid: config.APPLE_KEY_ID,
    });
}

// ─── Apple JWKS cache ──────────────────────────────────────────
//
// Apple rotates signing keys periodically; we cache for 10 minutes and
// refetch on cache miss (kid not found in cached set).

interface AppleJwk { kid: string; kty: string; use: string; alg: string; n: string; e: string }
let jwksCache: { keys: AppleJwk[]; expires: number } | null = null;

async function fetchAppleJwks(force = false): Promise<AppleJwk[]> {
    const now = Date.now();
    if (!force && jwksCache && jwksCache.expires > now) {
        return jwksCache.keys;
    }
    const res = await fetch(APPLE_JWKS_URL);
    if (!res.ok) {
        throw new Error(`Apple JWKS fetch failed: ${res.status}`);
    }
    const body = await res.json() as { keys: AppleJwk[] };
    jwksCache = { keys: body.keys, expires: now + 10 * 60 * 1000 };
    return body.keys;
}

function jwkToPublicKeyPem(jwk: AppleJwk): string {
    const key = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
    return key.export({ type: 'spki', format: 'pem' }) as string;
}

interface AppleIdTokenClaims {
    sub: string;
    email?: string;
    email_verified?: boolean | 'true' | 'false';
    is_private_email?: boolean | 'true' | 'false';
    iss: string;
    aud: string;
    exp: number;
}

async function verifyAppleIdToken(idToken: string): Promise<AppleIdTokenClaims> {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
        throw new Error('id_token missing kid');
    }
    const kid = decoded.header.kid;

    let keys = await fetchAppleJwks();
    let jwk = keys.find(k => k.kid === kid);
    if (!jwk) {
        // Possibly a key rotation since our last fetch.
        keys = await fetchAppleJwks(true);
        jwk = keys.find(k => k.kid === kid);
    }
    if (!jwk) {
        throw new Error(`Unknown Apple signing kid: ${kid}`);
    }

    const pem = jwkToPublicKeyPem(jwk);
    const verified = jwt.verify(idToken, pem, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: config.APPLE_SERVICES_ID,
    }) as AppleIdTokenClaims;

    return verified;
}

// ─── GET /api/v1/auth/oauth/apple/start ──────────────────────
router.get('/start', limiters.start, (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).json({
            error: 'Apple sign-in is not configured on this server.',
        });
    }

    const state = signOAuthState();
    const params = new URLSearchParams({
        client_id: config.APPLE_SERVICES_ID,
        redirect_uri: config.APPLE_OAUTH_REDIRECT_URI,
        response_type: 'code id_token',
        response_mode: 'form_post',
        scope: 'name email',
        state,
    });
    res.redirect(`${APPLE_AUTH_URL}?${params.toString()}`);
});

// ─── POST /api/v1/auth/oauth/apple/callback ──────────────────
//
// Apple sends a form_post with state + code + id_token + (optional first-auth) user JSON.
router.post('/callback', limiters.callback, async (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).send('Apple sign-in is not configured on this server.');
    }

    const code = typeof req.body.code === 'string' ? req.body.code : undefined;
    const state = typeof req.body.state === 'string' ? req.body.state : undefined;
    const formIdToken = typeof req.body.id_token === 'string' ? req.body.id_token : undefined;
    const userJson = typeof req.body.user === 'string' ? req.body.user : undefined;
    const appleError = typeof req.body.error === 'string' ? req.body.error : undefined;

    if (appleError) {
        return res.redirect(`${postLoginRedirect()}#error=${encodeURIComponent(appleError)}`);
    }

    if (!code || !verifyOAuthState(state)) {
        return res.status(400).send('Invalid OAuth state. Please start the sign-in flow again.');
    }

    // Parse the first-auth `user` blob if present.
    let firstAuthName: string | null = null;
    let firstAuthEmail: string | null = null;
    if (userJson) {
        try {
            const parsed = JSON.parse(userJson) as { name?: { firstName?: string; lastName?: string }; email?: string };
            const first = parsed.name?.firstName || '';
            const last = parsed.name?.lastName || '';
            const combined = `${first} ${last}`.trim();
            if (combined) firstAuthName = combined;
            if (parsed.email) firstAuthEmail = parsed.email;
        } catch {
            // Apple's user JSON is best-effort; ignore parse failures.
        }
    }

    // Exchange code → id_token. We do this even if Apple already form-posted
    // an id_token, because the token endpoint is the canonical issuer and
    // some flows omit the form id_token.
    let idToken: string | undefined = formIdToken;
    try {
        const clientSecret = mintAppleClientSecret();
        const tokenRes = await fetch(APPLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.APPLE_SERVICES_ID,
                client_secret: clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: config.APPLE_OAUTH_REDIRECT_URI,
            }).toString(),
        });
        if (!tokenRes.ok) {
            const body = await tokenRes.text();
            console.error('[apple-oauth] Token exchange failed:', tokenRes.status, body);
            return res.redirect(`${postLoginRedirect()}#error=token_exchange_failed`);
        }
        const tokenJson = await tokenRes.json() as { id_token?: string; access_token?: string };
        if (tokenJson.id_token) idToken = tokenJson.id_token;
    } catch (err: any) {
        console.error('[apple-oauth] Network error during token exchange:', err);
        return res.redirect(`${postLoginRedirect()}#error=network`);
    }

    if (!idToken) {
        return res.redirect(`${postLoginRedirect()}#error=no_id_token`);
    }

    let claims: AppleIdTokenClaims;
    try {
        claims = await verifyAppleIdToken(idToken);
    } catch (err: any) {
        console.error('[apple-oauth] id_token verification failed:', err.message);
        return res.redirect(`${postLoginRedirect()}#error=invalid_id_token`);
    }

    // Apple sometimes returns email_verified as the string "true"/"false".
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    const email = claims.email || firstAuthEmail || null;

    try {
        const { user, isNewUser } = await upsertUserFromOAuth({
            provider: 'apple',
            providerUserId: claims.sub,
            email,
            emailVerified,
            name: firstAuthName,
        });

        await logAuditEventAsync(
            isNewUser ? 'register' : 'login',
            user.id,
            { email: user.email, via: 'apple_oauth', appleSub: claims.sub, privateRelay: claims.is_private_email === true || claims.is_private_email === 'true' },
            req.ip,
            req.get('user-agent'),
        );

        return redirectWithTokens(res, postLoginRedirect(), {
            user: { id: user.id, email: user.email, name: user.name, tier: user.tier },
            isNewUser,
        });
    } catch (err: any) {
        if (err instanceof OAuthNoEmailError) {
            // Apple guarantees an email on first auth (private relay if hidden);
            // hitting this means we've seen this sub before but it's not linked.
            return res.redirect(`${postLoginRedirect()}#error=no_email`);
        }
        console.error('[apple-oauth] Upsert failed:', err);
        return res.redirect(`${postLoginRedirect()}#error=server_error`);
    }
});

export default router;
