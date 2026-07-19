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
import { trackEvent } from '../services/analytics';
import { emitAdminEvent } from '../services/admin-telemetry';
import { BillingTransactionsQuerySchema } from '@windy-pro/contracts';
import { ZodError } from 'zod';

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

export const TIER_LIMITS: Record<string, number> = {
    free: 500 * 1024 * 1024,              // 500 MB
    pro: 5 * 1024 * 1024 * 1024,           // 5 GB
    translate: 10 * 1024 * 1024 * 1024,    // 10 GB
    'translate-pro': 50 * 1024 * 1024 * 1024, // 50 GB
};

// Full published price matrix (monthly / yearly / lifetime per tier), plus
// legacy amounts still live on old subscriptions (799 was the pre-rebrand
// "Windy Translate" monthly). invoice.paid and subscription.updated use this
// as a fallback classifier when metadata.tier is absent.
const TIER_BY_AMOUNT: Record<number, string> = {
    499: 'pro',
    4900: 'pro',
    9900: 'pro',
    799: 'translate',   // legacy monthly price
    899: 'translate',
    7900: 'translate',
    19900: 'translate',
    1499: 'translate-pro',
    14900: 'translate-pro',
    29900: 'translate-pro',
};

// One plan per customer: when a checkout completes for a new subscription,
// cancel every OTHER active subscription on that Stripe customer (upgrade or
// downgrade — the newest purchase is the intended plan). Without this a
// Pro→Ultra upgrade left BOTH subscriptions billing. Proration credit for the
// unused time on the old plan lands on the customer's balance.
// Lifetime (mode=payment) purchases deliberately do NOT cancel subscriptions —
// lifetime covers local engines only; a cloud subscription remains valid.
async function cancelSupersededSubscriptions(stripe: Stripe, customerId: string, keepSubscriptionId: string): Promise<void> {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 20 });
    for (const sub of subs.data) {
        if (sub.id === keepSubscriptionId) continue;
        try {
            await stripe.subscriptions.cancel(sub.id, { prorate: true });
            console.log(`[Billing] Cancelled superseded subscription ${sub.id} (kept ${keepSubscriptionId}) for customer ${customerId}`);
        } catch (err: any) {
            console.error(`[Billing] Failed to cancel superseded subscription ${sub.id}:`, err?.message || err);
        }
    }
}

// ─── Stripe Webhook Router (mounted at /api/v1/stripe) ───────

export const stripeRouter = Router();

/**
 * Stripe webhook — requires raw body for signature verification.
 * NOTE: express.raw() middleware must be applied at this route,
 *       NOT the global express.json() middleware. The server.ts
 *       mounts this before express.json() kicks in.
 */
