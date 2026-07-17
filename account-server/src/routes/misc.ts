/**
 * Misc routes — health, analytics, updates, license, rtc, ocr.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { makeRateLimiter } from '../services/rate-limiter';
import { getDb } from '../db/schema';
import { config } from '../config';
import { isRS256Available } from '../jwks';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { emitAdminEvent } from '../services/admin-telemetry';
import {
    LicenseActivateRequestSchema,
    AnalyticsRequestSchema,
    RtcSignalRequestSchema,
} from '@windy-pro/contracts';

// Read version from package.json
import packageJson from '../../package.json';
const SERVER_VERSION: string = packageJson.version;

const analyticsLimiter = makeRateLimiter('analytics', {
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// In-memory RTC session store with TTL cleanup
const RTC_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RTC_MAX_SESSIONS = 1000;
const rtcSessions = new Map<string, { offer: string | null; answer: string | null; candidates: any[]; switchCamera?: boolean; createdAt: number }>();

// Periodic cleanup of expired RTC sessions
const rtcCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of rtcSessions) {
        if (now - session.createdAt > RTC_SESSION_TTL_MS) {
            rtcSessions.delete(token);
        }
    }
}, 60 * 1000);
rtcCleanupTimer.unref();

// ─── Comprehensive Health Check (cached 30s) ────────────────

const startTime = Date.now();

interface HealthResult {
    status: string;
    service: string;
    version: string;
    uptime_seconds: number;
    database: string;
    jwks: string;
    services: Record<string, string>;
    timestamp: string;
}

let cachedHealth: HealthResult | null = null;
let cacheExpiry = 0;

/**
 * Probe a service's health endpoint with a 3-second timeout.
 * Returns "ok" on any 2xx response, "unreachable" otherwise.
 *
 * Uses native fetch (Node 18+) so http:// + https:// URLs both work —
 * the previous http.get(url) silently failed on https:// URLs, which is
 * how every sister service showed "unreachable" in prod even though
 * they were all live (curl -s -o /dev/null -w '%{http_code}' returned
 * 200 for all four).
 *
 * `healthPath` defaults to /health; chat overrides to the Synapse
 * versions endpoint because Matrix homeservers don't expose /health
 * (they return 404 there).
 */
function checkService(baseUrl: string, healthPath: string = '/health'): Promise<string> {
    if (!baseUrl) return Promise.resolve('unreachable');
    const url = baseUrl.replace(/\/+$/, '') + healthPath;
    return fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) })
        .then((res) => (res.status >= 200 && res.status < 300 ? 'ok' : 'error'))
        .catch(() => 'unreachable');
}

async function buildHealthResult(): Promise<HealthResult> {
    // 1. Database check
    let dbStatus = 'ok';
    try {
        const db = getDb();
        db.prepare('SELECT 1').get();
    } catch {
        dbStatus = 'error';
    }

    // 2. JWKS check
    const jwksStatus = isRS256Available() ? 'ok' : 'error';

    // 3. Ecosystem service checks (parallel, 3s timeout each)
    //    All targets expose /health — including Synapse (GET /health → 200
    //    "OK") AND chat-onboarding. WINDY_CHAT_URL points at chat-onboarding
    //    (:8101) in prod for the provisioning calls, so probing
    //    /_matrix/client/versions here 404'd and /health reported
    //    windy_chat:"error" while chat was fine (chat stress pass 2026-07-16).
    const [windyChat, windyMail, windyCloud, eternitas] = await Promise.all([
        checkService(config.WINDY_CHAT_URL),
        checkService(config.WINDY_MAIL_URL),
        checkService(config.WINDY_CLOUD_URL),
        checkService(config.ETERNITAS_URL),
    ]);

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    return {
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        service: 'windy-pro-account-server',
        version: SERVER_VERSION,
        uptime_seconds: uptimeSeconds,
        database: dbStatus,
        jwks: jwksStatus,
        services: {
            windy_chat: windyChat,
            windy_mail: windyMail,
            windy_cloud: windyCloud,
            eternitas,
        },
        timestamp: new Date().toISOString(),
    };
}

// ─── GET /health (+ /healthz + /api/v1/health aliases) ─────
//
// /healthz is the cloud-native convention (Kubernetes liveness /
// readiness probes, most cloud load balancers). /health is what the
// rest of the ecosystem already hits. /api/v1/health is what the
// smoke-test brief + the ECOSYSTEM_API_REFERENCE route-table
// assume (Wave 14 P1-2 fix). All three point at the same handler
// so ops + clients can pick any without lying about what's live.

