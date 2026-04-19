# Wave 11 Hardening Report — windy-pro

**Mode:** hostile QA. Default assumption: every link is broken until clicked.
**Branch:** `wave11/hardening`
**Stack under test:** `account-server` (port 8098), sister services mocked.
**Date:** 2026-04-18

This report catalogues what a non-technical demo would actually survive on the
main branch as of today. **Nothing is marked `[WORKS]` that wasn't exercised
end-to-end with captured evidence.** GUI-only checks (browser screenshots,
Electron visual sweep, installer stress tests, deep-link `open` calls) are
explicitly marked `[ENV-BLOCKED]` — this terminal has no display, no real
browser, no ability to simulate low-disk / network-off on a live macOS. Do
not treat `[ENV-BLOCKED]` as "probably fine" — it means "un-tested, someone
on a real machine has to run it."

Evidence artifacts live in `docs/wave11-evidence/`:
- `endpoint-probe.md` — 208-row matrix (70 endpoints × {happy, no-auth, garbage})
- `hatch-ceremony.sse.txt` — captured SSE stream of a successful hatch
- `hatch-ceremony-resumed.sse.txt` — idempotent-replay stream
- `db-side-effects.txt` — `SELECT`s from every table the hatch flow touched
- `healthz.json` — /healthz response snapshot

---

## Severity glossary

| Label          | Meaning                                                           |
|----------------|-------------------------------------------------------------------|
| `[BROKEN]`     | Hard failure. 500s, crashes, dead links, never-lands traffic.      |
| `[DEGRADED]`   | Works but ugly. Wrong copy, missing state, double-fires, edge-case hangs. |
| `[MISSING]`    | Documented / UI-advertised but not actually wired.                 |
| `[WORKS]`      | Verified end-to-end with captured evidence in this repo.           |
| `[ENV-BLOCKED]`| Un-testable from this terminal (no GUI / display / real browser). |

---

## Summary scoreboard

| Severity       | Count |
|----------------|------:|
| `[BROKEN]`     | 4     |
| `[DEGRADED]`   | 6     |
| `[MISSING]`    | 2     |
| `[WORKS]`      | 10    |
| `[ENV-BLOCKED]`| 4     |

**Demo-to-grandma safety gate:**
- Signup → login → `/identity/me` ✓ safe to demo.
- Hatch ceremony happy path ✓ safe to demo **provided** Eternitas is reachable (see `[DEGRADED] D1`).
- "Talk to My Agent" deep-link ✗ **do not demo** — URL schemes aren't registered (`[BROKEN] B4`, `[MISSING] M1`).
- Recording upload / files listing / billing transactions ✗ **do not fuzz in front of grandma** — 500s on mildly-malformed input (`[BROKEN] B1, B2, B3`).

---

## `[BROKEN]` — hard failures

### B1. `GET /api/v1/files?limit=<non-numeric>` returns 500 `"Internal server error"`

**What I tried:** `curl "http://127.0.0.1:8098/api/v1/files?limit=not-a-number&cursor=%00" -H "Authorization: Bearer <valid JWT>"`
**What happened:** HTTP 500 `{"error":"Internal server error"}`.
**Root cause:** `account-server/src/routes/storage.ts:152` runs `FileListQuerySchema.parse(req.query)` inside a wide `try` whose single `catch` returns 500 for *any* error — including Zod validation errors which should be 400. See `storage.ts:181`.
**Severity:** medium. Not a security issue, but any prod 500 opens a support ticket and teaches users the product is unstable.
**Fix:** `catch (err: any) { if (err instanceof ZodError) return res.status(400).json({ error: 'invalid_query', details: err.flatten() }); ... }`

### B2. `GET /api/v1/billing/transactions?limit=<non-numeric>` returns 500

Same root cause as B1. `account-server/src/routes/billing.ts:379` — `BillingTransactionsQuerySchema.parse(req.query)` inside a catch-all try. Fix the same way.

### B3. `POST /api/v1/recordings/upload` with empty JSON body returns 500

