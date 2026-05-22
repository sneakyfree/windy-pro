/**
 * GET /api/v1/vitals
 *
 * Returns the SERVER process's host vitals in the Vitals v1 shape
 * (windy.vitals.v1). Per ADR-054, the renderer falls back to this
 * endpoint when no local Vitals source is available (plain browser);
 * the Web SPA surfaces a "📡 Server demo — open desktop app for local
 * vitals" banner to be honest about the provenance.
 *
 * WD-31 M-D.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { makeRateLimiter } from '../services/rate-limiter';
import { collectServerVitals } from '../services/vitals-collector';

const router = Router();

const limiter = makeRateLimiter('control-panel-vitals', {
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/', limiter, authenticateToken, async (_req: Request, res: Response) => {
    try {
        const vitals = await collectServerVitals();
        res.json(vitals);
    } catch (err: any) {
        console.error('[vitals] collector failed', err?.message || err);
        res.status(500).json({ error: 'vitals_collection_failed' });
    }
});

export default router;