router.get(['/health', '/healthz', '/api/v1/health'], async (_req: Request, res: Response) => {
    try {
        const now = Date.now();
        if (!cachedHealth || now > cacheExpiry) {
            cachedHealth = await buildHealthResult();
            cacheExpiry = now + 30_000; // cache for 30 seconds
        }
        // Update timestamp and uptime on every response even when cached
        const result = {
            ...cachedHealth,
            uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
            timestamp: new Date().toISOString(),
        };
        const statusCode = result.database === 'ok' ? 200 : 503;
        res.status(statusCode).json(result);
    } catch (err) {
        res.status(503).json({
            status: 'error',
            version: SERVER_VERSION,
            uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
            database: 'error',
            jwks: 'error',
            services: {},
            timestamp: new Date().toISOString(),
        });
    }
});

// ─── GET /version (MF1 — deployment identity) ─────────────────
//
// Separate from /health on purpose:
//   - /health is for orchestrators (liveness/readiness probes)
//   - /version is for deployment verification (provenance)
//   - /version MUST NOT depend on DB — process-level fact, safe to
//     call during incidents
//
// Consumer: kit-army-config deployed-state cron polls /version every
// 30 minutes and writes docs/deployed-state.json. See
// ~/kit-army-config/docs/marathon-foundations-program-2026-05-11.md §MF1.

const VERSION_STARTED_AT: string = new Date().toISOString();

router.get('/version', (_req: Request, res: Response) => {
    const commitSha = process.env.COMMIT_SHA || null;
    res.json({
        service: 'windy-pro-account',
        version: SERVER_VERSION,
        commit_sha: commitSha,
        commit_sha_short: commitSha ? commitSha.slice(0, 7) : null,
        build_timestamp: process.env.BUILD_TIMESTAMP || null,
        started_at: VERSION_STARTED_AT,
        environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'unknown',
    });
});

// ─── POST /api/v1/analytics ──────────────────────────────────

router.post('/api/v1/analytics', analyticsLimiter, validate(AnalyticsRequestSchema), (req: Request, res: Response) => {
    const { event, properties } = req.body || {};
    console.log(`📊 Analytics: ${event || 'unknown'}`);
    res.json({ received: true });
});

// ─── GET /api/v1/updates/check ───────────────────────────────

router.get('/api/v1/updates/check', (_req: Request, res: Response) => {
    res.json({
        version: SERVER_VERSION,
        url: `https://windyword.ai/download/latest`,
        releaseNotes: 'Bug fixes and performance improvements',
        required: false,
    });
});

// ─── POST /api/v1/license/activate ───────────────────────────

// Commerce P5: activation is device-bound. A license key activates on at
// most MAX_LICENSE_ACTIVATIONS distinct machines (fingerprint from the
// X-Device-Fingerprint header the desktop DRM layer already sends).
// Enforcement happens HERE, at activation — never via the heartbeat, and
// never by deleting anything (balanced anti-piracy: local tier stays
// usable offline; over-cap and multi-account keys are FLAGGED for admin
// review via GET /api/v1/admin/licenses/flagged).
const MAX_LICENSE_ACTIVATIONS = 3;