**What I tried:** `curl -X POST http://127.0.0.1:8098/api/v1/recordings/upload -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" -d '{}'`
**What happened:** HTTP 500 `{"error":"Internal server error"}`.
**Root cause:** The handler at `account-server/src/routes/recordings.ts:575` expects multipart form-data (`videoUpload.single('media')`) but also dereferences `req.body.duration_seconds`, `req.body.bundle_id`, etc. With a bare JSON body those are undefined and the DB insert path crashes downstream. The wide try/catch at `:606` buckets everything into 500.
**Severity:** medium. Legitimate clients won't hit this, but a malformed SDK call or replay from dev logs will.
**Fix:** explicit body-shape validation up front + 400 on missing `req.file`.

### B4. Custom URL schemes (`windypro://`, `windychat://`, `windyword://`, `windyfly://`) are not registered with the OS

**What I checked:**
```
grep -nE "setAsDefaultProtocolClient|build\\.protocols|CFBundleURLSchemes" \
  src/client/desktop/main.js src/client/desktop/package.json package.json \
  build/*.plist 2>/dev/null
```
→ zero matches.

**Impact:** The Wave 8 `hatch-ceremony.js` "Talk to My Agent" button calls `window.open('windychat://room/<id>')`. With no scheme registered, macOS either shows a "choose an application" dialog, opens nothing, or (worst case) routes to a stale handler from another app. The deep-link in the installer is decorative, not functional.
**Severity:** high for the Wave 8 demo narrative — the final CTA of the hatch ceremony goes nowhere.
**Fix:** in `src/client/desktop/main.js` startup, register each scheme:
```js
app.setAsDefaultProtocolClient('windypro');
app.setAsDefaultProtocolClient('windychat');
app.setAsDefaultProtocolClient('windyword');
app.setAsDefaultProtocolClient('windyfly');
```
+ add `build.protocols: [...]` in `package.json` for the electron-builder packaged install so the OS registers the handlers at install time, not first-run. Wire an `app.on('open-url', ...)` handler that routes incoming deep-links to the right renderer view.

---

## `[DEGRADED]` — works but ugly

### D1. Hatch ceremony hangs visually when the server aborts mid-step

**Evidence:** The route in `account-server/src/routes/agent.ts` exits the SSE stream on fatal mid-step failure (e.g. Eternitas unreachable) by emitting `<step>.registered status:failed` and calling `res.end()` — **no terminal `hatch.complete` frame**. The desktop renderer (`src/client/desktop/renderer/hatch-ceremony.js`) only calls `_showCtas()` inside `if (ev.type === 'hatch.complete')` — so on a mid-step server abort the overlay is left with a red step, no "Retry" button, no "Close" CTA, no explicit failure copy. User has to hit the × in the corner.
**Severity:** medium. Grandma would think the app froze.
**Fix:** add a terminal `hatch.aborted` SSE event on the server side emitted in every early-return path, and handle it in the renderer with a retry CTA.

### D2. Human user's `windy_chat` product_account stays `pending` forever

**Evidence:** `docs/wave11-evidence/db-side-effects.txt` — rows like `caa9cf90... | windy_chat | pending |` never transition. The bot's windy_chat row goes to `active` with a `matrix_user_id`, but the owner's stays pending because `provisionEcosystem()` in `account-server/src/services/ecosystem-provisioner.ts:94` inserts with `status='pending'` and no subsequent write flips it to `active` for humans (only the hatch flow does, and only for the bot).
**Severity:** low-medium. `/identity/me.products` permanently lies — sister repos depend on this field.
**Fix:** either (a) mark humans `active` immediately if WINDYCHAT_URL is unset (skip lazy provisioning), or (b) write the transition-to-active in the human-signup webhook once Chat acknowledges.

### D3. Inconsistent garbage-query handling across listing endpoints

