-- =============================================================================
-- Migration 004: oauth_identities (multi-provider OAuth linkage)
-- =============================================================================
--
-- Adds the oauth_identities table so a single Windy user can have multiple
-- third-party identity providers connected (Google, GitHub, Apple, Facebook,
-- ...). Lookup by (provider, provider_user_id) is the stable identifier;
-- email is captured only for audit/forensics.
--
-- Backfill: existing Google OAuth users (pre-this-migration) were linked
-- by email only and we don't have their `sub` recorded. Future Google
-- callbacks will INSERT OR IGNORE the linkage row on next sign-in, so the
-- backfill is lazy. No data is lost — the email-fallback path in the
-- helper still finds them.
--
-- Run with: psql "$DATABASE_URL" -f 004-oauth-identities-2026-05-24.sql
-- Reversible: DROP TABLE oauth_identities CASCADE;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_identities (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email_at_link TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_user
    ON oauth_identities(user_id);

INSERT INTO schema_migrations (version, description)
SELECT '004', 'oauth_identities table for multi-provider OAuth linkage'
 WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '004');

COMMIT;