router.post('/api/v1/license/activate', authenticateToken, validate(LicenseActivateRequestSchema), (req: Request, res: Response) => {
    try {
        const db = getDb();
        const { key } = req.body;
        const userId = (req as AuthRequest).user.userId;
        const fingerprint = String(req.headers['x-device-fingerprint'] || '').slice(0, 128);
        const deviceName = String(req.headers['x-device-name'] || '').slice(0, 128) || null;

        // Commerce P5: device-bound activation. Enforce the machine cap BEFORE
        // binding the key (the security de-grant below is independent of this).
        if (fingerprint) {
            const existing = db.prepare(
                'SELECT active FROM license_activations WHERE license_key = ? AND device_fingerprint = ?',
            ).get(key, fingerprint) as { active: number | boolean } | undefined;
            const activeCount = (db.prepare(
                'SELECT COUNT(*) as n FROM license_activations WHERE license_key = ? AND active = 1',
            ).get(key) as any).n;

            const alreadyActive = existing && (existing.active === 1 || existing.active === true);
            if (!alreadyActive && activeCount >= MAX_LICENSE_ACTIVATIONS) {
                // Intel (CONTRACT §8): activation blocked by the machine cap.
                emitAdminEvent({
                    event_type: 'license.activate', actor_type: 'human', actor_id: userId,
                    metadata: { ok: false, reason: 'device_limit', device_count: activeCount },
                });
                return res.status(403).json({
                    error: 'activation_limit',
                    message: `This license is already active on ${MAX_LICENSE_ACTIVATIONS} machines. Deactivate one from your account page (or ask support) and try again.`,
                    active_devices: activeCount,
                    max_devices: MAX_LICENSE_ACTIVATIONS,
                });
            }
            if (existing) {
                db.prepare(
                    'UPDATE license_activations SET active = 1, user_id = ?, device_name = ?, last_seen_at = ? WHERE license_key = ? AND device_fingerprint = ?',
                ).run(userId, deviceName, new Date().toISOString(), key, fingerprint);
            } else {
                db.prepare(
                    'INSERT INTO license_activations (license_key, device_fingerprint, user_id, device_name, active) VALUES (?, ?, ?, ?, 1)',
                ).run(key, fingerprint, userId, deviceName);
            }
        }

        // [A1 fix] A license key does NOT confer a tier. WP- keys are format-only
        // (tierFromKey is a string parse) with no issued-key store or signature, so an
        // activated key can never be trusted to grant paid access. Bind the key for the
        // desktop DRM heartbeat + device board (above); the tier comes solely from the
        // Stripe-verified account.
        //
        // [reactivation fix] Re-activating a key must CLEAR the admin 'revoked'
        // sentinel — otherwise a revoked license can never be restored (the
        // heartbeat 403s forever → the desktop keeps deleting model files). A1
        // stopped activate from writing license_tier, so nothing cleared the
        // sentinel anymore; this restores the Mission-5 revoke→reactivate
        // lifecycle. We flip ONLY 'revoked' → NULL; a key can never write a
        // PAID tier, so A1's no-elevation invariant holds (license_tier is only
        // ever NULL or the admin-set 'revoked').
        db.prepare(
            "UPDATE users SET license_key = ?, license_tier = CASE WHEN license_tier = 'revoked' THEN NULL ELSE license_tier END WHERE id = ?",
        ).run(key, userId);
        const acct = db.prepare('SELECT tier FROM users WHERE id = ?')
            .get(userId) as { tier: string | null } | undefined;
        const tier = acct?.tier || 'free';

        console.log(`🔑 License key bound for user ${userId.slice(0, 8)} (key: ${key.slice(0, 7)}...); tier=${tier} (from account)`);

        // Intel (CONTRACT §8): successful activation. Tier comes from the
        // Stripe-verified account, never the key (A1 invariant).
        emitAdminEvent({
            event_type: 'license.activate', actor_type: 'human', actor_id: userId,
            metadata: { ok: true, tier },
        });

        res.json({
            success: true,
            tier,
            key: key.slice(0, 7) + '...',
            activatedAt: new Date().toISOString(),
        });
    } catch (err: any) {
        console.error('License activation error:', err);
        res.status(500).json({ error: 'License activation failed' });
    }
});

