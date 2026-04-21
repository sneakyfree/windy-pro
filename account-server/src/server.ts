/**
 * Windy Pro v2.0 — Account & Authentication Server (TypeScript)
 *
 * Express.js server with SQLite storage, bcrypt passwords, JWT auth.
 * Enforces 5-device limit per account.
 */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { getDb, closeDb, closeDbAsync } from './db/schema';
import { initializeJWKS, getJWKSDocument } from './jwks';
import { startWALCheckpoint } from './db-maintenance';
import { initRedis, closeRedis } from './redis';
import authRoutes from './routes/auth';
import translationRoutes, { historyHandler, favoritesHandler } from './routes/translations';
import recordingRoutes from './routes/recordings';
import transcriptionRoutes from './routes/transcription';
import cloneRoutes from './routes/clone';
import adminRoutes from './routes/admin';
import downloadRoutes from './routes/downloads';
import miscRoutes from './routes/misc';
import storageRoutes from './routes/storage';
import cloudRoutes from './routes/cloud';
import identityRoutes from './routes/identity';
import verificationRoutes from './routes/verification';
import oauthRoutes, { seedEcosystemClients } from './routes/oauth';
import deviceApprovalRoutes from './routes/device-approval';
import passwordResetPageRoutes from './routes/password-reset-page';
import adminConsoleRoutes from './routes/admin-console';
import { billingRouter, stripeRouter } from './routes/billing';
import flyRoutes from './routes/fly';
import agentRoutes from './routes/agent';
import webhooksEternitasRoutes from './routes/webhooks-eternitas';
import { authenticateToken } from './middleware/auth';
import { initErrorReporting, reportError } from './services/error-reporter';

// Initialize Sentry error reporting (fire-and-forget if no DSN configured)
initErrorReporting();

const app = express();

// ─── Proxy trust ──────────────────────────────────────────────
//
// Required for rate limiting + `req.ip` to reflect the real client when
// we're behind AWS ALB, CloudFront, nginx, etc. Without this, every
// request looks like it comes from the load balancer's IP and the
// per-IP rate-limit becomes a global cap shared across all users.
//
// `TRUST_PROXY` env var accepts anything Express understands:
//   - "true" / "1"         → trust ALL proxies (fine behind a single LB)
//   - an integer like "1"  → trust N hops
//   - a CIDR list          → e.g. "10.0.0.0/8, 172.16.0.0/12"
// Default in dev: `loopback` so localhost testing works. In production
// we hard-fail instead of silently trusting the wrong thing — requiring
// operator to set TRUST_PROXY with an explicit value.
{
    const raw = process.env.TRUST_PROXY;
    if (raw && raw.length > 0) {
        // Accept 'true'/'false', integers, or comma-separated strings.
        const parsed = raw === 'true' ? true
            : raw === 'false' ? false
            : /^\d+$/.test(raw) ? parseInt(raw, 10)
            : raw.includes(',') ? raw.split(',').map(s => s.trim())
            : raw;
        app.set('trust proxy', parsed);
        console.log(`[server] trust proxy = ${JSON.stringify(parsed)}`);
    } else if (process.env.NODE_ENV === 'production') {
        throw new Error(
            '❌ TRUST_PROXY is required in production. Set it to the number of proxy hops ' +
            '(e.g. "1" behind a single ALB) or an explicit CIDR list. ' +
            'Without this, rate limits use the load-balancer IP instead of the real client IP.',
        );
    } else {
        // Dev-only — trust the loopback so supertest / localhost works.
        app.set('trust proxy', 'loopback');
    }
}

// ─── CORS ─────────────────────────────────────────────────────
//
// In production, CORS_ALLOWED_ORIGINS MUST be set. A wildcard origin with
// `credentials: true` creates a CSRF vector for any cookie-authed flow we
// add later, and silently accepts tokens issued at one origin from every
// other origin.
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ALLOWED_ORIGINS) {
    throw new Error(
        '❌ CORS_ALLOWED_ORIGINS is required in production. ' +
        'Set it to a comma-separated list of allowed origins, e.g. ' +
        '"https://windyword.ai,https://account.windyword.ai".',
    );
}