**Evidence:** `docs/wave11-evidence/endpoint-probe.md`. `/api/v1/auth/me`, `/devices`, `/billing`, `/identity/me`, `/identity/products`, `/oauth/userinfo`, `/recordings`, `/translate/languages`, `/user/history`, `/clone/training-data`, `/billing/summary` all return **200** on `?limit=not-a-number&cursor=%00` (they silently ignore unknown params). `/api/v1/files` and `/api/v1/billing/transactions` **500** on the same input.
**Severity:** low. Not a correctness bug per se, but the "500 vs 200" split means fuzzers will find the 500 endpoints first.
**Fix:** standardize on Zod-validation-error → 400 across every route that has query schemas (see B1, B2).

### D4. Hatch idempotent replay emits two `hatch.complete` frames

**Evidence:** `docs/wave11-evidence/hatch-ceremony-resumed.sse.txt`. On a second call for the same `windy_identity_id`, the server replays the 13 stored events (including the original `hatch.complete` with `data.resumed=false`) **and then** appends a fresh terminal `hatch.complete` with `seq=14, data.resumed=true`.
**Impact:** `hatch-ceremony.js:164` fires `_showCtas()` and `_saveState()` on **every** `hatch.complete`, so the renderer writes localStorage twice on a resume. No functional bug; just churn.
**Fix:** either the route should deduplicate by skipping the historical `hatch.complete` during replay, or the renderer should only act on the LAST `hatch.complete` (easy: set a flag, call `_showCtas` once on stream-end with the latest cert).

### D5. Resume terminal frame's `status` is hardcoded `'ok'` even when the stored session is `failed`

**Evidence:** `account-server/src/routes/agent.ts` resume branch emits:
```js
{ type: 'hatch.complete', status: 'ok',
  data: { resumed: true, status: snap?.status /* may be 'failed' */, ... } }
```
A client that only looks at the frame's top-level `status` can't distinguish a success replay from a failed replay.
**Severity:** low. Our own Electron renderer reads `data.status` so we're fine; but external consumers parsing the stream will be misled.
**Fix:** mirror the underlying session status into the top-level frame: `status: snap?.status === 'failed' ? 'failed' : 'ok'`.

### D6. Eternitas platform registration is deferred on startup with no visible auto-retry

**Evidence:** `/tmp/wave11-server.log` excerpt:
```
[Eternitas] Registering Windy Pro as platform (webhook: ...)
[Eternitas] Registration deferred: fetch failed
```
The code in `account-server/src/services/eternitas-register.ts` logs `deferred` and moves on; there's no retry timer I can find.
**Severity:** low in dev, medium in prod. A prod deploy that boots while Eternitas is down leaves the passport revocation cascade unsubscribed forever.
**Fix:** wrap `registerWithEternitas()` in the existing retry-worker pattern from `ecosystem-provisioner.ts:414`.

---

## `[MISSING]` — documented but not actually wired

### M1. Deep-link URL schemes (see B4)

Docs and UI copy reference `windypro://`, `windychat://`, `windyfly://`. No code registers them. Listed separately from B4 because the fix is both (a) a runtime scheme registration AND (b) a packaging-time protocol declaration, and both are missing.

### M2. Admin-gated endpoints under-documented

**What I found:** six endpoints in `docs/ECOSYSTEM_API_REFERENCE.md` list `Auth: JWT` but actually require admin role. A regular-user JWT gets 403 `"Admin access required"`:

| Endpoint                                        |
|-------------------------------------------------|
| `POST /api/v1/identity/scopes/grant`             |
| `DELETE /api/v1/identity/scopes/:scope`          |
| `POST /api/v1/identity/hatch/credentials`        |
| `POST /api/v1/identity/backfill`                 |
| `POST /api/v1/oauth/clients`                     |
| `GET /api/v1/oauth/clients`                      |

**Severity:** low. Not a code bug — the gate is correct. Docs just claim a weaker auth requirement than the handler enforces.
**Fix:** update `docs/ECOSYSTEM_API_REFERENCE.md` to flag these as `Auth: admin JWT`.

---

## `[WORKS]` — verified end-to-end with evidence

