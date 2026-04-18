/**
 * Recording routes — CRUD, upload, sync, list, check, batch, chunk, video stream.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import archiver from 'archiver';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAuditEvent } from '../identity-service';
import { validate } from '../middleware/validation';
import {
    ChunkUploadRequestSchema,
    RecordingUploadBodySchema,
    RecordingCheckQuerySchema,
    RecordingsListQuerySchema,
} from '@windy-pro/contracts';
import { validateFileMagicBytes } from '../middleware/file-validation';
import { trackEvent } from '../services/analytics';

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
const chunkCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of chunkStore) {
        if (now - entry.createdAt > 10 * 60 * 1000) {
            chunkStore.delete(id);
        }
    }
}, 60 * 1000);
chunkCleanupTimer.unref();

// ─── Helper: map recording row to camelCase ────────────────

function mapRecording(r: any) {
    return {
        id: r.id,
        bundleId: r.bundle_id,
        bundle_id: r.bundle_id,
        duration: r.duration_seconds,
        durationSeconds: r.duration_seconds,
        duration_seconds: r.duration_seconds,
        hasVideo: !!r.has_video,
        has_video: !!r.has_video,
        hasAudio: true,
        has_audio: true,
        videoResolution: r.video_resolution,
        video_resolution: r.video_resolution,
        cameraSource: r.camera_source,
        camera_source: r.camera_source,
        transcript: r.transcript_text,
        transcriptText: r.transcript_text,
        transcript_text: r.transcript_text,
        transcriptSegments: r.transcript_segments,
        segmentsJson: r.transcript_segments,
        fileSize: r.file_size,
        file_size: r.file_size,
        devicePlatform: r.device_platform,
        device_platform: r.device_platform,
        deviceId: r.device_id,
        device_id: r.device_id,
        deviceName: r.device_name,
        device_name: r.device_name,
        cloneTrainingReady: r.clone_training_ready,
        clone_training_ready: r.clone_training_ready,
        syncStatus: r.sync_status,
        sync_status: r.sync_status,
        createdAt: r.created_at,
        created_at: r.created_at,
        recorded_at: r.created_at,
        word_count: r.transcript_text ? r.transcript_text.split(/\s+/).filter(Boolean).length : 0,
    };
}

// ─── Helper: list recordings with pagination ────────────────

interface ListOpts {
    since?: string;
    page?: number;
    limit?: number;
    search?: string;
    from?: string;
    to?: string;
}

function listRecordings(userId: string, opts: ListOpts = {}) {
    const db = getDb();
    const since = opts.since || '1970-01-01T00:00:00Z';
    const limit = Math.min(Math.max(opts.limit || 50, 1), 100);
    const page = Math.max(opts.page || 1, 1);
    const offset = (page - 1) * limit;

    const conditions: string[] = ['user_id = ?', 'created_at > ?'];
    const params: any[] = [userId, since];

    if (opts.search) {
        conditions.push('transcript_text LIKE ?');
        params.push(`%${opts.search}%`);
    }
    if (opts.from) {
        conditions.push('created_at >= ?');
        params.push(opts.from);
    }
    if (opts.to) {
        conditions.push('created_at <= ?');
        params.push(opts.to);
    }

    const where = conditions.join(' AND ');

    const totalRow = db.prepare(
        `SELECT COUNT(*) as count FROM recordings WHERE ${where}`
    ).get(...params) as any;
    const total = totalRow?.count || 0;

    const recordings = db.prepare(
        `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
            camera_source, transcript_text, transcript_segments, file_size,
            device_platform, device_id, device_name, clone_training_ready,
            sync_status, created_at
     FROM recordings
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    const mapped = recordings.map(mapRecording);
    const totalPages = Math.ceil(total / limit);

    return {
        recordings: mapped,
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
    };
}

// ─── GET /api/v1/recordings ──────────────────────────────────
// Alias for /api/v1/recordings/list

router.get('/', authenticateToken, (req: Request, res: Response) => {
    try {
        const result = listRecordings((req as AuthRequest).user.userId, {
            since: req.query.since as string,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
            search: req.query.search as string,
            from: req.query.from as string,
            to: req.query.to as string,
        });
        res.json({
            recordings: result.recordings,
            bundles: result.recordings, // backward compat
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
            hasMore: result.hasMore,
            since: req.query.since || '1970-01-01T00:00:00Z',
            // Web dashboard expects nested pagination object
            pagination: {
                page: result.page,
                limit: result.limit,
                total: result.total,
                totalPages: result.totalPages,
                hasMore: result.hasMore,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /api/v1/recordings/list ─────────────────────────────

router.get('/list', authenticateToken, (req: Request, res: Response) => {
    try {
        const result = listRecordings((req as AuthRequest).user.userId, {
            since: req.query.since as string,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
            search: req.query.search as string,
            from: req.query.from as string,
            to: req.query.to as string,
        });
        res.json({
            recordings: result.recordings,
            bundles: result.recordings,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
            hasMore: result.hasMore,
            since: req.query.since || '1970-01-01T00:00:00Z',
        });
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

        // Compute totalWords from all transcript texts
        const allTranscripts = db.prepare(
            'SELECT transcript_text FROM recordings WHERE user_id = ? AND transcript_text IS NOT NULL'
        ).all(userId) as any[];
        const totalWords = allTranscripts.reduce((sum: number, r: any) =>
            sum + (r.transcript_text ? r.transcript_text.split(/\s+/).filter(Boolean).length : 0), 0);
        const totalHours = Math.round((stats.totalDuration / 3600) * 100) / 100;

        res.json({
            totalRecordings: stats.totalRecordings,
            totalDuration: Math.round(stats.totalDuration),
            totalHours,
            totalWords,
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

// ─── DELETE /api/v1/recordings/bulk ──────────────────────────
// MUST be before /:id to avoid route shadowing

router.delete('/bulk', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;
        const ids = req.body.recordingIds || req.body.ids;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'recordingIds array is required' });
        }

        if (ids.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 recordings per bulk delete' });
        }

        let deleted = 0;
        const errors: string[] = [];

        for (const id of ids) {
            try {
                const recording = db.prepare('SELECT id, file_path FROM recordings WHERE id = ? AND user_id = ?')
                    .get(id, userId) as any;
                if (!recording) { errors.push(`${id}: not found`); continue; }

                if (recording.file_path && fs.existsSync(recording.file_path)) {
                    try { fs.unlinkSync(recording.file_path); } catch { /* best effort */ }
                }
                db.prepare('DELETE FROM recordings WHERE id = ? AND user_id = ?').run(id, userId);
                deleted++;
            } catch (e: any) {
                errors.push(`${id}: ${e.message}`);
            }
        }

        console.log(`🗑️  Bulk delete: ${deleted}/${ids.length} recordings`);
        // P3-2: individual delete emits an audit event; bulk delete should too.
        logAuditEvent('recordings_bulk_deleted' as any, userId, {
            requested: ids.length,
            deleted,
            errorCount: errors.length,
        });
        res.json({ deleted, errors });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /api/v1/recordings/export ─────────────────────────