// ─── RESEND_API_KEY fail-closed ────────────────────────────────
//
// Wave 14 P0 — smoke report 2026-04-19 found /auth/forgot-password
// leaking reset tokens in the response body when services/mailer.ts
// stubs delivery. The code-side fix gates the `_devToken` branch on
// NODE_ENV !== 'production', but defence-in-depth: in production the
// mailer MUST be able to actually send — otherwise password-reset
// emails silently disappear while /forgot-password returns success.
// Fail closed so an unconfigured prod deploy can't start.
if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
    throw new Error(
        '❌ RESEND_API_KEY is required in production. ' +
        'Without it, /auth/forgot-password + email verification stub ' +
        'silently (reset tokens never reach users). Set RESEND_API_KEY ' +
        'to an active Resend key, or rewire services/mailer.ts to another ' +
        'provider before deploying to production.',
    );
}
app.use(cors({
    origin: process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
        : true, // Dev-only: reflect whatever origin the browser presents.
    credentials: true,
}));
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));

// Stripe webhook needs raw body — must come BEFORE express.json()
app.use('/api/v1/stripe', express.raw({ type: 'application/json' }), stripeRouter);

// Wave 13 — Eternitas firehose also needs raw body for HMAC verify,
// so mount it before the global express.json() body parser (same
// reason + same pattern as Stripe above).
app.use('/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhooksEternitasRoutes);

// Cap request body at 100 KiB. Everything legitimate (register, verify,
// login, webhook payloads) fits well under this. An oversized body throws
// `PayloadTooLargeError` which the error handler below converts to 413.
const JSON_BODY_LIMIT = '100kb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT })); // Admin console HTML forms

// ─── Body-parser error handler ────────────────────────────────
//
// Wave 7 P1-4 + P1-5 — malformed JSON and oversized bodies previously
// surfaced as 500 "Internal server error" because express.json()'s
// SyntaxError / entity.too.large errors bubbled to the catch-all below.
// This explicit handler runs BEFORE routes mount, so body-parser errors
// return well-formed 4xx responses instead.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({
            error: 'Request body too large',
            code: 'payload_too_large',
            limit: JSON_BODY_LIMIT,
        });
    }
    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({
            error: 'Malformed JSON body',
            code: 'invalid_json',
        });
    }
    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({
            error: 'Could not parse request body',
            code: 'invalid_body',
        });
    }
    // Not a body-parser error — let the general handler below deal with it.
    return next(err);
});

