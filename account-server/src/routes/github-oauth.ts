/**
 * GitHub OAuth — "Sign in with GitHub" for windyword.ai
 *
 * Flow mirrors google-oauth.ts. Two GitHub-specific notes:
 *   1. The /user endpoint returns email=null when the user has chosen to
 *      keep their primary email private. We always hit /user/emails after
 *      to find the verified primary — that requires user:email scope.
 *   2. /user/emails is the only place GitHub exposes the `verified` flag.
 *      We refuse to link to an existing Windy account unless GitHub
 *      attests the email is verified, to prevent takeover.
 *
 * Provisioning the GitHub OAuth App (one-time, per environment):
 *   https://github.com/settings/developers → New OAuth App
 *     Homepage URL:    https://windyword.ai
 *     Callback URL:    https://account.windyword.ai/api/v1/auth/oauth/github/callback
 *   Save Client ID + Secret to ACCESS_LOCKBOX.md under §9 GITHUB.
 */
import { Router, Request, Response } from 'express';
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

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

const limiters = makeOAuthLimiters('github');

function configured(): boolean {
    return Boolean(
        config.GITHUB_OAUTH_CLIENT_ID
        && config.GITHUB_OAUTH_CLIENT_SECRET
        && config.GITHUB_OAUTH_REDIRECT_URI,
    );
}

function postLoginRedirect(): string {
    return config.GITHUB_OAUTH_POST_LOGIN_REDIRECT || 'http://localhost:5173/auth/oauth/finish';
}

// ─── GET /api/v1/auth/oauth/github/start ──────────────────────
router.get('/start', limiters.start, (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).json({
            error: 'GitHub sign-in is not configured on this server.',
        });
    }

    const state = signOAuthState();
    const params = new URLSearchParams({
        client_id: config.GITHUB_OAUTH_CLIENT_ID,
        redirect_uri: config.GITHUB_OAUTH_REDIRECT_URI,
        scope: 'read:user user:email',
        state,
        allow_signup: 'true',
    });
    res.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
});

// ─── GET /api/v1/auth/oauth/github/callback ───────────────────
router.get('/callback', limiters.callback, async (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).send('GitHub sign-in is not configured on this server.');
    }

    const { code, state, error: githubError } = req.query as { code?: string; state?: string; error?: string };

    if (githubError) {
        return res.redirect(`${postLoginRedirect()}#error=${encodeURIComponent(githubError)}`);
    }

    if (!code || !verifyOAuthState(state)) {
        return res.status(400).send('Invalid OAuth state. Please start the sign-in flow again.');
    }

    let accessToken: string;
    try {
        const tokenRes = await fetch(GITHUB_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({
                client_id: config.GITHUB_OAUTH_CLIENT_ID,
                client_secret: config.GITHUB_OAUTH_CLIENT_SECRET,
                code,
                redirect_uri: config.GITHUB_OAUTH_REDIRECT_URI,
            }).toString(),
        });
        if (!tokenRes.ok) {
            const body = await tokenRes.text();
            console.error('[github-oauth] Token exchange failed:', tokenRes.status, body);
            return res.redirect(`${postLoginRedirect()}#error=token_exchange_failed`);
        }
        const tokenJson = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
        if (!tokenJson.access_token) {
            return res.redirect(`${postLoginRedirect()}#error=${encodeURIComponent(tokenJson.error || 'no_access_token')}`);
        }
        accessToken = tokenJson.access_token;
    } catch (err: any) {
        console.error('[github-oauth] Network error during token exchange:', err);
        return res.redirect(`${postLoginRedirect()}#error=network`);
    }

    let ghUser: { id: number; login: string; name?: string | null; email?: string | null };
    let ghEmail: string | null = null;
    let ghEmailVerified = false;
    try {
        const userRes = await fetch(GITHUB_USER_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'windy-account-server',
            },
        });
        if (!userRes.ok) {
            return res.redirect(`${postLoginRedirect()}#error=userinfo_failed`);
        }
        ghUser = await userRes.json() as typeof ghUser;

        // /user doesn't expose verification flags. Always cross-check /user/emails.
        const emailsRes = await fetch(GITHUB_EMAILS_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'windy-account-server',
            },
        });
        if (emailsRes.ok) {
            const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean; visibility: string | null }>;
            const primaryVerified = emails.find(e => e.primary && e.verified);
            if (primaryVerified) {
                ghEmail = primaryVerified.email;
                ghEmailVerified = true;
            } else {
                const anyVerified = emails.find(e => e.verified);
                if (anyVerified) {
                    ghEmail = anyVerified.email;
                    ghEmailVerified = true;
                }
            }
        }
        // Last-ditch fallback: profile email (no verification flag — treat as unverified).
        if (!ghEmail && ghUser.email) {
            ghEmail = ghUser.email;
            ghEmailVerified = false;
        }
    } catch (err: any) {
        console.error('[github-oauth] Network error during userinfo:', err);
        return res.redirect(`${postLoginRedirect()}#error=network`);
    }

    if (!ghEmail) {
        return res.redirect(`${postLoginRedirect()}#error=no_email`);
    }

    try {
        const { user, isNewUser } = await upsertUserFromOAuth({
            provider: 'github',
            providerUserId: String(ghUser.id),
            email: ghEmail,
            emailVerified: ghEmailVerified,
            name: ghUser.name || ghUser.login,
        });

        await logAuditEventAsync(
            isNewUser ? 'register' : 'login',
            user.id,
            { email: user.email, via: 'github_oauth', githubLogin: ghUser.login, githubId: ghUser.id },
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
        console.error('[github-oauth] Upsert failed:', err);
        return res.redirect(`${postLoginRedirect()}#error=server_error`);
    }
});

export default router;
