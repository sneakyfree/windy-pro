# Deploying the Windy Word webapp (`src/client/web/`)

This doc is the runbook for the webapp that serves **`app.windyword.ai`**. For the backend (`api.windyword.ai`) or the marketing site (`windyword.ai` — a separate repo) see their respective runbooks.

## TL;DR

- **Production deploys are automatic.** Merge a PR that touches `src/client/web/**` into `main` → GitHub Actions auto-deploys within ~3 minutes.
- **Rollback:** revert the offending commit on `main` → auto-redeploys the prior state.
- **Pre-launch gate (if needed later):** Cloudflare Access policy on `app.windyword.ai` — see `windyword-site/docs/PRE-LAUNCH-GATE.md` for the pattern.
- **Never deploy from a local laptop** unless the production automation is broken and you're using the same `scripts/cf-pages-deploy.py` with a lockbox-sourced token.

## Architecture

```
                               ┌─────────────────────────────────────────┐
                               │  GitHub: sneakyfree/windy-pro           │
                               │    main branch (push / merge)           │
                               └────────────────────┬────────────────────┘
                                                    │
                                                    ▼
                    ┌───────────────────────────────────────────────────────┐
                    │  .github/workflows/deploy-web.yml                     │
                    │    - setup-node 22  (.nvmrc)                          │
                    │    - cd src/client/web && npm ci && npm run build     │
                    │    - python3 scripts/cf-pages-deploy.py               │
                    │                                                       │
                    │  Needs repo secret: CF_PAGES_TOKEN                    │
                    └────────────────────┬──────────────────────────────────┘
                                         │
                                         ▼
              ┌────────────────────────────────────────────────────────────────┐
              │  Cloudflare API — direct upload (wrangler-free)                │
              │    1. GET   upload-token  →  project-scoped JWT                │
              │    2. POST  /pages/assets/check-missing  →  hashes not cached  │
              │    3. POST  /pages/assets/upload  (batched, base64, typed)     │
              │    4. POST  /accounts/X/pages/projects/Y/deployments           │
              │            (multipart: manifest + branch + _headers/_redirects)│
              └────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
              ┌────────────────────────────────────────────────────────────────┐
              │  Cloudflare Pages: windypro-webapp                             │
              │    subdomain   windypro-webapp.pages.dev                       │
              │    custom      app.windyword.ai (CNAME proxied through CF)     │
              │    deployment  immutable; one-click rollback via dashboard     │
              └────────────────────────────────────────────────────────────────┘
```

## Why direct-upload instead of `wrangler pages deploy`

`wrangler@3.90` returns Cloudflare API error **9106** ("Authorization error") even with tokens that succeed on every endpoint wrangler internally calls — tested repeatedly via direct curl in 2026-04-21 debugging. Chasing wrangler's version-specific auth sanity checks would keep us fragile against future wrangler updates. The Direct Upload API is the documented lower-layer that wrangler wraps; by driving it ourselves we get the same outcome without wrangler's opinions.

Tradeoff: we own a ~180-line Python script instead of a third-party action. Script is small, annotated, and doesn't change across deploys. The control is worth it.

## Prerequisites

### Repo secret: `CF_PAGES_TOKEN`

One-time setup. Cloudflare API token with the following scopes (minimum):

- **Account → Cloudflare Pages: Edit** (covers project read, asset upload, deployment create)

Stored at **`sneakyfree/windy-pro` → Settings → Secrets and variables → Actions**.

As of the 2026-04-21 cutover this secret holds the fleet-wide "god" token from `kit-army-config/ACCESS_LOCKBOX.md §6 → TheWindstormCloudflareGodToken`. Rotation plan noted in that lockbox entry — rotate after account is compromised, when decommissioning a machine that holds a copy, or on a calendar schedule if you establish one.

### Source-of-truth files in the webapp

These four files are prerequisites for a clean deploy (added by PR #62 "chore(web): add deploy foundation"):

- `src/client/web/.nvmrc` — pins Node 22
- `src/client/web/package.json` `engines.node` — enforces Node 22
- `src/client/web/public/_redirects` — SPA fallback (`/* /index.html 200`) so React Router works on deep links
- `src/client/web/public/_headers` — security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)

Don't remove them.

## Deploying

### Normal path (automatic)

```bash
# In a feature branch
git checkout -b feat/whatever
# ...edit src/client/web/... 
git add -A && git commit -m "feat(web): ..."
git push
gh pr create --title "..."
# Merge when approved
```

Merging to `main` triggers the workflow automatically. Expected timing:

- Workflow queue → ~10s
- `npm ci` → ~30s
- `npm run build` (Vite) → ~5s for this codebase
- Deploy script → ~30s for 50 files; ~2-3 min for 500 files
- Cloudflare edge propagation → 10-60s

