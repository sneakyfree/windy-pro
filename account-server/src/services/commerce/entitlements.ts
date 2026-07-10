/**
 * Entitlements engine (P2) — what actually gates features everywhere.
 *
 * Invariants:
 *  - Entitlement rows are written ONLY inside the purchase-success
 *    transaction, a verified Stripe webhook, or an audited admin grant.
 *    A failed/declined payment never touches this table.
 *  - Every row carries source_id (purchase / subscription / admin action)
 *    so refunds and cancellations revoke exactly their own grants.
 *  - Derived state (users.storage_limit, windy-cloud tier) is RECOMPUTED
 *    from active rows, never incremented — expiry/revoke converge to the
 *    same numbers a fresh replay would produce.
 *  - Downgrade/expiry re-locks with a human-readable ended_reason that the
 *    client can show verbatim (grandma bar).
 */
import { randomUUID } from 'crypto';
import { getDb } from '../../db/schema';
import type { AsyncTxContext } from '../../db/adapter';
import { FEATURES, FeatureKey, featureSpec, cloudTierForStorageBytes, humanLimit } from './features';
import type { CatalogSku } from './catalog';
import { allocateCloudTier } from './cloud-provisioner';

// Mirrors billing.ts TIER_LIMITS — legacy tier→storage floors that predate
// entitlements. The recompute takes max(legacy floor, best entitlement).
const LEGACY_TIER_STORAGE: Record<string, number> = {
    free: 500 * 1024 * 1024,
    pro: 5 * 1024 * 1024 * 1024,
    translate: 10 * 1024 * 1024 * 1024,
    'translate-pro': 50 * 1024 * 1024 * 1024,
    translate_pro: 50 * 1024 * 1024 * 1024,
};

const nowIso = () => new Date().toISOString();

export interface EntitlementRow {
    id: string;
    user_id: string;
    feature: string;
    limit_value: number;
    source: string;
    source_id: string;
    status: string;
    starts_at: string;
    expires_at: string | null;
    ended_reason: string | null;
}

// ─── Provisioning (called ONLY from purchase-success tx / webhook / admin) ──

/**
 * Upsert the SKU's entitlement rows for a user inside the caller's
 * transaction context. Renewals (same user/feature/source_id) extend
 * expires_at instead of duplicating.
 */
