/**
 * Billing routes — Stripe checkout, portal, webhook + transaction endpoints.
 *
 * POST /api/v1/stripe/webhook              — Stripe webhook handler (raw body)
 * POST /api/v1/stripe/create-checkout-session — Create Stripe Checkout for upgrade
 * POST /api/v1/stripe/create-portal-session   — Create Stripe Billing Portal session
 * GET  /api/v1/billing/transactions         — user's transaction history
 * GET  /api/v1/billing/summary              — billing summary
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import { config } from '../config';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { BillingTransactionsQuerySchema } from '@windy-pro/contracts';

// ─── Stripe client (lazy — only initialized if STRIPE_SECRET_KEY is set) ────

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
    if (!_stripe) {
        if (!config.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY not configured');
        }
        _stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
    }
    return _stripe;
}

// ─── Price ID resolution from env vars ──────────────────────

interface PriceConfig {
    lifetime?: string;
    monthly?: string;
    yearly?: string;
}

function getPriceIds(tier: string): PriceConfig {
    const env = process.env;
    switch (tier) {
        case 'pro':
            return {
                lifetime: env.STRIPE_PRO_PRICE_ID,
                monthly: env.STRIPE_PRO_MONTHLY_PRICE_ID,
                yearly: env.STRIPE_PRO_YEARLY_PRICE_ID,
            };
        case 'translate':
            return {
                lifetime: env.STRIPE_TRANSLATE_PRICE_ID,
                monthly: env.STRIPE_TRANSLATE_MONTHLY_PRICE_ID,
                yearly: env.STRIPE_TRANSLATE_YEARLY_PRICE_ID,
            };
        case 'translate_pro':
            return {
                lifetime: env.STRIPE_TRANSLATE_PRO_PRICE_ID,
                monthly: env.STRIPE_TRANSLATE_PRO_MONTHLY_PRICE_ID,
                yearly: env.STRIPE_TRANSLATE_PRO_YEARLY_PRICE_ID,
            };
        default:
            return {};
    }
}

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

        if (!config.STRIPE_WEBHOOK_SECRET) {
            console.warn('[Billing] STRIPE_WEBHOOK_SECRET not set — rejecting webhook');
            res.status(500).json({ error: 'Webhook secret not configured' });
            return;
        }

        const sig = req.headers['stripe-signature'] as string | undefined;
        if (!sig) {
            res.status(400).json({ error: 'Missing stripe-signature header' });
            return;
        }

        const ts = sig.split(',').find((s: string) => s.startsWith('t='))?.split('=')[1];
        const v1 = sig.split(',').find((s: string) => s.startsWith('v1='))?.split('=')[1];

        if (!ts || !v1) {
            res.status(400).json({ error: 'Malformed stripe-signature header' });
            return;
        }

        const expected = crypto.createHmac('sha256', config.STRIPE_WEBHOOK_SECRET)
            .update(`${ts}.${rawBody}`).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) {
            res.status(400).json({ error: 'Invalid signature' });
            return;
        }

        event = JSON.parse(rawBody);
    } catch (e: any) {
        res.status(400).json({ error: 'Webhook parse error' });
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

            if (user) {
                // Save stripe_customer_id if we have it and the user doesn't yet
                const stripeCustomerId = data.customer;
                if (stripeCustomerId && !user.stripe_customer_id) {
                    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
                        .run(stripeCustomerId, user.id);
                }

                if (data.amount) {
                    const newTier = TIER_BY_AMOUNT[data.amount];
                    if (newTier) {
                        db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                            .run(newTier, TIER_LIMITS[newTier] || TIER_LIMITS.free, user.id);
                    }
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

// ─── POST /api/v1/stripe/create-checkout-session ─────────────

stripeRouter.post('/create-checkout-session', authenticateToken, async (req: Request, res: Response) => {
    try {
        const stripe = getStripe();
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();
        const { tier, billing_type } = req.body;

        // Validate inputs
        const validTiers = ['pro', 'translate', 'translate_pro'];
        const validBillingTypes = ['lifetime', 'monthly', 'yearly'];
        if (!validTiers.includes(tier)) {
            return res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
        }
        if (!validBillingTypes.includes(billing_type)) {
            return res.status(400).json({ error: `Invalid billing_type. Must be one of: ${validBillingTypes.join(', ')}` });
        }

        // Resolve price ID
        const prices = getPriceIds(tier);
        const priceId = prices[billing_type as keyof PriceConfig];
        if (!priceId) {
            return res.status(400).json({
                error: `Price not configured for ${tier} / ${billing_type}. Set STRIPE_${tier.toUpperCase()}_${billing_type === 'lifetime' ? '' : billing_type.toUpperCase() + '_'}PRICE_ID in environment.`,
            });
        }

        // Get or create Stripe customer
        const user = db.prepare('SELECT id, email, name, stripe_customer_id FROM users WHERE id = ?').get(userId) as any;
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let customerId = user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.name,
                metadata: { windy_user_id: user.id },
            });
            customerId = customer.id;
            db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
        }

        // Build checkout session
        const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://windypro.thewindstorm.uk/dashboard';
        const isSubscription = billing_type === 'monthly' || billing_type === 'yearly';

        const sessionParams: Stripe.Checkout.SessionCreateParams = {
            customer: customerId,
            line_items: [{ price: priceId, quantity: 1 }],
            mode: isSubscription ? 'subscription' : 'payment',
            success_url: `${returnUrl}?checkout=success&tier=${tier}`,
            cancel_url: `${returnUrl}?checkout=cancelled`,
            metadata: {
                windy_user_id: user.id,
                tier,
                billing_type,
            },
        };

        const session = await stripe.checkout.sessions.create(sessionParams);

        console.log(`💳 Checkout session created: ${tier}/${billing_type} for ${user.email}`);

        res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
        if (err.message === 'STRIPE_SECRET_KEY not configured') {
            return res.status(503).json({ error: 'Stripe is not configured on this server' });
        }
        console.error('[Billing] Checkout session error:', err);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// ─── POST /api/v1/stripe/create-portal-session ──────────────

stripeRouter.post('/create-portal-session', authenticateToken, async (req: Request, res: Response) => {
    try {
        const stripe = getStripe();
        const userId = (req as AuthRequest).user.userId;
        const db = getDb();

        const user = db.prepare('SELECT stripe_customer_id, email FROM users WHERE id = ?').get(userId) as any;
        if (!user || !user.stripe_customer_id) {
            return res.status(400).json({ error: 'No billing history found. Make a purchase first to access billing management.' });
        }

        const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://windypro.thewindstorm.uk/dashboard';

        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: returnUrl,
        });

        res.json({ url: session.url });
    } catch (err: any) {
        if (err.message === 'STRIPE_SECRET_KEY not configured') {
            return res.status(503).json({ error: 'Stripe is not configured on this server' });
        }
        console.error('[Billing] Portal session error:', err);
        res.status(500).json({ error: 'Failed to create portal session' });
    }
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
        res.status(500).json({ error: 'Internal server error' });
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
        res.status(500).json({ error: 'Internal server error' });
    }
});
