/**
 * Clone training routes — training data + start training.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { StartTrainingRequestSchema } from '@windy-pro/contracts';

const router = Router();

// ─── GET /api/v1/clone/training-data ─────────────────────────

router.get('/training-data', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const bundles = db.prepare(
            `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
              camera_source, transcript_text, file_size, device_platform,
              clone_training_ready, created_at
       FROM recordings WHERE user_id = ? AND clone_training_ready = 1
       ORDER BY created_at DESC`
        ).all((req as AuthRequest).user.userId);
        res.json({ bundles, total: bundles.length });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/v1/clone/start-training ───────────────────────

router.post('/start-training', authenticateToken, validate(StartTrainingRequestSchema), (req: Request, res: Response) => {
    try {
        const db = getDb();
        const { bundle_ids } = req.body;

        // Validate bundles belong to user and are training-ready
        const placeholders = bundle_ids.map(() => '?').join(',');
        const result = db.prepare(
            `SELECT COUNT(*) as count FROM recordings
       WHERE bundle_id IN (${placeholders}) AND user_id = ? AND clone_training_ready = 1`
        ).get(...bundle_ids, (req as AuthRequest).user.userId) as any;

        if (result.count < bundle_ids.length) {
            return res.status(400).json({ error: 'Some bundles are not valid or training-ready' });
        }

        const jobId = crypto.randomUUID();
        res.set('X-Stub', 'true');
        res.json({
            jobId,
            status: 'queued',
            bundle_count: bundle_ids.length,
            estimated_time: `${Math.ceil(bundle_ids.length * 15)} minutes`,
            message: 'Clone training job queued successfully',
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