export async function provisionSkuEntitlements(
    tx: AsyncTxContext,
    userId: string,
    sku: CatalogSku,
    sourceId: string,
    source: 'purchase' | 'subscription',
    expiresAt: string | null,
): Promise<void> {
    for (const [feature, limit] of Object.entries(sku.entitlements)) {
        const existing = await tx.get<EntitlementRow>(
            'SELECT * FROM entitlements WHERE user_id = ? AND feature = ? AND source_id = ?',
            userId, feature, sourceId,
        );
        if (existing) {
            await tx.run(
                `UPDATE entitlements SET limit_value = ?, status = 'active', expires_at = ?, ended_reason = NULL, updated_at = ? WHERE id = ?`,
                limit, expiresAt, nowIso(), existing.id,
            );
        } else {
            await tx.run(
                `INSERT INTO entitlements (id, user_id, feature, limit_value, source, source_id, status, starts_at, expires_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
                randomUUID(), userId, feature, limit, source, sourceId, nowIso(), expiresAt, nowIso(), nowIso(),
            );
        }
    }
}

/** Audited admin grant/comp (P5). Returns the created row ids. */
export function adminGrantEntitlement(
    userId: string,
    feature: FeatureKey,
    limitValue: number,
    adminActionId: string,
    expiresAt: string | null,
): string {
    const db = getDb();
    const id = randomUUID();
    db.run(
        `INSERT INTO entitlements (id, user_id, feature, limit_value, source, source_id, status, starts_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin_grant', ?, 'active', ?, ?, ?, ?)`,
        id, userId, feature, limitValue, adminActionId, nowIso(), expiresAt, nowIso(), nowIso(),
    );
    return id;
}

// ─── Revocation / expiry ────────────────────────────────────────────────────

/** Revoke every active grant from one source (refund / cancellation / admin). */
export async function revokeBySource(sourceId: string, reason: string): Promise<string[]> {
    const db = getDb();
    const rows = await db.allAsync<EntitlementRow>(
        "SELECT * FROM entitlements WHERE source_id = ? AND status = 'active'", sourceId,
    );
    for (const row of rows) {
        await db.runAsync(
            "UPDATE entitlements SET status = 'revoked', ended_reason = ?, updated_at = ? WHERE id = ?",
            reason, nowIso(), row.id,
        );
    }
    const users = [...new Set(rows.map(r => r.user_id))];
    for (const userId of users) await recomputeDerivedState(userId);
    return users;
}

/**
 * Expiry sweep — marks past-due rows expired with a friendly reason, then
 * recomputes derived state (which also converges the cloud tier). Run from
 * the maintenance timer AND opportunistically before entitlement reads.
 */
export async function expireDueEntitlements(): Promise<number> {
    const db = getDb();
    const due = await db.allAsync<EntitlementRow>(
        "SELECT * FROM entitlements WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?",
        nowIso(),
    );
    for (const row of due) {
        const spec = featureSpec(row.feature);
        const reason = `Your ${spec.label} plan ended on ${(row.expires_at || '').slice(0, 10)}. Renew any time to get ${humanLimit(row.feature, row.limit_value)} back.`;
        await db.runAsync(
            "UPDATE entitlements SET status = 'expired', ended_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'",
            reason, nowIso(), row.id,
        );
    }
    for (const userId of [...new Set(due.map(r => r.user_id))]) {
        await recomputeDerivedState(userId);
    }
    return due.length;
}

// ─── Effective state ────────────────────────────────────────────────────────

/** Active, unexpired rows for a user (opportunistically ignores stale ones). */
export function activeEntitlements(userId: string): EntitlementRow[] {
    return getDb().all<EntitlementRow>(
        "SELECT * FROM entitlements WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= ?) ORDER BY feature, created_at",
        userId, nowIso(),
    );
}

/** feature → effective limit (free baseline + max/sum of active grants). */
export function effectiveLimits(userId: string): Record<string, number> {
    const rows = activeEntitlements(userId);
    const out: Record<string, number> = {};
    for (const [feature, spec] of Object.entries(FEATURES)) out[feature] = spec.freeLimit;
    for (const row of rows) {
        const spec = featureSpec(row.feature);
        const base = out[row.feature] ?? spec.freeLimit;
        out[row.feature] = spec.resolution === 'sum'
            ? base + Number(row.limit_value)
            : Math.max(base, Number(row.limit_value));
    }
    return out;
}

/**
 * Recompute derived gates from active entitlements:
 *  - users.storage_limit (account-server's own 413 storage gate)
 *  - windy-cloud tier via /billing/allocate (its 507 quota gate), converged
 *    against users.cloud_tier_pushed so retries self-heal cloud outages.
 */
export async function recomputeDerivedState(userId: string): Promise<{ storageLimit: number; cloudTier: string; cloudPushed: boolean }> {
    const db = getDb();
    const user = await db.getAsync<any>('SELECT id, tier, windy_identity_id, cloud_tier_pushed FROM users WHERE id = ?', userId);
    if (!user) return { storageLimit: 0, cloudTier: 'free', cloudPushed: false };

    const limits = effectiveLimits(userId);
    const legacyFloor = LEGACY_TIER_STORAGE[user.tier] ?? LEGACY_TIER_STORAGE.free;
    const storageLimit = Math.max(legacyFloor, limits['storage.bytes'] ?? 0);
    await db.runAsync('UPDATE users SET storage_limit = ? WHERE id = ?', storageLimit, userId);

    const cloudTier = cloudTierForStorageBytes(limits['storage.bytes'] ?? 0);
    let cloudPushed = false;
    if (user.cloud_tier_pushed !== cloudTier) {
        cloudPushed = await allocateCloudTier(user.windy_identity_id || userId, cloudTier);
        if (cloudPushed) {
            await db.runAsync('UPDATE users SET cloud_tier_pushed = ? WHERE id = ?', cloudTier, userId);
        }
    } else {
        cloudPushed = true;
    }
    return { storageLimit, cloudTier, cloudPushed };
}

/** Users whose desired cloud tier hasn't been pushed yet (sweep retry). */
export async function retryPendingCloudPushes(): Promise<number> {
    const db = getDb();
    // Cheap prefilter: anyone with an active storage entitlement or a stale push marker.
    const candidates = await db.allAsync<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM entitlements WHERE feature = 'storage.bytes'`,
    );
    let retried = 0;
    for (const { user_id } of candidates) {
        const user = await db.getAsync<any>('SELECT id, tier, windy_identity_id, cloud_tier_pushed FROM users WHERE id = ?', user_id);
        if (!user) continue;
        const limits = effectiveLimits(user_id);
        const desired = cloudTierForStorageBytes(limits['storage.bytes'] ?? 0);
        if (user.cloud_tier_pushed !== desired) {
            const ok = await allocateCloudTier(user.windy_identity_id || user_id, desired);
            if (ok) {
                await db.runAsync('UPDATE users SET cloud_tier_pushed = ? WHERE id = ?', desired, user_id);
                retried++;
            }
        }
    }
    return retried;
}

// ─── Human-readable status (the re-lock message surface) ───────────────────

export function entitlementStatus(userId: string) {
    const limits = effectiveLimits(userId);
    const active = activeEntitlements(userId);
    const db = getDb();
    // Most recent ended grant per feature → the re-lock message.
    const ended = db.all<EntitlementRow>(
        "SELECT * FROM entitlements WHERE user_id = ? AND status IN ('expired','revoked') ORDER BY updated_at DESC",
        userId,
    );
    const endedByFeature: Record<string, EntitlementRow> = {};
    for (const row of ended) if (!endedByFeature[row.feature]) endedByFeature[row.feature] = row;

    const features = Object.entries(limits).map(([feature, limit]) => {
        const spec = featureSpec(feature);
        const grants = active.filter(r => r.feature === feature);
        const onFreeBaseline = grants.length === 0;
        const soonest = grants.map(g => g.expires_at).filter(Boolean).sort()[0] || null;
        return {
            feature,
            label: spec.label,
            limit,
            limit_human: humanLimit(feature, limit),
            unit: spec.unit,
            on_free_tier: onFreeBaseline,
            expires_at: soonest,
            // Grandma-readable: why did this re-lock (only when it did)
            message: onFreeBaseline && endedByFeature[feature]
                ? endedByFeature[feature].ended_reason
                : null,
        };
    });
    // Boolean flags the free map doesn't know about (feature.<name> grants).
    for (const row of active) {
        if (!(row.feature in limits)) {
            features.push({
                feature: row.feature,
                label: featureSpec(row.feature).label,
                limit: Number(row.limit_value),
                limit_human: humanLimit(row.feature, Number(row.limit_value)),
                unit: 'flag',
                on_free_tier: false,
                expires_at: row.expires_at,
                message: null,
            });
        }
    }
    return { features, computed_at: nowIso() };
}
