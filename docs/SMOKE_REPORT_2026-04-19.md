# Smoke report — windy-pro account-server @ https://api.windyword.ai

**Date:** 2026-04-19
**Test method:** live-URL probes from outside (no local server).
**Commits live on prod:** `100162d` (main) — Phase 1 (#43) + webhooks (#44) + /credentials/verify (#45) + compose env forward (#46) + docs (#47).
**Evidence captured:** `/tmp/smoke-2026-04-19/` (curl responses, headers, JWKS, signed-HMAC round-trips).

---

## Headline

**2 P0**. **3 P1**. **5 P2**. **3 P3**.
None of the findings are "the server is on fire." Several are "a real user in their first 60 seconds would hit this."

| Severity | Count | Must-fix-before | Examples |
|---|---|---|---|
| 🟥 **P0** | 2 | Any public signup | `/forgot-password` leaks reset token in response; `/` serves no landing page |
| 🟧 **P1** | 3 | Cross-service JWT verify | windy-cloud points at the wrong JWKS URL; no admin user seeded; /api/v1/health alias missing |
| 🟨 **P2** | 5 | Polish pass | /health external latency 1.4s; missing X-Frame-Options; non-API 404 is HTML; no timestamp replay on firehose; 404 `path` field drops `/api` prefix |
| ⬜ **P3** | 3 | Neatness | `X-Powered-By: Express` leaks framework; Stripe endpoint is 503 (intentional?); JWT has no `aud` claim |

The only path that would embarrass us in a live grandma-ribbon demo today is the **/forgot-password token leak** (P0-1). Fix that before anyone gets a reset link email in their hand.

---

## §1 Public surface

### 🟥 P0-2 — `GET /` is a 404 "Cannot GET /", not a landing page

**What I saw:** HTTP/2 404, `content-type: text/html`, body `<pre>Cannot GET /</pre>`.

**What I expected:** the Windy Pro landing page (the Wave 13 Dockerfile dropped the web-client COPY step, so `/opt/windy-pro/...web/dist` doesn't exist inside the container; `express.static` falls through, SPA wildcard checks `fs.existsSync(spaIndexPath)` which is false, Express's default 404 handler wins).

**Repro:**
```bash
curl -sSI https://api.windyword.ai/
# HTTP/2 404   content-type: text/html; charset=utf-8
```

**Proposed fix:** either build the web portal in Phase 1 Dockerfile (`src/client/web` → new builder stage → COPY `dist` into stage 2), or mount a minimal static `/` that shows "Windy Pro account-server — API documentation at /api/v1/…". A bare `Cannot GET /` is the first thing anyone visiting the domain sees.

---

### 🟨 P2-1 — `/health` external latency is 1.4 s (target < 200 ms)

**What I saw:** first external `GET /health` from my machine: `time=1.42s` TLS+network+handler. Internal SSH `curl 127.0.0.1:8098/health`: 12 ms.

**Root cause:** `buildHealthResult()` in `routes/misc.ts` probes 4 sister services (chat/mail/cloud/eternitas) in parallel with a 3 s timeout on each. Result is cached for 30 s, so only the first request in each window pays. With all 4 sister services `unreachable` (the reality right now), the probe must wait its full 3 s window.

**Fix:** lower the probe timeout to 500 ms, or add a `/healthz` alias that skips the sister-service probes entirely and only checks DB + JWKS (what K8s / load balancers actually need). Current `/healthz` is an alias but inherits the same cache.

---

### 🟨 P2-2 — Non-API 404 responses are HTML, not JSON

**Repro:**
```bash
curl -sS https://api.windyword.ai/does-not-exist     # returns Express's default <pre>Cannot GET /…</pre>
curl -sS https://api.windyword.ai/api/v1/missing     # returns {"error":"Not found","path":"…"}
```

Two shapes, one hostname. Clients that treat 404 as JSON will choke on non-API paths. Low-impact because the API clients don't hit root paths, but still a surprise.

**Fix:** add a catch-all `app.use((_req,res) => res.status(404).json({error:'Not found'}))` after the SPA wildcard.

---

### 🟨 P2-3 — API 404 `path` field strips the `/api` prefix

**Repro:**
```bash
curl -sS https://api.windyword.ai/api/v1/does-not-exist
# {"error":"Not found","path":"/v1/does-not-exist"}    ← note missing /api
```

Caused by `server.ts:317` using `req.path` inside the `/api/` router mount (relative path). Minor — clients rarely inspect `path`.

**Fix:** use `req.originalUrl.split('?')[0]` or prepend the mount.

---

### §1 positive

- JWKS: 200, `kid=37e8955762d43189` (matches lockbox), `Cache-Control: public, max-age=3600`, `application/json; charset=utf-8`. ✓
- OIDC metadata: all 6 endpoints point at `https://api.windyword.ai`, no `localhost` leaks. ✓
- Static asset mounts (`/assets/`, `/landing/`, `/wizard/`): all 404 because the web bundle isn't in the image (same root cause as P0-2 above).
- `/admin` anonymous: 401 application/json — no state leak. ✓
- Register malformed inputs all return clean 4xx with JSON envelopes, **zero stack-trace leaks**:
  - malformed JSON body → 400 `{"error":"Malformed JSON body","code":"invalid_json"}`
  - wrong content-type → 400 Zod `Validation failed` with field array
  - empty body → 400 Zod `Validation failed`
  - 200 KB body → 413 `{"error":"Request body too large","code":"payload_too_large","limit":"100kb"}`

---

## §2 Auth flows

### 🟥 P0-1 — `POST /auth/forgot-password` **leaks the reset token** in the response body

**What I saw:**
```bash
$ curl -sS -X POST https://api.windyword.ai/api/v1/auth/forgot-password \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoke-1776642827@windypro.test"}'
{"success":true,"_devToken":"vHen8hhw4O30JdwXqBlEMjLOqsKjekuq3TFW6cGsW_g"}
```

**What I expected:** `{"success":true}` only. The raw reset token must ONLY reach the user via the email channel.

**Root cause:** `routes/auth.ts:1083-1091` — if `sendMail()` returns `stub:true`, the endpoint responds with `_devToken: <raw token>`. `sendMail` returns `stub:true` when `RESEND_API_KEY` is unset. Prod's `.env.production` has `RESEND_API_KEY=` (blank) — see `services/mailer.ts:32`.

**Severity:** **P0**. Any anonymous party that knows a Windy user's email address can:
1. POST `/forgot-password` with that email
2. Receive the reset token in the 200 response body
3. Submit it at `/reset-password?token=…` and set a new password
4. Log in as that user.

The 3-per-hour rate limit per email doesn't stop a targeted attack — it just slows it. And the rate limit key is per email, so an attacker can cycle targets.

**Proposed fix (minimum):** gate the `_devToken` branch on `NODE_ENV !== 'production'` (or on a separate `DEV_EXPOSE_RESET_TOKENS` flag). Production must never return raw reset tokens, regardless of whether mail delivery succeeded.

**Proposed fix (better):** wire `RESEND_API_KEY` (or equivalent SMTP) on the EC2 so the `stub` branch can't fire. Add a startup assertion: `if (NODE_ENV === 'production' && !RESEND_API_KEY) throw` — fail-closed like we do for `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, etc.

**Evidence:** `2.6-forgot.json` in `/tmp/smoke-2026-04-19/`.

---

### ⬜ P3-1 — Access-token missing `aud` claim

**What I saw (JWT payload after decode):**
```json
{
  "userId": "7420ce9c-…",
  "accountId": "7420ce9c-…",
  "windyIdentityId": "6867224f-…",
  "email": "…",
  "tier": "free",
  "type": "user",
  "scopes": [...],
  "products": [...],
  "iss": "windy-identity",
  "iat": 1776642831,
  "exp": 1776643731
}
```

Brief called for verifying `aud`. No `aud` claim is emitted. Downstream verifiers (cloud, chat) that enforce audience would reject — **but** cloud currently fetches the wrong JWKS URL (see P1-1), so they can't verify at all yet.

**Fix:** decide the audience contract for the ecosystem (e.g. `aud: "windy-ecosystem"`) and emit it. Document in `docs/ECOSYSTEM_API_REFERENCE.md`.

---

### §2 positive

- `/auth/register` returns correct shape: `{userId, windyIdentityId, email, name, tier, token, refreshToken, devices}`. ✓
- JWT header: `alg: RS256, typ: JWT, kid: 37e8955762d43189` — kid matches JWKS. ✓
- `/auth/login` 200 OK, returns identical token envelope. ✓
- Wrong-password rate limit: kicks in after ~5 attempts in a minute, returns 429 `{"error":"Too many attempts, please try again later"}`. ✓
- Refresh rotation: first refresh returns a **new** `refreshToken`, replay of the ORIGINAL refresh → 401 `{"error":"Invalid or expired refresh token"}`. ✓
- `/reset-password?token=bad` renders a readable HTML page (not a JSON blob to a non-technical user). ✓

---

## §3 OAuth device-code

### §3 positive — RFC 8628 compliant

```bash
$ curl -sS -X POST https://api.windyword.ai/api/v1/oauth/device \
    -d 'client_id=windy_pro_mobile&scope=openid profile email'
{
  "device_code": "825380ef…",
  "user_code": "H62K-U688",
  "verification_uri": "https://api.windyword.ai/device",
  "verification_uri_complete": "https://api.windyword.ai/device?code=H62K-U688",
  "expires_in": 900,
  "interval": 5
}
```

- `user_code` uses an unambiguous alphabet (no `O/0/I/1/l` seen in sample). ✓
- `/device` page renders a readable HTML form (approve/deny buttons, email+password field). ✓
- Wrong `user_code` via the HTML form → re-renders with a visible error banner. ✓
- `/oauth/token` polling before approval → `400 {"error":"authorization_pending"}` per RFC 8628 §3.5. ✓
- Garbage `device_code` → `400 {"error":"invalid_grant","error_description":"Unknown device_code"}`. ✓
- Expired-device-code code path exists (oauth.ts:624 returns `expired_token`) but I couldn't trigger it in a 60 s window — marked verified-by-inspection, not by live test. [ENV-BLOCKED-MINOR]

---

## §4 Service-mesh HMAC round-trips

### 🟨 P2-4 — `/webhooks/eternitas` has no timestamp-based replay protection

Brief asked for "send with a stale timestamp (>5 min old) → 401". The route has **no** timestamp header (`grep -c X-Eternitas-Timestamp routes/webhooks-eternitas.ts` → 0). HMAC is over the raw body only, so a captured valid webhook can be replayed indefinitely.

Our outbound-to-Eternitas probably uses timestamp-replay; the inbound route doesn't.

**Fix:** add `X-Eternitas-Timestamp` to the canonical string + ±5 min replay window, same pattern as `/api/v1/identity/eternitas/webhook` already uses (identity.ts:1437). Coordinate with Eternitas Phase 2 so they start sending the header.

---

### §4 positive — every documented case works

| Test | Result | Evidence |
|---|---|---|
| `/agent/credentials/issue` unsigned | 401 `invalid_signature` | `4.1` |
| `/agent/credentials/issue` signed (our smoke user) | 200 + full token envelope (provider=gemini, model=gemini-1.5-flash, usage_cap_tokens=50000, free tier) | `4.2-issue.json` |
| `/agent/credentials/verify` round-trip | `{"ok":true, "token":{…}}` with identity_id/provider/model/expires_at/usage_cap_tokens/usage_tokens | `4.3-verify.json` |
| `/agent/credentials/verify` garbage token | `200 {"ok":false,"reason":"not_found"}` | `4.4-verify-garbage.json` |
| `/webhooks/eternitas` unsigned | 401 `missing_signature` | `4.5` |
| `/webhooks/eternitas` signed (HMAC_WINDY_PRO from lockbox) | `200 {"received":true}` | `4.6` |
| `/webhooks/eternitas` tampered body | 401 `invalid_signature` | `4.7` |
| `/webhooks/eternitas` unknown event type + valid sig | `200 {"received":true}` (graceful) | `4.8` |

BROKER_HMAC_SECRET matches Phase 5 Fly side (I used the lockbox value and the server accepted; if it were drifted it'd have 401'd).
ETERNITAS_HMAC_SECRET matches `HMAC_WINDY_PRO` on Eternitas's Phase 2 state file.

---

## §5 Stripe webhook

### ⬜ P3-2 — `/api/v1/stripe/webhook` returns 503 `"Stripe webhook not configured"`

Any POST (signed or tampered) → 503. Root cause: `STRIPE_WEBHOOK_SECRET` is blank in prod `.env.production`.

Per the lockbox, billing is intentional on `cloud.windyword.ai` (Phase 3) not `api.windyword.ai` (Phase 1). So this Phase-1 endpoint is vestigial.

**Ask:** confirm — is Pro ever intended to handle Stripe directly? If no, remove the route + config knob from Phase 1 so the confusion goes away. If yes, wire STRIPE_WEBHOOK_SECRET. Either way, current behavior is "endpoint exists but doesn't work".

---

## §6 Admin console

### 🟧 P1-3 — No admin user is seeded on Phase 1

**What I saw:**
- `/admin` anonymous → 401 `Authentication required`. ✓
- `/admin/login` anonymous → 401 `Authentication required` (the admin router gates EVERY route including login; expected since there's no separate admin login page, users are supposed to login via `/api/v1/auth/login` and attach the JWT as a cookie).
- `/api/v1/admin/users` with a **regular user** JWT → 403 `Admin access required`. ✓
- Lockbox: no Phase-1 admin credentials documented. The bootstrap never seeded one.

**Impact:** the admin console and 5 `/api/v1/admin/*` endpoints are **inaccessible** today. Nobody can list users, force-rotate a key, freeze a subscription, or do any of the emergency-break actions the console is built for.

**Fix:** document + script the admin-user bootstrap step. Easiest path:
```bash
ssh ubuntu@100.52.10.181
sudo docker compose -f /opt/windy-pro/deploy/wave13/docker-compose.aws.yml \
    --env-file /opt/windy-pro/.env.production \
    exec account-server psql "$DATABASE_URL" -c "UPDATE users SET role='admin' WHERE email='ops@windypro.com'"
```
…then add the one-line psql to `deploy/wave13/user-data.sh.tmpl` as an idempotent bootstrap. And record the admin creds in the lockbox.

---

### §6 positive — gate works

401 / 403 responses are correct-shaped. No state leaks in the anonymous 401. Admin middleware chain (`authenticateToken` + `adminOnly`) is firing before any route handler runs.

---

## §7 Mobile / Cloud / Chat client perspective

### 🟥 P1-1 — windy-cloud points at the **wrong** JWKS URL

**What I saw (in `~/windy-cloud/api/app/config.py:10`):**
```python
windy_pro_jwks_url: str = "https://windyword.ai/.well-known/jwks.json"
```

**What the deployed Pro actually serves:**
- `https://api.windyword.ai/.well-known/jwks.json` → 200, valid JWKS
- `https://windyword.ai/.well-known/jwks.json` → **401 Basic Auth realm="WindyWord Pre-Launch"** (Cloudflare pre-launch gate on the apex; not our server)

No env override in cloud's deploy config (grep came up empty).

**Impact:** every cross-service JWT verification Cloud attempts against Pro's JWKS **fails**. Cloud's /api/v1/agent/* + /api/v1/files* and any other JWT-gated endpoint would reject valid Pro-issued JWTs because Cloud can't fetch the right public key to verify.

**Fix:** change `windy-cloud/api/app/config.py:10` default to `https://api.windyword.ai/.well-known/jwks.json` and/or set `WINDY_PRO_JWKS_URL` in Cloud's `.env` on its EC2. This is a **cloud-side** PR, not a Pro-side change, but it's blocking for Phase-1↔Phase-3 cross-auth.

---

### §7 positive — mobile API shapes match

- `windy-pro-mobile/src/services/identityApi.ts` uses OAuth endpoints (`/api/v1/oauth/device`, `/api/v1/oauth/token`) with OAuth-standard snake_case (`access_token`, `refresh_token`, `expires_in`, `grant_type`). Server `routes/oauth.ts:401` handles `grant_type=refresh_token` and emits the same snake_case shape. ✓ **No drift.**
- windy-chat does not directly verify Pro JWTs (Synapse-driven auth + service-token-based provisioning). No JWKS dependency → no drift risk.
- windy-mail: not inspected (no `src/` found in `~/windy-mail`; repo layout appears different).

---

### §7 extra — other drift to flag

- Brief mentioned `/api/v1/health` should respond; it returns 404 on prod. `routes/misc.ts` only registers `/health` + `/healthz` (no `/api/v1/` alias). Minor. **P1-2.**

---

## §8 CORS + security headers + TLS

### 🟨 P2-5 — Missing `X-Frame-Options` header

Brief called for HSTS + X-Content-Type + X-Frame + CSP. We have HSTS + X-Content-Type-Options + Referrer-Policy, **but no X-Frame-Options or CSP on API responses**. A malicious site could `<iframe src="https://api.windyword.ai/">`. Low attack surface (no interactive UI on the API domain), but cheap to add.

**Fix:** add `X-Frame-Options: DENY` in the Express security-headers middleware (or in nginx).

---

### ⬜ P3-3 — `X-Powered-By: Express` leaks framework

Minor fingerprinting. `app.disable('x-powered-by')` is a one-liner.

---

### §8 positive

- CORS from **disallowed** origin (`https://evil.example.com`) → no `Access-Control-Allow-Origin` header. ✓
- CORS from **each** allowed origin (`windypro.com`, `windyword.ai`, `api.windyword.ai`) → correct ACAO echo + `Vary: Origin, Access-Control-Request-Headers`. ✓
- HSTS: `max-age=15552000; includeSubDomains; preload` — 180 days, preload-ready. ✓
- TLS 1.3 with AEAD-AES256-GCM-SHA384. ✓
- Let's Encrypt E7 cert, subject `api.windyword.ai`, expires 2026-07-18. ✓
- TLS 1.0 + TLS 1.1 handshakes rejected with protocol-version alert. ✓

---

## §9 Observability

### §9 positive

- Both containers healthy: `wave13-account-server-1 Up 4h (healthy)`, `wave13-redis-1 Up 11h (healthy)`.
- **0 WARN or ERROR lines** in the account-server container log in the last 10 min (filtered out the known-harmless "Invalid email or password" + "Too many attempts" from my own smoke probes).
- **0 webhook-bus worker errors** in the last 10 min (the `relation "webhook_deliveries" does not exist` loop we saw during Wave 13 deploy got fixed by migration 002 and is permanently silent now).
- Internal `curl 127.0.0.1:8098/health` → 12 ms. Container latency is fine.
- nginx error log: only two entries, both from 14:20 during container-between-restart window, historical.

Nothing fired during my ~30 min of testing that requires investigation.

---

## Triage order for the fix-it PR

1. **P0-1** — `_devToken` leak. One-line fix + one-line startup assertion. **Do this first, today.**
2. **P1-1** — windy-cloud JWKS URL. Cloud-side PR; blocks Phase-1↔Phase-3 auth.
3. **P0-2** — `GET /` landing page. Either ship a stub or build the web portal into the image.
4. **P1-3** — admin user bootstrap. Nothing works in the admin console until this lands.
5. **P1-2** — `/api/v1/health` alias.
6. **P2 cluster** — health latency cap, X-Frame-Options, non-API 404 JSON, timestamp replay on firehose, `path` field prefix.
7. **P3 cluster** — `aud` claim, X-Powered-By, Stripe endpoint shape.

Zero P0 and zero P1 is the "done" bar. Everything P2 can be one PR. P3 can batch into a polish PR.

---

## Artifacts

- Curl responses + headers: `/tmp/smoke-2026-04-19/`
- Memory: `~/.claude/projects/-Users-thewindstorm/memory/MEMORY.md`
- Prompt this report answers: `docs/WHITE_GLOVE_SMOKE_PROMPT.md`

_No fixes made — discovery only, per the prompt. Ready for your review._
