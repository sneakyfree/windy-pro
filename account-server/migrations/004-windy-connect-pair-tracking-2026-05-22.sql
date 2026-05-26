-- =============================================================================
-- Migration 004: users.connect_paired_at + users.connect_bundle_version
-- =============================================================================
--
-- Wave E of the windy-connect E2E launch. When a user completes the
-- magic-link pair flow at api.windyconnect.com, the orchestrator Worker
-- POSTs /api/v1/identity/connect/paired (account-server side) which UPDATEs
-- these columns. The dashboard ecosystem-status route then surfaces
-- `windy_connect: { status: 'active' }` whenever connect_paired_at is recent.
--
-- "Recent" is defined as within the bundle TTL (30 days, per
-- windy-connect/docs/bundle-spec-v1.md). After 30 days the status drops back
-- to "available" until the user re-pairs — matches the bundle expiry that
-- already lives in the agent.
--
-- Run with: psql "$DATABASE_URL" -f 004-windy-connect-pair-tracking-2026-05-22.sql
--
-- Reversible: down-migration drops the two columns.
-- =============================================================================

BEGIN;

-- ─── 1. Add columns ─────────────────────────────────────────────
-- Both nullable; NULL means the user hasn't paired yet.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS connect_paired_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS connect_bundle_version TEXT;

-- ─── 2. Index for "active connections" dashboards ──────────────
-- Only index non-NULL rows; the vast majority of users haven't paired
-- so a partial index keeps the index size linear in paired users.
CREATE INDEX IF NOT EXISTS idx_users_connect_paired_at
  ON users(connect_paired_at)
  WHERE connect_paired_at IS NOT NULL;

-- ─── 3. Schema migrations record ────────────────────────────────
INSERT INTO schema_migrations (version, description)
SELECT '004', 'users.connect_paired_at + connect_bundle_version (Wave E windy-connect tile promote-to-active)'
 WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '004');

COMMIT;
