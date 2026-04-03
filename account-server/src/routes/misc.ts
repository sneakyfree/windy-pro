/**
 * Misc routes — health, analytics, updates, license, rtc, ocr.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/schema';
import { config } from '../config';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
    LicenseActivateRequestSchema,
    AnalyticsRequestSchema,
    RtcSignalRequestSchema,
} from '@windy-pro/contracts';
import { tierFromKey } from '@windy-pro/contracts';

const analyticsLimiter = rateLimit({
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
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of rtcSessions) {
        if (now - session.createdAt > RTC_SESSION_TTL_MS) {
            rtcSessions.delete(token);
        }
    }
}, 60 * 1000);

// ─── GET /health ─────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
    const db = getDb();
    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
    const deviceCount = (db.prepare('SELECT COUNT(*) as count FROM devices').get() as any).count;

    res.json({
        status: 'ok',
        service: 'windy-pro-account-server',
        version: '2.0.0',
        users: userCount,
        devices: deviceCount,
        maxDevicesPerAccount: config.MAX_DEVICES,
        timestamp: new Date().toISOString(),
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
    res.status(501).json({
        error: 'Not implemented',
        message: 'Update checking requires a release management backend. Configure UPDATE_SERVER_URL.',
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

router.post('/api/v1/ocr/translate', optionalAuth, upload.single('image'), (req: Request, res: Response) => {
    try {
        const targetLanguage = req.body.targetLanguage || 'en';

        console.log(`📷 OCR translate: target=${targetLanguage}`);

        res.status(501).json({
            error: 'Not implemented',
            message: 'OCR translation requires a vision API backend. Configure OCR_API_KEY or GOOGLE_VISION_API_KEY.',
        });
    } catch (err: any) {
        console.error('OCR translate error:', err);
        res.status(500).json({ error: 'OCR translation failed' });
    }
});

export default router;
