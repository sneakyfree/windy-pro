/**
 * File storage routes — merged from cloud-storage service.
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

// ─── Multer config ───────────────────────────────────────────

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

// ─── POST /upload — upload file ──────────────────────────────

router.post('/upload', authenticateToken, upload.single('file'), validateFileMagicBytes(), (req: Request, res: Response) => {
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
            // Remove uploaded file
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
        const storedName = req.file.filename;

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

router.get('/:fileId', authenticateToken, (req: Request, res: Response) => {
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

router.delete('/:fileId', authenticateToken, (req: Request, res: Response) => {
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

        // Remove from disk
        const filePath = path.join(config.UPLOADS_PATH, file.user_id, file.stored_name);
        try { fs.unlinkSync(filePath); } catch { /* file may already be gone */ }

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