// ─── POST /v1/license/heartbeat (+ /api/v1 alias) ────────────
// Desktop DRM heartbeat (src/client/desktop/heartbeat-service.js). The
// bearer is the LICENSE KEY (WP-XXXX-XXXX-XXXX), not a session JWT.
//
// ⚠️ Response-code contract: the desktop client DELETES all downloaded
// model files when this endpoint returns 401/403 (treated as "revoked").
// The ONLY case allowed to do that is the deliberate 'revoked' tier
// sentinel set by the admin revoke route (admin.ts license/revoke).
// Unknown/invalid keys get 200 {valid:false}, which puts the client on
// the offline-grace path (lock after grace, recoverable) instead of
// destructive delete — data drift must never nuke a customer's models.
const heartbeatLimiter = makeRateLimiter('license-heartbeat', {
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post(['/v1/license/heartbeat', '/api/v1/license/heartbeat'], heartbeatLimiter, (req: Request, res: Response) => {
    const auth = String(req.headers.authorization || '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

    if (!key || key === 'free') {
        return res.json({ valid: false, reason: 'no_license' });
    }

    try {
        const db = getDb();
        const row = db.prepare('SELECT id, tier, license_tier FROM users WHERE license_key = ?')
            .get(key) as { id: string; tier: string | null; license_tier: string | null } | undefined;

        if (!row) {
            return res.json({ valid: false, reason: 'unknown_token' });
        }

        // 'revoked' is a deliberate admin sentinel (admin.ts license/revoke)
        // — the ONLY case allowed to trigger the client's delete-on-revoke.
        if (row.license_tier === 'revoked') {
            // Intel (CONTRACT §8): the DRM kill signal — admin visibility into
            // every denied heartbeat (this is what deletes the client's models).
            emitAdminEvent({
                event_type: 'license.heartbeat_denied', actor_type: 'human',
                actor_id: row.id, metadata: { reason: 'revoked' },
            });
            return res.status(403).json({ valid: false, reason: 'revoked' });
        }

        // Commerce P5: record the sighting for the key-sharing flag. Beyond
        // the activation cap the sighting is stored INACTIVE (active=0) —
        // it grants nothing and feeds /api/v1/admin/licenses/flagged. The
        // heartbeat response itself is unchanged: flag, never punish here.
        const fingerprint = String(req.headers['x-device-fingerprint'] || '').slice(0, 128);
        if (fingerprint) {
            try {
                const seen = db.prepare(
                    'SELECT active FROM license_activations WHERE license_key = ? AND device_fingerprint = ?',
                ).get(key, fingerprint);
                if (seen) {
                    db.prepare('UPDATE license_activations SET last_seen_at = ? WHERE license_key = ? AND device_fingerprint = ?')
                        .run(new Date().toISOString(), key, fingerprint);
                } else {
                    const activeCount = (db.prepare(
                        'SELECT COUNT(*) as n FROM license_activations WHERE license_key = ? AND active = 1',
                    ).get(key) as any).n;
                    db.prepare(
                        'INSERT INTO license_activations (license_key, device_fingerprint, user_id, active) VALUES (?, ?, ?, ?)',
                    ).run(key, fingerprint, row.id, activeCount >= 3 ? 0 : 1);
                }
            } catch { /* sighting bookkeeping must never break the heartbeat */ }
        }

        // [A1 fix] Report the Stripe-verified account tier, never tierFromKey(key)
        // (which would echo a fabricated key's prefix back to the client as a paid tier).
        return res.json({ valid: true, tier: row.tier || 'free' });
    } catch (err: any) {
        console.error('License heartbeat error:', err);
        return res.status(500).json({ valid: false, reason: 'server_error' });
    }
});

// ─── License activations (self-serve device board) ──────────
// The activation-limit error tells users to deactivate a machine — these
// are the endpoints that make that real, scoped to the caller's own key.

router.get('/api/v1/license/activations', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT license_key FROM users WHERE id = ?')
            .get((req as AuthRequest).user.userId) as { license_key: string | null } | undefined;
        if (!user?.license_key) return res.json({ ok: true, activations: [] });
        const activations = db.prepare(
            'SELECT device_fingerprint, device_name, active, activated_at, last_seen_at FROM license_activations WHERE license_key = ? ORDER BY activated_at',
        ).all(user.license_key);
        res.json({ ok: true, activations });
    } catch (err: any) {
        console.error('License activations list error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

router.post('/api/v1/license/activations/deactivate', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const { device_fingerprint } = req.body || {};
        if (!device_fingerprint || typeof device_fingerprint !== 'string') {
            return res.status(400).json({ error: 'missing_fingerprint' });
        }
        const user = db.prepare('SELECT license_key FROM users WHERE id = ?')
            .get((req as AuthRequest).user.userId) as { license_key: string | null } | undefined;
        if (!user?.license_key) return res.status(404).json({ error: 'no_license' });
        const result = db.prepare(
            'UPDATE license_activations SET active = 0, last_seen_at = ? WHERE license_key = ? AND device_fingerprint = ?',
        ).run(new Date().toISOString(), user.license_key, device_fingerprint);
        if (result.changes === 0) return res.status(404).json({ error: 'activation_not_found' });
        res.json({ ok: true, deactivated: device_fingerprint });
    } catch (err: any) {
        console.error('License deactivation error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// ─── POST /api/v1/rtc/signal ─────────────────────────────────

router.post('/api/v1/rtc/signal', authenticateToken, (req: Request, res: Response) => {
    const { type, token, sdp, candidate } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    if (!rtcSessions.has(token)) {
        if (rtcSessions.size >= RTC_MAX_SESSIONS) {
            return res.status(503).json({ error: 'Too many active RTC sessions' });
        }
        rtcSessions.set(token, { offer: null, answer: null, candidates: [], createdAt: Date.now() });
    }
    const session = rtcSessions.get(token)!;

    if (type === 'offer') {
        session.offer = sdp;
        res.json({ success: true });
    } else if (type === 'answer') {
        session.answer = sdp;
        res.json({ success: true });
    } else if (type === 'ice-candidate') {
        session.candidates.push(candidate);
        res.json({ success: true });
    } else if (type === 'switch-camera') {
        session.switchCamera = true;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Unknown signal type' });
    }
});

// ─── GET /api/v1/rtc/signal ──────────────────────────────────

router.get('/api/v1/rtc/signal', authenticateToken, (req: Request, res: Response) => {
    const { token, type } = req.query as { token?: string; type?: string };
    if (!token) return res.status(400).json({ error: 'Token required' });
    const session = rtcSessions.get(token);
    if (!session) return res.json({});

    if (type === 'offer') return res.json({ sdp: session.offer });
    if (type === 'answer') return res.json({ sdp: session.answer, candidates: session.candidates });
    return res.json(session);
});

// ─── POST /api/v1/ocr/translate ──────────────────────────────

router.post('/api/v1/ocr/translate', optionalAuth, upload.single('image'), async (req: Request, res: Response) => {
    try {
        const targetLanguage = req.body.targetLanguage || 'en';
        const sourceLang = req.body.sourceLanguage || 'auto';

        console.log(`📷 OCR translate: target=${targetLanguage}`);

        if (!req.file) {
            return res.status(400).json({ error: 'Image file is required' });
        }

        const openaiKey = config.OPENAI_API_KEY;
        const googleKey = process.env.GOOGLE_VISION_API_KEY;

        // ── Strategy 1: OpenAI GPT-4o Vision ────────────────────
        if (openaiKey) {
            try {
                const base64Image = req.file.buffer.toString('base64');
                const mimeType = req.file.mimetype || 'image/png';

                const prompt = targetLanguage === sourceLang || sourceLang === 'auto'
                    ? 'Extract all text visible in this image. Return ONLY the extracted text, nothing else.'
                    : `Extract all text visible in this image and translate it to ${targetLanguage}. Return the result as JSON: {"extractedText": "...", "translatedText": "..."}`;

                const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiKey}`,
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
                            ],
                        }],
                        max_tokens: 2048,
                    }),
                    signal: AbortSignal.timeout(30000),
                });

                if (apiRes.ok) {
                    const data: any = await apiRes.json();
                    const content = data.choices?.[0]?.message?.content?.trim() || '';

                    // Try to parse structured JSON response
                    let extractedText = content;
                    let translatedText = content;
                    try {
                        const parsed = JSON.parse(content);
                        if (parsed.extractedText) extractedText = parsed.extractedText;
                        if (parsed.translatedText) translatedText = parsed.translatedText;
                    } catch {
                        // Plain text response — use as both
                    }

                    return res.json({
                        extractedText,
                        translatedText,
                        sourceLanguage: sourceLang,
                        targetLanguage,
                        engine: 'openai-vision',
                    });
                } else {
                    console.warn(`⚠️  OpenAI Vision API returned ${apiRes.status}`);
                }
            } catch (err: any) {
                console.warn('⚠️  OpenAI Vision failed:', err.message);
            }
        }

        // ── Strategy 2: Google Cloud Vision API ─────────────────
        if (googleKey) {
            try {
                const base64Image = req.file.buffer.toString('base64');

                const visionRes = await fetch(
                    `https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requests: [{
                                image: { content: base64Image },
                                features: [{ type: 'TEXT_DETECTION' }],
                            }],
                        }),
                        signal: AbortSignal.timeout(15000),
                    },
                );

                if (visionRes.ok) {
                    const visionData: any = await visionRes.json();
                    const extractedText = visionData.responses?.[0]?.fullTextAnnotation?.text?.trim() || '';

                    return res.json({
                        extractedText,
                        translatedText: extractedText, // Translation requires a separate step
                        sourceLanguage: sourceLang,
                        targetLanguage,
                        engine: 'google-vision',
                    });
                } else {
                    console.warn(`⚠️  Google Vision API returned ${visionRes.status}`);
                }
            } catch (err: any) {
                console.warn('⚠️  Google Vision failed:', err.message);
            }
        }

        // ── Fallback: dev stub ──────────────────────────────────
        console.log(`📷 OCR translate (dev stub): no vision API configured`);
        res.json({
            extractedText: '[OCR stub — configure OPENAI_API_KEY or GOOGLE_VISION_API_KEY]',
            translatedText: '[OCR stub — configure OPENAI_API_KEY or GOOGLE_VISION_API_KEY]',
            sourceLanguage: sourceLang,
            targetLanguage,
            engine: 'stub',
            stub: true,
        });
    } catch (err: any) {
        console.error('OCR translate error:', err);
        res.status(500).json({ error: 'OCR translation failed' });
    }
});

export default router;
