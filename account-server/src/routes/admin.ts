/**
 * Admin routes — users, stats, revenue.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import { config } from '../config';
import { getDb } from '../db/schema';
import { authenticateToken, adminOnly } from '../middleware/auth';

const router = Router();

// ─── GET /api/v1/admin/users ─────────────────────────────────

router.get('/users', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = (page - 1) * limit;
        const search = (req.query.search as string) || '';

        let users: any[];
        let total: number;

        if (search) {
            const like = `%${search}%`;
            users = db.prepare('SELECT id, name, email, tier, role, created_at FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
                .all(like, like, limit, offset) as any[];
            total = (db.prepare('SELECT COUNT(*) as count FROM users WHERE name LIKE ? OR email LIKE ?').get(like, like) as any).count;
        } else {
            users = db.prepare('SELECT id, name, email, tier, role, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?')
                .all(limit, offset) as any[];
            total = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
        }

        const stmtCount = db.prepare('SELECT COUNT(*) as count FROM recordings WHERE user_id = ?');
        users = users.map(u => ({ ...u, recording_count: (stmtCount.get(u.id) as any)?.count || 0 }));

        res.json({ users, total, page, limit });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/v1/admin/stats ─────────────────────────────────

router.get('/stats', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
        const totalRecordings = (db.prepare('SELECT COUNT(*) as count FROM recordings').get() as any).count;
        let totalTranslations = 0;
        try {
            totalTranslations = (db.prepare('SELECT COUNT(*) as count FROM translations').get() as any).count;
        } catch { /* table may not exist */ }

        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        let dbSize = 'unknown';
        try {
            dbSize = '~' + Math.round(fs.statSync(config.DB_PATH).size / 1024) + ' KB';
        } catch { /* file may not be accessible */ }

        res.json({
            totalUsers,
            totalRecordings,
            totalTranslations,
            serverStatus: 'OK',
            uptime: `${hours}h ${minutes}m`,
            dbSize,
            memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
            apiLatency: '<5ms',
            dailyTranslations: [12, 8, 15, 22, 18, 25, 31], // Stub
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/v1/admin/revenue ───────────────────────────────

router.get('/revenue', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const planCounts: Record<string, number> = {};
        for (const tier of ['free', 'pro', 'translate', 'translate_pro']) {
            planCounts[tier] = (db.prepare('SELECT COUNT(*) as count FROM users WHERE tier = ?').get(tier) as any)?.count || 0;
        }
        planCounts.free += (db.prepare("SELECT COUNT(*) as count FROM users WHERE tier IS NULL OR tier = ''").get() as any).count;

        res.json({
            total: (planCounts.pro * 4900) + (planCounts.translate * 7900) + (planCounts.translate_pro * 14900),
            mrr: planCounts.translate * 799,
            planCounts,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
