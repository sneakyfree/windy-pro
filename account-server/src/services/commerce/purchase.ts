/**
 * Unified wallet (P1) — one Stripe customer per Windy account, one payment
 * method on file, one purchase call for ANY ecosystem SKU that provisions
 * entitlements atomically.
 *
 * Money invariants (adversarial-review checklist):
 *  - IDEMPOTENT: (user_id, idempotency_key) is unique; a replayed request
 *    returns the first outcome and can never double-charge (the Stripe call
 *    also carries an idempotency key derived from the purchase row id).
 *  - ATOMIC: entitlements are written in the same DB transaction that marks
 *    the purchase succeeded — a declined/failed payment leaves purchase
 *    status='failed' and ZERO entitlement rows.
 *  - ISOLATED: every read/write is keyed by the authenticated user id;
 *    a subscription can only be cancelled through a purchases row owned by
 *    the caller.
 *  - NO PAN/CVV ever touches this server: cards are collected by Stripe
 *    Elements client-side; we store only opaque customer/pm ids.
 */
import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { getDb } from '../../db/schema';
import { getStripeClient } from './stripe-client';
import { getSku, setSkuStripeProduct, CatalogSku } from './catalog';
import { provisionSkuEntitlements, recomputeDerivedState, revokeBySource } from './entitlements';

const nowIso = () => new Date().toISOString();

/** Grace after a subscription period ends before entitlements expire —
 *  covers Stripe's own retry window for a failed renewal without letting a
 *  dead card keep cloud value forever. */
const RENEWAL_GRACE_DAYS = 3;
/** One-time top-ups (e.g. STT minutes) live this long. */
const ONE_TIME_TOPUP_DAYS = 30;

export interface PurchaseRow {
    id: string;
    user_id: string;
    sku_id: string;
    idempotency_key: string;
    status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'canceled';
    amount_cents: number;
    currency: string;
    stripe_payment_intent_id: string | null;
    stripe_subscription_id: string | null;
    error_code: string | null;
    provision_status: string;
    created_at: string;
}

export class PurchaseError extends Error {
    constructor(
        public httpStatus: number,
        public code: string,
        public friendly: string,
    ) {
        super(code);
    }
}

// ─── Customer + payment method ──────────────────────────────────────────────

export async function ensureStripeCustomer(user: { id: string; email: string; name?: string; stripe_customer_id?: string | null }): Promise<string> {
    if (user.stripe_customer_id) return user.stripe_customer_id;
    const stripe = getStripeClient();
    const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { windy_user_id: user.id },
    });
    getDb().run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', customer.id, user.id);
    return customer.id;
}

export async function createSetupIntent(user: any): Promise<{ client_secret: string; customer_id: string }> {
    const stripe = getStripeClient();
    const customerId = await ensureStripeCustomer(user);
    const si = await stripe.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        metadata: { windy_user_id: user.id },
    });
    return { client_secret: si.client_secret as string, customer_id: customerId };
}

/** Attach a confirmed payment method and make it the wallet default. */
export async function setDefaultPaymentMethod(user: any, paymentMethodId: string): Promise<void> {
    const stripe = getStripeClient();
    const customerId = await ensureStripeCustomer(user);
    try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (err: any) {
        // Already attached to THIS customer is fine; attached elsewhere is not.
        if (!String(err?.message || '').includes('already been attached to a customer') || !(await pmBelongsToCustomer(paymentMethodId, customerId))) {
            throw new PurchaseError(400, 'payment_method_invalid', 'That card could not be saved. Please try adding it again.');
        }
    }
    await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
    });
}

async function pmBelongsToCustomer(paymentMethodId: string, customerId: string): Promise<boolean> {
    try {
        const pm = await getStripeClient().paymentMethods.retrieve(paymentMethodId);
        return (typeof pm.customer === 'string' ? pm.customer : pm.customer?.id) === customerId;
    } catch {
        return false;
    }
}

export async function defaultPaymentMethod(user: any): Promise<{ id: string; brand: string; last4: string; exp_month: number; exp_year: number } | null> {
    if (!user.stripe_customer_id) return null;
    const stripe = getStripeClient();
    const customer = await stripe.customers.retrieve(user.stripe_customer_id) as Stripe.Customer;
    if (!customer || (customer as any).deleted) return null;
    const pmId = typeof customer.invoice_settings?.default_payment_method === 'string'
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id;
    if (!pmId) return null;
    const pm = await stripe.paymentMethods.retrieve(pmId);
    return {
        id: pm.id,
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '····',
        exp_month: pm.card?.exp_month || 0,
        exp_year: pm.card?.exp_year || 0,
    };
}

