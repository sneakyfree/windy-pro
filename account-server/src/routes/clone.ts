/**
 * Clone routes — training data listing, cloud training submission, job status.
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema';
import { config } from '../config';
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

router.post('/start-training', authenticateToken, validate(StartTrainingRequestSchema), async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;
        const { bundle_ids, model_name, voice_description } = req.body;

        // Validate bundles belong to user and are training-ready
        const placeholders = bundle_ids.map(() => '?').join(',');
        const result = db.prepare(
            `SELECT COUNT(*) as count FROM recordings
       WHERE bundle_id IN (${placeholders}) AND user_id = ? AND clone_training_ready = 1`
        ).get(...bundle_ids, userId) as any;

        if (result.count < bundle_ids.length) {
            return res.status(400).json({ error: 'Some bundles are not valid or training-ready' });
        }

        // Generate model name if not provided
        const resolvedModelName = model_name || `voice-clone-${userId.slice(0, 8)}-${Date.now()}`;

        // Attempt to forward to Windy Cloud compute API
        const cloudUrl = config.WINDY_CLOUD_URL;
        const cloudToken = config.WINDY_CLOUD_SERVICE_TOKEN;

        if (cloudUrl && cloudToken) {
            try {
                // Gather audio URLs for the selected bundles
                const audioRows = db.prepare(
                    `SELECT bundle_id, audio_path FROM recordings
           WHERE bundle_id IN (${placeholders}) AND user_id = ?`
                ).all(...bundle_ids, userId) as any[];

                const audioUrls = audioRows
                    .filter((r: any) => r.audio_path)
                    .map((r: any) => `${cloudUrl}/files/${r.audio_path}`);

                const cloudPayload = {
                    user_id: userId,
                    bundle_ids,
                    model_name: resolvedModelName,
                    voice_description: voice_description || '',
                    audio_urls: audioUrls,
                };

                const cloudResponse = await fetch(`${cloudUrl}/api/v1/compute/clone-training`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${cloudToken}`,
                    },
                    body: JSON.stringify(cloudPayload),
                });

                if (cloudResponse.ok) {
                    const cloudData = await cloudResponse.json() as any;
                    const jobId = crypto.randomUUID();

                    // Record the training job in the database
                    db.prepare(
                        `INSERT INTO clone_training_jobs (id, user_id, model_name, status, bundle_ids, cloud_job_id)
             VALUES (?, ?, ?, 'submitted', ?, ?)`
                    ).run(jobId, userId, resolvedModelName, JSON.stringify(bundle_ids), cloudData.job_id || null);

                    return res.status(202).json({
                        status: 'submitted',
                        job_id: jobId,
                        model_name: resolvedModelName,
                        message: 'Training submitted to Windy Cloud',
                    });
                }

                // Cloud returned an error — fall through to graceful degradation
            } catch {
                // Cloud unavailable — fall through to graceful degradation
            }
        }

        // Graceful degradation: return export_ready response
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

// ─── GET /api/v1/clone/training-status/:jobId ───────────────

router.get('/training-status/:jobId', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;
        const { jobId } = req.params;

        const job = db.prepare(
            `SELECT id, user_id, model_name, status, bundle_ids, cloud_job_id, created_at, updated_at
       FROM clone_training_jobs WHERE id = ? AND user_id = ?`
        ).get(jobId, userId) as any;

        if (!job) {
            return res.status(404).json({ error: 'Training job not found' });
        }

        res.json({
            job_id: job.id,
            model_name: job.model_name,
            status: job.status,
            bundle_ids: JSON.parse(job.bundle_ids),
            cloud_job_id: job.cloud_job_id,
            created_at: job.created_at,
            updated_at: job.updated_at,
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
