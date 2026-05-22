# SUBSTRATE — windy-pro production (Windy Word hub)

**ADR:** [ADR-048](https://github.com/sneakyfree/kit-army-config/blob/main/docs/adr-048-operational-substrate-as-code-2026-05-15.md) Layer 1
**Generated:** 2026-05-22 from `deploy-prod/docker-compose.yml`, `services/translate-api/windy-translate.service`, `.github/workflows/deploy-{web,account-server}.yml`, CLAUDE.md.
**Maintenance policy:** edit on every change to any of the three deploy surfaces (account-server compose, translate-api systemd, web CF Pages).
**Confidence flags:** ✓ verified-against-source · ⓘ inferred-from-repo · ⚠ known-gap or by-reference.

---

## Overview — three deploy surfaces

windy-pro (= Windy Word) is the **hub** product and has the most heterogeneous deploy surface of any repo in the ecosystem:

| Surface | Where | How deployed |
|---|---|---|
| **account-server** (identity authority) | Co-located on shared windy-mail EC2 | docker compose (`deploy-prod/docker-compose.yml`) |
| **translate-api** (B2B Translate API, Tier 2 SMT) | Standalone systemd service | `services/translate-api/windy-translate.service` |
| **web SPA** (windyword.ai dashboard) | Cloudflare Pages | `.github/workflows/deploy-web.yml` → `windypro-webapp` project |

The Electron desktop app + Windows installer + macOS DMG distribute separately (R2-distributed per `[[reference_r2_desktop_distribution_pattern]]`) — not "production substrate" in the ADR-048 sense.

---

## Surface 1 — account-server (compose)

### Host

| Field | Value |
|---|---|
| EC2 instance ID | `i-07cef803a6a3f86b4` ✓ (shared with windy-mail + eternitas) |
| Public IPv4 | `54.88.113.79` ✓ |
| SSH user | `ubuntu` ✓ |
| Repo path on host | `/opt/windy-pro` |
| Compose dir | `/opt/windy-pro/deploy-prod` |

### Compose project

| Field | Value |
|---|---|
| Project name | `windypro-prod` ✓ (per `name:` directive in compose; renamed from `deploy-prod` on 2026-05-20 per the [volume-collision migration](https://github.com/sneakyfree/windy-pro/pull/137) — see `[[feedback_windypro_volume_collision_2026_05_20]]`) |
| Compose file | `/opt/windy-pro/deploy-prod/docker-compose.yml` ✅ **IN GIT** (the exception — most sibling kernels' prod compose isn't committed; windy-pro's is) |
| Env file | `/opt/windy-pro/deploy-prod/.env.production` ✓ (hand-curated, not in git) |

### Volumes — declared (compose) → on-host

| Compose name | On-host name | Critical data | Notes |
|---|---|---|---|
| `pro-pg-data` | `windypro-prod_pro-pg-data` | **🚨 Postgres: account-server user records, sessions, devices, refresh tokens, translation history** | **Top criticality — user identity ledger.** Recovered via copy from old `deploy-prod_pg` volume during the 2026-05-20 rename incident. |
| `pro-redis-data` | `windypro-prod_pro-redis-data` | Redis appendonly: session state, rate-limit counters, JWKS cache | Re-buildable; loss causes brief auth recheck spike. |
| `pro-account-keys` | `windypro-prod_pro-account-keys` | **🚨 RS256 JWKS keypair for Pro JWTs** (live `kid 558f` per `[[feedback_jwks_split_brain]]`) | **Top criticality — Pro JWT trust root.** Recovered via copy during 2026-05-20 rename. |
| `pro-account-uploads` | `windypro-prod_pro-account-uploads` | User-uploaded media (profile photos, etc.) | Recovered via copy during 2026-05-20 rename. |

⚠ See migration history below — these volumes were originally `deploy-prod_*` and orphaned during the PR #137 rename until restored via host-side copy.

### Bind mounts

The compose declares no host-side bind mounts (compose-managed volumes only). Caddy lives in the sibling windy-mail compose project (`/opt/windy-mail/deploy/Caddyfile`) and proxies `account.windyword.ai → pro-account-server:8098` via the shared `deploy_backend` network.

### Services (running)

| Compose service | Container name | Image | Healthy when |
|---|---|---|---|
| pro-account-server | `windypro-prod-pro-account-server-1` ✓ | `windy-pro-account-server:local` (built from `account-server/Dockerfile`) | `wget -qO- http://localhost:8098/health` |
| pro-postgres | `windypro-prod-pro-postgres-1` ✓ | `postgres:16-alpine` | `pg_isready -U windy_pro -d windy_pro` |
| pro-redis | `windypro-prod-pro-redis-1` ✓ | `redis:7-alpine` | `redis-cli ping` |

### External ports (host-bound)

| Port | Service | Purpose |
|---|---|---|
| `127.0.0.1:8098` | pro-account-server → 8098 | API loopback for Caddy proxy to `account.windyword.ai` |

Postgres + Redis are NOT host-bound; reachable only via the shared `deploy_backend` docker network.

### Network

External bridge `backend` (alias for the on-host `deploy_backend` network shared with windy-mail + eternitas). This is what lets Caddy in windy-mail's stack proxy `account.windyword.ai` to `pro-account-server:8098` without exposing ports publicly.

### Critical env vars (must be present in /opt/windy-pro/deploy-prod/.env.production)

**Boot-blocking (compose `:?` enforcement):**
- `POSTGRES_PASSWORD`

**Required for Pro JWT issuance:**
- `JWT_SECRET` (HS256 fallback)
- RS256 keys live in the `pro-account-keys` volume; managed by the account-server at runtime

**Required for Stripe billing:**
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

**Required for sister-service service-tokens** (per `[[feedback_chat_identity_conflation]]`):
- `CHAT_API_TOKEN` (account-server → chat onboarding)
- `MAIL_API_TOKEN` (account-server → mail provisioning)

**Required for Eternitas integration** (per `[[feedback_eternitas_platform_autodeactivate]]`):
- `ETERNITAS_PLATFORM_ID`
- `ETERNITAS_PLATFORM_TOKEN` (auto-deactivates if `webhook_url` 4xxs first delivery — ship the /webhooks stub before registering)

**MF1 deploy-identity (set by deploy-account-server.yml at build):**
- `COMMIT_SHA`, `BUILD_TIMESTAMP`, `ENVIRONMENT=production`

---

## Surface 2 — translate-api (systemd, B2B Translate)

### Host

Per memory `[[project_windy_translate_b2b_api]]`: B2B API at `windy-pro/services/translate-api/`. Node + Python CTranslate2 + NLLB-200. systemd-hardened. Runs on a separate host from account-server (likely the windy-translate dedicated VM or a separate Tier-2 box). EC2 ID + IP live in lockbox.

| Field | Value |
|---|---|
| EC2 instance ID | (in lockbox `ACCESS_LOCKBOX.md`) ⚠ |
| Public IPv4 | (in lockbox) ⚠ |
| Repo path on host | `/opt/windy-translate-api` ✓ (per the systemd unit) |
| User/Group | `windy:windy` ✓ |
| systemd unit | `/etc/systemd/system/windy-translate.service` (deployed from `services/translate-api/windy-translate.service`) |

### Runtime

- Node `server.js` is the Express front-end at port `8099`
- Spawns Python `translate-worker.py` as a child process for CTranslate2 + NLLB-200-600M inference
- Model lives at `/opt/windy-translate-api/models/nllb-200-600M`
- SQLite cache at `/var/lib/windy-translate/cache.db`

### Critical env vars (systemd Environment= lines)

- `NODE_ENV=production`
- `PORT=8099`
- `MODEL_PATH=/opt/windy-translate-api/models/nllb-200-600M`
- `DB_PATH=/var/lib/windy-translate/cache.db`

Additional secrets (CORS, rate-limit thresholds, etc.) come from the EnvironmentFile if the systemd unit references one — confirm on next live audit.

### Notes

- Logs go to journald (`StandardOutput=journal`, `SyslogIdentifier=windy-translate`)
- Auto-restart on failure with 5s backoff (`Restart=always`, `RestartSec=5`)
- ADR-037 split: the standalone `windy-translate` scaffold repo was created 2026-05-13. The B2B API lives HERE in `windy-pro/services/translate-api/` for now; long-term it may migrate to the standalone repo.

---

## Surface 3 — web SPA (Cloudflare Pages)

### Where

- **CF Pages project:** `windypro-webapp`
- **Production alias:** `windyword.ai`
- **Build source:** `src/client/web/` (React + Vite)
- **Deploy script:** `scripts/cf-pages-deploy.py` (custom — sidesteps wrangler 3.90 API-error-9106 auth bug per workflow comment)
- **Deploy trigger:** push to main touching `src/client/web/**` (or manual workflow_dispatch)

### Critical secret

- `CF_PAGES_TOKEN` (Cloudflare API token, account-level write to Pages; rotated per the lockbox rotation plan)

### Bind to runtime

Per `[[feedback_wrangler_pages_deploy_dir]]`: ALWAYS deploy `dist`, NEVER `.` — the cf-pages-deploy.py script targets `dist/` correctly; if a future migration switches back to wrangler, watch this trap.

---

## Known gaps + audit findings

✅ **windy-pro is the FIRST repo where the prod compose IS in git** — all sibling kernels (cloud, search, triad) have the gap I documented across iterations 16–18. This is a positive divergence to preserve.

⚠ **translate-api systemd host EC2 ID + IP not captured here** — by-reference to lockbox. Confirm + add on next live audit.

⚠ **Live `docker inspect` audit pending** — promote ⓘ items to ✓ on next audit.

⚠ **Electron app distribution (Windows installer + macOS DMG)** intentionally NOT documented here per ADR-048 scope (substrate-as-code covers production-server substrate, not desktop distribution). See `[[reference_r2_desktop_distribution_pattern]]` for that surface.

## Tolerated drift (allowlist)

| Item | Reason |
|---|---|
| `:local` image tag on `pro-account-server` | Built in-place per deploy workflow. |
| Vestigial `deploy-prod_*` volumes if still present on host | Migration leftovers from the 2026-05-20 rename — windypro-prod-named copies are the live ones. |

## Recovery — cold start by surface

### account-server cold-start

1. `git clone https://github.com/sneakyfree/windy-pro /opt/windy-pro`
2. Restore `/opt/windy-pro/deploy-prod/.env.production` from lockbox.
3. **Restore `windypro-prod_pro-pg-data` + `windypro-prod_pro-account-keys` from EBS snapshot.** Without `pro-account-keys` the Pro JWT trust root is lost and every existing JWT becomes invalid.
4. `cd /opt/windy-pro/deploy-prod && sudo docker compose --env-file .env.production up -d`
5. Verify:
   - `curl https://account.windyword.ai/health` → `{"status":"healthy"}`
   - `curl https://account.windyword.ai/.well-known/jwks.json` → JWKS with `kid 558f` (or whatever current kid)
   - Per `[[feedback_jwks_split_brain]]` — `api.windyword.ai` is a zombie; DO NOT use that host.

### translate-api cold-start

1. Deploy `services/translate-api/server.js` + `translate-worker.py` to `/opt/windy-translate-api/`
2. Download the NLLB-200-600M model to `/opt/windy-translate-api/models/`
3. Install systemd unit + enable: `systemctl enable --now windy-translate.service`
4. Verify: `curl http://localhost:8099/health`

### web SPA cold-start

1. `cd src/client/web && npm install && npm run build` (produces `dist/`)
2. `python scripts/cf-pages-deploy.py --project windypro-webapp --dir dist/` (with `CF_PAGES_TOKEN` env)
3. Verify: `curl https://windyword.ai` returns the built `index.html` (NOT the dev-mode placeholder — see `[[feedback_wrangler_pages_deploy_dir]]`)

## Audit history

| Date | Trigger | Result |
|---|---|---|
| 2026-05-20 | PR #137 compose-name migration (`deploy-prod` → `windypro-prod`) | Volume collision — orphaned pg+keys+uploads volumes; recovered via host-side copy. See `[[feedback_windypro_volume_collision_2026_05_20]]`. |
| 2026-05-22 | Autonomous CTO loop T2.2 backfill | First substrate manifest. windy-pro is the **5-of-13** service with prod compose in git (mail/clone/chat/registry/eternitas/now-windy-pro). Live `docker inspect` audit pending. |

## Cross-references

- ADR-010: vision-aligned engineering invariants
- ADR-037: translation-stack repo split (translate-api currently here, may migrate to standalone windy-translate)
- ADR-048: substrate-as-code
- windy-mail SUBSTRATE.md (shared host): `/Users/thewindstorm/windy-mail/deploy/SUBSTRATE.md`
- eternitas SUBSTRATE.md (shared host): `/Users/thewindstorm/eternitas/deploy-prod/SUBSTRATE.md`
- PR #137 — compose-name migration (the 2026-05-20 incident)
- Memory: `feedback_windypro_volume_collision_2026_05_20.md`
- Memory: `feedback_jwks_split_brain.md` (account.windyword.ai live; api.windyword.ai zombie)
- Memory: `feedback_chat_identity_conflation.md` (service-token discipline)
- Memory: `feedback_eternitas_platform_autodeactivate.md`
- Memory: `feedback_wrangler_pages_deploy_dir.md`
- Memory: `project_windy_translate_b2b_api.md`
- Memory: `reference_r2_desktop_distribution_pattern.md`
- Memory: `reference_lockbox.md`
