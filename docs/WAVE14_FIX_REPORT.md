# Wave 14 overnight fix report

**Run:** overnight of 2026-04-19 → 2026-04-20
**Scope:** P0 + P1 findings in `docs/SMOKE_REPORT_2026-04-19.md`
**Mode:** autonomous, admin-merge pattern per Wave 12 playbook because CI runner-pickup was blocked on the cloud repo by a GitHub billing issue (not a Claude choice — the runners refused to start).

---

## Scoreboard

| Smoke finding | Sev | PR | Merged into | Status |
|---|---|---|---|---|
| P0-1 `/forgot-password` leaks `_devToken` + RESEND fail-closed | 🟥 P0 | [sneakyfree/windy-pro#48](https://github.com/sneakyfree/windy-pro/pull/48) | `cfa2c7d` on `main` | ✅ merged |
| P0-2 `GET /` returns "Cannot GET /" 404 | 🟥 P0 | [sneakyfree/windy-pro#49](https://github.com/sneakyfree/windy-pro/pull/49) | `238b96b` on `main` | ✅ merged |
| P1-1 windy-cloud JWKS URL wrong (apex 401-gated) | 🟧 P1 | [sneakyfree/WindyCloud#39](https://github.com/sneakyfree/WindyCloud/pull/39) | `f1a05fa` on `main` | ✅ merged |
| P1-2 `/api/v1/health` alias missing | 🟧 P1 | [sneakyfree/windy-pro#51](https://github.com/sneakyfree/windy-pro/pull/51) | `c87cf8c` on `main` | ✅ merged (batched) |
| P1-3 No admin user seeded | 🟧 P1 | [sneakyfree/windy-pro#51](https://github.com/sneakyfree/windy-pro/pull/51) | `c87cf8c` on `main` | ✅ merged (batched) |

5 of 5 P0+P1 fixed. Zero skipped.

---

## What changed, by finding

### 🟥 P0-1 — `/forgot-password` `_devToken` leak

**`account-server/src/routes/auth.ts:1089`** — the `_devToken` response branch is now gated on `NODE_ENV !== 'production'`. Test environment keeps working (the existing `tests/password-reset.test.ts` reads `_devToken` from the response to exercise the reset flow without SMTP); prod simply cannot emit the field.

**`account-server/src/server.ts:107`** — new startup assertion alongside the `CORS_ALLOWED_ORIGINS` / `TRUST_PROXY` guards: in production, boot fails if `RESEND_API_KEY` is unset. Fail-closed is the right default — without it, password-reset emails silently disappear while the endpoint returns success.

**New test:** `tests/forgot-password-prod-gate.test.ts`. Boots the server with `NODE_ENV=production` + a `RESEND_API_KEY` (satisfies the fail-closed), registers a user, posts `/forgot-password`, asserts the 200 response has **no** `_devToken` key and **no** 20+-char token-shaped substring.

### 🟥 P0-2 — `GET /` landing stub

**`account-server/src/server.ts:327`** — when the SPA bundle is absent AND the request is `/` or `/index.html`, serve a 540-px-wide single-HTML stub with:
- a clear "this is the API, not a UI" message
- a link back to `windyword.ai` for desktop users
- a pointer at `/.well-known/openid-configuration` for integrators
- `/healthz` reference for ops

The stub never leaks backend shape (no version string, no uptime, no endpoint table). Scoped to `/` + `/index.html` only — other dead paths still fall through.

**New test:** `tests/landing-stub.test.ts` — 5 cases. Asserts 200 + HTML + no `Cannot GET` + no stack-trace leaks, regardless of whether the SPA bundle is present (dev machine has one, prod Docker image doesn't; both shapes must not 404).

### 🟧 P1-1 — windy-cloud JWKS URL

**Cross-repo fix in [sneakyfree/WindyCloud](https://github.com/sneakyfree/WindyCloud).**

`api/app/config.py:10` default flipped from `https://windyword.ai/.well-known/jwks.json` (Cloudflare-gated 401) to `https://pro.windyword.ai/.well-known/jwks.json`.

**⚠ Deploy ordering warning** — `pro.windyword.ai` does NOT currently resolve (DNS not yet created). If Cloud is redeployed with this default BEFORE the pro-side DNS + nginx vhost are live, Cloud boots with an unresolvable hostname. Three possible rollout strategies, in the PR body:

1. **Ideal:** add `pro.windyword.ai` A record, extend the Pro-side cert with `certbot --expand`, verify both `api.windyword.ai` and `pro.windyword.ai` return the same JWKS kid, THEN redeploy Cloud.
2. **Urgent interim:** override via env — `WINDY_PRO_JWKS_URL=https://api.windyword.ai/.well-known/jwks.json` on Cloud's EC2. Unblocks cross-auth immediately.
3. **Block the merge:** — Grant can revert if the migration plan changed.

### 🟧 P1-2 — `/api/v1/health` alias

**`account-server/src/routes/misc.ts:138`** — handler now registered for `['/health', '/healthz', '/api/v1/health']`. Reuses the existing 30 s health cache; zero extra work. `tests/health-alias.test.ts` pins all three paths + asserts same-shape.

### 🟧 P1-3 — admin bootstrap

**New `account-server/src/services/admin-bootstrap.ts`.** On startup, if `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` are set AND no admin exists, mint one (bcrypted password, role='admin'). Idempotent across reboots. If only email is set → warn and skip (we intentionally do NOT auto-generate a password and log it; logs are the wrong place for credentials). If a user with the bootstrap email already exists as role='user' → promote them instead of colliding on UNIQUE.

**Ops flow (documented in `.env.example:§13`):**
1. Set both env vars.
2. Start container. One info line appears in logs.
3. Log in as admin via `/api/v1/auth/login`.
4. **Unset both env vars** and restart — check is no-op on the next boot.

Wired into `server.ts` alongside `seedEcosystemClients()`. `tests/admin-bootstrap.test.ts` — 6 cases covering create / hashed password / idempotent skip / promote existing user / warn-on-missing-password / silent no-op.

---

## Ancillary hygiene

- **`.env.example`** — added `§13 admin bootstrap` block with `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` and the "unset after first login" ops note. Added `§14 outbound email` cross-reference pointing back at `RESEND_API_KEY` in `§7` with the new prod-required contract (single source of truth — the key is only declared once to keep the drift-guard green).
- **Drift-guard fix** on PR #51 — my first attempt duplicated `RESEND_API_KEY=` which tripped the `tests/env-example-drift.test.ts` "no duplicate KEY=" check. Converted the §14 block to doc-only. Commit `cddec23`.

---

## What I did NOT do, and why

| Thing | Why not |
|---|---|
| **Redeploy to AWS** | Explicit instruction in the brief: "Grant owns the rollout call." Documented the ops steps in each PR body. |
| **Fix P2 / P3 findings** | Scope is P0 + P1 only. P2 cluster (health latency, X-Frame-Options, HTML 404 on non-API paths, no timestamp replay on firehose, `path` field prefix) and P3 cluster (JWT `aud`, `X-Powered-By`, Stripe endpoint) can batch into a follow-up polish PR. |
| **DNS for `pro.windyword.ai`** | DNS mutations are ops actions that touch live ecosystem state; deferring to Grant for the FIRE-style approval cadence we used in Wave 13. |
| **Override the Wave 14 canonical URL** | The brief said "correct URL is `pro.windyword.ai`". My verification showed that URL doesn't resolve today. I followed the brief's direction (updated the default) and flagged the DNS dependency in the PR body + offered an env-override workaround. Did not second-guess Grant's architecture call. |

---

## New bugs found en route

1. **Drift-guard self-trip on my first P1-batch commit** — duplicated `RESEND_API_KEY=` in `.env.example`. Caught by CI. Fixed with commit `cddec23` before merge. No escape.
2. **Parallel Claude session active in `windy-cloud`** — the cloud worktree had uncommitted WIP on `wave14/pr3-batched-p1s` when I arrived (security headers middleware, analytics admin-gate test, smoke report). Stashed it, made my one-line config change on a fresh `wave14/fix-pro-jwks-url-cloud-side` branch cut from `origin/main`, pushed. The WIP should still be recoverable from the stash on that machine — did not commit on top of their work, did not delete their stash. Not a bug in Windy code; a coordination observation for Grant.
3. **Initial `git checkout -b` in the cloud repo behaved unexpectedly** (branch state got tangled). Resolved by `git reset --hard origin/main` + `git clean -fd` + cherry-pick onto a fresh branch. No content lost; commit `44d3bc6` → `f3fbd04` after re-rebase.

---

## Deploy ops the EC2 still needs (Grant to run at rollout)

1. **Set `RESEND_API_KEY`** in `/opt/windy-pro/.env.production` on the Phase 1 EC2. Without it, the new fail-closed assertion prevents container boot. Get a key at https://resend.com/api-keys — free tier = 100 emails/day.
2. **Optionally set `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD`** on the first redeploy to seed an admin. Remove them on the second redeploy.
3. **Add `pro.windyword.ai` DNS + cert** — Pro-side ops to make PR #39 (cloud) functional:
   ```bash
   # On Cloudflare: A pro.windyword.ai → 100.52.10.181, proxied=false
   # On the Pro EC2:
   sudo sed -i 's/server_name api.windyword.ai;/server_name api.windyword.ai pro.windyword.ai;/' \
     /etc/nginx/sites-available/api.windyword.ai.conf
   sudo certbot --expand -d api.windyword.ai -d pro.windyword.ai --non-interactive --agree-tos --email grantwhitmer3@gmail.com
   sudo systemctl reload nginx
   # Verify: both hostnames return kid 37e8955762d43189
   ```
4. **Redeploy Cloud** with its new default (or leave `WINDY_PRO_JWKS_URL` env override pointing at api.windyword.ai for an interim ship).

---

## Test matrix before and after

| Area | Pre-Wave-14 | Post-Wave-14 |
|---|---|---|
| `GET /` | `Cannot GET /` 404 | 200 HTML landing stub (when no SPA bundle) |
| `POST /forgot-password` with unset RESEND | 200 + `_devToken` leak | 200 success (prod) / server-boot fail (prod with unset RESEND) |
| `GET /api/v1/health` | 404 | 200 identical to /health |
| Admin user | nothing | seedable via 2 env vars |
| Cloud ↔ Pro JWT verify | 401 (apex gate) | works after pro.windyword.ai DNS + cert |

---

## Links

- Smoke report this fix report implements: [`docs/SMOKE_REPORT_2026-04-19.md`](./SMOKE_REPORT_2026-04-19.md)
- PRs: [#48](https://github.com/sneakyfree/windy-pro/pull/48) [#49](https://github.com/sneakyfree/windy-pro/pull/49) [#51](https://github.com/sneakyfree/windy-pro/pull/51) [cloud #39](https://github.com/sneakyfree/WindyCloud/pull/39)
- Commits on `main`: `cfa2c7d` (#48), `238b96b` (#49), `c87cf8c` (#51); cloud: `f1a05fa` (#39)

_Grant owns the rollout. Nothing has been redeployed to AWS. All four merges are on `main`; the next `docker compose build` + `up -d` on the Phase 1 EC2 will carry them forward, provided `RESEND_API_KEY` is set first or the container will fail to start (by design)._
