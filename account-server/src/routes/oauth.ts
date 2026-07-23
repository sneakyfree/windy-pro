/**
 * OAuth2 Routes — "Sign in with Windy" Authorization Server
 *
 * Phase 5: Implements OAuth2 authorization code flow with PKCE,
 * client_credentials for service-to-service, device code flow for CLIs,
 * and standard OIDC UserInfo endpoint.
 *
 * Security invariants:
 *   - Authorization codes are single-use (checked + marked atomically)
 *   - PKCE is required for public clients
 *   - Client secrets are bcrypt-hashed
 *   - State parameter must round-trip (validated by the client, not server)
 *   - Codes expire in 10 minutes
 *   - Device codes expire in 15 minutes
 */
import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { makeRateLimiter } from '../services/rate-limiter';
import { config } from '../config';
import { getDb } from '../db/schema';
import { getStatements } from '../db/statements';
import { authenticateToken, adminOnly, AuthRequest } from '../middleware/auth';
import { logAuditEvent, getScopes, getProductAccounts } from '../identity-service';
import { isRS256Available, getSigningKey } from '../jwks';
import { decryptSecret, verifyTotpCode, consumeBackupCode } from '../services/mfa';
import { renderOAuthLoginPage, renderOAuthErrorPage } from './oauth-login-page';

const router = Router();

