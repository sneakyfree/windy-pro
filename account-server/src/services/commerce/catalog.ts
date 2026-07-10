/**
 * Server-driven SKU catalog (P2).
 *
 * Prices + bundle contents live in the catalog_skus table and are editable
 * via the admin API — clients render whatever this returns, so pricing
 * changes never need a client release. Seeded once (only when empty) with
 * the launch proposal; every seeded number is FLAGGED FOR GRANT in the
 * commercial-engine report and adjustable in place.
 *
 * Grandma bar: bundles are the hero (one price, one button); à-la-carte SKUs
 * exist as a power-user escape hatch and sort after the bundles.
 */
import { getDb } from '../../db/schema';
import { FEATURES, GB, FeatureKey, featureSpec, humanLimit } from './features';

export interface CatalogSku {
    sku_id: string;
    kind: 'bundle' | 'alacarte';
    billing_mode: 'subscription' | 'one_time';
    price_cents: number;
    currency: string;
    name: string;
    description: string;
    entitlements: Record<FeatureKey, number>;
    active: boolean;
    sort_order: number;
    stripe_product_id: string | null;
}

// ─── Launch seed (PROPOSED amounts — Grant's prices, my per-tier contents) ──
// COGS anchors: R2 ≈ $0.015/GB-mo; cloud STT ≈ $0.005/min; agent msg ≈ $0.2¢.
const SEED_SKUS: Array<Omit<CatalogSku, 'stripe_product_id' | 'active'>> = [
    {
        sku_id: 'bundle_breeze',
        kind: 'bundle',
        billing_mode: 'subscription',
        price_cents: 500,
        currency: 'usd',
        name: 'Breeze',
        description: '100 GB cloud storage, 300 cloud transcription minutes, 200,000 translation characters, and 500 agent messages every month.',
        entitlements: { 'storage.bytes': 100 * GB, 'stt.cloud_minutes': 300, 'translate.chars': 200000, 'agent.messages': 500 },
        sort_order: 10,
    },
    {
        sku_id: 'bundle_gale',
        kind: 'bundle',
        billing_mode: 'subscription',
        price_cents: 2000,
        currency: 'usd',
        name: 'Gale',
        description: '1 TB cloud storage, 1,500 cloud transcription minutes, 2 million translation characters, and 3,000 agent messages every month.',
        entitlements: { 'storage.bytes': 1024 * GB, 'stt.cloud_minutes': 1500, 'translate.chars': 2000000, 'agent.messages': 3000 },
        sort_order: 20,
    },
    {
        sku_id: 'bundle_storm',
        kind: 'bundle',
        billing_mode: 'subscription',
        price_cents: 5000,
        currency: 'usd',
        name: 'Storm',
        description: '5 TB cloud storage, 6,000 cloud transcription minutes, 10 million translation characters, and 12,000 agent messages every month.',
        entitlements: { 'storage.bytes': 5 * 1024 * GB, 'stt.cloud_minutes': 6000, 'translate.chars': 10000000, 'agent.messages': 12000 },
        sort_order: 30,
    },
    // À-la-carte escape hatch — never the default surface.
    {
        sku_id: 'alacarte_storage_100gb',
        kind: 'alacarte',
        billing_mode: 'subscription',
        price_cents: 300,
        currency: 'usd',
        name: 'Cloud Storage 100 GB',
        description: '100 GB of Windy Cloud storage, nothing else.',
        entitlements: { 'storage.bytes': 100 * GB },
        sort_order: 110,
    },
    {
        sku_id: 'alacarte_storage_1tb',
        kind: 'alacarte',
        billing_mode: 'subscription',
        price_cents: 1000,
        currency: 'usd',
        name: 'Cloud Storage 1 TB',
        description: '1 TB of Windy Cloud storage, nothing else.',
        entitlements: { 'storage.bytes': 1024 * GB },
        sort_order: 120,
    },
    {
        sku_id: 'alacarte_stt_600',
        kind: 'alacarte',
        billing_mode: 'one_time',
        price_cents: 500,
        currency: 'usd',
        name: 'Transcription Top-up',
        description: '600 extra cloud transcription minutes (30-day top-up).',
        entitlements: { 'stt.cloud_minutes': 600 },
        sort_order: 130,
    },
    {
        sku_id: 'alacarte_translate_1m',
        kind: 'alacarte',
        billing_mode: 'subscription',
        price_cents: 400,
        currency: 'usd',
        name: 'Translation 1M',
        description: '1 million cloud translation characters every month.',
        entitlements: { 'translate.chars': 1000000 },
        sort_order: 140,
    },
];

