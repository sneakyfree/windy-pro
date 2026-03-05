/**
 * Billing routes — Stripe webhook + transaction endpoints.
 * Merged from cloud-storage service.
 *
 * POST /api/v1/stripe/webhook     — Stripe webhook handler (raw body)
 * GET  /api/v1/billing/transactions — user's transaction history
 * GET  /api/v1/billing/summary      — billing summary
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { BillingTransactionsQuerySchema } from '@windy-pro/contracts';

// ─── Tier → storage limit mapping ────────────────────────────

const TIER_LIMITS: Record<string, number> = {
    free: 500 * 1024 * 1024,              // 500 MB
    pro: 5 * 1024 * 1024 * 1024,           // 5 GB
    translate: 10 * 1024 * 1024 * 1024,    // 10 GB
    'translate-pro': 50 * 1024 * 1024 * 1024, // 50 GB
};

const TIER_BY_AMOUNT: Record<number, string> = {
    4900: 'pro',
    799: 'translate',
    7900: 'translate',
    14900: 'translate-pro',
};

// ─── Stripe Webhook Router (mounted at /api/v1/stripe) ───────

export const stripeRouter = Router();

/**
 * Stripe webhook — requires raw body for signature verification.
 * NOTE: express.raw() middleware must be applied at this route,
 *       NOT the global express.json() middleware. The server.ts
 *       mounts this before express.json() kicks in.
 */
stripeRouter.post('/webhook', (req: Request, res: Response) => {
    let event: any;

    try {
        const rawBody = typeof req.body === 'string' ? req.body : req.body?.toString?.() || JSON.stringify(req.body);

        if (config.STRIPE_WEBHOOK_SECRET) {
            const sig = req.headers['stripe-signature'] as string | undefined;
            const ts = sig?.split(',').find((s: string) => s.startsWith('t='))?.split('=')[1];
            const v1 = sig?.split(',').find((s: string) => s.startsWith('v1='))?.split('=')[1];

            if (ts && v1) {
                const expected = crypto.createHmac('sha256', config.STRIPE_WEBHOOK_SECRET)
                    .update(`${ts}.${rawBody}`).digest('hex');
                if (expected !== v1) {
                    res.status(400).json({ error: 'Invalid signature' });
                    return;
                }
            }
            event = JSON.parse(rawBody);
        } else {
            event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        }
    } catch (e: any) {
        res.status(400).json({ error: 'Webhook parse error: ' + e.message });
        return;
    }

    const db = getDb();
    const type = event.type;
    const data = event.data?.object || {};

    try {
        if (type === 'payment_intent.succeeded' || type === 'invoice.paid') {
            const email = data.receipt_email || data.customer_email || data.billing_details?.email;
            const user = email
                ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
                : null;

            const txId = uuidv4();
            db.prepare(
                'INSERT INTO transactions (id, user_id, email, amount, currency, type, status, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(
                txId,
                user?.id || null,
                email || '',
                data.amount || data.amount_paid || 0,
                data.currency || 'usd',
                type === 'invoice.paid' ? 'subscription' : 'one_time',
                'paid',
                data.id || '',
            );

            if (user && data.amount) {
                const newTier = TIER_BY_AMOUNT[data.amount];
                if (newTier) {
                    db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                        .run(newTier, TIER_LIMITS[newTier] || TIER_LIMITS.free, user.id);
                }
            }
        } else if (type === 'customer.subscription.deleted') {
            const email = data.customer_email || '';
            if (email) {
                db.prepare("UPDATE users SET tier = 'free', storage_limit = ? WHERE email = ?")
                    .run(TIER_LIMITS.free, email);
            }
        } else if (type === 'charge.refunded') {
            const pid = data.payment_intent;
            const tx = db.prepare('SELECT * FROM transactions WHERE stripe_payment_id = ?').get(pid) as any;
            if (tx) {
                db.prepare("UPDATE transactions SET status = 'refunded' WHERE id = ?").run(tx.id);
                if (tx.user_id) {
                    db.prepare("UPDATE users SET tier = 'free', storage_limit = ? WHERE id = ?")
                        .run(TIER_LIMITS.free, tx.user_id);
                }
            }
        } else if (type === 'invoice.payment_failed') {
            const email = data.customer_email || '';
            const user = email
                ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
                : null;
            const txId = uuidv4();
            db.prepare(
                'INSERT INTO transactions (id, user_id, email, amount, currency, type, status, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(txId, user?.id || null, email, data.amount_due || 0, data.currency || 'usd', 'subscription', 'failed', data.id || '');
        }
    } catch (e: any) {
        console.error('[Billing] Webhook processing error:', e);
    }

    res.json({ received: true });
});

// ─── Billing Router (mounted at /api/v1/billing) ─────────────

export const billingRouter = Router();

/**
 * GET /transactions — user's transaction history
 */
billingRouter.get('/transactions', authenticateToken, (req: Request, res: Response) => {
    try {
        const user = (req as AuthRequest).user;
        const query = BillingTransactionsQuerySchema.parse(req.query);
        const db = getDb();

        let txs: any[];
        let total: number;

        if (query.status) {
            txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
                .all(user.userId, query.status, query.limit, query.offset) as any[];
            total = (db.prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND status = ?')
                .get(user.userId, query.status) as any).count;
        } else {
            txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
                .all(user.userId, query.limit, query.offset) as any[];
            total = (db.prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?')
                .get(user.userId) as any).count;
        }

        res.json({ ok: true, transactions: txs, total, limit: query.limit, offset: query.offset });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /summary — billing overview for the authenticated user
 */
billingRouter.get('/summary', authenticateToken, (req: Request, res: Response) => {
    try {
        const user = (req as AuthRequest).user;
        const db = getDb();

        const paid = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND status = 'paid'")
            .get(user.userId) as { total: number | null };
        const sub = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND type = 'subscription' AND status = 'paid'")
            .get(user.userId) as { count: number };

        const userRow = db.prepare('SELECT tier, storage_used, storage_limit FROM users WHERE id = ?')
            .get(user.userId) as { tier: string; storage_used: number; storage_limit: number } | undefined;

        res.json({
            ok: true,
            totalSpent: paid.total || 0,
            activeSubscriptions: sub.count,
            tier: userRow?.tier || 'free',
            storageUsed: userRow?.storage_used || 0,
            storageLimit: userRow?.storage_limit || TIER_LIMITS.free,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
