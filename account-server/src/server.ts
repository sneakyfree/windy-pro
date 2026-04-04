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
import { getDb, closeDb } from './db/schema';
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
import adminConsoleRoutes from './routes/admin-console';
import { billingRouter, stripeRouter } from './routes/billing';
import flyRoutes from './routes/fly';
import { authenticateToken } from './middleware/auth';

const app = express();

// ─── Middleware ───────────────────────────────────────────────

app.use(cors({
    origin: process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
        : true, // Allow all in development; set CORS_ALLOWED_ORIGINS in production
    credentials: true,
}));
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));

// Stripe webhook needs raw body — must come BEFORE express.json()
app.use('/api/v1/stripe', express.raw({ type: 'application/json' }), stripeRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Admin console HTML forms

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

// JWKS endpoint (Phase 4 — public keys for RS256 token verification)
app.get('/.well-known/jwks.json', (_req, res) => {
    const jwks = getJWKSDocument();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(jwks);
});

// OIDC Discovery (Phase 5 — OpenID Connect provider metadata)
app.get('/.well-known/openid-configuration', (req, res) => {
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
    const { startRetryWorker } = require('./services/ecosystem-provisioner');
    startRetryWorker();

    // Register with Eternitas as a platform (idempotent — skips if already registered)
    const { registerWithEternitas } = require('./services/eternitas-register');
    registerWithEternitas().catch((err: any) => console.warn('[Startup] Eternitas registration deferred:', err.message));
  });
}

// ─── Process-level error handlers ───────────────────────────

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    console.error('UNHANDLED REJECTION at:', promise);
    console.error('Reason:', reason instanceof Error ? reason.stack : reason);
    // Don't crash — log and continue
});

process.on('uncaughtException', (err: Error) => {
    console.error('UNCAUGHT EXCEPTION:', err.stack || err);
    // Graceful shutdown on uncaught exception — state may be corrupted
    closeRedis().catch(() => {});
    closeDb();
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    closeRedis().catch(() => {});
    closeDb();
    process.exit(0);
});
process.on('SIGTERM', () => {
    closeRedis().catch(() => {});
    closeDb();
    process.exit(0);
});

export { app, server };
