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
    ];

    for (const sql of migrations) {
        try { db.exec(sql); } catch { /* column already exists */ }
    }
}