Total: **~2-4 minutes from merge to live on `app.windyword.ai`.**

### Manual trigger (no code change)

```bash
gh workflow run deploy-web.yml --repo sneakyfree/windy-pro --ref main
```

Useful for forcing a redeploy if Cloudflare state drifted.

### Emergency local deploy (should be rare)

If GitHub Actions is broken (billing, runner outage, script regression):

```bash
# From your laptop, with the lockbox token
export CLOUDFLARE_API_TOKEN="$(ssh -i ~/.ssh/kit_mesh root@72.60.118.54 \
    'grep CLOUDFLARE_API_TOKEN /root/clawd/.secrets/cloudflare-god.env | cut -d= -f2-')"
export CLOUDFLARE_ACCOUNT_ID="193b347aedeaafe35de0b5a534b2d9aa"

cd /path/to/windy-pro
( cd src/client/web && npm ci && npm run build )
python3 scripts/cf-pages-deploy.py windypro-webapp src/client/web/dist main
```

Only do this if automation is down. Local deploys bypass the audit trail that merge-to-main gives us.

## Rollback

### Same-repo rollback (revert the commit)

```bash
git revert <bad-commit-sha>
git push  # auto-triggers new deploy of the reverted state
```

### Cloudflare-dashboard rollback (faster, no code change)

1. Cloudflare Dashboard → Workers & Pages → `windypro-webapp` → Deployments
2. Find a known-good prior deployment
3. Click the "..." menu → **Rollback to this deployment** (or "Promote to production" if on another branch)

Useful when the bad state isn't attributable to a single commit (env drift, content drift).

## Common issues

### `9106 Authorization error` from the deploy step

Usually means the `CF_PAGES_TOKEN` repo secret was set incorrectly. Verify first by checking the "Secret sanity check" workflow step — if it reports length < 20, the secret is malformed (see next item). If length looks right but 9106 still fires, the token may have been rotated/revoked or no longer has `Account → Cloudflare Pages: Edit`. Refresh from the lockbox:

```bash
# CORRECT invocation — pipe value via stdin, NO --body flag:
echo "$TOKEN_VALUE" | gh secret set CF_PAGES_TOKEN --repo sneakyfree/windy-pro
gh workflow run deploy-web.yml --repo sneakyfree/windy-pro --ref main
```

### ⚠️ `gh secret set --body -` does NOT mean "read from stdin"

**This burned an hour of debugging on 2026-04-21.** The `gh` CLI's `--body -` flag does NOT read from stdin — it sets the secret's value to the literal string `-` (one character). Every run with a `-`-valued token will return 9106 because the HTTP Authorization header becomes malformed.

| Invocation | Actual behavior |
|---|---|
| `echo "$T" \| gh secret set NAME --repo R --body -` | ❌ Sets secret to literal `-`. Runner sees a 1-char secret. |
| `echo "$T" \| gh secret set NAME --repo R` | ✅ Reads from stdin (default behavior when stdin is a pipe). |
| `gh secret set NAME --repo R --body "$T"` | ✅ Uses `$T` as the literal body value. Works. |
| `gh secret set NAME --repo R -f file` | ✅ Reads from a file. Works. |

The `Secret sanity check` step in `deploy-web.yml` now catches this with a fail-fast if the runner sees a secret shorter than 20 characters.

### Build succeeds but site serves old content

- DNS propagation can lag by up to a minute; wait
- Cloudflare edge cache — `curl -sI https://app.windyword.ai/` and check `cf-cache-status`. If `HIT`, force a purge via dashboard (Caching → Configuration → Purge Cache)
- Browser cache — open in incognito
- Verify the deployment's aliases include `app.windyword.ai` via Pages dashboard

### SPA routes 404 on refresh (e.g. `/verify-email` reload)

`public/_redirects` is missing or malformed. Should contain exactly `/*    /index.html   200`. Added in PR #62; don't remove.

### Security headers not appearing

`public/_headers` is missing, or the file was deleted by a scope-creep PR. Added in PR #62; don't remove.

## Staging environment (not yet implemented)

When needed, create a second Pages project `windypro-webapp-staging` pointed at a `staging` branch of this repo, with custom domain `staging.windyword.ai`. The deploy script is branch-agnostic; add a parallel workflow that triggers on `push: branches: [staging]`.

## Followups (open)

- Pre-warm production alias after first deploy to shave edge-propagation time
- Add deploy-status notifications (Slack/email) for failed prod deploys
- Content-addressable caching is still SHA-256-based in the script; if Cloudflare starts rejecting non-BLAKE3 hashes, swap to `blake3` (pypi package)
- `docs/ROLLBACK-DRILL.md` — practice the rollback path monthly
