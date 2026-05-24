/**
 * Google OAuth — "Sign in with Google" for windyword.ai
 *
 * Implements the OAuth 2.0 authorization code flow as a *consumer* (Google is
 * the provider). Distinct from src/routes/oauth.ts, which makes Windy itself
 * an OAuth provider — that's the "Sign in with Windy" path.
 *
 * Flow:
 *   1. Browser hits GET /api/v1/auth/oauth/google/start
 *      → we sign a stateless `state` and 302 to Google's authorization endpoint.
 *   2. User consents, Google redirects to /callback?code=...&state=...
 *   3. We verify state, POST the code to Google's token endpoint, get an
 *      access token, GET userinfo, find-or-create the Windy user via the
 *      shared OAuth helper, mint a Windy JWT, and 302 to the SPA's finish
 *      page with the tokens in the URL fragment.
 *
 * Pre-prod: this client is in Testing mode with hand-curated test users.
 * Before public traffic, rotate the secret and publish the consent screen.
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { generateTokens as _unusedGenerateTokens } from './auth';   // keep import path stable
import { logAuditEventAsync } from '../identity-service';
import {
    signOAuthState,
    verifyOAuthState,
    upsertUserFromOAuth,
    redirectWithTokens,
    makeOAuthLimiters,
    OAuthNoEmailError,
} from './_oauth-helpers';

// keep the helper import side-effect-free
void _unusedGenerateTokens;

const router = Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const limiters = makeOAuthLimiters('google');

function configured(): boolean {
    return Boolean(config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET && config.GOOGLE_OAUTH_REDIRECT_URI);
}

function postLoginRedirect(): string {
    return config.GOOGLE_OAUTH_POST_LOGIN_REDIRECT || 'http://localhost:5173/auth/google/finish';
}

// ─── GET /api/v1/auth/oauth/google/start ──────────────────────
router.get('/start', limiters.start, (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).json({
            error: 'Google sign-in is not configured on this server.',
        });
    }

    const state = signOAuthState();

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
router.get('/callback', limiters.callback, async (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).send('Google sign-in is not configured on this server.');
    }

    const { code, state, error: googleError } = req.query as { code?: string; state?: string; error?: string };

    if (googleError) {
        return res.redirect(`${postLoginRedirect()}#error=${encodeURIComponent(googleError)}`);
    }

    if (!code || !verifyOAuthState(state)) {
        return res.status(400).send('Invalid OAuth state. Please start the sign-in flow again.');
    }

    let userInfo: { sub: string; email: string; name?: string; picture?: string; email_verified?: boolean };
    try {
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

    try {
        const { user, isNewUser } = await upsertUserFromOAuth({
            provider: 'google',
            providerUserId: userInfo.sub,
            email: userInfo.email,
            // Google's email_verified is true for any consumer account; default
            // to true when the claim is missing because the consent screen
            // only releases email after Google has verified it.
            emailVerified: userInfo.email_verified !== false,
            name: userInfo.name || null,
        });

        await logAuditEventAsync(
            isNewUser ? 'register' : 'login',
            user.id,
            { email: user.email, via: 'google_oauth', googleSub: userInfo.sub },
            req.ip,
            req.get('user-agent'),
        );

        return redirectWithTokens(res, postLoginRedirect(), {
            user: { id: user.id, email: user.email, name: user.name, tier: user.tier },
            isNewUser,
        });
    } catch (err: any) {
        if (err instanceof OAuthNoEmailError) {
            return res.redirect(`${postLoginRedirect()}#error=no_email`);
        }
        console.error('[google-oauth] Upsert failed:', err);
        return res.redirect(`${postLoginRedirect()}#error=server_error`);
    }
});

export default router;