// ─── Static Website ──────────────────────────────────────────
// Serve the Windy Pro landing page and web app from the web dist folder
import path from 'path';
const webDistDir = path.join(__dirname, '..', '..', 'src', 'client', 'web', 'dist');
// Cache strategy matching the original web proxy:
// - index.html, sw.js, manifest.json: NEVER cache (always fresh)
// - /assets/*: immutable (Vite hashed filenames)
// - everything else: revalidate hourly
app.use('/assets', express.static(path.join(webDistDir, 'assets'), {
    maxAge: '1y', immutable: true
}));
app.use('/landing', express.static(path.join(webDistDir, 'landing'), {
    setHeaders: (res: any, filePath: string) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));
app.use('/wizard', express.static(path.join(webDistDir, 'wizard')));
app.use(express.static(webDistDir, {
    index: 'index.html',
    setHeaders: (res: any, filePath: string) => {
        const base = path.basename(filePath);
        if (['index.html', 'sw.js', 'manifest.json'].includes(base)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// ─── Mount Routes ────────────────────────────────────────────

// Auth
app.use('/api/v1/auth', authRoutes);
// Also mount at /v1/auth for backward compat with test-api.sh
app.use('/v1/auth', authRoutes);

// Identity (Unified Windy Identity — Phase 10.0)
app.use('/api/v1/identity', identityRoutes);

// Verification (Phase 1 — promoted from chat-onboarding to identity-level)
app.use('/api/v1/identity/verify', verificationRoutes);

// OAuth2 / SSO (Phase 5 — "Sign in with Windy")
app.use('/api/v1/oauth', oauthRoutes);

// Top-level device-code approval page (GET /device, POST /device/approve).
// Mobile shows "Visit windyword.ai/device" — this is the operator UI.
app.use('/', deviceApprovalRoutes);

// P1-14: /reset-password page so the email link from forgot-password
// actually lands on a working form instead of the SPA's 404 wildcard.
app.use('/', passwordResetPageRoutes);

// JWKS + OIDC-discovery rate limit — Wave 7 P1-7. Both endpoints are cheap
// but unauthenticated. Public CDN fronts would normally absorb abuse; lacking
// one, a naive loop hitting these at 10k rps can still fill the event loop.
// 120/min per client is generous for legitimate JWKS clients (which cache for
// 1 hour via our Cache-Control header) and enough to trip obvious abuse.
const wellKnownLimiter = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeRateLimiter } = require('./services/rate-limiter');
    return makeRateLimiter('well-known', {
        windowMs: 60 * 1000,
        max: process.env.NODE_ENV === 'test' ? 10000 : 120,
        standardHeaders: true,
        legacyHeaders: false,
    });
})();

// JWKS endpoint (Phase 4 — public keys for RS256 token verification)
app.get('/.well-known/jwks.json', wellKnownLimiter, (_req, res) => {
    const jwks = getJWKSDocument();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(jwks);
});

// OIDC Discovery (Phase 5 — OpenID Connect provider metadata)
app.get('/.well-known/openid-configuration', wellKnownLimiter, (req, res) => {
    const issuer = process.env.OIDC_ISSUER || `${req.protocol}://${req.get('host')}`;
    res.json({
        issuer,
        authorization_endpoint: `${issuer}/api/v1/oauth/authorize`,
        token_endpoint: `${issuer}/api/v1/oauth/token`,
        userinfo_endpoint: `${issuer}/api/v1/oauth/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        device_authorization_endpoint: `${issuer}/api/v1/oauth/device`,
        scopes_supported: [
            'openid', 'profile', 'email', 'phone',
            'windy_pro:*', 'windy_chat:read', 'windy_chat:write',
            'windy_mail:read', 'windy_mail:send', 'windy_fly:*',
        ],
        response_types_supported: ['code'],
        grant_types_supported: [
            'authorization_code',
            'client_credentials',
            'refresh_token',
            'urn:ietf:params:oauth:grant-type:device_code',
        ],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256', 'HS256'],
        code_challenge_methods_supported: ['S256'],
    });
});

// Translations
app.use('/api/v1/translate', translationRoutes);
// User history/favorites (different prefix but related to translations)
app.get('/api/v1/user/history', authenticateToken, historyHandler);
app.post('/api/v1/user/favorites', authenticateToken, favoritesHandler);

// Recordings
app.use('/api/v1/recordings', recordingRoutes);

// Transcription
app.use('/api/v1/transcribe', transcriptionRoutes);

// Clone/Training
app.use('/api/v1/clone', cloneRoutes);

// Admin API
app.use('/api/v1/admin', adminRoutes);

// Admin Console (server-rendered HTML — Phase 7B)
app.use('/admin', adminConsoleRoutes);

// Downloads
app.use('/download', downloadRoutes);

// Misc routes (health, analytics, updates, license, rtc, ocr)
app.use('/', miscRoutes);

// File storage (merged from cloud-storage service)
app.use('/api/v1/files', storageRoutes);

// Cloud infrastructure stubs (phone provisioning, push notifications)
app.use('/api/v1/cloud', cloudRoutes);

// Fly agent proxy (ecosystem dashboard chat)
app.use('/api/v1/fly', flyRoutes);

// Wave 8 — Managed-credential broker + hatch-from-Pro endpoint.
// HMAC-gated credentials/issue for S2S, Bearer-JWT /hatch that streams SSE.
app.use('/api/v1/agent', agentRoutes);


// Billing
app.use('/api/v1/billing', billingRouter);

// Webhooks — inbound notifications from ecosystem services
// POST /api/v1/webhooks/identity/created — called by Windy Mail on new identity
app.post('/api/v1/webhooks/identity/created', express.json(), (req, res) => {
    const { windy_identity_id, email, name, product } = req.body || {};
    console.log(`📨 Webhook: identity/created for ${email || windy_identity_id} (product: ${product || 'unknown'})`);
    // Acknowledge receipt — full provisioning handled by /identity/provision-all
    res.json({
        received: true,
        windy_identity_id: windy_identity_id || null,
        message: 'Identity creation webhook acknowledged. Use POST /api/v1/identity/provision-all to provision products.',
    });
});

// ─── JSON 404 for unmatched API routes ──────────────────────

app.use('/api/', (req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

// ─── SPA Catch-All (React Router client-side routing) ───────
// Any non-API, non-static request gets index.html so React Router handles routing.
// This must come AFTER all API routes and static file serving.

import fs from 'fs';
const spaIndexPath = path.join(webDistDir, 'index.html');
app.get('*', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Skip if the request looks like a file (has extension)
    if (req.path.includes('.')) return next();
    // Serve index.html for SPA routes
    if (fs.existsSync(spaIndexPath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(spaIndexPath);
    } else if (req.path === '/' || req.path === '/index.html') {
        // Wave 14 P0-2 — minimal landing stub. The SPA bundle is not
        // included in the Phase 1 Docker image (the web builder stage
        // was removed to keep the image lean; see account-server/
        // Dockerfile). Without this stub, GET / falls through to
        // Express's default 404 ("Cannot GET /") — the first thing a
        // human visiting the domain saw. Keep the response tiny,
        // link to the things that DO exist, and NEVER leak backend
        // shape (no version, no uptime, no endpoint table).
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Windy — windypro account API</title>
  <style>
    html,body{margin:0;padding:0;background:#0F1219;color:#E2E8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{max-width:540px;padding:40px 44px;text-align:center}
    h1{margin:0 0 16px;font-size:28px;font-weight:700;color:#F8FAFC;letter-spacing:-0.01em}
    p{margin:0 0 12px;font-size:15px;line-height:1.55;color:#94A3B8}
    a{color:#8B5CF6;text-decoration:none}
    a:hover{text-decoration:underline}
    code{font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;background:rgba(139,92,246,0.12);padding:2px 6px;border-radius:4px;font-size:13px;color:#CBD5E1}
    .footer{margin-top:24px;font-size:12px;color:#64748B}
  </style>
</head>
<body>
  <div class="card">
    <h1>🌪️ Windy Word — account API</h1>
    <p>This host serves the Windy ecosystem's identity and authentication API. There is no UI here yet.</p>
    <p>If you meant to install the desktop app, visit <a href="https://windyword.ai">windyword.ai</a>.</p>
    <p>If you are integrating with the API, start at <code>/.well-known/openid-configuration</code>.</p>
    <p class="footer">Uptime + health at <code>/healthz</code>.</p>
  </div>
</body>
</html>`);
    } else {
        next();
    }
});

// ─── Error Handler ───────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── HTTP + WebSocket Server ─────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

wss.on('connection', (ws: WebSocket) => {
    let authenticated = false;
    let wsConfig = { language: 'en', engine: 'cloud-standard' };
    let chunkCount = 0;

    console.log('🎙️  WS transcribe: client connected');

    ws.send(JSON.stringify({ type: 'ack' }));

    // SEC-H1: Close connection if no auth within 10 seconds
    const authTimeout = setTimeout(() => {
        if (!authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
            ws.close(4001, 'Authentication timeout');
        }
    }, 10000);

    ws.on('message', (data: Buffer | ArrayBuffer | string) => {
        // Binary audio chunk
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
            // SEC-H1: Reject binary data until authenticated
            if (!authenticated) {
                ws.send(JSON.stringify({ type: 'error', message: 'Authentication required before sending audio' }));
                return;
            }
            chunkCount++;
            if (chunkCount % 10 === 0) {
                ws.send(JSON.stringify({
                    type: 'transcript',
                    text: `[Transcription chunk ${chunkCount}]`,
                    partial: true,
                    confidence: 0.92,
                    startTime: (chunkCount - 10) * 0.1,
                    endTime: chunkCount * 0.1,
                    language: wsConfig.language,
                }));
            }
            return;
        }

        // Text message (JSON)
        try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
                case 'auth':
                    if (msg.token) {
                        try {
                            // SEC-H5: Explicit algorithm whitelist
                            jwt.verify(msg.token, config.JWT_SECRET, { algorithms: ['HS256'] });
                            authenticated = true;
                            clearTimeout(authTimeout);
                        } catch {
                            authenticated = false;
                        }
                    }
                    ws.send(JSON.stringify({ type: 'ack', authenticated }));
                    break;

                case 'config':
                    // SEC-H1: Reject config before auth
                    if (!authenticated) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
                        return;
                    }
                    wsConfig.language = msg.language || wsConfig.language;
                    wsConfig.engine = msg.engine || wsConfig.engine;
                    ws.send(JSON.stringify({ type: 'state', state: 'listening' }));
                    console.log(`🎙️  WS config: language=${wsConfig.language}, engine=${wsConfig.engine}`);
                    break;

                case 'stop':
                    ws.send(JSON.stringify({
                        type: 'transcript',
                        text: `[Final transcription — ${chunkCount} audio chunks processed]`,
                        partial: false,
                        confidence: 0.95,
                        startTime: 0,
                        endTime: chunkCount * 0.1,
                        language: wsConfig.language,
                    }));
                    console.log(`🎙️  WS transcribe: stopped after ${chunkCount} chunks`);
                    ws.close();
                    break;

                default:
                    ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
            }
        } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
    });

    ws.on('close', () => {
        clearTimeout(authTimeout);
        console.log(`🎙️  WS transcribe: client disconnected (${chunkCount} chunks)`);
    });
});

