/**
 * Clone routes — training data listing + export-ready response.
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { StartTrainingRequestSchema } from '@windy-pro/contracts';

const router = Router();

// ─── GET /api/v1/clone/training-data ─────────────────────────

router.get('/training-data', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const rows = db.prepare(
            `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
              camera_source, transcript_text, file_size, device_platform,
              clone_training_ready, created_at
       FROM recordings WHERE user_id = ? AND clone_training_ready = 1
       ORDER BY created_at DESC`
        ).all((req as AuthRequest).user.userId) as any[];
        const bundles = rows.map(r => ({
            id: r.id,
            bundleId: r.bundle_id,
            durationSeconds: r.duration_seconds,
            hasVideo: r.has_video,
            videoResolution: r.video_resolution,
            cameraSource: r.camera_source,
            transcript: r.transcript_text,
            fileSize: r.file_size,
            devicePlatform: r.device_platform,
            cloneTrainingReady: r.clone_training_ready,
            createdAt: r.created_at,
        }));
        res.json({ bundles, total: bundles.length });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
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

        res.status(202).json({
            status: 'export_ready',
            bundleCount: bundle_ids.length,
            message: 'Clone training service coming soon. Use the desktop app to export your voice data package for use with ElevenLabs, PlayHT, or other voice cloning services.',
            exportInstructions: 'In the Windy Word desktop app, go to Clone Data Archive → select your bundles → click Export Clone Package.',
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
