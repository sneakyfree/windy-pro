/**
 * Misc routes — health, analytics, updates, license, rtc, ocr.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
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

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// In-memory RTC session store
const rtcSessions = new Map<string, { offer: string | null; answer: string | null; candidates: any[]; switchCamera?: boolean }>();

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

router.post('/api/v1/analytics', (req: Request, res: Response) => {
    const { event, properties } = req.body || {};
    console.log(`📊 Analytics: ${event || 'unknown'}`, properties ? JSON.stringify(properties).slice(0, 200) : '');
    res.json({ received: true });
});

// ─── GET /api/v1/updates/check ───────────────────────────────

router.get('/api/v1/updates/check', (_req: Request, res: Response) => {
    res.set('X-Stub', 'true');
    res.json({
        version: '0.6.0',
        url: 'https://windypro.thewindstorm.uk/download/latest/linux',
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
        res.status(500).json({ error: 'License activation failed: ' + err.message });
    }
});

// ─── POST /api/v1/rtc/signal ─────────────────────────────────

router.post('/api/v1/rtc/signal', (req: Request, res: Response) => {
    const { type, token, sdp, candidate } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    if (!rtcSessions.has(token)) {
        rtcSessions.set(token, { offer: null, answer: null, candidates: [] });
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

router.get('/api/v1/rtc/signal', (req: Request, res: Response) => {
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

        res.set('X-Stub', 'true');
        res.json({
            originalText: '[OCR stub — connect a real OCR engine]',
            translatedText: `[${targetLanguage}] [OCR stub — connect a real OCR engine]`,
            language: targetLanguage,
            confidence: 0.85,
        });
    } catch (err: any) {
        console.error('OCR translate error:', err);
        res.status(500).json({ error: 'OCR translation failed: ' + err.message });
    }
});

export default router;
