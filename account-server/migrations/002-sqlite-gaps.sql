-- ============================================================
--  Migration 002: tables missing from 001 for PostgreSQL parity
--
--  schema.ts (SQLite path) creates several tables in the core
--  init-schema block that were never ported to the 001 migration.
--  Phase 1 prod boot against RDS failed smoke-login with:
--    relation "mfa_secrets" does not exist
--  and the webhook-bus worker spins every 30s logging
--    relation "webhook_deliveries" does not exist
--
--  All CREATEs are IF NOT EXISTS so re-running is safe.
-- ============================================================

-- analytics_events — /api/v1/analytics insert-only log
CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    user_id TEXT,
    properties TEXT,
    created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_event   ON analytics_events(event);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_user    ON analytics_events(user_id);

-- mfa_secrets — TOTP + backup codes per user.
-- user_id matches 001's users.id type (UUID). pg coerces string inputs.
CREATE TABLE IF NOT EXISTS mfa_secrets (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    totp_secret_encrypted TEXT NOT NULL,
    totp_secret_iv TEXT NOT NULL,
    totp_secret_tag TEXT NOT NULL,
    backup_codes_hash TEXT NOT NULL DEFAULT '[]',
    enabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

-- otp_codes — email-verify + password-reset one-time codes
CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_otp_user_purpose ON otp_codes(user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_expires      ON otp_codes(expires_at);

-- webhook_deliveries — identity fan-out bus (PR4)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    target TEXT NOT NULL,
    target_url TEXT NOT NULL,
    payload TEXT NOT NULL,
    signature TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    delivered_at TEXT,
    dead_lettered_at TEXT,
    last_error TEXT,
    identity_id TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_due
    ON webhook_deliveries(next_attempt_at)
    WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_identity ON webhook_deliveries(identity_id);
CREATE INDEX IF NOT EXISTS idx_webhook_event    ON webhook_deliveries(event_type);

-- ── Wave 8 broker tables ─────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_tokens (
    id TEXT PRIMARY KEY,
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    passport_number TEXT,
    token_hash TEXT UNIQUE NOT NULL,
    token_prefix TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'llm:chat',
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    plan_tier TEXT NOT NULL DEFAULT 'free',
    issued_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
    expires_at TEXT NOT NULL,
    usage_cap_tokens INTEGER NOT NULL DEFAULT 100000,
    usage_tokens INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    revoked_at TEXT,
    revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_broker_tokens_identity ON broker_tokens(identity_id);
CREATE INDEX IF NOT EXISTS idx_broker_tokens_hash     ON broker_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_broker_tokens_passport ON broker_tokens(passport_number);
CREATE INDEX IF NOT EXISTS idx_broker_tokens_expires  ON broker_tokens(expires_at);

CREATE TABLE IF NOT EXISTS broker_revocations (
    id TEXT PRIMARY KEY,
    identity_id TEXT,
    passport_number TEXT,
    token_hash TEXT,
    reason_hash TEXT NOT NULL,
    cascade INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_broker_revocations_identity ON broker_revocations(identity_id);
CREATE INDEX IF NOT EXISTS idx_broker_revocations_passport ON broker_revocations(passport_number);

CREATE TABLE IF NOT EXISTS hatch_sessions (
    id TEXT PRIMARY KEY,
    windy_identity_id TEXT NOT NULL,
    bot_identity_id TEXT,
    agent_name TEXT,
    passport_number TEXT,
    broker_token_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    last_event_seq INTEGER NOT NULL DEFAULT 0,
    events TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
    completed_at TEXT,
    UNIQUE(windy_identity_id)
);
CREATE INDEX IF NOT EXISTS idx_hatch_sessions_identity ON hatch_sessions(windy_identity_id);
CREATE INDEX IF NOT EXISTS idx_hatch_sessions_status   ON hatch_sessions(status);

INSERT INTO schema_migrations (version, description)
SELECT '002', 'Port remaining SQLite-only tables (mfa, otp, webhook, analytics, Wave 8 broker)'
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '002');
