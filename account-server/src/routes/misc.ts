/**
 * Misc routes — health, analytics, updates, license, rtc, ocr.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { makeRateLimiter } from '../services/rate-limiter';
import http from 'http';
import { getDb } from '../db/schema';
import { config } from '../config';
import { isRS256Available } from '../jwks';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
    LicenseActivateRequestSchema,
    AnalyticsRequestSchema,
    RtcSignalRequestSchema,
} from '@windy-pro/contracts';
import { tierFromKey } from '@windy-pro/contracts';

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
 * Probe a service's /health endpoint with a 3-second timeout.
 * Returns "ok" on any 2xx response, "unreachable" otherwise.
 */
function checkService(baseUrl: string): Promise<string> {
    if (!baseUrl) return Promise.resolve('unreachable');
    const url = baseUrl.replace(/\/+$/, '') + '/health';
    return new Promise((resolve) => {
        try {
            const req = http.get(url, { timeout: 3000 }, (res) => {
                // Consume the response body to free resources
                res.resume();
                resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 'ok' : 'error');
            });
            req.on('error', () => resolve('unreachable'));
            req.on('timeout', () => { req.destroy(); resolve('unreachable'); });
        } catch {
            resolve('unreachable');
        }
    });
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
        url: `https://windypro.thewindstorm.uk/download/latest`,
        releaseNotes: 'Bug fixes and performance improvements',
        required: false,
    });
});

// ─── POST /api/v1/license/activate ───────────────────────────

router.post('/api/v1/license/activate', authenticateToken, validate(LicenseActivateRequestSchema), (req: Request, res: Response) => {
    try {
        const db = getDb();
        const { key } = req.body;
        const tier = tierFromKey(key);

        db.prepare('UPDATE users SET license_key = ?, license_tier = ? WHERE id = ?')
            .run(key, tier, (req as AuthRequest).user.userId);

        console.log(`🔑 License activated: ${tier} for user ${(req as AuthRequest).user.userId.slice(0, 8)} (key: ${key.slice(0, 7)}...)`);

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
