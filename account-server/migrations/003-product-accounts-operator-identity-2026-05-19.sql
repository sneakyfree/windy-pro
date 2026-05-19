-- =============================================================================
-- Migration 003: product_accounts.operator_identity_id (ADR-050)
-- =============================================================================
--
-- Adds the operator_identity_id column to product_accounts to capture the
-- human-vs-agent provisioning relationship that today's hatch ceremony
-- writes inconsistently. See ADR-050 for the 3-category taxonomy and full
-- rationale.
--
-- Run with: psql "$DATABASE_URL" -f 003-product-accounts-operator-identity-2026-05-19.sql
--
-- Reversible: down-migration drops the column + index.
-- =============================================================================

BEGIN;

-- ─── 1. Add column ──────────────────────────────────────────────
-- Nullable + ON DELETE SET NULL because not all rows have an operator
-- (Category 1 and 3 products keep this NULL).
ALTER TABLE product_accounts
  ADD COLUMN IF NOT EXISTS operator_identity_id UUID
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_accounts_operator
  ON product_accounts(operator_identity_id)
  WHERE operator_identity_id IS NOT NULL;

-- ─── 2. Backfill from eternitas_passports ───────────────────────
-- For every product_accounts row where identity_id refers to a bot that has
-- an Eternitas passport with an operator, copy the operator_identity_id over.
-- Covers Category 2 'eternitas' rows fully + 'windy_mail' rows whose bot has
-- an Eternitas passport (which is the common case for hatched agents).

UPDATE product_accounts pa
   SET operator_identity_id = ep.operator_identity_id
  FROM eternitas_passports ep
 WHERE pa.identity_id = ep.identity_id
   AND ep.operator_identity_id IS NOT NULL
   AND pa.operator_identity_id IS NULL
   AND pa.product IN ('eternitas', 'windy_mail');

-- ─── 3. Backfill from hatch_sessions ────────────────────────────
-- For windy_mail rows on bot identities that aren't covered by the passport
-- join above, fall back to hatch_sessions which records the operator via
-- windy_identity_id. This covers historic hatches where the bot's passport
-- row may have been written separately.

UPDATE product_accounts pa
   SET operator_identity_id = u.id
  FROM hatch_sessions hs
  JOIN users u ON u.windy_identity_id::text = hs.windy_identity_id
 WHERE pa.product = 'windy_mail'
   AND pa.identity_id::text = hs.bot_identity_id
   AND hs.bot_identity_id IS NOT NULL
   AND pa.operator_identity_id IS NULL;

-- ─── 4. Verification queries (idempotent, safe to re-run) ──────
-- Count rows that now have operator_identity_id populated.
-- Expected after first run: at least 1 row per hatched agent.
DO $$
DECLARE
  populated_count INTEGER;
  null_eternitas INTEGER;
  null_mail INTEGER;
BEGIN
  SELECT COUNT(*) INTO populated_count
    FROM product_accounts
   WHERE operator_identity_id IS NOT NULL;

  SELECT COUNT(*) INTO null_eternitas
    FROM product_accounts
   WHERE product = 'eternitas' AND operator_identity_id IS NULL;

  SELECT COUNT(*) INTO null_mail
    FROM product_accounts
   WHERE product = 'windy_mail' AND operator_identity_id IS NULL;

  RAISE NOTICE 'product_accounts operator_identity_id populated: %', populated_count;
  RAISE NOTICE 'product_accounts eternitas rows still NULL operator: %', null_eternitas;
  RAISE NOTICE 'product_accounts windy_mail rows still NULL operator: %', null_mail;
  RAISE NOTICE 'NULL rows above are historic data without discoverable operator — manually backfillable if ownership known.';
END $$;

-- ─── 5. Schema migrations record ────────────────────────────────
-- Mirror the convention from 001 + 002.
INSERT INTO schema_migrations (version, description)
SELECT '003', 'product_accounts.operator_identity_id per ADR-050 (human-vs-agent identity model)'
 WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '003');

COMMIT;
