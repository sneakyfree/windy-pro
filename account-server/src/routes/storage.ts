/**
 * File storage routes — merged from cloud-storage service.
 *
 * Backend: Cloudflare R2 when R2_ACCOUNT_ID + R2_ACCESS_KEY_ID are set,
 *          otherwise local disk (original behavior).
 *
 * POST /api/v1/files/upload  — multipart file upload
 * GET  /api/v1/files         — list user's files
 * GET  /api/v1/files/:fileId — download file
 * DELETE /api/v1/files/:fileId — delete file
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
    FileUploadBodySchema,
    FileListQuerySchema,
} from '@windy-pro/contracts';
import { validateFileMagicBytes } from '../middleware/file-validation';
import { R2StorageAdapter, isR2Configured } from '../services/r2-adapter';

// ─── R2 backend (lazy-initialized) ──────────────────────────

let r2: R2StorageAdapter | null = null;
const useR2 = isR2Configured();

if (useR2) {
    r2 = new R2StorageAdapter();
    console.log('[Storage] Using Cloudflare R2 backend');
} else {
    console.log('[Storage] Using local disk backend (set R2_ACCOUNT_ID + R2_ACCESS_KEY_ID for R2)');
}

// ─── Multer config ───────────────────────────────────────────
// Always write to local disk first (temp staging for R2 uploads, or permanent for local mode)

const storage = multer.diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
        const userId = (_req as AuthRequest).user?.userId || 'anonymous';
        const userDir = path.join(config.UPLOADS_PATH, userId);
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
        const date = new Date().toISOString().slice(0, 10);
        const ext = path.extname(file.originalname);
        cb(null, `${date}_${uuidv4().slice(0, 8)}${ext}`);
    },
});

const upload = multer({ storage, limits: { fileSize: config.MAX_FILE_SIZE } });

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────

/** Map file body type to R2 bucket path segment */
function fileTypeToR2Type(type: string): string {
    const map: Record<string, string> = {
        recording: 'recordings',
        transcript: 'transcriptions',
        translation: 'translations',
        clone: 'clone-data',
    };
    return map[type] || type;
}

// ─── POST /upload — upload file ──────────────────────────────

