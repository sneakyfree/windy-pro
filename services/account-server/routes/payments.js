/**
 * Windy Pro — Stripe Payment Integration
 *
 * Handles checkout sessions, billing portal, subscription lifecycle.
 * Caches subscription state in local SQLite to avoid Stripe API calls on every launch.
 *
 * Tiers & Storage Limits:
 *   Free           — $0        — 500 MB
 *   Pro            — $49/yr    — 5 GB
 *   Translate      — $79/yr    — 10 GB
 *   Translate Pro  — $149/yr   — 25 GB
 */

const stripe = require('stripe');
const express = require('express');

// Storage limits per tier (in MB)
const TIER_STORAGE = {
    free: 500,
    pro: 5 * 1024,          // 5 GB
    translate: 10 * 1024,   // 10 GB
    translate_pro: 25 * 1024 // 25 GB
};

module.exports = function createRouter({ db, authenticate }) {
    const router = express.Router();

    // Initialize Stripe (key comes from environment)
    const stripeClient = stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
    const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

    // Product catalog — all 4 tiers with multiple billing options
    const PRODUCTS = {
        // ── Pro ($49/yr) ──
        pro_annual: {
            priceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || 'price_1T5oYzBXIOBasDQibSlnIsPg',
            tier: 'pro', name: 'Windy Pro (Annual)', amount: 4900
        },
        pro_monthly: {
            priceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || 'price_1T60GeBXIOBasDQi4aitcq8O',
            tier: 'pro', name: 'Windy Pro (Monthly)', amount: 499, recurring: true
        },
        pro_lifetime: {
            priceId: process.env.STRIPE_PRO_LIFETIME_PRICE_ID || 'price_1T5oYzBXIOBasDQibSlnIsPg_life',
            tier: 'pro', name: 'Windy Pro (Lifetime)', amount: 9900
        },

        // ── Translate / Ultra ($79/yr) ──
        translate_annual: {
            priceId: process.env.STRIPE_TRANSLATE_ANNUAL_PRICE_ID || 'price_1T5oZJBXIOBasDQiHO0MtYS7',
            tier: 'translate', name: 'Windy Ultra (Annual)', amount: 7900
        },
        translate_monthly: {
            priceId: process.env.STRIPE_TRANSLATE_MONTHLY_PRICE_ID || 'price_1T5oZJBXIOBasDQijBW23Gow',
            tier: 'translate', name: 'Windy Ultra (Monthly)', amount: 899, recurring: true
        },
        translate_lifetime: {
            priceId: process.env.STRIPE_TRANSLATE_LIFETIME_PRICE_ID || 'price_1T5oZJBXIOBasDQiHO0MtYS7_life',
            tier: 'translate', name: 'Windy Ultra (Lifetime)', amount: 19900
        },

        // ── Translate Pro / Max ($149/yr) ──
        translate_pro_annual: {
            priceId: process.env.STRIPE_TRANSLATE_PRO_ANNUAL_PRICE_ID || 'price_1T5oZ1BXIOBasDQinrz3VdvG',
            tier: 'translate_pro', name: 'Windy Max (Annual)', amount: 14900
        },
        translate_pro_monthly: {
            priceId: process.env.STRIPE_TRANSLATE_PRO_MONTHLY_PRICE_ID || 'price_1T60H8BXIOBasDQiy5eorTWR',
            tier: 'translate_pro', name: 'Windy Max (Monthly)', amount: 1499, recurring: true
        },
        translate_pro_lifetime: {
            priceId: process.env.STRIPE_TRANSLATE_PRO_LIFETIME_PRICE_ID || 'price_1T5oZ1BXIOBasDQinrz3VdvG_life',
            tier: 'translate_pro', name: 'Windy Max (Lifetime)', amount: 29900
        }
    };

    // ─── Helper: upsert subscription cache ───
    function upsertSubscription(userId, tier, stripeCustomerId, stripeSubId, periodEnd) {
        const storageLimitMb = TIER_STORAGE[tier] || TIER_STORAGE.free;
        db.prepare(`
            INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, storage_limit_mb, status, current_period_end, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
                tier = excluded.tier,
                stripe_customer_id = COALESCE(excluded.stripe_customer_id, stripe_customer_id),
                stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, stripe_subscription_id),
                storage_limit_mb = excluded.storage_limit_mb,
                status = 'active',
                current_period_end = excluded.current_period_end,
                updated_at = datetime('now')
        `).run(userId, tier, stripeCustomerId || null, stripeSubId || null, storageLimitMb, periodEnd || null);
    }

    function downgradeToFree(userId) {
        db.prepare(`
            INSERT INTO subscriptions (user_id, tier, storage_limit_mb, status, updated_at)
            VALUES (?, 'free', 500, 'cancelled', datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
                tier = 'free',
                storage_limit_mb = 500,
                status = 'cancelled',
                stripe_subscription_id = NULL,
                current_period_end = NULL,
                updated_at = datetime('now')
        `).run(userId);
    }

    // ─── POST /create-checkout ───
    router.post('/create-checkout', async (req, res) => {
        try {
            const { priceId, userId, email } = req.body;

            // Find product by priceId
            const product = Object.values(PRODUCTS).find(p => p.priceId === priceId);
            if (!product) {
                // Also allow productKey lookup for backward compat
                const byKey = PRODUCTS[req.body.productKey];
                if (!byKey) return res.status(400).json({ error: 'Invalid product or priceId' });
                return handleCheckout(byKey, userId, email, req, res);
            }
            return handleCheckout(product, userId, email, req, res);
        } catch (err) {
            console.error('[Stripe] Checkout error:', err.message);
            res.status(500).json({ error: 'Payment setup failed' });
        }
    });

    async function handleCheckout(product, userId, email, req, res) {
        const sessionParams = {
            payment_method_types: ['card'],
            line_items: [{ price: product.priceId, quantity: 1 }],
            mode: product.recurring ? 'subscription' : 'payment',
            success_url: `${req.headers.origin || 'https://windypro.thewindstorm.uk'}/dashboard?payment=success&tier=${product.tier}`,
            cancel_url: `${req.headers.origin || 'https://windypro.thewindstorm.uk'}/dashboard?payment=cancelled`,
            customer_email: email || undefined,
            metadata: {
                userId: userId || '',
                tier: product.tier,
                productName: product.name
            }
        };

        const session = await stripeClient.checkout.sessions.create(sessionParams);
        res.json({ ok: true, url: session.url, sessionId: session.id });
    }

    // ─── GET /subscription/:userId — cached subscription status ───
    router.get('/subscription/:userId', authenticate, (req, res) => {
        try {
            const userId = req.params.userId;

            // Only allow users to query their own subscription (or admin)
            if (req.user.sub !== userId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);

            if (!sub) {
                // No subscription record = free tier
                return res.json({
                    tier: 'free',
                    storageLimitMb: TIER_STORAGE.free,
                    storageLimitBytes: TIER_STORAGE.free * 1024 * 1024,
                    status: 'active',
                    currentPeriodEnd: null,
                    stripeCustomerId: null
                });
            }

            res.json({
                tier: sub.tier,
                storageLimitMb: sub.storage_limit_mb,
                storageLimitBytes: sub.storage_limit_mb * 1024 * 1024,
                status: sub.status,
                currentPeriodEnd: sub.current_period_end,
                stripeCustomerId: sub.stripe_customer_id
            });
        } catch (err) {
            console.error('[Stripe] Subscription query error:', err.message);
            res.status(500).json({ error: 'Could not fetch subscription' });
        }
    });

    // ─── POST /portal — create Stripe billing portal session ───
    router.post('/portal', authenticate, async (req, res) => {
        try {
            const userId = req.user.sub;
            const sub = db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(userId);

            if (!sub || !sub.stripe_customer_id) {
                return res.status(400).json({ error: 'No Stripe customer found. Purchase a plan first.' });
            }

            const portalSession = await stripeClient.billingPortal.sessions.create({
                customer: sub.stripe_customer_id,
                return_url: `${req.headers.origin || 'https://windypro.thewindstorm.uk'}/dashboard`
            });

            res.json({ ok: true, url: portalSession.url });
        } catch (err) {
            console.error('[Stripe] Portal error:', err.message);
            res.status(500).json({ error: 'Could not create billing portal session' });
        }
    });

    // ─── GET /check-session/:sessionId — poll payment status ───
    router.get('/check-session/:sessionId', async (req, res) => {
        try {
            const session = await stripeClient.checkout.sessions.retrieve(req.params.sessionId);
            const paid = session.payment_status === 'paid';
            res.json({
                paid,
                tier: session.metadata?.tier || null,
                status: session.payment_status
            });
        } catch (err) {
            console.error('[Stripe] Session check error:', err.message);
            res.status(500).json({ error: 'Could not check session' });
        }
    });

    // ─── POST /webhook — Stripe webhook handler ───
    router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
        try {
            let event;

            if (WEBHOOK_SECRET) {
                const sig = req.headers['stripe-signature'];
                event = stripeClient.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
            } else {
                // Dev mode: trust raw body
                event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            }

            switch (event.type) {
                // ── Checkout completed (one-time or first subscription payment) ──
                case 'checkout.session.completed': {
                    const session = event.data.object;
                    const tier = session.metadata?.tier;
                    const userId = session.metadata?.userId;
                    const customerId = session.customer;
                    const subscriptionId = session.subscription; // null for one-time

                    if (userId && tier) {
                        // Fetch period end if subscription
                        let periodEnd = null;
                        if (subscriptionId) {
                            try {
                                const sub = await stripeClient.subscriptions.retrieve(subscriptionId);
                                periodEnd = new Date(sub.current_period_end * 1000).toISOString();
                            } catch (_) { }
                        }

                        upsertSubscription(userId, tier, customerId, subscriptionId, periodEnd);

                        // Generate license key
                        const key = generateLicenseKey(tier);
                        console.log(`[Stripe] ✅ Payment completed: user=${userId} tier=${tier} key=${key}`);
                    }
                    break;
                }

                // ── Subscription renewed or plan changed ──
                case 'customer.subscription.updated': {
                    const sub = event.data.object;
                    const customerId = sub.customer;
                    const subscriptionId = sub.id;
                    const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
                    const status = sub.status; // active, past_due, canceled, unpaid

                    // Find user by stripe_customer_id
                    const row = db.prepare('SELECT user_id, tier FROM subscriptions WHERE stripe_customer_id = ?').get(customerId);
                    if (row) {
                        if (status === 'active' || status === 'trialing') {
                            // Determine tier from price if plan changed
                            let tier = row.tier;
                            const priceId = sub.items?.data?.[0]?.price?.id;
                            if (priceId) {
                                const product = Object.values(PRODUCTS).find(p => p.priceId === priceId);
                                if (product) tier = product.tier;
                            }
                            upsertSubscription(row.user_id, tier, customerId, subscriptionId, periodEnd);
                            console.log(`[Stripe] 🔄 Subscription updated: user=${row.user_id} tier=${tier} status=${status}`);
                        } else if (status === 'canceled' || status === 'unpaid') {
                            downgradeToFree(row.user_id);
                            console.log(`[Stripe] ⬇️ Subscription ${status}: user=${row.user_id} → free`);
                        }
                    }
                    break;
                }

                // ── Subscription cancelled ──
                case 'customer.subscription.deleted': {
                    const sub = event.data.object;
                    const customerId = sub.customer;

                    const row = db.prepare('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?').get(customerId);
                    if (row) {
                        downgradeToFree(row.user_id);
                        console.log(`[Stripe] 🗑️ Subscription deleted: user=${row.user_id} → free`);
                    }
                    break;
                }

                default:
                    console.log(`[Stripe] Unhandled event: ${event.type}`);
            }

            res.json({ received: true });
        } catch (err) {
            console.error('[Stripe] Webhook error:', err.message);
            res.status(400).json({ error: 'Webhook processing failed' });
        }
    });

    // ─── POST /activate — license key activation ───
    router.post('/activate', (req, res) => {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'Missing license key' });

        // Validate format: WP-XXXX-XXXX-XXXX
        if (!/^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
            return res.status(400).json({ error: 'Invalid license key format' });
        }

        // Determine tier from key prefix
        let tier = 'pro';
        if (key.startsWith('WP-M')) tier = 'translate_pro';
        else if (key.startsWith('WP-T')) tier = 'translate';
        else if (key.startsWith('WP-P')) tier = 'pro';

        res.json({
            success: true,
            tier,
            key,
            storageLimitMb: TIER_STORAGE[tier],
            storageLimitBytes: TIER_STORAGE[tier] * 1024 * 1024
        });
    });

    // ─── GET /storage-limits — public tier limits ───
    router.get('/storage-limits', (req, res) => {
        res.json({
            tiers: Object.entries(TIER_STORAGE).map(([tier, mb]) => ({
                tier,
                storageLimitMb: mb,
                storageLimitBytes: mb * 1024 * 1024,
                storageLimitLabel: mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`
            }))
        });
    });

    return router;
};

/**
 * Generate a license key for a tier
 */
function generateLicenseKey(tier) {
    const prefixes = {
        pro: 'WP-P',
        translate: 'WP-T',
        translate_pro: 'WP-M'
    };
    const prefix = prefixes[tier] || 'WP-P';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${prefix}${segment().slice(1)}-${segment()}-${segment()}`;
}
