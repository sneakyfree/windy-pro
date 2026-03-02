/**
 * Windy Pro — Stripe Payment Integration (Ghost Feature 1)
 * 
 * Handles one-time license purchases and optional subscriptions.
 * Uses Stripe Checkout for payment processing.
 * 
 * Tiers:
 *   Pro       — $49 one-time
 *   Translate — $79 one-time or $7.99/month
 */

const stripe = require('stripe');
const express = require('express');
const router = express.Router();

// Initialize Stripe (key comes from environment)
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Product IDs (configure in Stripe Dashboard)
const PRODUCTS = {
    pro_onetime: {
        priceId: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_onetime',
        tier: 'pro',
        name: 'Windy Pro License',
        amount: 4900 // $49
    },
    translate_onetime: {
        priceId: process.env.STRIPE_TRANSLATE_PRICE_ID || 'price_translate_onetime',
        tier: 'translate',
        name: 'Windy Translate License',
        amount: 7900 // $79
    },
    translate_monthly: {
        priceId: process.env.STRIPE_TRANSLATE_SUB_PRICE_ID || 'price_translate_monthly',
        tier: 'translate',
        name: 'Windy Translate Subscription',
        amount: 799, // $7.99/mo
        recurring: true
    }
};

/**
 * POST /api/v1/payments/create-checkout
 * Creates a Stripe Checkout session
 */
router.post('/create-checkout', async (req, res) => {
    try {
        const { productKey, userId, email } = req.body;
        const product = PRODUCTS[productKey];

        if (!product) {
            return res.status(400).json({ error: 'Invalid product' });
        }

        const sessionParams = {
            payment_method_types: ['card'],
            line_items: [{
                price: product.priceId,
                quantity: 1
            }],
            mode: product.recurring ? 'subscription' : 'payment',
            success_url: `${req.headers.origin || 'https://windypro.thewindstorm.uk'}/dashboard?payment=success&tier=${product.tier}`,
            cancel_url: `${req.headers.origin || 'https://windypro.thewindstorm.uk'}/dashboard?payment=cancelled`,
            customer_email: email,
            metadata: {
                userId: userId || '',
                tier: product.tier,
                productKey
            }
        };

        const session = await stripeClient.checkout.sessions.create(sessionParams);
        res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
        console.error('[Stripe] Checkout error:', err.message);
        res.status(500).json({ error: 'Payment setup failed' });
    }
});

/**
 * POST /api/v1/payments/webhook
 * Stripe webhook for payment confirmation
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        let event;

        if (WEBHOOK_SECRET) {
            const sig = req.headers['stripe-signature'];
            event = stripeClient.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
        } else {
            event = req.body;
        }

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const tier = session.metadata?.tier;
                const userId = session.metadata?.userId;

                console.log(`[Stripe] Payment completed: user=${userId} tier=${tier}`);

                // Generate license key
                const key = generateLicenseKey(tier);
                console.log(`[Stripe] License key generated: ${key}`);

                // In production: update user record in database
                // await db.run('UPDATE users SET tier = ?, license_key = ? WHERE id = ?', [tier, key, userId]);

                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                console.log(`[Stripe] Subscription cancelled: ${sub.id}`);
                // Downgrade user to free tier
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

/**
 * POST /api/v1/license/activate
 * Activate a license key
 */
router.post('/activate', (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing license key' });

    // Validate format: WP-XXXX-XXXX-XXXX
    if (!/^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
        return res.status(400).json({ error: 'Invalid license key format' });
    }

    const tier = key.startsWith('WP-T') ? 'translate' : 'pro';
    res.json({ success: true, tier, key });
});

/**
 * Generate a license key for a tier
 */
function generateLicenseKey(tier) {
    const prefix = tier === 'translate' ? 'WP-T' : 'WP-P';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
    const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${prefix}${segment().slice(1)}-${segment()}-${segment()}`;
}

module.exports = router;