// ─── Start ───────────────────────────────────────────────────

// Ensure DB is initialized
const db = getDb();

// Seed ecosystem OAuth clients (windy_chat, windy_mail, eternitas, windy_fly)
seedEcosystemClients();

// Wave 14 P1-3 — bootstrap an admin user if ADMIN_BOOTSTRAP_EMAIL +
// ADMIN_BOOTSTRAP_PASSWORD are set and no admin exists yet. Phase 1
// shipped dormant; this is how ops brings the admin console online.
import { maybeBootstrapAdmin } from './services/admin-bootstrap';
maybeBootstrapAdmin().catch(err => {
    console.error('[admin-bootstrap] failed:', err?.message || err);
});

// Phase 4: Initialize RS256 key management (falls back to HS256 if unconfigured)
initializeJWKS();

// Phase 4: Start periodic WAL checkpoint to prevent unbounded WAL growth
startWALCheckpoint();

// Phase 7A: Initialize Redis (non-blocking — falls back to in-memory if unavailable)
initRedis().catch(err => {
    console.warn('[redis] Init warning:', err.message);
});

// Only start listening in non-test mode — tests use supertest(app) directly
if (process.env.NODE_ENV !== 'test') {
  server.listen(config.PORT, () => {
    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
    const dbType = process.env.DATABASE_URL?.startsWith('postgres') ? 'PostgreSQL' : 'SQLite';

    console.log('');
    console.log('🔑 Windy Pro Account Server v2.0 (TypeScript)');
    console.log(`   Port:     http://localhost:${config.PORT}`);
    console.log(`   Database: ${dbType === 'PostgreSQL' ? 'PostgreSQL' : config.DB_PATH}`);
    console.log(`   Users:    ${userCount}`);
    console.log(`   Devices:  ${config.MAX_DEVICES} per account`);
    console.log('');
    console.log('   Endpoints:');
    console.log('   POST /v1/auth/register              — Create account');
    console.log('   POST /v1/auth/login                 — Login');
    console.log('   POST /v1/auth/logout                — Logout');
    console.log('   GET  /v1/auth/me                    — Current user info');
    console.log('   GET  /v1/auth/devices               — List devices');
    console.log(`   POST /v1/auth/devices/register      — Register device (${config.MAX_DEVICES} max)`);
    console.log('   POST /v1/auth/devices/remove        — Remove device');
    console.log('   POST /v1/auth/refresh               — Refresh token');
    console.log('   POST /api/v1/translate/speech        — Speech translation');
    console.log('   POST /api/v1/translate/text          — Text translation (AI)');
    console.log('   GET  /api/v1/translate/languages     — Supported languages');
    console.log('   POST /api/v1/transcribe              — Audio transcription');
    console.log('   POST /api/v1/transcribe/batch        — Batch transcription');
    console.log('   WS   /ws/transcribe                  — Real-time transcription');
    console.log('   POST /api/v1/ocr/translate           — OCR + translate');
    console.log('   GET  /api/v1/recordings              — List recordings');
    console.log('   GET  /api/v1/recordings/:id          — Get recording');
    console.log('   DEL  /api/v1/recordings/:id          — Delete recording');
    console.log('   POST /api/v1/recordings/upload       — Upload recording');
    console.log('   POST /api/v1/recordings/upload/chunk — Chunked upload');
    console.log('   POST /api/v1/recordings/upload/batch — Batch upload');
    console.log('   POST /api/v1/recordings/sync         — Sync recordings');
    console.log('   GET  /api/v1/recordings/check        — Check bundle exists');
    console.log('   GET  /api/v1/user/history            — Translation history');
    console.log('   POST /api/v1/user/favorites          — Toggle favorite');
    console.log('   POST /api/v1/analytics               — Log event (no auth)');
    console.log('   GET  /api/v1/updates/check           — Check for updates');
    console.log('   POST /api/v1/license/activate        — Activate license');
    console.log('   GET  /api/v1/admin/users             — Admin: list users');
    console.log('   GET  /api/v1/admin/stats             — Admin: server stats');
    console.log('   GET  /api/v1/admin/revenue           — Admin: revenue');
    console.log('   GET  /api/v1/clone/training-data     — Clone: training bundles');
    console.log('   POST /api/v1/clone/start-training    — Clone: start training');
    console.log('   GET  /download/latest/:platform      — Download latest release');
    console.log('   GET  /download/verify                — Download verification');
    console.log('   GET  /download/version               — Current version');
    console.log('   GET  /health                         — Health check');
    console.log('');

    // Start ecosystem provisioning retry worker
    // P2-6: Start hourly cleanup of exhausted / orphaned pending_provisions rows.
    const { startRetryWorker, startPendingCleanup } = require('./services/ecosystem-provisioner');
    startRetryWorker();
    startPendingCleanup();

    // PR4: Start identity webhook fan-out worker (polls webhook_deliveries every 30s)
    // P1-10: Start hourly cleanup of terminal webhook_deliveries rows.
    const { startWebhookWorker, startWebhookCleanup } = require('./services/webhook-bus');
    startWebhookWorker();
    startWebhookCleanup();

    // Register with Eternitas as a platform (idempotent — skips if already registered)
    const { registerWithEternitas } = require('./services/eternitas-register');
    registerWithEternitas().catch((err: any) => console.warn('[Startup] Eternitas registration deferred:', err.message));
  });
}

// ─── Process-level error handlers ───────────────────────────

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    console.error('UNHANDLED REJECTION at:', promise);
    console.error('Reason:', reason instanceof Error ? reason.stack : reason);
    reportError(reason instanceof Error ? reason : new Error(String(reason)), { handler: 'unhandledRejection' });
    // Don't crash — log and continue
});

process.on('uncaughtException', (err: Error) => {
    console.error('UNCAUGHT EXCEPTION:', err.stack || err);
    reportError(err, { handler: 'uncaughtException' });
    // Graceful shutdown on uncaught exception — state may be corrupted
    closeRedis().catch(() => {});
    closeDb();
    process.exit(1);
});

// Graceful shutdown — await the pool drain so in-flight registrations finish.
// A 5 s hard deadline protects against a hung driver keeping the container alive.
async function gracefulShutdown(signal: string): Promise<void> {
    const deadline = setTimeout(() => {
        console.error(`[${signal}] graceful shutdown timed out — forcing exit`);
        process.exit(0);
    }, 5000);
    deadline.unref();
    try { await closeRedis(); } catch { /* best-effort */ }
    try { await closeDbAsync(); } catch { /* best-effort */ }
    process.exit(0);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

export { app, server };