/** Idempotent: seeds only when the table is empty (server-driven after that). */
export function seedCatalogIfEmpty(): void {
    const db = getDb();
    const count = (db.get<{ n: number }>('SELECT COUNT(*) as n FROM catalog_skus') || { n: 0 }).n;
    if (count > 0) return;
    for (const sku of SEED_SKUS) {
        db.run(
            `INSERT INTO catalog_skus (sku_id, kind, billing_mode, price_cents, currency, name, description, entitlements_json, active, sort_order, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            sku.sku_id, sku.kind, sku.billing_mode, sku.price_cents, sku.currency,
            sku.name, sku.description, JSON.stringify(sku.entitlements), 1, sku.sort_order, 'seed',
        );
    }
    console.log(`🛒 Commerce catalog seeded (${SEED_SKUS.length} SKUs — amounts flagged for Grant)`);
}

function rowToSku(row: any): CatalogSku {
    let entitlements: Record<string, number> = {};
    try { entitlements = JSON.parse(row.entitlements_json || '{}'); } catch { /* leave empty */ }
    return {
        sku_id: row.sku_id,
        kind: row.kind,
        billing_mode: row.billing_mode,
        price_cents: row.price_cents,
        currency: row.currency,
        name: row.name,
        description: row.description,
        entitlements,
        active: !!row.active && row.active !== 'false',
        sort_order: row.sort_order,
        stripe_product_id: row.stripe_product_id || null,
    };
}

export function getSku(skuId: string): CatalogSku | undefined {
    const row = getDb().get('SELECT * FROM catalog_skus WHERE sku_id = ?', skuId);
    return row ? rowToSku(row) : undefined;
}

export function listSkus(includeInactive = false): CatalogSku[] {
    const rows = includeInactive
        ? getDb().all('SELECT * FROM catalog_skus ORDER BY sort_order ASC')
        : getDb().all('SELECT * FROM catalog_skus WHERE active = 1 ORDER BY sort_order ASC');
    return rows.map(rowToSku);
}

/** The public catalog payload: bundles first, free caps included. */
export function publicCatalog() {
    const skus = listSkus().map(sku => ({
        sku_id: sku.sku_id,
        kind: sku.kind,
        billing_mode: sku.billing_mode,
        price_cents: sku.price_cents,
        currency: sku.currency,
        name: sku.name,
        description: sku.description,
        entitlements: sku.entitlements,
        entitlements_human: Object.fromEntries(
            Object.entries(sku.entitlements).map(([f, v]) => [f, humanLimit(f, v)]),
        ),
    }));
    return {
        bundles: skus.filter(s => s.kind === 'bundle'),
        alacarte: skus.filter(s => s.kind === 'alacarte'),
        free_tier: Object.fromEntries(
            Object.entries(FEATURES).map(([f, spec]) => [f, { limit: spec.freeLimit, human: humanLimit(f, spec.freeLimit), label: spec.label }]),
        ),
    };
}

/** Admin upsert — price/content changes are data edits, never releases. */
export function upsertSku(sku: Partial<CatalogSku> & { sku_id: string }, updatedBy: string): CatalogSku {
    const db = getDb();
    const existing = getSku(sku.sku_id);
    if (existing) {
        const merged = { ...existing, ...sku, entitlements: sku.entitlements ?? existing.entitlements };
        db.run(
            `UPDATE catalog_skus SET kind = ?, billing_mode = ?, price_cents = ?, currency = ?, name = ?, description = ?,
             entitlements_json = ?, active = ?, sort_order = ?, updated_at = ?, updated_by = ? WHERE sku_id = ?`,
            merged.kind, merged.billing_mode, merged.price_cents, merged.currency, merged.name, merged.description,
            JSON.stringify(merged.entitlements), merged.active ? 1 : 0, merged.sort_order,
            new Date().toISOString(), updatedBy, sku.sku_id,
        );
        return getSku(sku.sku_id)!;
    }
    if (sku.price_cents == null || !sku.name) {
        throw new Error('New SKU requires price_cents and name');
    }
    db.run(
        `INSERT INTO catalog_skus (sku_id, kind, billing_mode, price_cents, currency, name, description, entitlements_json, active, sort_order, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sku.sku_id, sku.kind || 'alacarte', sku.billing_mode || 'subscription', sku.price_cents,
        sku.currency || 'usd', sku.name, sku.description || '', JSON.stringify(sku.entitlements || {}),
        sku.active === false ? 0 : 1, sku.sort_order ?? 100, updatedBy,
    );
    return getSku(sku.sku_id)!;
}

export function setSkuStripeProduct(skuId: string, productId: string): void {
    getDb().run('UPDATE catalog_skus SET stripe_product_id = ? WHERE sku_id = ?', productId, skuId);
}

// Re-export for callers that need the spec helpers alongside the catalog.
export { featureSpec };