// MUST be before /:id to avoid route shadowing

router.post('/export', authenticateToken, async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;
        const { format } = req.body;
        const ids = req.body.recordingIds || req.body.ids;

        let recordings: any[];
        if (ids && Array.isArray(ids) && ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            recordings = db.prepare(
                `SELECT id, bundle_id, duration_seconds, transcript_text, transcript_segments,
                        created_at, device_platform, has_video, file_size, file_path
                 FROM recordings WHERE user_id = ? AND id IN (${placeholders})`
            ).all(userId, ...ids) as any[];
        } else {
            recordings = db.prepare(
                `SELECT id, bundle_id, duration_seconds, transcript_text, transcript_segments,
                        created_at, device_platform, has_video, file_size, file_path
                 FROM recordings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000`
            ).all(userId) as any[];
        }

        if (recordings.length === 0) {
            return res.status(404).json({ error: 'No recordings found to export' });
        }

        const exportData = recordings.map(r => ({
            id: r.id,
            bundleId: r.bundle_id,
            duration: r.duration_seconds,
            transcript: r.transcript_text || '',
            segments: r.transcript_segments ? JSON.parse(r.transcript_segments) : [],
            createdAt: r.created_at,
            platform: r.device_platform,
            hasVideo: !!r.has_video,
        }));

        // ── ZIP export with audio files + transcript text files ──
        if (format === 'zip') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="recordings-export.zip"');

            const archive = archiver('zip', { zlib: { level: 5 } });
            archive.on('error', (err: Error) => {
                console.error('Archive error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'ZIP export failed' });
                }
            });
            archive.pipe(res);

            for (const r of recordings) {
                const safeId = r.bundle_id || r.id;

                // Add transcript text file
                if (r.transcript_text) {
                    archive.append(r.transcript_text, { name: `${safeId}/transcript.txt` });
                }

                // Add transcript segments as JSON
                if (r.transcript_segments) {
                    archive.append(r.transcript_segments, { name: `${safeId}/segments.json` });
                }

                // Add audio file if it exists on disk
                if (r.file_path && fs.existsSync(r.file_path)) {
                    const ext = path.extname(r.file_path) || '.webm';
                    archive.file(r.file_path, { name: `${safeId}/audio${ext}` });
                }

                // Add metadata JSON
                archive.append(JSON.stringify({
                    id: r.id,
                    bundleId: r.bundle_id,
                    duration: r.duration_seconds,
                    createdAt: r.created_at,
                    platform: r.device_platform,
                    hasVideo: !!r.has_video,
                    fileSize: r.file_size,
                }, null, 2), { name: `${safeId}/metadata.json` });
            }

            await archive.finalize();
            return;
        }

        if (format === 'csv') {
            const header = 'id,bundleId,duration,createdAt,platform,hasVideo,transcript\n';
            const rows = exportData.map(r =>
                `${r.id},${r.bundleId},${r.duration},${r.createdAt},${r.platform},${r.hasVideo},"${(r.transcript || '').replace(/"/g, '""')}"`
            ).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="recordings-export.csv"');
            return res.send(header + rows);
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="recordings-export.json"');
        res.json({
            exportedAt: new Date().toISOString(),
            count: exportData.length,
            recordings: exportData,
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Export failed' });
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
        const mapped = {
            id: r.id,
            bundleId: r.bundle_id,
            bundle_id: r.bundle_id,
            createdAt: r.created_at,
            created_at: r.created_at,
            recorded_at: r.created_at,
            durationSeconds: r.duration_seconds,
            duration_seconds: r.duration_seconds,
            transcript: r.transcript_text,
            source: r.source,
            devicePlatform: r.device_platform,
            device_platform: r.device_platform,
            appVersion: r.app_version,
            hasVideo: !!r.has_video,
            has_video: !!r.has_video,
            hasAudio: true, // All recordings have audio
            has_audio: true,
        };
        // Wrap in `recording` key for frontend compat + flat fields for backward compat
        res.json({ recording: mapped, ...mapped });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── PATCH /api/v1/recordings/:id ────────────────────────────

router.patch('/:id', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const userId = (req as AuthRequest).user.userId;
        const recording = db.prepare('SELECT id FROM recordings WHERE id = ? AND user_id = ?')
            .get(req.params.id, userId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const updates: string[] = [];
        const values: any[] = [];

        if (req.body.transcript_text !== undefined || req.body.transcript !== undefined) {
            updates.push('transcript_text = ?');
            values.push(req.body.transcript_text ?? req.body.transcript);
        }
        if (req.body.transcript_segments !== undefined || req.body.segments_json !== undefined) {
            updates.push('transcript_segments = ?');
            values.push(req.body.transcript_segments ?? req.body.segments_json);
        }
        if (req.body.clone_training_ready !== undefined) {
            updates.push('clone_training_ready = ?');
            values.push(req.body.clone_training_ready ? 1 : 0);
        }
        if (req.body.tags_json !== undefined) {
            updates.push('tags_json = ?');
            values.push(req.body.tags_json);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updatable fields provided' });
        }

        db.prepare(`UPDATE recordings SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
            .run(...values, req.params.id, userId);

        const updated = db.prepare(
            `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
                camera_source, transcript_text, transcript_segments, file_size,
                device_platform, device_id, device_name, clone_training_ready,
                sync_status, created_at
             FROM recordings WHERE id = ? AND user_id = ?`
        ).get(req.params.id, userId) as any;

        const mapped = mapRecording(updated);
        res.json({ recording: mapped, ...mapped });
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

        trackEvent('recording_created', (req as AuthRequest).user.userId, { duration: parseInt(duration_seconds) || 0 });
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

// ─── GET /api/v1/recordings/:id/audio ────────────────────────

router.get('/:id/audio', authenticateToken, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const recording = db.prepare('SELECT file_path, file_size FROM recordings WHERE id = ? AND user_id = ?')
            .get(req.params.id, (req as AuthRequest).user.userId) as any;

        if (!recording || !recording.file_path || !fs.existsSync(recording.file_path)) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const stat = fs.statSync(recording.file_path);
        const fileSize = stat.size;
        const ext = path.extname(recording.file_path).toLowerCase();
        const contentType = ext === '.wav' ? 'audio/wav'
            : ext === '.ogg' ? 'audio/ogg'
            : ext === '.mp3' ? 'audio/mpeg'
            : 'audio/webm';

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
                'Content-Type': contentType,
            });
            fs.createReadStream(recording.file_path, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            });
            fs.createReadStream(recording.file_path).pipe(res);
        }
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
        const ext = path.extname(recording.file_path).toLowerCase();
        const contentType = ext === '.mp4' ? 'video/mp4'
            : ext === '.ogg' ? 'video/ogg'
            : ext === '.mkv' ? 'video/x-matroska'
            : 'video/webm';
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
                'Content-Type': contentType,
            });
            fs.createReadStream(recording.file_path, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
            });
            fs.createReadStream(recording.file_path).pipe(res);
        }
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
