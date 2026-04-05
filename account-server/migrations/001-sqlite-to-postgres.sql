-- ============================================================
--  Migration 001: SQLite to PostgreSQL
--  Windy Pro Account Server
--
--  This creates the full PostgreSQL schema equivalent to the
--  SQLite schema managed by src/db/schema.ts.
--
--  Run with: psql "$DATABASE_URL" -f 001-sqlite-to-postgres.sql
--
--  Safe to run multiple times (all statements use IF NOT EXISTS).
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT
);

-- Guard: skip if already applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '001') THEN
        RAISE NOTICE 'Migration 001 already applied, skipping.';
        RETURN;
    END IF;

    -- Record this migration
    INSERT INTO schema_migrations (version, description)
    VALUES ('001', 'Initial PostgreSQL schema — full parity with SQLite');
END $$;

-- ─── Core Tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Extended identity fields
    role TEXT DEFAULT 'user',
    stripe_customer_id TEXT,
    license_key TEXT,
    license_tier TEXT DEFAULT 'free',
    storage_used BIGINT DEFAULT 0,
    storage_limit BIGINT DEFAULT 524288000,
    frozen BOOLEAN DEFAULT false,
    identity_type TEXT DEFAULT 'human',
    phone TEXT,
    display_name TEXT,
    avatar_url TEXT,
    email_verified BOOLEAN DEFAULT false,
    phone_verified BOOLEAN DEFAULT false,
    passport_id TEXT,
    preferred_lang TEXT DEFAULT 'en',
    last_login_at TIMESTAMPTZ,
    windy_identity_id UUID DEFAULT gen_random_uuid()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_windy_identity_id
    ON users(windy_identity_id);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown',
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    type TEXT NOT NULL DEFAULT 'text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    translation_id UUID NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, translation_id)
);

CREATE TABLE IF NOT EXISTS recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    bundle_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    transcript_text TEXT NOT NULL DEFAULT '',
    transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    audio_path TEXT,
    video_path TEXT,
    quality_score INTEGER NOT NULL DEFAULT 0,
    quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    engine_used TEXT NOT NULL DEFAULT 'cloud-standard',
    source TEXT NOT NULL DEFAULT 'record',
    languages_json JSONB NOT NULL DEFAULT '["en"]'::jsonb,
    media_audio BOOLEAN NOT NULL DEFAULT true,
    media_video BOOLEAN NOT NULL DEFAULT false,
    file_path TEXT,
    file_size BIGINT NOT NULL DEFAULT 0,
    synced BOOLEAN NOT NULL DEFAULT false,
    synced_at TIMESTAMPTZ,
    clone_usable BOOLEAN NOT NULL DEFAULT false,
    clone_training_ready BOOLEAN DEFAULT false,
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    device_model TEXT,
    device_platform TEXT DEFAULT 'desktop',
    device_id TEXT,
    device_name TEXT,
    app_version TEXT,
    has_video BOOLEAN DEFAULT false,
    video_resolution TEXT,
    camera_source TEXT,
    sync_status TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_recordings_user ON recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_training ON recordings(clone_training_ready);
CREATE INDEX IF NOT EXISTS idx_recordings_synced ON recordings(synced);
CREATE INDEX IF NOT EXISTS idx_recordings_bundle ON recordings(bundle_id);

CREATE TABLE IF NOT EXISTS sync_queue (
    session_id TEXT PRIMARY KEY,
    queued_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT
);

-- ─── Cloud File Storage ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size BIGINT NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'transcript',
    session_date TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded ON files(uploaded_at);

-- ─── Billing ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    email TEXT DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    type TEXT NOT NULL DEFAULT 'one_time',
    status TEXT NOT NULL DEFAULT 'pending',
    stripe_payment_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 999,
    usage_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Token Blacklist ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS token_blacklist (
    token_hash TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Product Accounts ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    external_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(identity_id, product)
);
CREATE INDEX IF NOT EXISTS idx_product_accounts_identity ON product_accounts(identity_id);
CREATE INDEX IF NOT EXISTS idx_product_accounts_product ON product_accounts(product);

-- ─── Identity Scopes ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS identity_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by TEXT,
    UNIQUE(identity_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_identity_scopes_identity ON identity_scopes(identity_id);

-- ─── Identity Audit Log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS identity_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID,
    event TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_identity ON identity_audit_log(identity_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON identity_audit_log(event);
CREATE INDEX IF NOT EXISTS idx_audit_created ON identity_audit_log(created_at);

-- ─── Eternitas Passports ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eternitas_passports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    passport_number TEXT UNIQUE NOT NULL,
    operator_identity_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active',
    trust_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    birth_certificate JSONB NOT NULL DEFAULT '{}'::jsonb,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_passports_identity ON eternitas_passports(identity_id);
CREATE INDEX IF NOT EXISTS idx_passports_operator ON eternitas_passports(operator_identity_id);
CREATE INDEX IF NOT EXISTS idx_passports_status ON eternitas_passports(status);

-- ─── Bot API Keys ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    label TEXT,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_identity ON bot_api_keys(identity_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON bot_api_keys(key_hash);

-- ─── Secretary Consents ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS secretary_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT true,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_secretary_owner ON secretary_consents(owner_identity_id);
CREATE INDEX IF NOT EXISTS idx_secretary_bot ON secretary_consents(bot_identity_id);

-- ─── OAuth2 Clients ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT,
    name TEXT NOT NULL,
    redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    owner_identity_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_first_party BOOLEAN NOT NULL DEFAULT false,
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── OAuth2 Authorization Codes ─────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    state TEXT,
    code_challenge TEXT,
    code_challenge_method TEXT DEFAULT 'S256',
    used BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at);

-- ─── OAuth2 Consent Records ────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    scopes TEXT NOT NULL DEFAULT '',
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    UNIQUE(identity_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_consents_identity ON oauth_consents(identity_id);

-- ─── OAuth2 Device Codes ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_device_codes (
    device_code TEXT PRIMARY KEY,
    user_code TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT '',
    identity_id UUID,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_codes_user ON oauth_device_codes(user_code);

-- ─── Chat Profiles ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_profiles (
    identity_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_user_id TEXT UNIQUE,
    matrix_user_id TEXT UNIQUE,
    matrix_access_token TEXT,
    matrix_device_id TEXT,
    display_name TEXT,
    languages JSONB NOT NULL DEFAULT '["en"]'::jsonb,
    primary_language TEXT NOT NULL DEFAULT 'en',
    onboarding_complete BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── App Settings ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Clone Training Jobs ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clone_training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    status TEXT DEFAULT 'submitted',
    bundle_ids TEXT NOT NULL,
    cloud_job_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clone_jobs_user ON clone_training_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_clone_jobs_status ON clone_training_jobs(status);

-- ─── Pending Provisions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_provisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    action TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_provisions_retry ON pending_provisions(next_retry_at);
