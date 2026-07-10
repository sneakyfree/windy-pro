-- ════════════════════════════════════════════════════════════════
--  007 — Commerce: unified wallet + server-driven catalog + entitlements
--  2026-07-10 · commerce/p1-wallet-catalog-entitlements
--
--  ⚠️ MANUAL MIGRATION (feedback_windy_pro_migrations_manual):
--  apply on prod via the pg container AFTER the PR merges, BEFORE the
--  account-server image that ships the wallet routes is recreated.
--  All statements are idempotent (IF NOT EXISTS / guarded ALTER).
--
--  New tables: catalog_skus, purchases, entitlements, license_activations
--  New column: users.cloud_tier_pushed
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- users: last cloud tier pushed to windy-cloud /api/v1/billing/allocate.
-- The entitlement sweep converges desired vs pushed (self-heals cloud outages).
ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_tier_pushed TEXT;

-- SKU catalog — prices + contents are server-driven (no client release).
CREATE TABLE IF NOT EXISTS catalog_skus (
    sku_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'bundle',                -- 'bundle' | 'alacarte'
    billing_mode TEXT NOT NULL DEFAULT 'subscription',  -- 'subscription' | 'one_time'
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    entitlements_json TEXT NOT NULL DEFAULT '{}',       -- {feature: limit_value}
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 100,
    stripe_product_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);

-- Purchases — idempotency guard (user_id, idempotency_key); entitlements
-- provision ONLY on status='succeeded'. Declines leave no partial state.
CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sku_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',             -- pending|succeeded|failed|refunded|canceled
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    stripe_payment_intent_id TEXT,
    stripe_subscription_id TEXT,
    error_code TEXT,
    provision_status TEXT NOT NULL DEFAULT 'none',      -- none|provisioned|cloud_retry
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_subscription ON purchases(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_purchases_payment_intent ON purchases(stripe_payment_intent_id);

-- Entitlements — the per-feature grants that gate cloud value everywhere.
CREATE TABLE IF NOT EXISTS entitlements (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,                              -- storage.bytes | stt.cloud_minutes | translate.chars | agent.messages | feature.<name>
    limit_value BIGINT NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'purchase',            -- purchase|subscription|admin_grant
    source_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',              -- active|expired|revoked
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    ended_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, feature, source_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_user_feature ON entitlements(user_id, feature, status);

-- License activations — 3-machine cap enforced AT activation; key-sharing
-- flagged for admin review (never auto-revoked; balanced anti-piracy).
CREATE TABLE IF NOT EXISTS license_activations (
    license_key TEXT NOT NULL,
    device_fingerprint TEXT NOT NULL,
    user_id UUID,
    device_name TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (license_key, device_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_license_activations_user ON license_activations(user_id);

-- Record the migration
INSERT INTO schema_migrations (version, description)
SELECT '007', 'commerce: catalog_skus + purchases + entitlements + license_activations + users.cloud_tier_pushed'
 WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '007');

COMMIT;