stripeRouter.post('/webhook', async (req: Request, res: Response) => {
    let event: any;

    try {
        const rawBody = typeof req.body === 'string' ? req.body : req.body?.toString?.() || JSON.stringify(req.body);

        if (!config.STRIPE_WEBHOOK_SECRET) {
            console.warn('[Billing] STRIPE_WEBHOOK_SECRET not set — rejecting webhook');
            res.status(503).json({ error: 'Stripe webhook not configured', retryable: false });
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

        // Replay window: reject a captured-then-replayed webhook whose
        // timestamp is more than 5 minutes off (mirrors Stripe's own default
        // tolerance). Handlers are idempotent, but this closes the replay door.
        const tsSec = parseInt(ts, 10);
        if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
            res.status(400).json({ error: 'Stale or invalid webhook timestamp' });
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

    // Commerce engine (wallet/catalog/entitlements) events are handled by
    // their own idempotent handlers and MUST NOT fall through to the legacy
    // email/amount-matching below (a $20 bundle would otherwise be
    // misclassified by TIER_BY_AMOUNT). Signature is already verified above.
    try {
        const { handleCommerceWebhookEvent } = await import('../services/commerce/webhook');
        if (await handleCommerceWebhookEvent(event)) {
            res.json({ received: true, commerce: true });
            return;
        }
    } catch (e: any) {
        console.error('[Billing] Commerce webhook processing error:', e);
        // Non-2xx so Stripe redelivers — commerce handlers are idempotent.
        res.status(500).json({ error: 'commerce_webhook_error', retryable: true });
        return;
    }

    try {
        if (type === 'payment_intent.succeeded' || type === 'invoice.paid') {
            const email = data.receipt_email || data.customer_email || data.billing_details?.email;
            let user = email
                ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
                : null;
            // Subscription invoices often omit the email — fall back to the
            // Stripe customer id so this (now sole) subscription record still
            // attaches to the user and shows in Billing History.
            if (!user && data.customer) {
                user = db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(data.customer) as any;
            }

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
        } else if (type === 'checkout.session.completed') {
            // Primary handler for Stripe Checkout completions — uses metadata set during session creation
            const userId = data.metadata?.windy_user_id;
            const tier = data.metadata?.tier;
            if (userId && tier) {
                trackEvent('subscription_started', userId, { tier });
                const priorTier = (db.prepare('SELECT tier, windy_identity_id FROM users WHERE id = ?')
                    .get(userId) as { tier: string | null; windy_identity_id: string } | undefined);
                const newLimit = TIER_LIMITS[tier] || TIER_LIMITS[tier.replace('_', '-')] || TIER_LIMITS.free;
                db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                    .run(tier, newLimit, userId);

                // Intel (CONTRACT §8): commerce — the checkout AND the resulting
                // entitlement change. amount_total is integer cents → microcents.
                const wid = priorTier?.windy_identity_id || userId;
                emitAdminEvent({
                    event_type: 'wallet.purchase', actor_type: 'human', actor_id: wid,
                    metadata: {
                        sku: tier, ok: true,
                        amount_microcents: (data.amount_total || 0) * 10_000,
                    },
                });
                emitAdminEvent({
                    event_type: 'entitlement.change', actor_type: 'human', actor_id: wid,
                    metadata: {
                        tier_from: priorTier?.tier || 'free', tier_to: tier,
                        initiator: 'billing',
                    },
                });

                // Save stripe_customer_id if present
                const stripeCustomerId = data.customer;
                const user = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(userId) as any;
                if (user && stripeCustomerId && !user.stripe_customer_id) {
                    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
                        .run(stripeCustomerId, userId);
                }

                // Record the transaction — but ONLY for one-time (lifetime)
                // purchases. Subscription payments are recorded by the
                // invoice.paid handler (which also fires on every renewal), so
                // recording here too double-listed each subscription payment in
                // Billing History.
                if (data.mode !== 'subscription') {
                    const txId = uuidv4();
                    db.prepare(
                        'INSERT INTO transactions (id, user_id, email, amount, currency, type, status, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    ).run(
                        txId,
                        userId,
                        data.customer_email || '',
                        data.amount_total || 0,
                        data.currency || 'usd',
                        'one_time',
                        'paid',
                        data.payment_intent || data.id || '',
                    );
                }

                // One plan per customer — retire whatever this purchase replaces.
                if (data.mode === 'subscription' && data.subscription && data.customer) {
                    try {
                        await cancelSupersededSubscriptions(getStripe(), data.customer, data.subscription);
                    } catch (err: any) {
                        console.error('[Billing] cancelSupersededSubscriptions failed:', err?.message || err);
                    }
                }
            }
        } else if (type === 'customer.subscription.updated') {
            // Handles plan changes (upgrades/downgrades) mid-subscription
            const email = data.customer_email || '';
            const user = email
                ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
                : null;

            if (user && data.items?.data?.[0]?.price?.unit_amount) {
                const amount = data.items.data[0].price.unit_amount;
                const newTier = TIER_BY_AMOUNT[amount];
                if (newTier) {
                    db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                        .run(newTier, TIER_LIMITS[newTier] || TIER_LIMITS.free, user.id);
                }
            }

            // If subscription status is past_due or unpaid, downgrade
            if (user && (data.status === 'past_due' || data.status === 'unpaid')) {
                db.prepare("UPDATE users SET tier = 'free', storage_limit = ? WHERE id = ?")
                    .run(TIER_LIMITS.free, user.id);
            }
        } else if (type === 'customer.subscription.deleted') {
            // Subscription objects carry `customer`, not `customer_email` —
            // the old email lookup matched nothing, so cancellations never
            // actually downgraded anyone. Resolve the user by customer id
            // (email kept as a fallback for old replayed events).
            const customerId = data.customer || '';
            let deletedUser = (customerId
                ? db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId)
                : null) as any;
            if (!deletedUser && data.customer_email) {
                deletedUser = db.prepare('SELECT id FROM users WHERE email = ?').get(data.customer_email) as any;
            }
            if (deletedUser) {
                trackEvent('subscription_cancelled', deletedUser.id);
                // Only downgrade when NO other subscription remains active —
                // upgrades cancel the superseded plan, and that deletion event
                // must not clobber the tier the customer just paid for.
                let remainingTier: string | null = null;
                if (customerId && config.STRIPE_SECRET_KEY) {
                    try {
                        const subs = await getStripe().subscriptions.list({ customer: customerId, status: 'active', limit: 20 });
                        const remaining = subs.data.find((s) => s.id !== data.id);
                        const amount = remaining?.items?.data?.[0]?.price?.unit_amount;
                        if (amount && TIER_BY_AMOUNT[amount]) remainingTier = TIER_BY_AMOUNT[amount];
                        else if (remaining) remainingTier = 'keep'; // active sub we can't classify — don't touch tier
                    } catch (err: any) {
                        console.error('[Billing] subscription.deleted: could not list remaining subs:', err?.message || err);
                        remainingTier = 'keep'; // fail safe — never downgrade on a Stripe API hiccup
                    }
                }
                if (remainingTier === null) {
                    db.prepare("UPDATE users SET tier = 'free', storage_limit = ? WHERE id = ?")
                        .run(TIER_LIMITS.free, deletedUser.id);
                } else if (remainingTier !== 'keep') {
                    db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                        .run(remainingTier, TIER_LIMITS[remainingTier] || TIER_LIMITS.free, deletedUser.id);
                }
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
        const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://windyword.ai/dashboard';
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

        const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || 'https://windyword.ai/dashboard';

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
        // Wave 12 B2: narrow ZodError → 400. Mirrors the fix in storage.ts
        // for the /files endpoint — a malformed ?limit=non-numeric used to
        // 500 because the same wide catch buckets validation + server errors.
        if (err instanceof ZodError || err?.name === 'ZodError') {
            return res.status(400).json({
                error: 'invalid_query',
                details: err.flatten ? err.flatten() : err.issues || err.errors,
            });
        }
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
