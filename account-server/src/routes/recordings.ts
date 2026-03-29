/**
 * Recording routes — CRUD, upload, sync, list, check, batch, chunk, video stream.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
    ChunkUploadRequestSchema,
    RecordingUploadBodySchema,
    RecordingCheckQuerySchema,
    RecordingsListQuerySchema,
} from '@windy-pro/contracts';
import { validateFileMagicBytes } from '../middleware/file-validation';

const router = Router();

// Large file upload for video bundles (500MB limit)
const videoUpload = multer({
    storage: multer.diskStorage({
        destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
            const dir = path.join(__dirname, '..', '..', 'uploads', 'bundles');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
            const ext = path.extname(file.originalname) || '.webm';
            cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
        },
    }),
    limits: { fileSize: 500 * 1024 * 1024 },
});

// In-memory chunk store with limits
const MAX_CHUNK_BUNDLES = 50;
const MAX_CHUNK_DATA_BYTES = 10 * 1024 * 1024; // 10 MB per chunk
const chunkStore = new Map<string, { chunks: Map<number, string>; total: number; file_type: string; createdAt: number }>();

// Periodic cleanup of stale chunk uploads (older than 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of chunkStore) {
        if (now - entry.createdAt > 10 * 60 * 1000) {
            chunkStore.delete(id);
        }
    }
}, 60 * 1000);

// ─── Helper: list recordings query ──────────────────────────

function listRecordings(userId: string, since: string) {
    const db = getDb();
    const recordings = db.prepare(
        `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
            camera_source, transcript_text, transcript_segments, file_size,
            device_platform, device_id, device_name, clone_training_ready,
            sync_status, created_at
     FROM recordings
     WHERE user_id = ? AND created_at > ?
     ORDER BY created_at DESC
     LIMIT 100`
    ).all(userId, since) as any[];

    // Cross-platform field mapping — camelCase for JS consumers
    return recordings.map(r => ({
        id: r.id,
        bundleId: r.bundle_id,
        duration: r.duration_seconds,
        durationSeconds: r.duration_seconds,
        hasVideo: r.has_video,
        videoResolution: r.video_resolution,
        cameraSource: r.camera_source,
        transcript: r.transcript_text,
        transcriptText: r.transcript_text,
        transcriptSegments: r.transcript_segments,
        segmentsJson: r.transcript_segments,
        fileSize: r.file_size,
        devicePlatform: r.device_platform,
        deviceId: r.device_id,
        deviceName: r.device_name,
        cloneTrainingReady: r.clone_training_ready,
        syncStatus: r.sync_status,
        createdAt: r.created_at,
    }));
}

// ─── GET /api/v1/recordings ──────────────────────────────────
// Alias for /api/v1/recordings/list

router.get('/', authenticateToken, (req: Request, res: Response) => {
    try {
        const since = (req.query.since as string) || '1970-01-01T00:00:00Z';
        const mapped = listRecordings((req as AuthRequest).user.userId, since);
        res.json({ bundles: mapped, total: mapped.length, since });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/v1/recordings/list ─────────────────────────────

router.get('/list', authenticateToken, (req: Request, res: Response) => {
    try {
        const since = (req.query.since as string) || '1970-01-01T00:00:00Z';
        const mapped = listRecordings((req as AuthRequest).user.userId, since);
        res.json({ bundles: mapped, total: mapped.length, since });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/v1/recordings/check ────────────────────────────

router.get('/check', authenticateToken, (req: Request, res: Response) => {
    try {
        const bundle_id = req.query.bundle_id as string;
        if (!bundle_id) return res.status(400).json({ error: 'bundle_id parameter required' });

        const db = getDb();
        const row = db.prepare('SELECT id FROM recordings WHERE bundle_id = ? AND user_id = ?')
            .get(bundle_id, (req as AuthRequest).user.userId);
        res.json({ exists: !!row, bundleId: bundle_id });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/v1/recordings/stats ────────────────────────────
// MUST be before /:id to avoid route shadowing

router.get('/stats', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;
        const stats = db.prepare(`
            SELECT
                COUNT(*) as totalRecordings,
                COALESCE(SUM(duration_seconds), 0) as totalDuration,
                COALESCE(SUM(file_size), 0) as totalSize,
                COALESCE(AVG(quality_score), 0) as avgQuality,
                COUNT(CASE WHEN has_video = 1 THEN 1 END) as videoRecordings,
                COUNT(CASE WHEN clone_training_ready = 1 THEN 1 END) as cloneReady,
                MIN(created_at) as firstRecording,
                MAX(created_at) as lastRecording
            FROM recordings WHERE user_id = ?
        `).get(userId) as any;

        res.json({
            totalRecordings: stats.totalRecordings,
            totalDuration: Math.round(stats.totalDuration),
            totalSize: stats.totalSize,
            avgQuality: Math.round(stats.avgQuality),
            videoRecordings: stats.videoRecordings,
            cloneReady: stats.cloneReady,
            firstRecording: stats.firstRecording,
            lastRecording: stats.lastRecording,
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/v1/recordings/:id ──────────────────────────────

router.get('/:id', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const recording = db.prepare(
            `SELECT id, bundle_id, created_at, duration_seconds, transcript_text,
              source, device_platform, app_version, has_video
       FROM recordings WHERE id = ? AND user_id = ?`
        ).get(req.params.id, (req as AuthRequest).user.userId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }
        const r = recording as any;
        res.json({
            id: r.id,
            bundleId: r.bundle_id,
            createdAt: r.created_at,
            durationSeconds: r.duration_seconds,
            transcript: r.transcript_text,
            source: r.source,
            devicePlatform: r.device_platform,
            appVersion: r.app_version,
            hasVideo: r.has_video,
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /api/v1/recordings/:id ───────────────────────────

router.delete('/:id', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const recording = db.prepare(
            'SELECT id, file_path FROM recordings WHERE id = ? AND user_id = ?'
        ).get(req.params.id, (req as AuthRequest).user.userId) as any;

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        if (recording.file_path && fs.existsSync(recording.file_path)) {
            try { fs.unlinkSync(recording.file_path); } catch { /* best effort */ }
        }

        db.prepare('DELETE FROM recordings WHERE id = ? AND user_id = ?')
            .run(req.params.id, (req as AuthRequest).user.userId);

        console.log(`🗑️  Recording deleted: ${req.params.id.slice(0, 8)}`);
        res.json({ deleted: true, id: req.params.id });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/v1/recordings/upload ──────────────────────────