// Rate limits for OAuth endpoints
const oauthLimiter = makeRateLimiter('oauth', {
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const tokenLimiter = makeRateLimiter('oauth-token', {
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many token requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limit for the credential-accepting login page POST.
const loginPageLimiter = makeRateLimiter('oauth-login', {
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many sign-in attempts. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══════════════════════════════════════════
//  CLIENT REGISTRATION
// ═══════════════════════════════════════════

/**
 * POST /api/v1/oauth/clients — Register a new OAuth2 client (admin only)
 */
router.post('/clients', authenticateToken, adminOnly, (req: Request, res: Response) => {
  try {
    const { name, redirectUris, allowedScopes, isFirstParty, isPublic } = req.body;

    if (!name || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      return res.status(400).json({ error: 'name and redirectUris[] are required' });
    }

    const db = getDb();
    const clientId = crypto.randomUUID();
    let clientSecret: string | null = null;
    let clientSecretHash: string | null = null;

    // Public clients (mobile, CLI) don't get a secret — they use PKCE
    if (!isPublic) {
      clientSecret = `wcs_${crypto.randomBytes(32).toString('hex')}`;
      clientSecretHash = bcrypt.hashSync(clientSecret, 12);
    }

    db.prepare(`
      INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, owner_identity_id, is_first_party, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientId,
      clientSecretHash,
      name,
      JSON.stringify(redirectUris),
      JSON.stringify(allowedScopes || []),
      (req as AuthRequest).user.userId,
      isFirstParty ? 1 : 0,
      isPublic ? 1 : 0,
    );

    logAuditEvent('oauth_client_register' as any, (req as AuthRequest).user.userId, {
      clientId, name, isFirstParty: !!isFirstParty, isPublic: !!isPublic,
    });

    res.status(201).json({
      clientId,
      clientSecret: clientSecret || undefined,
      name,
      redirectUris,
      allowedScopes: allowedScopes || [],
      isFirstParty: !!isFirstParty,
      isPublic: !!isPublic,
      warning: clientSecret ? 'Store the client_secret securely. It will not be shown again.' : undefined,
    });
  } catch (err: any) {
    console.error('[oauth] Client registration error:', err);
    res.status(500).json({ error: 'Client registration failed' });
  }
});

/**
 * GET /api/v1/oauth/clients — List registered clients (admin only)
 */
router.get('/clients', authenticateToken, adminOnly, (_req: Request, res: Response) => {
  const db = getDb();
  const clients = db.prepare(
    'SELECT client_id, name, redirect_uris, allowed_scopes, is_first_party, is_public, created_at FROM oauth_clients',
  ).all();
  res.json({ clients });
});

// ═══════════════════════════════════════════
//  ECOSYSTEM CLIENT REGISTRATION
// ═══════════════════════════════════════════

/**
 * POST /api/v1/oauth/register-client — Register an ecosystem service as an OAuth client
 *
 * ADMIN ONLY (SEC 2026-07-19). This endpoint mints a FIRST-PARTY client, and
 * first-party clients skip the user-consent screen in the authorize flow
 * (oauth.ts handleAuthorizeGet). Left unauthenticated, anyone could register a
 * client with a name like "Windy Cloud" + an attacker-controlled redirect_uri
 * and self-known client_secret, phish a victim through the REAL Windy login
 * page, receive an auto-consented auth code, and exchange it for the victim's
 * tokens — full account takeover. Gating it behind adminOnly (mirroring the
 * sibling POST /clients) closes the vector. Ecosystem clients are provisioned
 * server-side by seedEcosystemClients() at boot, not via this endpoint, so no
 * legitimate caller is affected (verified: zero callers across all Windy repos).
 *
 * Body: { client_id, client_name, redirect_uris[], allowed_scopes[], client_secret }
 */
router.post('/register-client', authenticateToken, adminOnly, oauthLimiter, (req: Request, res: Response) => {
  try {
    const { client_id, client_name, redirect_uris, allowed_scopes, client_secret } = req.body;

    if (!client_id || typeof client_id !== 'string') {
      return res.status(400).json({ error: 'client_id is required and must be a string' });
    }
    if (!client_name || typeof client_name !== 'string') {
      return res.status(400).json({ error: 'client_name is required and must be a string' });
    }
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'redirect_uris must be a non-empty array' });
    }
    if (!Array.isArray(allowed_scopes) || allowed_scopes.length === 0) {
      return res.status(400).json({ error: 'allowed_scopes must be a non-empty array' });
    }
    if (!client_secret || typeof client_secret !== 'string') {
      return res.status(400).json({ error: 'client_secret is required and must be a string' });
    }

    const db = getDb();

    // Check if client_id already exists
    const existing = db.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get(client_id);
    if (existing) {
      return res.status(409).json({ error: 'client_id already registered' });
    }

    const secretHash = bcrypt.hashSync(client_secret, 12);

    db.prepare(`
      INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, owner_identity_id, is_first_party, is_public)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0)
    `).run(
      client_id,
      secretHash,
      client_name,
      JSON.stringify(redirect_uris),
      JSON.stringify(allowed_scopes),
      (req as AuthRequest).user.userId,
    );

    logAuditEvent('oauth_client_register' as any, (req as AuthRequest).user.userId, {
      clientId: client_id, name: client_name, isFirstParty: true, isPublic: false, via: 'register-client',
    });

    res.status(201).json({
      client_id,
      client_name,
      redirect_uris,
      allowed_scopes,
      registered: true,
    });
  } catch (err: any) {
    console.error('[oauth] Ecosystem client registration error:', err);
    res.status(500).json({ error: 'Client registration failed' });
  }
});

// ═══════════════════════════════════════════
//  AUTHORIZATION ENDPOINT
// ═══════════════════════════════════════════

/**
 * GET /api/v1/oauth/authorize — Start authorization flow
 *
 * Query params:
 *   - client_id (required)
 *   - redirect_uri (required)
 *   - response_type=code (required)
 *   - scope (space-separated, optional)
 *   - state (recommended)
 *   - code_challenge (required for public clients, PKCE S256)
 *   - code_challenge_method=S256
 *
 * For first-party clients: auto-approves and redirects with code.
 * For third-party clients: returns consent_required with client info.
 *
 * Unauthenticated browsers (Accept: text/html, no Bearer/query token) get a
 * rendered login page instead of a raw 401, so a full-page redirect from an
 * ecosystem app ("Sign in with Windy") actually lands somewhere a human can
 * sign in. API clients keep the 401 JSON contract.
 */

/**
 * Validate the OAuth authorize params + client. Shared by GET /authorize
 * (both authenticated and login-page branches) and POST /login so the form
 * can't smuggle a tampered redirect_uri past the checks.
 */
function validateAuthorizeRequest(params: Record<string, string | undefined>):
  | { ok: true; client: any }
  | { ok: false; status: number; error: string; error_description: string } {
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method } = params;

  if (response_type !== 'code') {
    return { ok: false, status: 400, error: 'unsupported_response_type', error_description: 'Only response_type=code is supported' };
  }
  if (!client_id) {
    return { ok: false, status: 400, error: 'invalid_request', error_description: 'client_id is required' };
  }
  if (!redirect_uri) {
    return { ok: false, status: 400, error: 'invalid_request', error_description: 'redirect_uri is required' };
  }

  const db = getDb();
  const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id) as any;
  if (!client) {
    return { ok: false, status: 400, error: 'invalid_client', error_description: 'Unknown client_id' };
  }

  const allowedUris: string[] = parseJsonArrayColumn(client.redirect_uris);
  if (!allowedUris.includes(redirect_uri)) {
    return { ok: false, status: 400, error: 'invalid_request', error_description: 'redirect_uri not registered for this client' };
  }

  if (client.is_public && !code_challenge) {
    return { ok: false, status: 400, error: 'invalid_request', error_description: 'code_challenge is required for public clients (PKCE)' };
  }
  if (code_challenge && code_challenge_method && code_challenge_method !== 'S256') {
    return { ok: false, status: 400, error: 'invalid_request', error_description: 'Only S256 code_challenge_method is supported' };
  }

  return { ok: true, client };
}

function acceptsHtml(req: Request): boolean {
  return (req.headers.accept || '').toLowerCase().includes('text/html');
}

/**
 * Read a JSON-array column across both adapters: SQLite stores TEXT (raw
 * JSON string), Postgres stores JSONB which node-postgres returns already
 * parsed. JSON.parse on an already-parsed array coerces it to a plain
 * string ("a,b") and throws — the prod-only 500 this helper exists for.
 */
function parseJsonArrayColumn(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

/** Pull the OAuth params out of a query/body bag, as plain strings. */
function pickOAuthParams(src: Record<string, unknown>): {
  client_id: string; redirect_uri: string; response_type: string; scope: string;
  state: string; code_challenge: string; code_challenge_method: string;
} {
  const s = (k: string) => (typeof src[k] === 'string' ? (src[k] as string) : '');
  return {
    client_id: s('client_id'),
    redirect_uri: s('redirect_uri'),
    response_type: s('response_type'),
    scope: s('scope'),
    state: s('state'),
    code_challenge: s('code_challenge'),
    code_challenge_method: s('code_challenge_method'),
  };
}

router.get('/authorize', oauthLimiter, (req: Request, res: Response) => {
  // Requests that carry a token (Bearer header or ?token= query) go through
  // the normal auth middleware — preserving blacklist checks and the JSON
  // contract. Token-less browser navigations get the login page.
  const authHeader = req.headers['authorization'];
  const hasToken = !!(authHeader && authHeader.split(' ')[1]) ||
    (typeof req.query.token === 'string' && req.query.token.length > 0);

  if (hasToken) {
    return authenticateToken(req, res, () => handleAuthorizeGet(req, res));
  }

  // Unauthenticated. API clients keep the historical 401 JSON.
  if (!acceptsHtml(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Browser: validate the link, then show the login page.
  const params = pickOAuthParams(req.query as Record<string, unknown>);
  const v = validateAuthorizeRequest(params);
  if (!v.ok) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(v.status).send(renderOAuthErrorPage(v.error_description));
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(renderOAuthLoginPage({ clientName: v.client.name, params }));
});

function handleAuthorizeGet(req: Request, res: Response) {
  try {
    const {
      client_id, redirect_uri, scope,
      state, code_challenge,
    } = req.query as Record<string, string>;

    const v = validateAuthorizeRequest(pickOAuthParams(req.query as Record<string, unknown>));
    if (!v.ok) {
      return res.status(v.status).json({ error: v.error, error_description: v.error_description });
    }
    const client = v.client;

    const userId = (req as AuthRequest).user.userId;
    const requestedScopes = scope ? scope.split(' ').filter(Boolean) : [];

    // Check for existing consent (or first-party auto-approve)
    const db = getDb();
    const isFirstParty = !!client.is_first_party;
    let hasConsent = isFirstParty;

    if (!isFirstParty) {
      const existingConsent = db.prepare(
        "SELECT scopes FROM oauth_consents WHERE identity_id = ? AND client_id = ? AND revoked_at IS NULL",
      ).get(userId, client_id) as any;

      if (existingConsent) {
        const approvedScopes = existingConsent.scopes.split(' ').filter(Boolean);
        hasConsent = requestedScopes.every((s: string) => approvedScopes.includes(s));
      }
    }

    if (hasConsent) {
      // Auto-approve: generate code and redirect
      const code = generateAuthorizationCode(
        db, client_id, userId, redirect_uri, requestedScopes.join(' '),
        state || null, code_challenge || null,
      );

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);

      // Browsers navigating here get sent back to the app; API clients keep
      // the JSON contract.
      if (acceptsHtml(req)) {
        return res.redirect(302, redirectUrl.toString());
      }

      return res.json({
        redirect: redirectUrl.toString(),
        code,
        state: state || undefined,
      });
    }

    // Consent required. For browser requests (Accept: text/html), redirect
    // straight to the rendered consent screen so the user lands on a page
    // they can interact with. For API clients, return JSON describing what's
    // needed so they can build their own UX.
    if (acceptsHtml(req)) {
      const consentUrl = new URL('/api/v1/oauth/consent', `${req.protocol}://${req.get('host')}`);
      // `token` is forwarded so the consent page (and its form POST) stays
      // authenticated across the redirect — browser navigations can't carry
      // a Bearer header. Same query-token pattern authenticateToken already
      // supports for media URLs.
      for (const k of ['client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'token'] as const) {
        const v = req.query[k];
        if (typeof v === 'string' && v.length > 0) consentUrl.searchParams.set(k, v);
      }
      return res.redirect(302, consentUrl.pathname + consentUrl.search);
    }

    res.json({
      consent_required: true,
      client: {
        clientId: client.client_id,
        name: client.name,
        isFirstParty: false,
      },
      requestedScopes,
      state: state || undefined,
      code_challenge: code_challenge || undefined,
      consent_url: `/api/v1/oauth/consent?${new URLSearchParams({
        client_id, redirect_uri,
        ...(scope ? { scope } : {}),
        ...(state ? { state } : {}),
        ...(code_challenge ? { code_challenge } : {}),
      }).toString()}`,
    });
  } catch (err: any) {
    console.error('[oauth] Authorization error:', err);
    res.status(500).json({ error: 'server_error', error_description: 'Authorization failed' });
  }
}

// ═══════════════════════════════════════════
//  LOGIN PAGE SUBMIT
// ═══════════════════════════════════════════

/**
 * POST /api/v1/oauth/login — Login-page submit: authenticate + authorize in
 * one step. Body is URL-encoded form data from renderOAuthLoginPage: email,
 * password, optional mfaCode, plus the original authorize params as hidden
 * fields. On success the browser is 302'd back to the client's redirect_uri
 * with an authorization code (first-party / already-consented clients) or to
 * the consent screen (third-party clients).
 *
 * Credential handling mirrors POST /api/v1/auth/login (bcrypt compare,
 * 24h-grace email-verification gate, TOTP/backup-code MFA) with page
 * re-renders in place of JSON errors.
 */
router.post('/login', express.urlencoded({ extended: false }), loginPageLimiter, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string>;
    const params = pickOAuthParams(body);
    const v = validateAuthorizeRequest(params);
    if (!v.ok) {
      // Tampered or stale form — never proceed with an unvalidated redirect_uri.
      if (acceptsHtml(req)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(v.status).send(renderOAuthErrorPage(v.error_description));
      }
      return res.status(v.status).json({ error: v.error, error_description: v.error_description });
    }
    const client = v.client;

    const rerender = (status: number, opts: { error?: string; showMfa?: boolean }) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(status).send(renderOAuthLoginPage({
        clientName: client.name,
        params,
        email: (body.email || '').trim(),
        error: opts.error,
        showMfa: opts.showMfa,
      }));
    };

    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const mfaCode = (body.mfaCode || '').trim();

    if (!email || !password) {
      return rerender(400, { error: 'Please enter your email and password.' });
    }

    const user = getStatements().findUserByEmail.get(email) as any;
    if (!user) {
      logAuditEvent('login_failed', null, { email, reason: 'user_not_found', via: 'oauth_login_page' }, req.ip, req.get('user-agent'));
      return rerender(401, { error: 'Incorrect email or password.' });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      logAuditEvent('login_failed', user.id, { email, reason: 'invalid_password', via: 'oauth_login_page' }, req.ip, req.get('user-agent'));
      return rerender(401, { error: 'Incorrect email or password.' });
    }

    // Mirror POST /auth/login's verified-email gate (24h grace window).
    if (!user.email_verified) {
      const createdMs = user.created_at ? new Date(user.created_at).getTime() : Date.now();
      const ageHours = (Date.now() - createdMs) / (1000 * 60 * 60);
      if (ageHours > 24) {
        logAuditEvent('login_blocked', user.id, { email, reason: 'email_not_verified', via: 'oauth_login_page' }, req.ip, req.get('user-agent'));
        return rerender(403, { error: 'Please verify your email first — open the verification link we sent you, then come back and sign in.' });
      }
    }

    // Mirror POST /auth/login's MFA gate.
    const mfa = getDb().prepare(
      'SELECT totp_secret_encrypted, totp_secret_iv, totp_secret_tag, backup_codes_hash, enabled_at FROM mfa_secrets WHERE user_id = ?',
    ).get(user.id) as any;

    if (mfa?.enabled_at) {
      if (!mfaCode) {
        logAuditEvent('mfa_login_challenge', user.id, { email, via: 'oauth_login_page' }, req.ip, req.get('user-agent'));
        return rerender(200, { showMfa: true });
      }

      let mfaPassed = false;
      try {
        const secret = decryptSecret({
          ciphertext: mfa.totp_secret_encrypted,
          iv: mfa.totp_secret_iv,
          tag: mfa.totp_secret_tag,
        });
        if (verifyTotpCode(secret, mfaCode)) mfaPassed = true;
      } catch (e) {
        console.error('[oauth] MFA decrypt failed:', (e as any).message);
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
        logAuditEvent('mfa_login_failed', user.id, { email, via: 'oauth_login_page' }, req.ip, req.get('user-agent'));
        return rerender(401, { error: "That verification code didn't work. Try again.", showMfa: true });
      }
      logAuditEvent('mfa_login_success', user.id, { email, via: 'oauth_login_page' }, req.ip, req.get('user-agent'));
    }

    logAuditEvent('login', user.id, { email, via: 'oauth_login_page', client_id: client.client_id }, req.ip, req.get('user-agent'));

    // Authorize — same consent logic as GET /authorize.
    const db = getDb();
    const requestedScopes = params.scope ? params.scope.split(' ').filter(Boolean) : [];
    let hasConsent = !!client.is_first_party;
    if (!hasConsent) {
      const existingConsent = db.prepare(
        "SELECT scopes FROM oauth_consents WHERE identity_id = ? AND client_id = ? AND revoked_at IS NULL",
      ).get(user.id, params.client_id) as any;
      if (existingConsent) {
        const approvedScopes = existingConsent.scopes.split(' ').filter(Boolean);
        hasConsent = requestedScopes.every((s: string) => approvedScopes.includes(s));
      }
    }

    if (hasConsent) {
      const code = generateAuthorizationCode(
        db, params.client_id, user.id, params.redirect_uri, requestedScopes.join(' '),
        params.state || null, params.code_challenge || null,
      );
      const redirectUrl = new URL(params.redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (params.state) redirectUrl.searchParams.set('state', params.state);
      return res.redirect(302, redirectUrl.toString());
    }

    // Third-party client → consent screen. A short-lived token keeps the
    // consent page + its form POST authenticated across the redirect
    // (browser navigations can't carry a Bearer header).
    const ssoToken = signShortLivedSsoToken(user);
    const consentUrl = new URL('/api/v1/oauth/consent', `${req.protocol}://${req.get('host')}`);
    for (const [k, val] of Object.entries(params)) {
      if (val) consentUrl.searchParams.set(k, val);
    }
    consentUrl.searchParams.set('token', ssoToken);
    return res.redirect(302, consentUrl.pathname + consentUrl.search);
  } catch (err: any) {
    console.error('[oauth] Login page error:', err);
    res.status(500).json({ error: 'server_error', error_description: 'Sign-in failed' });
  }
});

/**
 * Short-lived (10 min) token minted after a successful login-page auth,
 * used only to carry identity into the consent-page redirect. Deliberately
 * NOT generateTokens/generateOAuthTokens — those persist refresh tokens;
 * this hop needs none of that.
 */
function signShortLivedSsoToken(user: any): string {
  const payload: Record<string, any> = {
    sub: user.id,
    userId: user.id,
    email: user.email,
    tier: user.tier,
    accountId: user.id,
    type: user.identity_type || 'human',
  };
  const signingKey = getSigningKey();
  if (signingKey) {
    return jwt.sign(payload, signingKey.privateKey, { algorithm: 'RS256', expiresIn: '10m', keyid: signingKey.kid });
  }
  return jwt.sign(payload, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
}

/**
 * POST /api/v1/oauth/authorize — Submit consent decision
 *
 * Body: { client_id, redirect_uri, scope, state, code_challenge, approved: boolean }
 * Accepts both JSON and URL-encoded form data (from the consent page).
 */
router.post('/authorize', express.urlencoded({ extended: false }), authenticateToken, oauthLimiter, (req: Request, res: Response) => {
  try {
    const {
      client_id, redirect_uri, scope, state,
      code_challenge, approved,
    } = req.body;

    if (!client_id || !redirect_uri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required' });
    }

    const db = getDb();
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id) as any;
    if (!client) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    // RFC 6749 §4.1.3: the redirect_uri MUST match one the client registered.
    // GET /authorize and POST /login enforce this via validateAuthorizeRequest;
    // this consent-submit path did not, letting an authenticated caller mint a
    // code to an arbitrary URL. Mirror the same allowlist check.
    if (!parseJsonArrayColumn(client.redirect_uris).includes(redirect_uri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered for this client' });
    }

    const userId = (req as AuthRequest).user.userId;

    // Handle both boolean and string "true"/"false" (form data sends strings)
    const isApproved = approved === true || approved === 'true';

    if (!isApproved) {
      const deniedUrl = `${redirect_uri}?error=access_denied&error_description=User+denied+consent${state ? `&state=${state}` : ''}`;
      // Consent-page form posts navigate the browser; send it back to the app.
      if (acceptsHtml(req)) {
        return res.redirect(302, deniedUrl);
      }
      return res.json({ redirect: deniedUrl });
    }

    // Record consent
    const scopeStr = scope || '';
    db.prepare(`
      INSERT INTO oauth_consents (id, identity_id, client_id, scopes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(identity_id, client_id) DO UPDATE SET scopes = ?, granted_at = datetime('now'), revoked_at = NULL
    `).run(crypto.randomUUID(), userId, client_id, scopeStr, scopeStr);

    // Generate authorization code
    const code = generateAuthorizationCode(
      db, client_id, userId, redirect_uri, scopeStr,
      state || null, code_challenge || null,
    );

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    logAuditEvent('oauth_consent_granted' as any, userId, { client_id, scopes: scopeStr });

    // Consent-page form posts navigate the browser; send it back to the app.
    if (acceptsHtml(req)) {
      return res.redirect(302, redirectUrl.toString());
    }

    res.json({
      redirect: redirectUrl.toString(),
      code,
      state: state || undefined,
    });
  } catch (err: any) {
    console.error('[oauth] Consent error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ═══════════════════════════════════════════
//  TOKEN ENDPOINT
// ═══════════════════════════════════════════

/**
 * POST /api/v1/oauth/token — Exchange code/credentials for tokens
 *
 * Supports grant_types:
 *   - authorization_code (with PKCE)
 *   - client_credentials (service-to-service)
 *   - refresh_token
 *   - urn:ietf:params:oauth:grant-type:device_code
 */
router.post('/token', tokenLimiter, (req: Request, res: Response) => {
  try {
    const { grant_type } = req.body;

    switch (grant_type) {
      case 'authorization_code':
        return handleAuthorizationCodeGrant(req, res);
      case 'client_credentials':
        return handleClientCredentialsGrant(req, res);
      case 'refresh_token':
        return handleRefreshTokenGrant(req, res);
      case 'urn:ietf:params:oauth:grant-type:device_code':
        return handleDeviceCodeGrant(req, res);
      default:
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: `Grant type '${grant_type}' is not supported`,
        });
    }
  } catch (err: any) {
    console.error('[oauth] Token error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

function handleAuthorizationCodeGrant(req: Request, res: Response) {
  const { code, redirect_uri, client_id, client_secret, code_verifier } = req.body;

  if (!code || !redirect_uri || !client_id) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code, redirect_uri, and client_id are required',
    });
  }

  const db = getDb();

  // Authenticate client
  const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id) as any;
  if (!client) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Confidential clients must authenticate with secret
  if (!client.is_public && client.client_secret_hash) {
    if (!client_secret || !bcrypt.compareSync(client_secret, client.client_secret_hash)) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
    }
  }

  // Look up authorization code
  const authCode = db.prepare(
    "SELECT * FROM oauth_codes WHERE code = ? AND client_id = ? AND used = 0 AND expires_at > datetime('now')",
  ).get(code, client_id) as any;

  if (!authCode) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code is invalid, expired, or already used',
    });
  }

  // Mark code as used IMMEDIATELY (single-use enforcement)
  const markResult = db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ? AND used = 0').run(code);
  if (markResult.changes === 0) {
    // Race condition: another request already used this code
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code already used' });
  }

  // Validate redirect_uri matches
  if (authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  // PKCE verification
  if (authCode.code_challenge) {
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier is required (PKCE)' });
    }

    const expectedChallenge = crypto
      .createHash('sha256')
      .update(code_verifier)
      .digest('base64url');

    if (expectedChallenge !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier does not match code_challenge' });
    }
  }

  // Generate tokens
  const tokens = generateOAuthTokens(authCode.identity_id, authCode.scope, client_id);

  logAuditEvent('oauth_token_issued' as any, authCode.identity_id, {
    client_id, grant_type: 'authorization_code', scope: authCode.scope,
  });

  res.json({
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: 900, // 15 minutes
    refresh_token: tokens.refreshToken,
    scope: authCode.scope,
  });
}

function handleClientCredentialsGrant(req: Request, res: Response) {
  const { client_id, client_secret, scope } = req.body;

  if (!client_id || !client_secret) {
    // Try Basic auth
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [id, secret] = decoded.split(':');
      return handleClientCredentialsWithAuth(req, res, id, secret, scope);
    }
    return res.status(401).json({ error: 'invalid_client', error_description: 'Client credentials required' });
  }

  return handleClientCredentialsWithAuth(req, res, client_id, client_secret, scope);
}

function handleClientCredentialsWithAuth(_req: Request, res: Response, clientId: string, clientSecret: string, scope?: string) {
  const db = getDb();
  const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as any;

  if (!client || !client.client_secret_hash) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  if (!bcrypt.compareSync(clientSecret, client.client_secret_hash)) {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
  }

  // Client credentials tokens represent the client itself, not a user
  const scopeStr = scope || parseJsonArrayColumn(client.allowed_scopes).join(' ');
  const tokenPayload: Record<string, unknown> = {
    sub: clientId,
    client_id: clientId,
    scope: scopeStr,
    iss: 'windy-identity',
    type: 'client_credentials',
  };

  let accessToken: string;
  const signingKey = getSigningKey();

  if (signingKey) {
    accessToken = jwt.sign(tokenPayload, signingKey.privateKey, {
      algorithm: 'RS256',
      expiresIn: '1h',
      keyid: signingKey.kid,
    });
  } else {
    accessToken = jwt.sign(tokenPayload, config.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
  }

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: scopeStr,
  });
}

function handleRefreshTokenGrant(req: Request, res: Response) {
  const { refresh_token, client_id, client_secret } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
  }

  const db = getDb();

  // Look up refresh token
  const stored = db.prepare(
    "SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')",
  ).get(refresh_token) as any;

  if (!stored) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
  }

  // Client binding: a refresh token minted for an OAuth client may only be
  // redeemed by that same client. Rows with no client_id predate the binding
  // (or came from the first-party /auth flow) and keep the legacy behavior.
  if (stored.client_id && stored.client_id !== client_id) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Refresh token was not issued to this client',
    });
  }

  // Verify client if provided
  if (client_id) {
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id) as any;
    if (client && !client.is_public && client.client_secret_hash) {
      if (!client_secret || !bcrypt.compareSync(client_secret, client.client_secret_hash)) {
        return res.status(401).json({ error: 'invalid_client' });
      }
    }
  }

  // Rotate: delete old refresh token, generate new tokens
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refresh_token);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(stored.user_id) as any;
  if (!user) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found' });
  }

  // Re-mint the scope the original grant consented to — never a blanket
  // windy_pro:* (a third-party refresh must not widen what consent granted).
  const grantScope = stored.scope || 'windy_pro:*';
  const tokens = generateOAuthTokens(user.id, grantScope, stored.client_id || client_id || 'windy-identity');

  logAuditEvent('oauth_token_issued' as any, user.id, {
    client_id: stored.client_id || client_id || null, grant_type: 'refresh_token',
  });

  res.json({
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: tokens.refreshToken,
  });
}

