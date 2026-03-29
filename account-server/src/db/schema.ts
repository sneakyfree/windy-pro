/**
 * Database schema — table creation and migrations.
 */
import Database from 'better-sqlite3';
import { config } from '../config';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}

function initSchema(db: Database.Database): void {
  // Core tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS translations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.85,
      type TEXT NOT NULL DEFAULT 'text',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      translation_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE,
      UNIQUE(user_id, translation_id)
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bundle_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_seconds REAL NOT NULL DEFAULT 0,
      transcript_text TEXT NOT NULL DEFAULT '',
      transcript_segments TEXT NOT NULL DEFAULT '[]',
      audio_path TEXT,
      video_path TEXT,
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_json TEXT NOT NULL DEFAULT '{}',
      engine_used TEXT NOT NULL DEFAULT 'cloud-standard',
      source TEXT NOT NULL DEFAULT 'record',
      languages_json TEXT NOT NULL DEFAULT '["en"]',
      media_audio INTEGER NOT NULL DEFAULT 1,
      media_video INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT,
      clone_usable INTEGER NOT NULL DEFAULT 0,
      clone_training_ready INTEGER DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      latitude REAL,
      longitude REAL,
      device_model TEXT,
      device_platform TEXT DEFAULT 'desktop',
      device_id TEXT,
      device_name TEXT,
      app_version TEXT,
      has_video INTEGER DEFAULT 0,
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
      queued_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    -- Cloud file storage (merged from cloud-storage service)
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'transcript',
      session_date TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_uploaded ON files(uploaded_at);

    -- Billing transactions (merged from cloud-storage service)
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      type TEXT NOT NULL DEFAULT 'one_time',
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_payment_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

    -- Coupons (merged from cloud-storage service)
    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      discount_percent INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 999,
      usage_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- SEC-M6: Token blacklist for logout invalidation
    CREATE TABLE IF NOT EXISTS token_blacklist (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe column migrations — silently skip if column already exists
  const migrations: string[] = [
    "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN license_key TEXT",
    "ALTER TABLE users ADD COLUMN license_tier TEXT DEFAULT 'free'",
    // Canonical recording columns that may be missing from old schemas
    "ALTER TABLE recordings ADD COLUMN device_id TEXT",
    "ALTER TABLE recordings ADD COLUMN device_name TEXT",
    "ALTER TABLE recordings ADD COLUMN source TEXT DEFAULT 'record'",
    "ALTER TABLE recordings ADD COLUMN languages_json TEXT DEFAULT '[\"en\"]'",
    "ALTER TABLE recordings ADD COLUMN media_audio INTEGER DEFAULT 1",
    "ALTER TABLE recordings ADD COLUMN media_video INTEGER DEFAULT 0",
    "ALTER TABLE recordings ADD COLUMN quality_score INTEGER DEFAULT 0",
    "ALTER TABLE recordings ADD COLUMN quality_json TEXT DEFAULT '{}'",
    "ALTER TABLE recordings ADD COLUMN engine_used TEXT DEFAULT 'cloud-standard'",
    "ALTER TABLE recordings ADD COLUMN synced INTEGER DEFAULT 0",
    "ALTER TABLE recordings ADD COLUMN synced_at TEXT",
    "ALTER TABLE recordings ADD COLUMN clone_usable INTEGER DEFAULT 0",
    "ALTER TABLE recordings ADD COLUMN tags_json TEXT DEFAULT '[]'",
    "ALTER TABLE recordings ADD COLUMN latitude REAL",
    "ALTER TABLE recordings ADD COLUMN longitude REAL",
    "ALTER TABLE recordings ADD COLUMN device_model TEXT",
    "ALTER TABLE recordings ADD COLUMN audio_path TEXT",
    "ALTER TABLE recordings ADD COLUMN video_path TEXT",
    // Cloud storage user fields
    "ALTER TABLE users ADD COLUMN storage_used INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN storage_limit INTEGER DEFAULT 524288000",
    "ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0",

    // ─── Unified Windy Identity (Phase 10.0) ───
    // These columns extend users into a full identity record.
    // All nullable with defaults so existing queries work unchanged.
    "ALTER TABLE users ADD COLUMN identity_type TEXT DEFAULT 'human'",      // 'human' | 'bot'
    "ALTER TABLE users ADD COLUMN phone TEXT",                               // E.164 format
    "ALTER TABLE users ADD COLUMN display_name TEXT",                        // Public display name
    "ALTER TABLE users ADD COLUMN avatar_url TEXT",                          // MXC or HTTPS URL
    "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0",         // 0 = unverified
    "ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0",         // 0 = unverified
    "ALTER TABLE users ADD COLUMN passport_id TEXT",                         // Eternitas passport (ET-XXXXX) for bots
    "ALTER TABLE users ADD COLUMN preferred_lang TEXT DEFAULT 'en'",         // ISO 639-1 language code
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",                       // Tracks login recency
  ];

  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // ─── Unified Identity: New Tables ───
  // These are additive — CREATE TABLE IF NOT EXISTS is safe.
  db.exec(`
    -- Product accounts: maps identities to ecosystem products
    -- One identity can have accounts across Windy Pro, Chat, Mail, etc.
    CREATE TABLE IF NOT EXISTS product_accounts (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      product TEXT NOT NULL,                          -- 'windy_pro' | 'windy_chat' | 'windy_mail' | 'windy_fly'
      external_id TEXT,                               -- Matrix user ID, email address, etc.
      status TEXT NOT NULL DEFAULT 'active',           -- 'active' | 'suspended' | 'pending' | 'deprovisioned'
      provisioned_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT NOT NULL DEFAULT '{}',             -- Product-specific JSON (tier, config, etc.)
      FOREIGN KEY (identity_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(identity_id, product)
    );
    CREATE INDEX IF NOT EXISTS idx_product_accounts_identity ON product_accounts(identity_id);
    CREATE INDEX IF NOT EXISTS idx_product_accounts_product ON product_accounts(product);

    -- Identity scopes: JWT scopes granted to each identity
    -- Enables per-product access control (e.g., windy_pro:read, windy_chat:write)
    CREATE TABLE IF NOT EXISTS identity_scopes (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      scope TEXT NOT NULL,                            -- 'windy_pro:*' | 'windy_chat:read' | 'admin:*', etc.
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      granted_by TEXT,                                -- Who/what granted this scope
      FOREIGN KEY (identity_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(identity_id, scope)
    );
    CREATE INDEX IF NOT EXISTS idx_identity_scopes_identity ON identity_scopes(identity_id);

    -- Identity audit log: tracks all authentication and identity events
    -- Required for security compliance and debugging
    CREATE TABLE IF NOT EXISTS identity_audit_log (
      id TEXT PRIMARY KEY,
      identity_id TEXT,                               -- Nullable for failed login attempts
      event TEXT NOT NULL,                            -- 'login' | 'register' | 'logout' | 'password_change' | 'scope_grant' | 'device_add' | 'token_refresh' | 'account_freeze' | 'passport_register' | 'passport_revoke'
      details TEXT NOT NULL DEFAULT '{}',             -- Event-specific JSON payload
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_identity ON identity_audit_log(identity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_event ON identity_audit_log(event);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON identity_audit_log(created_at);

    -- Eternitas passports: bot identity verification records
    -- Windy Fly agents registered through eternitas.ai get tracked here
    CREATE TABLE IF NOT EXISTS eternitas_passports (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      passport_number TEXT UNIQUE NOT NULL,            -- 'ET-XXXXX' format
      operator_identity_id TEXT,                       -- Human who owns/operates the bot
      status TEXT NOT NULL DEFAULT 'active',           -- 'active' | 'suspended' | 'revoked'
      trust_score REAL NOT NULL DEFAULT 1.0,           -- 0.0 to 1.0
      birth_certificate TEXT NOT NULL DEFAULT '{}',    -- Eternitas registration metadata
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (identity_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (operator_identity_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_passports_identity ON eternitas_passports(identity_id);
    CREATE INDEX IF NOT EXISTS idx_passports_operator ON eternitas_passports(operator_identity_id);
    CREATE INDEX IF NOT EXISTS idx_passports_status ON eternitas_passports(status);

    -- Bot API keys: long-lived keys for bot agents (Phase 3)
    -- Bots use API keys instead of JWTs — no browser-style refresh flow needed
    CREATE TABLE IF NOT EXISTS bot_api_keys (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,                    -- SHA-256 hash of the raw key
      key_prefix TEXT NOT NULL,                          -- First 11 chars for identification: "wk_xxxxxxxx"
      label TEXT,                                        -- Human-readable label
      scopes TEXT NOT NULL DEFAULT '[]',                 -- JSON array of granted scopes
      status TEXT NOT NULL DEFAULT 'active',              -- 'active' | 'revoked'
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      last_used_at TEXT,
      created_by TEXT NOT NULL,                           -- Identity that created this key
      FOREIGN KEY (identity_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_identity ON bot_api_keys(identity_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON bot_api_keys(key_hash);

    -- Secretary mode consents: explicit OAuth-style permission for bot-as-delegate email (Phase 3)
    -- Required for mail:secretary scope — the scope alone is not sufficient without recorded consent
    CREATE TABLE IF NOT EXISTS secretary_consents (
      id TEXT PRIMARY KEY,
      owner_identity_id TEXT NOT NULL,                   -- Human who grants consent
      bot_identity_id TEXT NOT NULL,                     -- Bot that receives consent
      active INTEGER NOT NULL DEFAULT 1,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (owner_identity_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (bot_identity_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_secretary_owner ON secretary_consents(owner_identity_id);
    CREATE INDEX IF NOT EXISTS idx_secretary_bot ON secretary_consents(bot_identity_id);

    -- Chat profiles: links Matrix accounts to Windy identities
    -- Bridge between account-server identity and Synapse Matrix account
    CREATE TABLE IF NOT EXISTS chat_profiles (
      identity_id TEXT PRIMARY KEY,
      chat_user_id TEXT UNIQUE,                        -- Internal chat user ID
      matrix_user_id TEXT UNIQUE,                      -- @windy_abc123:chat.windypro.com
      matrix_access_token TEXT,                        -- Encrypted Matrix access token
      matrix_device_id TEXT,
      display_name TEXT,
      languages TEXT NOT NULL DEFAULT '["en"]',        -- JSON array of ISO 639-1 codes
      primary_language TEXT NOT NULL DEFAULT 'en',
      onboarding_complete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (identity_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}
