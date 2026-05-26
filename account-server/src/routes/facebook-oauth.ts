/**
 * Facebook OAuth — "Sign in with Facebook" for windyword.ai
 *
 * Standard OAuth 2.0 code flow against Facebook Graph API. Two FB-specific
 * caveats:
 *
 *   1. Email is NEVER guaranteed even with the `email` permission. ~10% of
 *      FB users have phone-only signups. We surface OAUTH_NO_EMAIL as the
 *      fragment error `no_email` so the SPA can offer a "please use a
 *      different provider" message. (Future enhancement: prompt for email
 *      post-OAuth.)
 *
 *   2. The `email` permission requires **Facebook App Review** before
 *      serving production traffic past test users. Until reviewed, only
 *      app admins/test users can complete the flow. The /start route
 *      still works; FB will redirect with an error if the user isn't
 *      whitelisted.
 *
 * Provisioning the Facebook App (one-time, per environment):
 *   developers.facebook.com → My Apps → Create App → Consumer
 *     Display name: Windy Word
 *     App Domain: windyword.ai
 *     Add product: Facebook Login → Web
 *     Valid OAuth Redirect URIs:
 *       https://account.windyword.ai/api/v1/auth/oauth/facebook/callback
 *     Privacy Policy URL: https://windyword.ai/privacy
 *     Terms URL:          https://windyword.ai/terms
 *   Submit `email` permission for App Review before going live.
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

// Pin the Graph API version so a Facebook breaking change doesn't surprise us.
const FB_API_VERSION = 'v19.0';
const FB_AUTH_URL = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`;
const FB_TOKEN_URL = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`;
const FB_USER_URL = `https://graph.facebook.com/${FB_API_VERSION}/me`;

const limiters = makeOAuthLimiters('facebook');

function configured(): boolean {
    return Boolean(
        config.FACEBOOK_OAUTH_CLIENT_ID
        && config.FACEBOOK_OAUTH_CLIENT_SECRET
        && config.FACEBOOK_OAUTH_REDIRECT_URI,
    );
}

function postLoginRedirect(): string {
    return config.FACEBOOK_OAUTH_POST_LOGIN_REDIRECT || 'http://localhost:5173/auth/oauth/finish';
}

// ─── GET /api/v1/auth/oauth/facebook/start ──────────────────
router.get('/start', limiters.start, (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).json({
            error: 'Facebook sign-in is not configured on this server.',
        });
    }

    const state = signOAuthState();
    const params = new URLSearchParams({
        client_id: config.FACEBOOK_OAUTH_CLIENT_ID,
        redirect_uri: config.FACEBOOK_OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
    });
    res.redirect(`${FB_AUTH_URL}?${params.toString()}`);
});

// ─── GET /api/v1/auth/oauth/facebook/callback ───────────────
router.get('/callback', limiters.callback, async (req: Request, res: Response) => {
    if (!configured()) {
        return res.status(503).send('Facebook sign-in is not configured on this server.');
    }

    const { code, state, error: fbError, error_reason } = req.query as { code?: string; state?: string; error?: string; error_reason?: string };

    if (fbError) {
        const reason = error_reason || fbError;
        return res.redirect(`${postLoginRedirect()}#error=${encodeURIComponent(reason)}`);
    }

    if (!code || !verifyOAuthState(state)) {
        return res.status(400).send('Invalid OAuth state. Please start the sign-in flow again.');
    }

    let accessToken: string;
    try {
        // FB token endpoint accepts both GET and POST; GET with query params
        // is the documented form.
        const tokenUrl = new URL(FB_TOKEN_URL);
        tokenUrl.searchParams.set('client_id', config.FACEBOOK_OAUTH_CLIENT_ID);
        tokenUrl.searchParams.set('client_secret', config.FACEBOOK_OAUTH_CLIENT_SECRET);
        tokenUrl.searchParams.set('redirect_uri', config.FACEBOOK_OAUTH_REDIRECT_URI);
        tokenUrl.searchParams.set('code', code);

        const tokenRes = await fetch(tokenUrl.toString());
        if (!tokenRes.ok) {
            const body = await tokenRes.text();
            console.error('[facebook-oauth] Token exchange failed:', tokenRes.status, body);
            return res.redirect(`${postLoginRedirect()}#error=token_exchange_failed`);
        }
        const tokenJson = await tokenRes.json() as { access_token?: string; error?: any };
        if (!tokenJson.access_token) {
            return res.redirect(`${postLoginRedirect()}#error=no_access_token`);
        }
        accessToken = tokenJson.access_token;
    } catch (err: any) {
        console.error('[facebook-oauth] Network error during token exchange:', err);
        return res.redirect(`${postLoginRedirect()}#error=network`);
    }

    let fbUser: { id: string; name?: string; email?: string };
    try {
        const userUrl = new URL(FB_USER_URL);
        userUrl.searchParams.set('fields', 'id,name,email');
        userUrl.searchParams.set('access_token', accessToken);

        const userRes = await fetch(userUrl.toString());
        if (!userRes.ok) {
            return res.redirect(`${postLoginRedirect()}#error=userinfo_failed`);
        }
        fbUser = await userRes.json() as typeof fbUser;
    } catch (err: any) {
        console.error('[facebook-oauth] Network error during userinfo:', err);
        return res.redirect(`${postLoginRedirect()}#error=network`);
    }

    // Facebook attests email verification implicitly — once an email is on
    // the FB account it has been verified. If the field is missing, the user
    // hasn't shared one with us (or has none on file).
    const email = fbUser.email || null;
    const emailVerified = Boolean(fbUser.email);

    try {
        const { user, isNewUser } = await upsertUserFromOAuth({
            provider: 'facebook',
            providerUserId: fbUser.id,
            email,
            emailVerified,
            name: fbUser.name || null,
        });

        await logAuditEventAsync(
            isNewUser ? 'register' : 'login',
            user.id,
            { email: user.email, via: 'facebook_oauth', facebookId: fbUser.id },
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
        console.error('[facebook-oauth] Upsert failed:', err);
        return res.redirect(`${postLoginRedirect()}#error=server_error`);
    }
});

export default router;
