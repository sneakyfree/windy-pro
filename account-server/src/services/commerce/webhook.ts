/**
 * Commerce webhook handling — consumes ALREADY-SIGNATURE-VERIFIED Stripe
 * events (billing.ts verifies the HMAC before dispatching here). Returns
 * true when the event belongs to the commerce engine so the legacy tier
 * handlers never double-process it.
 *
 * Commerce ownership is decided by ground truth, not trust in the payload:
 * metadata.windy_commerce plus a purchases-table match on the Stripe ids.
 * All handlers are idempotent — Stripe redelivers.
 */
import { getDb } from '../../db/schema';
import { getSku } from './catalog';
import { provisionSkuEntitlements, recomputeDerivedState, revokeBySource } from './entitlements';
import { PurchaseRow, subscriptionExpiry, oneTimeTopupExpiry } from './purchase';

const nowIso = () => new Date().toISOString();

async function purchaseBySubscription(subId: string | null | undefined): Promise<PurchaseRow | undefined> {
    if (!subId) return undefined;
    return getDb().getAsync<PurchaseRow>(
        'SELECT * FROM purchases WHERE stripe_subscription_id = ? ORDER BY created_at DESC LIMIT 1', subId,
    );
}

async function purchaseByPaymentIntent(piId: string | null | undefined): Promise<PurchaseRow | undefined> {
    if (!piId) return undefined;
    return getDb().getAsync<PurchaseRow>(
        'SELECT * FROM purchases WHERE stripe_payment_intent_id = ? ORDER BY created_at DESC LIMIT 1', piId,
    );
}

/** Newer Stripe APIs moved invoice.subscription under parent details. */
function invoiceSubscriptionId(inv: any): string | null {
    const direct = inv?.subscription;
    if (typeof direct === 'string') return direct;
    if (direct?.id) return direct.id;
    const parent = inv?.parent?.subscription_details?.subscription;
    if (typeof parent === 'string') return parent;
    return parent?.id || null;
}