function handleDeviceCodeGrant(req: Request, res: Response) {
  const { device_code, client_id } = req.body;

  if (!device_code || !client_id) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'device_code and client_id are required' });
  }

  const db = getDb();
  const deviceAuth = db.prepare(
    "SELECT * FROM oauth_device_codes WHERE device_code = ? AND client_id = ?",
  ).get(device_code, client_id) as any;

  if (!deviceAuth) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown device_code' });
  }

  if (new Date(deviceAuth.expires_at) < new Date()) {
    return res.status(400).json({ error: 'expired_token', error_description: 'Device code has expired' });
  }

  switch (deviceAuth.status) {
    case 'pending':
      return res.status(400).json({ error: 'authorization_pending' });

    case 'denied':
      return res.status(400).json({ error: 'access_denied' });

    case 'approved': {
      if (!deviceAuth.identity_id) {
        return res.status(400).json({ error: 'server_error' });
      }

      // Mark as consumed
      db.prepare("UPDATE oauth_device_codes SET status = 'expired' WHERE device_code = ?").run(device_code);

      const tokens = generateOAuthTokens(deviceAuth.identity_id, deviceAuth.scope, client_id);

      logAuditEvent('oauth_token_issued' as any, deviceAuth.identity_id, {
        client_id, grant_type: 'device_code',
      });

      return res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: 900,
        refresh_token: tokens.refreshToken,
        scope: deviceAuth.scope,
      });
    }

    default:
      return res.status(400).json({ error: 'invalid_grant' });
  }
}

