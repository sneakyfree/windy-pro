-- 009 — OAuth refresh-token client + scope binding (2026-07-19)
--
-- Binds each OAuth-issued refresh token to the client it was minted for and
-- the scope the user consented to. The refresh grant now:
--   * rejects a bound refresh token presented by a different client_id
--   * re-mints the originally consented scope instead of a blanket windy_pro:*
--
-- Rows with NULL client_id/scope are first-party /auth login tokens (or
-- pre-migration legacy rows) and keep their existing behavior.
--
-- Safe to apply while the old code is running: columns are nullable and the
-- old INSERT names its columns explicitly.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS scope TEXT;
