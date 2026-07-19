/**
 * RevenueCat webhook — server-side provisioning for mobile in-app purchases.
 *
 * POST /api/v1/webhooks/revenuecat
 *
 * LAUNCH-BLOCKER fix: App Store / Play Store subscribers pay through
 * RevenueCat, but nothing ever told the account-server. The mobile app's
 * "sync" call posted {tier, source:'revenuecat'} to /api/v1/license/activate
 * (windy-pro-mobile src/app/subscription/index.tsx:232-243), which validates
 * for {key} — so the body was rejected — and by design ignores client-claimed
 * tiers (A1 invariant: tier comes only from a payment-verified server path).
 * Net effect: paying mobile customers stayed tier='free' server-side.
 *
 * This webhook IS the payment-verified server path for mobile: RevenueCat
 * calls it directly on purchase lifecycle events, authenticated by the
 * shared-secret Authorization header configured in the RC dashboard
 * (Project → Integrations → Webhooks → "Authorization header value").
 *
 * Security / money rules (mirrors the Stripe webhook posture in billing.ts):
 *  - Fail-closed: REVENUECAT_WEBHOOK_AUTH unset → 503, zero writes
 *    (same as STRIPE_WEBHOOK_SECRET handling).
 *  - Constant-time auth compare; bad/missing auth → 401, zero writes.
 *  - Idempotent: replays of the same RC event id are acknowledged without
 *    re-writing; the tier writes themselves are idempotent UPDATEs.
 *  - Processing errors are logged and ACKed with a generic body
 *    (fire-and-forget — a handler bug must not put RevenueCat into a
 *    retry storm; same posture as the legacy Stripe handlers).
 *  - SANDBOX (TestFlight / internal-testing) events never provision unless
 *    REVENUECAT_ALLOW_SANDBOX=1 — sandbox "purchases" are free.
 *  - Downgrades never clobber a tier this product didn't grant (a Stripe
 *    upgrade on the same account survives a mobile expiration) — mirrors
 *    the "only downgrade when no other plan remains" caution in
 *    customer.subscription.deleted.
 *
 * Event semantics (RevenueCat public webhook spec, docs.revenuecat.com):
 *  - INITIAL_PURCHASE / RENEWAL / NON_RENEWING_PURCHASE / UNCANCELLATION /
 *    PRODUCT_CHANGE  → grant the mapped tier.
 *  - CANCELLATION    → auto-renew was switched OFF; the user keeps access
 *    until period end, so we only downgrade when access actually ended
 *    (refund via cancel_reason=CUSTOMER_SUPPORT, or expiration already past).
 *  - EXPIRATION      → access ended → downgrade to free.
 *  - Everything else (BILLING_ISSUE, SUBSCRIBER_ALIAS, TRANSFER, TEST, …)
 *    is acknowledged without writes.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getDb } from '../db/schema';
import { trackEvent } from '../services/analytics';
import { emitAdminEvent } from '../services/admin-telemetry';
import { TIER_LIMITS } from './billing';

// ─── Product / entitlement → tier map ────────────────────────
//
// RevenueCat sends both the store product id (`product_id`) and the RC
// entitlement identifiers (`entitlement_ids`). The mobile client's
// ENTITLEMENT_MAP (windy-pro-mobile src/services/subscription.ts) uses RC
// entitlement identifiers 'pro' / 'translate' / 'translate_pro', so those
// are the stable keys. The store product ids below are the EXPECTED ids —
// Grant: adjust these to the real App Store Connect / Play Console product
// ids before go-live (unknown ids are logged + ACKed, never provisioned).
export const REVENUECAT_PRODUCT_TIER_MAP: Record<string, string> = {
    // RC entitlement identifiers (preferred — resilient to product-id churn)
    pro: 'pro',
    translate: 'translate',
    translate_pro: 'translate_pro',
    // Expected store product ids (adjust to match the stores)
    windy_pro_monthly: 'pro',
    windy_pro_yearly: 'pro',
    windy_translate_monthly: 'translate',
    windy_translate_yearly: 'translate',
    windy_translate_pro_monthly: 'translate_pro',
    windy_translate_pro_yearly: 'translate_pro',
};

// Highest tier wins when an event carries several mappable identifiers.
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, translate: 2, translate_pro: 3 };

const ACTIVE_TYPES = new Set([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'NON_RENEWING_PURCHASE',
    'UNCANCELLATION',
    'PRODUCT_CHANGE',
]);
// Event types that record a payment in Billing History (money actually moved).
const MONEY_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']);

// ─── Helpers ─────────────────────────────────────────────────

/** Constant-time compare of the Authorization header against the shared
 *  secret. Accepts the exact configured value, or `Bearer <value>` (RC
 *  sends the header string verbatim as configured in its dashboard, so
 *  either form may be in play depending on how Grant fills the field). */
function isAuthorized(req: Request): boolean {
    const secret = config.REVENUECAT_WEBHOOK_AUTH;
    if (!secret) return false;
    const header = String(req.headers['authorization'] || '');
    const candidates = [header, header.replace(/^Bearer\s+/i, '')];
    const expected = Buffer.from(secret);
    for (const candidate of candidates) {
        const got = Buffer.from(candidate);
        if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) {
            return true;
        }
    }
    return false;
}

