/**
 * Admin routes — users, stats, revenue.
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
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
            dailyTranslations: (() => {
                try {
                    const rows = db.prepare(
                        `SELECT DATE(created_at) as day, COUNT(*) as count
                         FROM translations
                         WHERE created_at >= datetime('now', '-7 days')
                         GROUP BY DATE(created_at)
                         ORDER BY day`
                    ).all() as { day: string; count: number }[];
                    // Build a 7-day array (fill missing days with 0)
                    const dayMap = new Map(rows.map(r => [r.day, r.count]));
                    const result: number[] = [];
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
                        result.push(dayMap.get(d) || 0);
                    }
                    return result;
                } catch { return [0, 0, 0, 0, 0, 0, 0]; }
            })()
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

// ─── GET /users/:userId — detailed user info ─────────────────

router.get('/users/:userId', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const user = db.prepare(
            'SELECT id, name, email, tier, role, storage_used, storage_limit, frozen, created_at, updated_at FROM users WHERE id = ?'
        ).get(req.params.userId) as any;

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const files = db.prepare('SELECT id, original_name, type, size, uploaded_at FROM files WHERE user_id = ?')
            .all(user.id) as any[];
        const recordingCount = (db.prepare('SELECT COUNT(*) as count FROM recordings WHERE user_id = ?')
            .get(user.id) as any).count;
        const devices = db.prepare('SELECT id, name, platform, last_seen FROM devices WHERE user_id = ?')
            .all(user.id) as any[];

        res.json({ ok: true, user, files, recordingCount, devices });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /users/:userId/freeze — freeze/unfreeze account ────

router.post('/users/:userId/freeze', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId) as any;
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        const frozen = req.body.frozen !== false ? 1 : 0;
        db.prepare('UPDATE users SET frozen = ? WHERE id = ?').run(frozen, user.id);

        res.json({ ok: true, frozen: !!frozen });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /users/:userId/tier — change tier ──────────────────

router.post('/users/:userId/tier', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT id, tier FROM users WHERE id = ?').get(req.params.userId) as any;
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        const tierLimits: Record<string, number> = {
            free: 500 * 1024 * 1024,
            pro: 5 * 1024 * 1024 * 1024,
            translate: 10 * 1024 * 1024 * 1024,
            'translate-pro': 50 * 1024 * 1024 * 1024,
        };

        if (req.body.tier) {
            const newLimit = tierLimits[req.body.tier] || tierLimits.free;
            db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                .run(req.body.tier, newLimit, user.id);
        }
        if (req.body.storageLimit !== undefined) {
            db.prepare('UPDATE users SET storage_limit = ? WHERE id = ?')
                .run(req.body.storageLimit, user.id);
        }

        const updated = db.prepare('SELECT tier, storage_limit FROM users WHERE id = ?').get(user.id) as any;
        res.json({ ok: true, tier: updated.tier, storageLimit: updated.storage_limit });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DELETE /users/:userId — delete user + all data ──────────

router.delete('/users/:userId', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.userId) as any;
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        // Delete user files from disk
        const files = db.prepare('SELECT stored_name, user_id FROM files WHERE user_id = ?').all(user.id) as any[];
        const userUploadDir = require('path').join(config.UPLOADS_PATH, user.id);
        for (const f of files) {
            try { require('fs').unlinkSync(require('path').join(config.UPLOADS_PATH, f.user_id, f.stored_name)); } catch { /* ignore */ }
        }
        try { require('fs').rmSync(userUploadDir, { recursive: true }); } catch { /* ignore */ }

        // Cascade delete — files, recordings, devices, tokens, translations, favorites
        db.prepare('DELETE FROM files WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM recordings WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM devices WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM translations WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM favorites WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

        res.json({ ok: true, filesDeleted: files.length });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /overview — storage and system overview ─────────────

router.get('/overview', authenticateToken, adminOnly, (_req: Request, res: Response) => {
    try {
        const db = getDb();
        const totalUsers = (db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin' OR role IS NULL").get() as any).count;
        const totalFiles = (db.prepare('SELECT COUNT(*) as count FROM files').get() as any).count;
        const totalRecordings = (db.prepare('SELECT COUNT(*) as count FROM recordings').get() as any).count;
        const totalStorage = (db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM files').get() as any).total;

        const tierCounts: Record<string, number> = {};
        for (const tier of ['free', 'pro', 'translate', 'translate-pro']) {
            tierCounts[tier] = (db.prepare('SELECT COUNT(*) as count FROM users WHERE tier = ?').get(tier) as any)?.count || 0;
        }

        const storageByType: Record<string, number> = {};
        const typeRows = db.prepare('SELECT type, COALESCE(SUM(size), 0) as total FROM files GROUP BY type').all() as any[];
        for (const row of typeRows) { storageByType[row.type] = row.total; }

        res.json({
            ok: true,
            summary: {
                totalUsers,
                totalFiles,
                totalRecordings,
                totalStorage,
                usersByTier: tierCounts,
                storageByType,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /billing/transactions — admin view of all txns ──────

router.get('/billing/transactions', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = parseInt(req.query.offset as string) || 0;

        let txs: any[];
        let total: number;
        const userId = req.query.userId as string | undefined;
        const status = req.query.status as string | undefined;

        let where = '';
        const params: any[] = [];
        if (userId) { where += ' AND user_id = ?'; params.push(userId); }
        if (status) { where += ' AND status = ?'; params.push(status); }

        txs = db.prepare(`SELECT * FROM transactions WHERE 1=1 ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset) as any[];
        total = (db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE 1=1 ${where}`)
            .get(...params) as any).count;

        res.json({ ok: true, transactions: txs, total, limit, offset });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /billing/refund — admin refund ─────────────────────

router.post('/billing/refund', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const { transactionId } = req.body;
        if (!transactionId) { res.status(400).json({ error: 'transactionId required' }); return; }

        const db = getDb();
        const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId) as any;
        if (!tx) { res.status(404).json({ error: 'Transaction not found' }); return; }

        db.prepare("UPDATE transactions SET status = 'refunded' WHERE id = ?").run(tx.id);

        // Downgrade user
        if (tx.user_id) {
            db.prepare("UPDATE users SET tier = 'free', storage_limit = 524288000 WHERE id = ?").run(tx.user_id);
        }

        // Call Stripe refund API if configured
        if (config.STRIPE_SECRET_KEY && tx.stripe_payment_id) {
            const postData = `payment_intent=${tx.stripe_payment_id}`;
            const stripeReq = https.request({
                hostname: 'api.stripe.com', path: '/v1/refunds', method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.STRIPE_SECRET_KEY}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            });
            stripeReq.on('error', (e: Error) => console.error('[Billing] Stripe refund error:', e.message));
            stripeReq.write(postData);
            stripeReq.end();
        }

        res.json({ ok: true, transaction: tx });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/v1/admin/analytics ────────────────────────────

router.get('/analytics', authenticateToken, adminOnly, (req: Request, res: Response) => {
    try {
        const db = getDb();
        const period = (req.query.period as string) || 'week';

        // Determine the date cutoff for the period
        let periodDays: number;
        switch (period) {
            case 'day': periodDays = 1; break;
            case 'month': periodDays = 30; break;
            case 'week':
            default: periodDays = 7; break;
        }

        const cutoff = `datetime('now', '-${periodDays} days')`;

        // Count events by type for the period
        const eventRows = db.prepare(
            `SELECT event, COUNT(*) as count FROM analytics_events
             WHERE created_at >= ${cutoff}
             GROUP BY event`
        ).all() as { event: string; count: number }[];
        const events: Record<string, number> = {};
        for (const row of eventRows) {
            events[row.event] = row.count;
        }

        // Total users
        const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;

        // DAU — distinct user_ids in last 24h
        const dau = (db.prepare(
            `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events
             WHERE user_id IS NOT NULL AND created_at >= datetime('now', '-1 days')`
        ).get() as any).count;

        // WAU — distinct user_ids in last 7 days
        const wau = (db.prepare(
            `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events
             WHERE user_id IS NOT NULL AND created_at >= datetime('now', '-7 days')`
        ).get() as any).count;

        // MAU — distinct user_ids in last 30 days
        const mau = (db.prepare(
            `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events
             WHERE user_id IS NOT NULL AND created_at >= datetime('now', '-30 days')`
        ).get() as any).count;

        // Active subscriptions from users table WHERE tier != 'free'
        const subRows = db.prepare(
            `SELECT tier, COUNT(*) as count FROM users
             WHERE tier IS NOT NULL AND tier != 'free' AND tier != ''
             GROUP BY tier`
        ).all() as { tier: string; count: number }[];
        const activeSubscriptions: Record<string, number> = {};
        for (const row of subRows) {
            activeSubscriptions[row.tier] = row.count;
        }

        res.json({
            period,
            events,
            users: {
                total: totalUsers,
                dau,
                wau,
                mau,
            },
            revenue: {
                active_subscriptions: activeSubscriptions,
                mrr_cents: 0, // placeholder — real Stripe data via billing route
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