// ─── Purchase (the one-tap endpoint's engine) ───────────────────────────────

function replayResponse(row: PurchaseRow) {
    return {
        purchase_id: row.id,
        sku_id: row.sku_id,
        status: row.status,
        amount_cents: row.amount_cents,
        currency: row.currency,
        error_code: row.error_code,
        replayed: true,
    };
}

export async function purchaseSku(user: any, skuId: string, idempotencyKey: string) {
    const db = getDb();

    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw new PurchaseError(400, 'bad_idempotency_key', 'A purchase needs a client-generated idempotency key (8–128 chars).');
    }
    const sku = getSku(skuId);
    if (!sku || !sku.active) {
        throw new PurchaseError(404, 'unknown_sku', 'That plan is not available right now.');
    }
    if ((user.frozen ?? 0) === 1 || user.frozen === true) {
        throw new PurchaseError(403, 'account_frozen', 'This account is frozen — contact support before making purchases.');
    }

    // Replay guard #1 — a completed attempt returns its original outcome.
    const prior = await db.getAsync<PurchaseRow>(
        'SELECT * FROM purchases WHERE user_id = ? AND idempotency_key = ?', user.id, idempotencyKey,
    );
    if (prior) return replayResponse(prior);

    const customerId = await ensureStripeCustomer(user);
    const pm = await defaultPaymentMethod({ ...user, stripe_customer_id: customerId });
    if (!pm) {
        throw new PurchaseError(409, 'no_payment_method', 'Add a card to your Windy wallet first — it takes one minute and works across every Windy app.');
    }

    const purchaseId = randomUUID();
    try {
        await db.runAsync(
            `INSERT INTO purchases (id, user_id, sku_id, idempotency_key, status, amount_cents, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
            purchaseId, user.id, skuId, idempotencyKey, sku.price_cents, sku.currency, nowIso(), nowIso(),
        );
    } catch {
        // Replay guard #2 — lost the race to a concurrent identical request.
        const winner = await db.getAsync<PurchaseRow>(
            'SELECT * FROM purchases WHERE user_id = ? AND idempotency_key = ?', user.id, idempotencyKey,
        );
        if (winner) return replayResponse(winner);
        throw new PurchaseError(500, 'purchase_insert_failed', 'Something went wrong starting this purchase. Nothing was charged.');
    }

    try {
        let paymentIntentId: string | null = null;
        let subscriptionId: string | null = null;
        let expiresAt: string | null = null;

        if (sku.billing_mode === 'one_time') {
            const pi = await getStripeClient().paymentIntents.create({
                amount: sku.price_cents,
                currency: sku.currency,
                customer: customerId,
                payment_method: pm.id,
                off_session: true,
                confirm: true,
                description: `Windy ${sku.name}`,
                metadata: { windy_commerce: '1', purchase_id: purchaseId, windy_user_id: user.id, sku_id: skuId },
            }, { idempotencyKey: `wp-pi-${purchaseId}` });
            if (pi.status !== 'succeeded') {
                throw Object.assign(new Error('payment_not_succeeded'), { code: `pi_status_${pi.status}` });
            }
            paymentIntentId = pi.id;
            expiresAt = new Date(Date.now() + ONE_TIME_TOPUP_DAYS * 86400_000).toISOString();
        } else {
            const productId = await ensureStripeProduct(sku);
            const sub = await getStripeClient().subscriptions.create({
                customer: customerId,
                items: [{
                    price_data: {
                        currency: sku.currency,
                        product: productId,
                        recurring: { interval: 'month' },
                        unit_amount: sku.price_cents,
                    },
                }],
                default_payment_method: pm.id,
                payment_behavior: 'error_if_incomplete',
                metadata: { windy_commerce: '1', purchase_id: purchaseId, windy_user_id: user.id, sku_id: skuId },
            }, { idempotencyKey: `wp-sub-${purchaseId}` });
            if (sub.status !== 'active') {
                throw Object.assign(new Error('subscription_not_active'), { code: `sub_status_${sub.status}` });
            }
            subscriptionId = sub.id;
            paymentIntentId = extractSubscriptionPI(sub);
            expiresAt = subscriptionExpiry(sub);
        }

        // ATOMIC success: purchase flips to succeeded + entitlements provision
        // in one transaction. A crash between charge and here leaves a
        // 'pending' row that the webhook (payment_intent.succeeded /
        // invoice.paid carries purchase_id metadata) completes idempotently.
        await db.transactionAsync(async (tx) => {
            await tx.run(
                `UPDATE purchases SET status = 'succeeded', stripe_payment_intent_id = ?, stripe_subscription_id = ?, provision_status = 'provisioned', updated_at = ? WHERE id = ?`,
                paymentIntentId, subscriptionId, nowIso(), purchaseId,
            );
            await provisionSkuEntitlements(
                tx, user.id, sku,
                subscriptionId || purchaseId,
                subscriptionId ? 'subscription' : 'purchase',
                expiresAt,
            );
        });

        // Derived gates (account storage_limit + cloud tier). Fail-soft on
        // cloud: the sweep converges it; the purchase is already good.
        const derived = await recomputeDerivedState(user.id);
        if (!derived.cloudPushed) {
            await db.runAsync("UPDATE purchases SET provision_status = 'cloud_retry' WHERE id = ?", purchaseId);
        }

        return {
            purchase_id: purchaseId,
            sku_id: skuId,
            status: 'succeeded' as const,
            amount_cents: sku.price_cents,
            currency: sku.currency,
            subscription_id: subscriptionId,
            entitlements_active_until: expiresAt,
            replayed: false,
        };
    } catch (err: any) {
        const code = err?.code || err?.raw?.code || err?.decline_code || 'payment_failed';
        await db.runAsync(
            `UPDATE purchases SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
            String(code).slice(0, 64), nowIso(), purchaseId,
        );
        const friendly = code === 'card_declined' || String(code).includes('declined')
            ? 'Your card was declined — nothing was charged. Try another card in your Windy wallet.'
            : 'The payment didn\'t go through — nothing was charged and nothing changed on your account.';
        throw new PurchaseError(402, String(code), friendly);
    }
}