/** Resolve the Windy user from the RC app_user_id (+ aliases). The mobile
 *  app calls Purchases.logIn(<windy user id>) so app_user_id should equal
 *  users.id; windy_identity_id and email are accepted as fallbacks. RC
 *  anonymous ids ($RCAnonymousID:…) can never match a user and are skipped. */
function resolveUser(db: any, ev: any): any | null {
    const candidates = [ev?.app_user_id, ev?.original_app_user_id, ...(Array.isArray(ev?.aliases) ? ev.aliases : [])]
        .filter((c: any): c is string => typeof c === 'string' && !!c.trim() && !c.startsWith('$RCAnonymousID:'));
    for (const candidate of candidates) {
        const byId = db.prepare('SELECT * FROM users WHERE id = ?').get(candidate) as any;
        if (byId) return byId;
        const byIdentity = db.prepare('SELECT * FROM users WHERE windy_identity_id = ?').get(candidate) as any;
        if (byIdentity) return byIdentity;
        const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(candidate.toLowerCase()) as any;
        if (byEmail) return byEmail;
    }
    return null;
}

/** Map the event's entitlement/product identifiers to a tier (highest wins).
 *  PRODUCT_CHANGE carries the destination product in new_product_id. */
function resolveTier(ev: any): string | null {
    const keys: string[] = [];
    if (Array.isArray(ev?.entitlement_ids)) keys.push(...ev.entitlement_ids.filter((k: any) => typeof k === 'string'));
    if (typeof ev?.entitlement_id === 'string') keys.push(ev.entitlement_id);
    const productKey = typeof ev?.new_product_id === 'string' && ev.new_product_id ? ev.new_product_id : ev?.product_id;
    if (typeof productKey === 'string') keys.push(productKey);

    let best: string | null = null;
    for (const key of keys) {
        const tier = REVENUECAT_PRODUCT_TIER_MAP[key];
        if (tier && (best === null || (TIER_RANK[tier] || 0) > (TIER_RANK[best] || 0))) {
            best = tier;
        }
    }
    return best;
}

function storageLimitForTier(tier: string): number {
    // Same lookup the Stripe checkout.session.completed handler uses —
    // 'translate_pro' (underscore, RC/metadata form) falls back to the
    // hyphenated TIER_LIMITS key.
    return TIER_LIMITS[tier] || TIER_LIMITS[tier.replace('_', '-')] || TIER_LIMITS.free;
}

// ─── Router (mounted at /api/v1/webhooks/revenuecat) ─────────

const router = Router();

