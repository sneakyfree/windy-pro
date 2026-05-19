# Account Server — Conventions

## Branching policy

Inherits from `~/windy-pro/CLAUDE.md`. Feature branches + PR review for production code paths.

## Database schema

- **Local dev:** SQLite via `better-sqlite3` (`src/db/sqlite-adapter.ts`). Schema bootstraps at startup via `src/db/schema.ts`.
- **Prod:** PostgreSQL via `pg` (`src/db/postgres-adapter.ts`). Schema lives in `src/db/postgres-schema.sql`; migrations applied manually via `migrations/NNN-*.sql`.
- **Both schemas must stay in sync.** If you add a column, edit BOTH `src/db/schema.ts` (CREATE TABLE + ALTER TABLE migrations array) AND `src/db/postgres-schema.sql` (CREATE TABLE only — Postgres prod requires a numbered migration file in `migrations/` for the ADD COLUMN).

## product_accounts identity model (ADR-050)

**REQUIRED READING before any code that writes a `product_accounts` row.**

Each row in `product_accounts` falls into one of THREE categories based on the relationship between the row's data and the user identities involved. Pick the right category before writing.

### Category 1 — Human-direct products

The human user is the direct holder; no agent involved.

- **Examples:** `windy_pro` (the account itself), `windy_cloud`, `windy_clone`, `windy_traveler`, `windy_code`, `windy_mind`, `windy_search`
- **Write pattern:**
  ```typescript
  INSERT INTO product_accounts (identity_id, operator_identity_id, product, ...)
  VALUES (humanUserId, NULL, '<product>', ...)
  ```
- **Read pattern:** `WHERE identity_id = humanUserId`

### Category 2 — Bot-held products

The bot is the direct holder of the resource (mailbox, passport, chat handle), with a human operator above.

- **Examples:** `windy_mail` (mailbox belongs to bot), `eternitas` (passport belongs to bot), `windy_chat` for bot agents (Matrix handle belongs to bot)
- **Write pattern:**
  ```typescript
  INSERT INTO product_accounts (identity_id, operator_identity_id, product, external_id, ...)
  VALUES (botUserId, operatorHumanUserId, '<product>', <bot's resource>, ...)
  ```
- **Bot-side read:** `WHERE identity_id = botUserId` (trust gates, agent self-introspection)
- **Operator-side read:** `WHERE identity_id = humanUserId OR operator_identity_id = humanUserId` (dashboard, quota aggregation)

### Category 3 — Operator-of-agent products

The row represents the human operator's *relationship to* an agent, not something the agent owns.

- **Example:** `windy_fly` — "this human operates this agent"
- **Write pattern:**
  ```typescript
  INSERT INTO product_accounts (identity_id, operator_identity_id, product, external_id, metadata, ...)
  VALUES (humanUserId, NULL, 'windy_fly', botUserId, JSON.stringify({...bot info...}), ...)
  ```
- **Read pattern:** `WHERE identity_id = humanUserId`

### Decision tree for new products

When adding a new product that needs a `product_accounts` row, ask:

1. **Does a bot OWN the resource directly?** (mailbox, passport, chat handle, etc.)
   → **Category 2**. `identity_id = bot`, `operator_identity_id = human`.
2. **Does the row describe a relationship between operator and agent?** (e.g., agent-spawn marker)
   → **Category 3**. `identity_id = human`, `operator_identity_id = NULL`, `external_id = bot_id`.
3. **Otherwise** (human-direct product like account, storage, app license)
   → **Category 1**. `identity_id = human`, `operator_identity_id = NULL`.

### Why this matters

Today's hatch ceremony (pre-ADR-050) wrote inconsistent data: Fly→Category 3, Mail+Eternitas→Category 2, Chat→Category 2. The morning's SoT-derivation pattern (PR #124) read inconsistent results because of it. ADR-050 locks the write-side; the operator-aware read pattern from PR #128 + #129 already handles the read side.

**Tests:** any new `product_accounts.<new_product>` write must include a contract test verifying the right Category. Add to `tests/contract-ecosystem.test.ts` `requiredProducts` list.

## Related ADRs

- ADR-026 — Trust Gate Philosophy (Eternitas-SoT invariant; this convention is its data-layer manifestation)
- ADR-049 — Pricing Tier Commitment (per-tier quotas key off product_accounts; consistent identity_id matters)
- ADR-050 — product_accounts Identity Model (THIS convention's canonical doc)

## Tests

- `npm test` — full Jest suite
- `npx jest tests/contract-ecosystem.test.ts` — ecosystem-status contract (10 tests)
- `npx tsc --noEmit` — type checking