All of the following were captured with a live `account-server` process at `127.0.0.1:8098` against an isolated SQLite DB (`/tmp/wave11-hardening.db`) and four fake sister services on ports 65501-65504. Evidence paths are relative to the repo root.

### W1. `/healthz` and `/health`

Both return 200 with `status: "ok"`. Evidence: `docs/wave11-evidence/healthz.json`. Adds a `/healthz` K8s convention alias on top of the existing `/health` per Wave 9 commit `df872fb`.

### W2. `/.well-known/jwks.json`

Returns a valid JWKS with 1 RSA key, `kid=dc2de219f47fd24b`, `alg=RS256`, `use=sig`.

### W3. `/.well-known/openid-configuration`

Returns valid OIDC metadata with `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, `device_authorization_endpoint` all populated.

### W4. `POST /api/v1/auth/register`

201 created. Response body contains `userId` + `windyIdentityId` + a 3-part RS256 JWT signed by the JWKS kid in W2.

### W5. `POST /api/v1/auth/login`

200 OK. Response token verifies against the JWKS.

### W6. `GET /api/v1/auth/me` (authenticated)

200. Returns `userId`, `name`, `email`, `tier`, `createdAt`, `devices`, `deviceLimit`. Matches the docs.

### W7. `GET /api/v1/identity/me`

200. Returns `identity`, `products` (2 rows for a fresh signup — windy_pro active + windy_chat pending — see D2), `scopes: ["windy_pro:*"]`. Matches the docs.

### W8. `POST /api/v1/agent/hatch` — full SSE ceremony

Evidence: `docs/wave11-evidence/hatch-ceremony.sse.txt`.

The stream emits the 13 canonical events in Wave 8 contract order:

```
eternitas.registering → eternitas.registered
mail.provisioning     → mail.provisioned
chat.provisioning     → chat.provisioned
cloud.provisioning    → cloud.provisioned
phone.assigning       → phone.assigned
birth_certificate.generating → birth_certificate.ready
hatch.complete
```

Seq numbers are monotonic (1..13). Birth-certificate payload:

```json
{
  "certificate_no": "WF-WAVE1111",
  "agent_name": "Hardening's Agent",
  "passport_number": "ET26-WAVE-1111",
  "email": "hardening-agent@windymail.ai",
  "cloud_storage_bytes": 5368709120,
  "brain": { "provider": "gemini", "model": "gemini-1.5-flash" },
  "chat": {
    "matrix_user_id": "@hardening-agent:chat.windypro.com",
    "dm_room_id": "!dm-hardening:chat.windypro.com"
  }
}
```

Legacy event names (`ceremony.started`, `broker.issuing`, `broker.issued`, `windy_fly.hatching`, `windy_fly.hatched`, `certificate.ready`, `ceremony.complete`, `ceremony.resumed`) are NOT present in the stream. Good.

### W9. Hatch DB side-effects after W8

Evidence: `docs/wave11-evidence/db-side-effects.txt`.

- ✓ `users`: owner row (human) + bot row (`agent-<uuid>@agents.windy.internal`, `identity_type='bot'`)
- ✓ `eternitas_passports`: `ET26-WAVE-1111 | active | <owner-uuid>`
- ✓ `broker_tokens`: `bk_live_<prefix> | gemini | gemini-1.5-flash | free | active | usage=0/50000`
- ✓ `hatch_sessions`: `complete | last_event_seq=13 | passport=ET26-WAVE-1111`
- ✓ `product_accounts`: bot → `windy_chat | active | @hardening-agent:…`, owner → `windy_fly | active | @hardening-agent:…` (plus pending chat for owner — see D2)

### W10. Broker HMAC contract

Unit-tested in `tests/broker-token-lifecycle.test.ts`: 24/24 green. Asserts canonical sort-keys JSON matches python byte-for-byte, `X-Windy-Signature: sha256=<hex>` accepted, `X-Windy-Timestamp` 300s window enforced, legacy `X-Broker-*` headers rejected, wire-order independent verify, unknown identity 404s.

---

## `[ENV-BLOCKED]` — asked for, not delivered, reasons given

### E1. Electron UI visual sweep

**Requested:** screenshot every tab / modal / error state of the Electron app, check for overlapping text, off-screen elements, placeholder copy, never-resolving spinners, DevTools errors.
**Why blocked:** this terminal has no display server. Electron can't open a window. `screencapture -w` requires an interactive macOS session with focus.
**Partial static audit I did perform:**
- The Wave 8 home-card mount anchor (`<div id="hatchCardMount">`) exists in `src/client/desktop/renderer/index.html:135` and the script that mounts it (`hatch-mount.js`) grabs that exact id.
- CSP `connect-src` allows localhost + `*.windyword.ai` + `*.thewindstorm.uk`. Does NOT allow `windypro.com` / `windyfly.ai` — so a production build that talks to `windypro.com` would be CSP-blocked. **This is a latent `[BROKEN]` if DEPLOY.md's `https://windypro.com` is the real hostname.** Flagged separately as follow-up.