export async function handleCommerceWebhookEvent(event: any): Promise<boolean> {
    const type: string = event?.type || '';
    const obj: any = event?.data?.object || {};
    const db = getDb();

    // ── Renewal: extend the subscription's entitlements to the new period ──
    if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
        const subId = invoiceSubscriptionId(obj);
        const purchase = await purchaseBySubscription(subId);
        if (!purchase) return false; // legacy invoice — let billing.ts handle it
        // A $0 proration/credit invoice is not a real renewal — don't extend on it.
        const amountPaid = Number(obj?.amount_paid ?? 0);
        if (amountPaid <= 0) return true;
        // Never re-activate a subscription that was refunded or cancelled — a
        // late/redelivered invoice for a prior period must not resurrect access.
        if (purchase.status === 'refunded' || purchase.status === 'canceled') return true;
        const sku = getSku(purchase.sku_id);
        if (sku) {
            const periodEnd: number | undefined = obj?.lines?.data?.[0]?.period?.end;
            const expiresAt = subscriptionExpiry(
                periodEnd ? { items: { data: [{ current_period_end: periodEnd }] } } : {},
            );
            await db.transactionAsync(async (tx) => {
                // Heal a purchase left 'pending' by a post-capture provisioning
                // failure in the inline path (charge_captured_retry): flip it
                // to succeeded here. Already-succeeded rows just get extended.
                await tx.run(
                    `UPDATE purchases SET status = 'succeeded', provision_status = 'provisioned', updated_at = ? WHERE id = ? AND status = 'pending'`,
                    nowIso(), purchase.id,
                );
                await provisionSkuEntitlements(tx, purchase.user_id, sku, subId as string, 'subscription', expiresAt);
            });
            await recomputeDerivedState(purchase.user_id);
        }
        return true;
    }

    // ── Renewal failed: no immediate revoke — expires_at already carries the
    //    grace window; Stripe keeps retrying, then fires subscription.deleted.
    if (type === 'invoice.payment_failed') {
        const purchase = await purchaseBySubscription(invoiceSubscriptionId(obj));
        if (!purchase) return false;
        console.warn(`[Commerce] renewal payment failed for purchase ${purchase.id} (grace window active)`);
        return true;
    }

    // ── Cancellation (user, admin, or Stripe dunning gave up) ──
    if (type === 'customer.subscription.deleted') {
        const purchase = await purchaseBySubscription(obj?.id);
        if (!purchase && obj?.metadata?.windy_commerce !== '1') return false;
        if (purchase) {
            const sku = getSku(purchase.sku_id);
            if (purchase.status === 'succeeded') {
                await db.runAsync("UPDATE purchases SET status = 'canceled', updated_at = ? WHERE id = ?", nowIso(), purchase.id);
            }
            await revokeBySource(
                obj.id,
                `Your ${sku?.name || 'plan'} subscription ended. Re-subscribe any time to get it back.`,
                purchase.user_id,
            );
        }
        return true;
    }

    // ── Refund / chargeback: revoke exactly what this payment granted ──
    if (type === 'charge.refunded' || type === 'charge.dispute.created') {
        const piId = typeof obj?.payment_intent === 'string' ? obj.payment_intent : obj?.payment_intent?.id;
        const purchase = await purchaseByPaymentIntent(piId);
        if (!purchase) return false;
        const sku = getSku(purchase.sku_id);
        await db.runAsync("UPDATE purchases SET status = 'refunded', updated_at = ? WHERE id = ?", nowIso(), purchase.id);
        await revokeBySource(
            purchase.stripe_subscription_id || purchase.id,
            `Your ${sku?.name || 'plan'} payment was refunded, so the plan switched off.`,
            purchase.user_id,
        );
        return true;
    }

    // ── Crash recovery: charge succeeded but the server died before the
    //    provisioning transaction — the PI metadata carries our purchase id.
    if (type === 'payment_intent.succeeded' && obj?.metadata?.windy_commerce === '1') {
        const purchaseId = obj.metadata.purchase_id;
        const purchase = purchaseId
            ? await db.getAsync<PurchaseRow>('SELECT * FROM purchases WHERE id = ?', purchaseId)
            : undefined;
        if (purchase && purchase.status === 'pending') {
            const sku = getSku(purchase.sku_id);
            if (sku) {
                // Only one_time SKUs stamp windy_commerce on the PI, so a
                // recovered PI is always a top-up — give it the same 30-day
                // expiry the inline path would have, not a forever grant.
                const expiresAt = sku.billing_mode === 'one_time' ? oneTimeTopupExpiry() : null;
                await db.transactionAsync(async (tx) => {
                    await tx.run(
                        `UPDATE purchases SET status = 'succeeded', stripe_payment_intent_id = ?, provision_status = 'provisioned', updated_at = ? WHERE id = ? AND status = 'pending'`,
                        obj.id, nowIso(), purchase.id,
                    );
                    await provisionSkuEntitlements(tx, purchase.user_id, sku, purchase.id, 'purchase', expiresAt);
                });
                await recomputeDerivedState(purchase.user_id);
            }
        }
        return true; // commerce PI either way — keep it away from legacy email-matching
    }

    if (type === 'payment_intent.payment_failed' && obj?.metadata?.windy_commerce === '1') {
        const purchaseId = obj.metadata.purchase_id;
        if (purchaseId) {
            await db.runAsync(
                "UPDATE purchases SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
                String(obj?.last_payment_error?.code || 'payment_failed').slice(0, 64), nowIso(), purchaseId,
            );
        }
        return true;
    }

    // Subscription create/update noise for commerce subs — consumed so the
    // legacy amount-map can't misfire on bundle amounts; state changes ride
    // the invoice/deleted events above.
    if ((type === 'customer.subscription.created' || type === 'customer.subscription.updated')
        && obj?.metadata?.windy_commerce === '1') {
        return true;
    }

    return false;
}