router.post('/', async (req: Request, res: Response) => {
    // Fail-closed: without the shared secret this endpoint is inert —
    // mirror the STRIPE_WEBHOOK_SECRET-unset behaviour (503, no writes).
    if (!config.REVENUECAT_WEBHOOK_AUTH) {
        console.warn('[RevenueCat] REVENUECAT_WEBHOOK_AUTH not set — rejecting webhook');
        res.status(503).json({ error: 'RevenueCat webhook not configured', retryable: false });
        return;
    }
    if (!isAuthorized(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    // RC wraps the event: { api_version, event: {...} }. Tolerate a flat
    // body too (some test tooling posts the event object directly).
    const body: any = req.body;
    const ev: any = body && typeof body === 'object' && body.event && typeof body.event === 'object'
        ? body.event
        : body;
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') {
        res.status(400).json({ error: 'Malformed RevenueCat event' });
        return;
    }

    // Dashboard "send test event" ping — ack, never write.
    if (ev.type === 'TEST') {
        res.json({ received: true });
        return;
    }

    // Sandbox purchases are free — never provision from them in prod.
    if (ev.environment === 'SANDBOX' && process.env.REVENUECAT_ALLOW_SANDBOX !== '1') {
        console.log(`[RevenueCat] Skipping SANDBOX event ${String(ev.id || '').slice(0, 8)} (${ev.type})`);
        res.json({ received: true, skipped: 'sandbox' });
        return;
    }

    try {
        const db = getDb();
        const eventRef = ev.id ? `rc_evt_${String(ev.id)}`.slice(0, 128) : null;

        // Idempotency: money events record a transaction keyed on the RC
        // event id — a redelivered event is acknowledged without re-writing.
        if (eventRef && MONEY_TYPES.has(ev.type)) {
            const seen = db.prepare('SELECT id FROM transactions WHERE stripe_payment_id = ?').get(eventRef) as any;
            if (seen) {
                res.json({ received: true, replayed: true });
                return;
            }
        }

        const user = resolveUser(db, ev);
        if (!user) {
            // Unknown app_user_id — most likely the mobile app never called
            // Purchases.logIn(<windy user id>) for this subscriber. ACK (RC
            // would retry forever otherwise) but log loudly: this purchase
            // needs manual linking.
            console.error(
                `[RevenueCat] ${ev.type}: no user matches app_user_id ${String(ev.app_user_id || '').slice(0, 12)}… — purchase NOT provisioned`,
            );
            res.json({ received: true });
            return;
        }

        if (ACTIVE_TYPES.has(ev.type)) {
            const tier = resolveTier(ev);
            if (!tier) {
                console.error(
                    `[RevenueCat] ${ev.type}: unmapped product '${String(ev.product_id || '')}' / entitlements ${JSON.stringify(ev.entitlement_ids || [])} — add it to REVENUECAT_PRODUCT_TIER_MAP`,
                );
                res.json({ received: true });
                return;
            }

            const priorTier = user.tier || 'free';
            // Same tier write the Stripe checkout.session.completed handler
            // performs — users.tier is what every server-side gate reads.
            db.prepare('UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?')
                .run(tier, storageLimitForTier(tier), user.id);

            if (ev.type === 'INITIAL_PURCHASE') {
                trackEvent('subscription_started', user.id, { tier });
            }

            // Billing History row for real payments (idempotent via eventRef).
            if (eventRef && MONEY_TYPES.has(ev.type)) {
                const amountCents = Math.round(Number(ev.price || 0) * 100) || 0;
                db.prepare(
                    'INSERT INTO transactions (id, user_id, email, amount, currency, type, status, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                ).run(
                    uuidv4(),
                    user.id,
                    user.email || '',
                    amountCents,
                    'usd', // RC's `price` field is normalized to USD
                    ev.type === 'NON_RENEWING_PURCHASE' ? 'one_time' : 'subscription',
                    'paid',
                    eventRef,
                );
            }

            // Intel (CONTRACT §8): commerce events — counts/ids only.
            const wid = user.windy_identity_id || user.id;
            if (MONEY_TYPES.has(ev.type)) {
                emitAdminEvent({
                    event_type: 'wallet.purchase', actor_type: 'human', actor_id: wid,
                    metadata: {
                        sku: tier, ok: true,
                        amount_microcents: Math.round(Number(ev.price || 0) * 100) * 10_000,
                    },
                });
            }
            if (priorTier !== tier) {
                emitAdminEvent({
                    event_type: 'entitlement.change', actor_type: 'human', actor_id: wid,
                    metadata: { tier_from: priorTier, tier_to: tier, initiator: 'revenuecat' },
                });
            }

            console.log(`[RevenueCat] ${ev.type}: user ${String(user.id).slice(0, 8)} → tier=${tier} (was ${priorTier})`);
            res.json({ received: true });
            return;
        }

        if (ev.type === 'CANCELLATION' || ev.type === 'EXPIRATION') {
            // CANCELLATION = auto-renew off; access runs to period end.
            // Only revoke when access actually ended: EXPIRATION, a refund
            // (App Store refunds arrive as CANCELLATION with
            // cancel_reason=CUSTOMER_SUPPORT), or an already-past expiry.
            const expirationMs = Number(ev.expiration_at_ms || 0);
            const refunded = ev.cancel_reason === 'CUSTOMER_SUPPORT';
            const accessEnded = ev.type === 'EXPIRATION' || refunded
                || (expirationMs > 0 && expirationMs <= Date.now());
            if (!accessEnded) {
                console.log(`[RevenueCat] CANCELLATION (auto-renew off) for user ${String(user.id).slice(0, 8)} — access kept until expiration`);
                res.json({ received: true, deferred: 'active_until_expiration' });
                return;
            }

            const mappedTier = resolveTier(ev);
            const currentTier = user.tier || 'free';
            // Never clobber a tier this product didn't grant — a Stripe
            // upgrade (or a different mobile product) on the same account
            // must survive this event. Unknown products also never downgrade.
            if (!mappedTier || currentTier !== mappedTier) {
                console.log(`[RevenueCat] ${ev.type}: user ${String(user.id).slice(0, 8)} tier '${currentTier}' not granted by this product (${mappedTier || 'unmapped'}) — keeping`);
                res.json({ received: true });
                return;
            }

            db.prepare("UPDATE users SET tier = 'free', storage_limit = ? WHERE id = ?")
                .run(TIER_LIMITS.free, user.id);
            trackEvent('subscription_cancelled', user.id);
            emitAdminEvent({
                event_type: 'entitlement.change', actor_type: 'human',
                actor_id: user.windy_identity_id || user.id,
                metadata: { tier_from: currentTier, tier_to: 'free', initiator: 'revenuecat' },
            });
            console.log(`[RevenueCat] ${ev.type}: user ${String(user.id).slice(0, 8)} downgraded ${currentTier} → free`);
            res.json({ received: true });
            return;
        }

        // BILLING_ISSUE / SUBSCRIBER_ALIAS / TRANSFER / future types — ack.
        // (BILLING_ISSUE gets its grace window from the store; EXPIRATION
        // follows if dunning fails, same shape as Stripe's invoice retries.)
        console.log(`[RevenueCat] Ignoring event type ${ev.type}`);
        res.json({ received: true });
    } catch (err: any) {
        // Fire-and-forget: log, ACK with a generic body. Handlers are
        // idempotent but a retry storm on a persistent bug helps nobody —
        // same posture as the legacy Stripe processing catch.
        console.error('[RevenueCat] Webhook processing error:', err);
        res.json({ received: true });
    }
});

export default router;