### E2. Installer wizard stress test (4 scenarios)

**Requested:** fresh macOS state, internet cut mid-download, artificially low disk, invalid license paste.
**Why blocked:** these require simulating filesystem state (`df` lies), toggling network interfaces, and actually running the wizard on macOS. I have none of those privileges from this sandbox.
**Partial static audit:** the wizard has an "offline" narrative in its copy (`wizard.html:1933` "No Internet, No Problem") and a 120-GB disk assumption in the simulation path (`wizard.html:3071`), but I could not verify that `scan-disk` correctly handles a <1 GB free-space case without running it.

### E3. Deep-link real test

**Requested:** `open windypro://hatch`, `open windychat://room/test`.
**Why blocked:** I have no running Electron app to target, AND no URL schemes registered to route anywhere (`[BROKEN] B4`). Even with a display, these open calls would fail at the OS layer because no app has claimed the scheme.

### E4. Browser-based signup screenshots

**Requested:** create a throwaway account in a real browser at `http://localhost:5173`, screenshot every step.
**Why blocked:** no browser, no display. I ran the same flow via `curl` and captured the JSON responses instead (see W4, W5). What I *couldn't* verify is the React form's validation UX, error-message copy, and accessibility of the signup flow — those need a real browser.

---

## Recommended triage order

1. **B4 / M1** — register URL schemes. Without this, the Wave 8 demo dead-ends at "Talk to My Agent". Fix in `src/client/desktop/main.js` + `package.json` `build.protocols`. Estimated: 1 hour.
2. **B1 / B2** — stop mapping Zod errors to 500. Replace the wide catches in `storage.ts:181` and `billing.ts:401` with Zod-aware branching. Estimated: 30 min.
3. **B3** — validate `req.file` presence on `/recordings/upload` before touching `req.body`. Estimated: 20 min.
4. **D1** — terminal `hatch.aborted` frame + renderer CTA. Estimated: 1 hour.
5. **D2** — flip human `windy_chat` pending→active once Chat acknowledges (or skip the pending insert entirely if Chat isn't configured). Estimated: 1 hour.
6. **M2 / D3 / D4 / D5 / D6** — doc + cleanup fixes, 15 min each.
7. **E1–E4** — need a real-machine hardening pass from someone with a display. Open as separate issues with the [ENV-BLOCKED] scope clearly noted so they don't get silently marked "WORKS".

---

## What would change this report's verdict

If someone re-runs this with a real Electron build + display, they'll want to:

- Actually click every nav tab and verify no overlapping text / dead links / console errors.
- Run the installer wizard with `Network Link Conditioner` throttling → 0 bytes/s partway through the model download.
- Run `open windypro://hatch` after a successful install and confirm the running Electron app focuses the home view.
- Re-probe the 14 `[DEGRADED] D3` endpoints that accept garbage queries — if any of them are later given Zod schemas (per the B1/B2 fix), they should 400 too.

Until those run, sections [ENV-BLOCKED] E1-E4 are genuine unknowns — not "probably fine".