router.post('/upload', authenticateToken, upload.single('file'), validateFileMagicBytes(), async (req: Request, res: Response) => {
    try {
        const user = (req as AuthRequest).user;
        if (!req.file) {
            res.status(400).json({ error: 'No file provided' });
            return;
        }

        const bodyParsed = FileUploadBodySchema.safeParse(req.body);
        const body = bodyParsed.success ? bodyParsed.data : { type: 'transcript' as const, sessionDate: undefined, metadata: undefined };

        const db = getDb();
        const fileSize = req.file.size;

        // Check storage quota
        const userRow = db.prepare('SELECT storage_used, storage_limit FROM users WHERE id = ?').get(user.userId) as
            { storage_used: number; storage_limit: number } | undefined;

        if (userRow && userRow.storage_limit > 0 && userRow.storage_used + fileSize > userRow.storage_limit) {
            try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
            res.status(413).json({
                error: 'Storage limit exceeded',
                used: userRow.storage_used,
                limit: userRow.storage_limit,
                fileSize,
            });
            return;
        }

        const fileId = uuidv4();
        let storedName = req.file.filename;
        let r2Key: string | null = null;

        // Upload to R2 if configured
        if (r2) {
            const r2Type = fileTypeToR2Type(body.type || 'transcript');
            const result = await r2.uploadFromMulter(user.userId, req.file, r2Type);
            r2Key = result.key;
            storedName = result.key; // store R2 key as the stored_name for R2 mode
        }

        db.prepare(`INSERT INTO files (id, user_id, original_name, stored_name, mime_type, size, type, session_date, metadata)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
                fileId,
                user.userId,
                req.file.originalname,
                storedName,
                req.file.mimetype,
                fileSize,
                body.type || 'transcript',
                body.sessionDate || new Date().toISOString().slice(0, 10),
                body.metadata || '{}',
            );

        // Update user storage
        db.prepare('UPDATE users SET storage_used = COALESCE(storage_used, 0) + ? WHERE id = ?')
            .run(fileSize, user.userId);

        res.json({
            ok: true,
            fileId,
            size: fileSize,
            storageUsed: (userRow?.storage_used || 0) + fileSize,
            storageLimit: userRow?.storage_limit || 524288000,
        });
    } catch (err: any) {
        console.error('[Storage] Upload error:', err);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// ─── GET / — list user's files ───────────────────────────────

router.get('/', authenticateToken, (req: Request, res: Response) => {
    try {
        const user = (req as AuthRequest).user;
        const query = FileListQuerySchema.parse(req.query);
        const db = getDb();

        const offset = (query.page - 1) * query.limit;

        const files = db.prepare(
            'SELECT id, original_name, type, size, session_date, metadata, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?'
        ).all(user.userId, query.limit, offset) as any[];

        const total = (db.prepare('SELECT COUNT(*) as count FROM files WHERE user_id = ?').get(user.userId) as any).count;

        const userRow = db.prepare('SELECT storage_used, storage_limit FROM users WHERE id = ?').get(user.userId) as
            { storage_used: number; storage_limit: number } | undefined;

        res.json({
            ok: true,
            files: files.map(f => ({
                id: f.id,
                name: f.original_name,
                type: f.type,
                size: f.size,
                sessionDate: f.session_date,
                uploadedAt: f.uploaded_at,
                metadata: f.metadata ? JSON.parse(f.metadata) : {},
            })),
            total,
            storageUsed: userRow?.storage_used || 0,
            storageLimit: userRow?.storage_limit || 524288000,
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /:fileId — download file ────────────────────────────

router.get('/:fileId', authenticateToken, async (req: Request, res: Response) => {
    try {
        const user = (req as AuthRequest).user;
        const db = getDb();

        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId) as any;
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        // Check ownership (admins can access any file)
        const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(user.userId) as { role: string } | undefined;
        if (file.user_id !== user.userId && userRow?.role !== 'admin') {
            res.status(403).json({ error: 'Access denied' });
            return;
        }

        // R2 mode: stream from R2
        if (r2 && file.stored_name.startsWith('users/')) {
            const result = await r2.download(file.stored_name);
            res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
            if (result.contentType) res.setHeader('Content-Type', result.contentType);
            if (result.size) res.setHeader('Content-Length', result.size);
            result.stream.pipe(res);
            return;
        }

        // Local disk mode
        const filePath = path.join(config.UPLOADS_PATH, file.user_id, file.stored_name);
        if (!fs.existsSync(filePath)) {
            res.status(404).json({ error: 'File not found on disk' });
            return;
        }

        res.download(filePath, file.original_name);
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /:fileId — delete file ───────────────────────────

router.delete('/:fileId', authenticateToken, async (req: Request, res: Response) => {
    try {
        const user = (req as AuthRequest).user;
        const db = getDb();

        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.fileId) as any;
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        // Check ownership
        const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(user.userId) as { role: string } | undefined;
        if (file.user_id !== user.userId && userRow?.role !== 'admin') {
            res.status(403).json({ error: 'Access denied' });
            return;
        }

        // R2 mode: delete from R2
        if (r2 && file.stored_name.startsWith('users/')) {
            try { await r2.delete(file.stored_name); } catch { /* file may already be gone */ }
        } else {
            // Local disk mode
            const filePath = path.join(config.UPLOADS_PATH, file.user_id, file.stored_name);
            try { fs.unlinkSync(filePath); } catch { /* file may already be gone */ }
        }

        // Update user storage
        db.prepare('UPDATE users SET storage_used = MAX(0, COALESCE(storage_used, 0) - ?) WHERE id = ?')
            .run(file.size, file.user_id);

        // Remove from DB
        db.prepare('DELETE FROM files WHERE id = ?').run(file.id);

        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