async function ensureStripeProduct(sku: CatalogSku): Promise<string> {
    if (sku.stripe_product_id) return sku.stripe_product_id;
    const product = await getStripeClient().products.create({
        name: `Windy ${sku.name}`,
        metadata: { sku_id: sku.sku_id },
    });
    setSkuStripeProduct(sku.sku_id, product.id);
    return product.id;
}

/** Stripe moved current_period_end onto subscription items in newer API
 *  versions — read both shapes. */
export function subscriptionExpiry(sub: any): string {
    const periodEnd: number | undefined =
        sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end;
    const endMs = periodEnd ? periodEnd * 1000 : Date.now() + 31 * 86400_000;
    return new Date(endMs + RENEWAL_GRACE_DAYS * 86400_000).toISOString();
}

function extractSubscriptionPI(sub: any): string | null {
    const invoice = sub?.latest_invoice;
    if (!invoice) return null;
    if (typeof invoice === 'string') return null;
    const pi = invoice.payment_intent;
    return typeof pi === 'string' ? pi : pi?.id || null;
}

// ─── Cancel / downgrade (user-initiated) ────────────────────────────────────

export async function cancelSubscription(user: any, subscriptionId: string) {
    const db = getDb();
    // Ownership check: only through a purchases row the caller owns.
    const row = await db.getAsync<PurchaseRow>(
        "SELECT * FROM purchases WHERE user_id = ? AND stripe_subscription_id = ? AND status = 'succeeded'",
        user.id, subscriptionId,
    );
    if (!row) {
        throw new PurchaseError(404, 'subscription_not_found', 'No active plan with that id on this account.');
    }
    try {
        await getStripeClient().subscriptions.cancel(subscriptionId);
    } catch (err: any) {
        if (err?.code !== 'resource_missing') {
            throw new PurchaseError(502, 'cancel_failed', 'Could not reach billing to cancel — please try again.');
        }
    }
    const sku = getSku(row.sku_id);
    await db.runAsync("UPDATE purchases SET status = 'canceled', updated_at = ? WHERE id = ?", nowIso(), row.id);
    await revokeBySource(
        subscriptionId,
        `You cancelled ${sku?.name || 'this plan'} — it's off your bill. Re-subscribe any time to pick up where you left off.`,
    );
    return { ok: true, canceled: subscriptionId };
}

// ─── Wallet summary ─────────────────────────────────────────────────────────

export async function walletSummary(user: any) {
    const db = getDb();
    const pm = user.stripe_customer_id ? await defaultPaymentMethod(user) : null;
    const purchases = await db.allAsync<PurchaseRow>(
        'SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT 25', user.id,
    );
    return {
        has_payment_method: !!pm,
        payment_method: pm,
        purchases: purchases.map(p => ({
            purchase_id: p.id,
            sku_id: p.sku_id,
            status: p.status,
            amount_cents: p.amount_cents,
            currency: p.currency,
            subscription_id: p.stripe_subscription_id,
            created_at: p.created_at,
        })),
    };
}