// ═══════════════════════════════════════════
//  DEVICE CODE FLOW
// ═══════════════════════════════════════════

/**
 * POST /api/v1/oauth/device — Request a device code for CLI/headless auth
 */
router.post('/device', oauthLimiter, (req: Request, res: Response) => {
  try {
    const { client_id, scope } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
    }

    const db = getDb();
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id) as any;
    if (!client) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    const deviceCode = crypto.randomBytes(32).toString('hex');
    const userCode = generateUserCode(); // 8-char human-readable
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

    db.prepare(`
      INSERT INTO oauth_device_codes (device_code, user_code, client_id, scope, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(deviceCode, userCode, client_id, scope || '', expiresAt);

    const issuer = process.env.OIDC_ISSUER || 'https://windyword.ai';
    const verificationUri = `${issuer}/device`;

    res.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${userCode}`,
      expires_in: 900,
      interval: 5,
    });
  } catch (err: any) {
    console.error('[oauth] Device code error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/v1/oauth/device/approve — User approves a device code
 * (Called by the web UI after user enters the user_code)
 */
router.post('/device/approve', authenticateToken, (req: Request, res: Response) => {
  try {
    const { user_code, approved } = req.body;

    if (!user_code) {
      return res.status(400).json({ error: 'user_code is required' });
    }

    const db = getDb();
    const deviceAuth = db.prepare(
      "SELECT * FROM oauth_device_codes WHERE user_code = ? AND status = 'pending' AND expires_at > datetime('now')",
    ).get(user_code) as any;

    if (!deviceAuth) {
      return res.status(404).json({ error: 'Invalid or expired user code' });
    }

    const userId = (req as AuthRequest).user.userId;

    if (approved) {
      db.prepare(
        "UPDATE oauth_device_codes SET status = 'approved', identity_id = ? WHERE device_code = ?",
      ).run(userId, deviceAuth.device_code);

      logAuditEvent('oauth_device_approved' as any, userId, {
        client_id: deviceAuth.client_id, user_code,
      });

      res.json({ success: true, message: 'Device authorized' });
    } else {
      db.prepare(
        "UPDATE oauth_device_codes SET status = 'denied' WHERE device_code = ?",
      ).run(deviceAuth.device_code);

      res.json({ success: true, message: 'Device authorization denied' });
    }
  } catch (err: any) {
    console.error('[oauth] Device approve error:', err);
    res.status(500).json({ error: 'Device approval failed' });
  }
});

// ═══════════════════════════════════════════
//  USERINFO ENDPOINT (OIDC)
// ═══════════════════════════════════════════

/**
 * GET /api/v1/oauth/userinfo — Standard OIDC UserInfo endpoint
 */
router.get('/userinfo', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const user = db.prepare(`
      SELECT id, windy_identity_id, email, name, display_name, avatar_url, phone,
             email_verified, phone_verified, identity_type, preferred_lang
      FROM users WHERE id = ?
    `).get(userId) as any;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Standard OIDC claims
    const claims: Record<string, unknown> = {
      sub: user.windy_identity_id || user.id,
    };

    // Profile claims
    claims.name = user.display_name || user.name;
    if (user.avatar_url) claims.picture = user.avatar_url;
    claims.preferred_username = user.name;
    claims.locale = user.preferred_lang || 'en';

    // Email claims
    claims.email = user.email;
    claims.email_verified = !!user.email_verified;

    // Phone claims
    if (user.phone) {
      claims.phone_number = user.phone;
      claims.phone_number_verified = !!user.phone_verified;
    }

    // Windy-specific claims
    claims.windy_identity_id = user.windy_identity_id;
    claims.identity_type = user.identity_type || 'human';

    // Product accounts
    const products = getProductAccounts(user.id);
    claims.products = products.map((p: any) => ({
      product: p.product,
      status: p.status,
      externalId: p.external_id,
    }));

    res.json(claims);
  } catch (err: any) {
    console.error('[oauth] UserInfo error:', err);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// ═══════════════════════════════════════════
//  CONSENT MANAGEMENT
// ═══════════════════════════════════════════

/**
 * GET /api/v1/oauth/consents — List user's OAuth consents
 */
router.get('/consents', authenticateToken, (req: Request, res: Response) => {
  const db = getDb();
  const userId = (req as AuthRequest).user.userId;

  const consents = db.prepare(`
    SELECT oc.*, c.name as client_name, c.is_first_party
    FROM oauth_consents oc
    JOIN oauth_clients c ON oc.client_id = c.client_id
    WHERE oc.identity_id = ? AND oc.revoked_at IS NULL
  `).all(userId);

  res.json({ consents });
});

/**
 * DELETE /api/v1/oauth/consents/:clientId — Revoke consent for a client
 */
router.delete('/consents/:clientId', authenticateToken, (req: Request, res: Response) => {
  const db = getDb();
  const userId = (req as AuthRequest).user.userId;

  const result = db.prepare(
    "UPDATE oauth_consents SET revoked_at = datetime('now') WHERE identity_id = ? AND client_id = ? AND revoked_at IS NULL",
  ).run(userId, req.params.clientId);

  logAuditEvent('oauth_consent_revoked' as any, userId, { client_id: req.params.clientId });

  res.json({ revoked: result.changes > 0 });
});

// ═══════════════════════════════════════════
//  CONSENT SCREEN (Phase 6C)
// ═══════════════════════════════════════════

/**
 * GET /api/v1/oauth/consent — Serve HTML consent page for third-party clients.
 *
 * Query params: client_id, redirect_uri, scope, state, code_challenge
 * The page shows the client name, requested scopes, and Allow/Deny buttons.
 * Posts the decision back to POST /api/v1/oauth/authorize.
 */
router.get('/consent', authenticateToken, oauthLimiter, (req: Request, res: Response) => {
  try {
    const {
      client_id, redirect_uri, scope, state, code_challenge,
    } = req.query as Record<string, string>;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const db = getDb();
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id) as any;
    if (!client) {
      return res.status(400).json({ error: 'Unknown client_id' });
    }

    const requestedScopes = scope ? scope.split(' ').filter(Boolean) : [];
    const scopeDescriptions = formatScopeDescriptions(requestedScopes);

    // The consent form's POST must stay authenticated. Browser navigations
    // can't set a Bearer header, so when this page was reached with a query
    // token (the login-page → consent redirect), thread it into the form
    // action — authenticateToken accepts ?token=.
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const html = renderConsentPage({
      clientName: client.name,
      clientId: client.client_id,
      isFirstParty: !!client.is_first_party,
      scopes: scopeDescriptions,
      redirectUri: redirect_uri || '',
      state: state || '',
      codeChallenge: code_challenge || '',
      scope: scope || '',
      authorizeUrl: `/api/v1/oauth/authorize${queryToken ? `?token=${encodeURIComponent(queryToken)}` : ''}`,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err: any) {
    console.error('[oauth] Consent page error:', err);
    res.status(500).json({ error: 'Failed to render consent page' });
  }
});

/**
 * Map scope strings to human-readable descriptions.
 */
function formatScopeDescriptions(scopes: string[]): { scope: string; label: string; description: string }[] {
  const scopeMap: Record<string, { label: string; description: string }> = {
    'openid': { label: 'OpenID', description: 'Verify your identity' },
    'profile': { label: 'Profile', description: 'Read your name and avatar' },
    'email': { label: 'Email', description: 'Read your email address' },
    'phone': { label: 'Phone', description: 'Read your phone number' },
    'windy_pro:*': { label: 'Windy Word', description: 'Full access to your Windy Word account' },
    'windy_pro:read': { label: 'Windy Word (Read)', description: 'Read your Windy Word data' },
    'windy_chat:*': { label: 'Windy Chat', description: 'Full access to your Windy Chat' },
    'windy_chat:read': { label: 'Windy Chat (Read)', description: 'Read your chat messages' },
    'windy_chat:write': { label: 'Windy Chat (Write)', description: 'Send chat messages on your behalf' },
    'windy_mail:*': { label: 'Windy Mail', description: 'Full access to your Windy Mail' },
    'windy_mail:read': { label: 'Windy Mail (Read)', description: 'Read your emails' },
    'windy_mail:send': { label: 'Windy Mail (Send)', description: 'Send emails on your behalf' },
    'windy_fly:*': { label: 'Windy Fly', description: 'Full access to Windy Fly agent platform' },
    'eternitas:verify': { label: 'Eternitas (Verify)', description: 'Verify bot passports' },
    'eternitas:register': { label: 'Eternitas (Register)', description: 'Register new bot passports' },
  };

  return scopes.map(s => {
    const mapped = scopeMap[s];
    if (mapped) return { scope: s, ...mapped };
    // Generic: product:permission
    const [product, permission] = s.split(':');
    return {
      scope: s,
      label: `${product} (${permission})`,
      description: `Access ${product} — ${permission} permission`,
    };
  });
}

/**
 * Render a minimal, branded HTML consent page.
 */
function renderConsentPage(data: {
  clientName: string;
  clientId: string;
  isFirstParty: boolean;
  scopes: { scope: string; label: string; description: string }[];
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  authorizeUrl: string;
}): string {
  const scopeListHtml = data.scopes.map(s => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f5;">
      <div style="width:8px;height:8px;background:#4f46e5;border-radius:50%;flex-shrink:0;"></div>
      <div>
        <div style="font-weight:600;font-size:14px;color:#1a1a2e;">${escapeHtml(s.label)}</div>
        <div style="font-size:13px;color:#666;">${escapeHtml(s.description)}</div>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${escapeHtml(data.clientName)} — Windy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5fa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      max-width: 420px;
      width: 100%;
      padding: 40px 32px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 24px;
      text-align: center;
    }
    .client-name {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a2e;
      text-align: center;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 14px;
      color: #666;
      text-align: center;
      margin-bottom: 24px;
    }
    .scope-list {
      margin-bottom: 24px;
    }
    .btn-row {
      display: flex;
      gap: 12px;
    }
    .btn {
      flex: 1;
      padding: 14px 24px;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-allow {
      background: #4f46e5;
      color: white;
    }
    .btn-allow:hover { background: #4338ca; }
    .btn-deny {
      background: #f0f0f5;
      color: #666;
    }
    .btn-deny:hover { background: #e5e5ea; color: #333; }
    .footer {
      margin-top: 20px;
      font-size: 12px;
      color: #aaa;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Windy</div>
    <div class="client-name">${escapeHtml(data.clientName)}</div>
    <div class="subtitle">wants access to your Windy account</div>

    <div class="scope-list">
      ${scopeListHtml || '<div style="color:#888;text-align:center;padding:12px;">No specific permissions requested.</div>'}
    </div>

    <form method="POST" action="${escapeAttr(data.authorizeUrl)}" id="consent-form">
      <input type="hidden" name="client_id" value="${escapeAttr(data.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeAttr(data.redirectUri)}">
      <input type="hidden" name="scope" value="${escapeAttr(data.scope)}">
      <input type="hidden" name="state" value="${escapeAttr(data.state)}">
      <input type="hidden" name="code_challenge" value="${escapeAttr(data.codeChallenge)}">
      <input type="hidden" name="approved" id="approved-field" value="true">

      <div class="btn-row">
        <button type="button" class="btn btn-deny" onclick="deny()">Deny</button>
        <button type="submit" class="btn btn-allow">Allow</button>
      </div>
    </form>

    <div class="footer">
      You can revoke this access at any time in your Windy account settings.
    </div>
  </div>

  <script>
    function deny() {
      document.getElementById('approved-field').value = 'false';
      document.getElementById('consent-form').submit();
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/**
 * Generate a single-use authorization code.
 */
function generateAuthorizationCode(
  db: any,
  clientId: string,
  identityId: string,
  redirectUri: string,
  scope: string,
  state: string | null,
  codeChallenge: string | null,
): string {
  const code = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  db.prepare(`
    INSERT INTO oauth_codes (code, client_id, identity_id, redirect_uri, scope, state, code_challenge, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, clientId, identityId, redirectUri, scope, state, codeChallenge, expiresAt);

  return code;
}

/**
 * Generate OAuth access + refresh tokens for a user.
 */
function generateOAuthTokens(identityId: string, scope: string, clientId: string): { accessToken: string; refreshToken: string } {
  const db = getDb();

  // Fetch user info for token payload
  const user = db.prepare('SELECT email, tier, identity_type, windy_identity_id, name, display_name FROM users WHERE id = ?').get(identityId) as any;
  if (!user) throw new Error('User not found');

  // Fetch scopes from identity_scopes table
  let identityScopes: string[];
  try {
    const rows = db.prepare('SELECT scope FROM identity_scopes WHERE identity_id = ?').all(identityId) as { scope: string }[];
    identityScopes = rows.length > 0 ? rows.map(r => r.scope) : ['windy_pro:*'];
  } catch { identityScopes = ['windy_pro:*']; }

  // Consent binding: a third-party client's token must carry only the scopes
  // the user consented to (∩ what the identity actually holds), never the
  // identity's full scope set. First-party clients and legacy callers with no
  // oauth_clients row (e.g. 'windy-identity' refresh mints) keep the full set —
  // first-party session semantics are explicitly out of scope here.
  let effectiveScopes = identityScopes;
  try {
    const clientRow = db.prepare('SELECT is_first_party FROM oauth_clients WHERE client_id = ?').get(clientId) as any;
    if (clientRow && !clientRow.is_first_party) {
      const granted = (scope || '').split(' ').filter(Boolean);
      // OIDC identity scopes (openid/profile/email — no product prefix) live in
      // the `scope` string claim; only product:action scopes belong in `scopes`.
      effectiveScopes = granted
        .filter(s => s.includes(':'))
        .filter(s => _identityHoldsScope(identityScopes, s));
    }
  } catch { /* oauth_clients may not exist on first-run SQLite bootstrap */ }

  // Fetch products
  let products: string[];
  try {
    const rows = db.prepare("SELECT product FROM product_accounts WHERE identity_id = ? AND status = 'active'").all(identityId) as { product: string }[];
    products = rows.length > 0 ? rows.map(r => r.product) : ['windy_pro'];
  } catch { products = ['windy_pro']; }

  // Fetch active Eternitas passport (if any). Included as the
  // `eternitas_passport` JWT claim so consumers like windy-code's
  // agentBusServer can verify passport-gated flows without a round-trip
  // to the passport registry. Only active passports — revoked/suspended
  // passports MUST NOT produce a claim (that would let a revoked bot
  // continue to authenticate until the JWT expires).
  let passportNumber: string | undefined;
  try {
    // Operator context — prefer operator_identity_id (the passport row is keyed
    // by the bot's identity_id), so the OAuth JWT carries the agent's passport.
    const row = db.prepare(
      `SELECT passport_number FROM eternitas_passports
       WHERE (operator_identity_id = ? OR identity_id = ?) AND status = 'active'
       ORDER BY (operator_identity_id = ?) DESC, registered_at DESC LIMIT 1`,
    ).get(identityId, identityId, identityId) as { passport_number: string } | undefined;
    passportNumber = row?.passport_number;
  } catch { /* table may not exist on first-run SQLite bootstrap */ }

  const tokenPayload: Record<string, any> = {
    // Standard JWT subject claim — RFC 7519. Mirrors auth.ts; required
    // by every ecosystem service that consumes Pro JWTs.
    sub: identityId,
    userId: identityId,
    // Both naming conventions emitted for cross-service compatibility.
    windy_identity_id: user.windy_identity_id,
    windyIdentityId: user.windy_identity_id,
    email: user.email,
    tier: user.tier,
    accountId: identityId,
    type: user.identity_type || 'human',
    scopes: effectiveScopes,
    products,
    iss: 'windy-identity',
    client_id: clientId,
    scope,
  };
  if (passportNumber) tokenPayload.eternitas_passport = passportNumber;
  // display_name claim — parity with auth.ts generateTokens. chat_profiles
  // is the richer source (matrix-aligned), users.display_name/name the
  // fallback; without this the SSO-login path minted tokens with no name
  // and chat rendered raw UUIDs (see auth.ts for the full story).
  try {
    const cp = db.prepare('SELECT chat_user_id, display_name FROM chat_profiles WHERE identity_id = ? LIMIT 1').get(identityId) as any;
    const dn = (cp?.display_name && cp.display_name !== identityId && cp.display_name !== user.windy_identity_id)
      ? cp.display_name
      : (user.display_name || user.name || cp?.display_name);
    if (cp?.chat_user_id) tokenPayload.chat_user_id = cp.chat_user_id;
    if (dn) tokenPayload.display_name = dn;
  } catch { /* chat_profiles may not exist on first-run */ }

  let accessToken: string;
  const signingKey = getSigningKey();

  if (signingKey) {
    accessToken = jwt.sign(tokenPayload, signingKey.privateKey, {
      algorithm: 'RS256',
      expiresIn: config.JWT_EXPIRY,
      keyid: signingKey.kid,
    });
  } else {
    accessToken = jwt.sign(tokenPayload, config.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: config.JWT_EXPIRY,
    });
  }

  // Generate refresh token
  const refreshToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at, client_id, scope) VALUES (?, ?, ?, ?, ?)').run(
    refreshToken, identityId, expiresAt, clientId, scope || null,
  );

  return { accessToken, refreshToken };
}

/**
 * Whether the identity's held scopes cover a requested scope.
 * Mirrors _hasScope in middleware/auth.ts: direct match, product wildcard
 * ('windy_pro:*' covers 'windy_pro:read'), and 'admin:*' covers everything.
 */
function _identityHoldsScope(held: string[], requested: string): boolean {
  if (held.includes('admin:*')) return true;
  if (held.includes(requested)) return true;
  const [product] = requested.split(':');
  if (held.includes(`${product}:*`)) return true;
  return false;
}

/**
 * Generate a human-readable user code for device flow.
 * Format: XXXX-XXXX (letters only, no ambiguous chars)
 */
function generateUserCode(): string {
  // Exclude ambiguous characters: 0, O, I, l, 1
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

// ═══════════════════════════════════════════
//  SEED ECOSYSTEM CLIENTS
// ═══════════════════════════════════════════

// Note: client_ids use a mix of underscores and hyphens. Match whatever the
// actual consumer sends — e.g. windy-code (hyphen) is how the VS Code fork
// identifies itself in extensions/windy-ecosystem/src/signIn.ts. Don't
// normalize here — the INSERT below stores the literal value.
const ECOSYSTEM_CLIENTS: { client_id: string; name: string; scopes: string[]; redirect_uris?: string[] }[] = [
  { client_id: 'windy_chat', name: 'Windy Chat', scopes: ['windy_chat:*'] },
  // Windy Chat web SPA — hyphen on purpose: matches the client_id the
  // deployed app sends from windy-chat/web/src/pages/LoginPage.tsx
  // ("Sign in with Windy" authorization-code + PKCE flow).
  {
    client_id: 'windy-chat',
    name: 'Windy Chat',
    scopes: ['openid', 'profile', 'email', 'windy_chat:*'],
    redirect_uris: ['https://app.windychat.ai/auth/callback', 'http://localhost:5173/auth/callback'],
  },
  { client_id: 'windy_mail', name: 'Windy Mail', scopes: ['windy_mail:*'] },
  { client_id: 'eternitas', name: 'Eternitas', scopes: ['eternitas:*'] },
  { client_id: 'windy_fly', name: 'Windy Fly', scopes: ['windy_fly:*'] },
  { client_id: 'windy_pro_mobile', name: 'Windy Word Mobile', scopes: ['openid', 'profile', 'email', 'windy_pro:*', 'windy_mail:read'] },
  // Windy Code — VS Code soft fork IDE. Uses OAuth device-code flow from
  // extensions/windy-ecosystem/src/signIn.ts with exactly these scopes.
  // Public client (no secret); no redirect_uris (device flow doesn't use them).
  { client_id: 'windy-code', name: 'Windy Code', scopes: ['openid', 'profile', 'email', 'windy_code:*', 'windy_chat:*', 'windy_mail:*', 'windy_fly:*'] },
];

/**
 * Pre-seed the oauth_clients table with Windy ecosystem services.
 * Safe to call multiple times — skips clients that already exist, except
 * that entries which declare redirect_uris keep the DB row's redirect_uris
 * in sync (an existing row with a stale/empty list would make GET /authorize
 * reject every redirect_uri for that client). Admin-managed clients (no
 * redirect_uris declared here) are never touched.
 */
export function seedEcosystemClients(): void {
  const db = getDb();

  for (const client of ECOSYSTEM_CLIENTS) {
    const wantedRedirects = JSON.stringify(client.redirect_uris || []);
    const existing = db.prepare('SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?').get(client.client_id) as any;
    if (existing) {
      // Compare canonically — Postgres hands JSONB back as a parsed array,
      // SQLite as a raw string; a naive !== would rewrite on every boot.
      const existingRedirects = JSON.stringify(parseJsonArrayColumn(existing.redirect_uris));
      if (client.redirect_uris && existingRedirects !== wantedRedirects) {
        db.prepare('UPDATE oauth_clients SET redirect_uris = ? WHERE client_id = ?')
          .run(wantedRedirects, client.client_id);
        console.log(`[oauth] Synced redirect_uris for ecosystem client: ${client.client_id}`);
      }
      continue;
    }

    db.prepare(`
      INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public)
      VALUES (?, NULL, ?, ?, ?, 1, 1)
    `).run(client.client_id, client.name, wantedRedirects, JSON.stringify(client.scopes));

    console.log(`[oauth] Seeded ecosystem client: ${client.client_id}`);
  }
}

export default router;