router.post('/upload', authenticateToken, videoUpload.single('media'), validateFileMagicBytes(['audio', 'video']), (req: Request, res: Response) => {
    try {
        const db = getDb();
        const { duration_seconds, has_video, video_resolution, camera_source,
            device_platform, app_version, clone_training_ready } = req.body;

        const bundleId = req.body.bundle_id || req.body.id || crypto.randomUUID();
        const transcriptText = req.body.transcript_text || req.body.transcript || null;
        const transcriptSegments = req.body.transcript_segments || req.body.segments_json || null;

        const id = crypto.randomUUID();
        const filePath = req.file ? req.file.path : null;
        const fileSize = req.file ? req.file.size : 0;

        db.prepare(`INSERT INTO recordings
        (id, user_id, bundle_id, duration_seconds, has_video, video_resolution, camera_source,
         transcript_text, transcript_segments, file_path, file_size, device_platform, app_version,
         sync_status, clone_training_ready)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)`).run(
            id, (req as AuthRequest).user.userId, bundleId, parseInt(duration_seconds) || 0,
            has_video === 'true' || has_video === true ? 1 : 0,
            video_resolution || null, camera_source || null,
            transcriptText, transcriptSegments,
            filePath, fileSize, device_platform || 'desktop', app_version || '2.0',
            clone_training_ready === 'true' || clone_training_ready === true ? 1 : 0
        );

        res.status(201).json({ id, bundleId, fileSize });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/v1/recordings/upload/chunk ────────────────────

router.post('/upload/chunk', authenticateToken, (req: Request, res: Response) => {
    try {
        const { bundle_id, chunk_index, total_chunks, data, file_type } = req.body;

        if (!bundle_id || chunk_index === undefined || !total_chunks) {
            return res.status(400).json({ error: 'bundle_id, chunk_index, and total_chunks are required' });
        }

        if (!chunkStore.has(bundle_id)) {
            if (chunkStore.size >= MAX_CHUNK_BUNDLES) {
                return res.status(503).json({ error: 'Too many concurrent chunk uploads' });
            }
            chunkStore.set(bundle_id, { chunks: new Map(), total: total_chunks, file_type: file_type || 'audio/webm', createdAt: Date.now() });
        }

        const entry = chunkStore.get(bundle_id)!;
        const chunkData = data || '';
        if (typeof chunkData === 'string' && chunkData.length > MAX_CHUNK_DATA_BYTES) {
            return res.status(413).json({ error: 'Chunk data too large' });
        }
        entry.chunks.set(chunk_index, chunkData);

        console.log(`📦 Chunk ${chunk_index + 1}/${total_chunks} for bundle ${bundle_id.slice(0, 8)}`);

        if (entry.chunks.size >= entry.total) {
            setTimeout(() => chunkStore.delete(bundle_id), 5 * 60 * 1000);
        }

        res.json({ received: true, chunkIndex: chunk_index, bundleId: bundle_id });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/v1/recordings/upload/batch ────────────────────

router.post('/upload/batch', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const recordings = req.body;
        if (!Array.isArray(recordings)) {
            return res.status(400).json({ error: 'Request body must be a JSON array of recording objects' });
        }

        let uploaded = 0;
        const errors: string[] = [];

        for (const r of recordings) {
            try {
                const id = uuidv4();
                const bundleId = r.bundle_id || r.id || uuidv4();
                const transcriptText = r.transcript_text || r.transcript || '';
                const transcriptSegments = r.transcript_segments || r.segments_json || '[]';

                db.prepare(`INSERT INTO recordings
            (id, user_id, bundle_id, created_at, duration_seconds,
             transcript_text, transcript_segments, source, device_platform,
             app_version, has_video, file_size, sync_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`
                ).run(
                    id, (req as AuthRequest).user.userId, bundleId,
                    r.created_at || new Date().toISOString(),
                    r.duration_seconds || r.duration || 0,
                    transcriptText, transcriptSegments,
                    r.source || 'record',
                    r.device_platform || 'unknown',
                    r.app_version || '2.0.0',
                    r.has_video ? 1 : 0,
                    r.file_size || 0
                );
                uploaded++;
            } catch (itemErr: any) {
                errors.push(`${r.bundle_id || 'unknown'}: ${itemErr.message}`);
            }
        }

        console.log(`📦 Batch upload: ${uploaded} recordings, ${errors.length} errors`);
        res.json({ uploaded, errors });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/v1/recordings/sync ────────────────────────────

router.post('/sync', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const { bundles } = req.body;
        if (!bundles || !Array.isArray(bundles)) return res.status(400).json({ error: 'bundles array required' });

        let synced = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const b of bundles) {
            try {
                const bundleId = b.bundle_id || b.id;
                const transcriptText = b.transcript?.text || b.transcript_text || b.transcript || '';
                const transcriptSegments = b.transcript?.segments
                    ? JSON.stringify(b.transcript.segments)
                    : (b.transcript_segments || b.segments_json || '[]');

                const exists = db.prepare('SELECT id FROM recordings WHERE bundle_id = ? AND user_id = ?')
                    .get(bundleId, (req as AuthRequest).user.userId);
                if (exists) { skipped++; continue; }

                db.prepare(`INSERT INTO recordings (id, user_id, bundle_id, created_at, duration_seconds,
            transcript_text, transcript_segments, source, languages_json, media_audio, media_video,
            file_size, synced, synced_at, clone_usable, clone_training_ready, tags_json,
            device_platform, device_id, device_name, device_model, app_version,
            has_video, video_resolution, camera_source, sync_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`
                ).run(
                    crypto.randomUUID(), (req as AuthRequest).user.userId, bundleId, b.created_at, b.duration_seconds || b.duration || 0,
                    transcriptText, transcriptSegments,
                    b.source || 'record', JSON.stringify(b.languages || b.languages_json || ['en']),
                    b.audio ? 1 : (b.media_audio || 0), b.video ? 1 : (b.media_video || 0),
                    (b.audio?.size_bytes || 0) + (b.video?.size_bytes || 0) + (b.file_size || 0),
                    new Date().toISOString(),
                    b.clone_training_ready || b.clone_usable ? 1 : 0,
                    b.clone_training_ready || b.clone_usable ? 1 : 0,
                    JSON.stringify(b.tags || b.tags_json || []),
                    b.device?.platform || b.device_platform || 'desktop',
                    b.device?.device_id || b.device_id || null,
                    b.device?.device_name || b.device_name || null,
                    b.device?.model || b.device_model || null,
                    b.device?.app_version || b.app_version || '2.0.0',
                    b.video ? 1 : (b.has_video || b.media_video || 0),
                    b.video?.resolution || b.video_resolution || null,
                    b.video?.camera || b.camera_source || null
                );
                synced++;
            } catch (err: any) {
                errors.push(`${b.bundle_id}: ${err.message}`);
            }
        }
        res.json({ synced, skipped, errors });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/v1/recordings/:id/video ────────────────────────

router.get('/:id/video', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const recording = db.prepare('SELECT file_path, file_size FROM recordings WHERE id = ? AND user_id = ?')
            .get(req.params.id, (req as AuthRequest).user.userId) as any;

        if (!recording || !recording.file_path || !fs.existsSync(recording.file_path)) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const stat = fs.statSync(recording.file_path);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/webm',
            });
            fs.createReadStream(recording.file_path, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/webm',
            });
            fs.createReadStream(recording.file_path).pipe(res);
        }
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
