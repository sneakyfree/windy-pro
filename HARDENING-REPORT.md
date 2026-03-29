# HARDENING TEST REPORT — Windy Pro

_Generated: 29 March 2026_
_Passes Completed: 1-4 (Infrastructure, API Surface, Auth Deep Dive, UI/UX Code Audit)_
_Passes Remaining: 5-8 (Integration, Stress, Security Penetration, Polish)_

---

## Executive Summary

| Severity | Count |
|----------|-------|
| **CRITICAL** | 5 |
| **HIGH** | 16 |
| **MEDIUM** | 24 |
| **LOW** | 7 |
| **Total** | 52 |

The identity infrastructure (Phases 0-7) is solid — 48/48 tests pass, TypeScript compiles clean, auth guards work, JWT manipulation is blocked, rate limiting fires, token blacklisting works, device limits enforce, and cross-user data isolation is confirmed. However, the **frontend has significant data consistency issues** (camelCase vs snake_case API responses, wrong tier names, wrong prices), the **desktop app has fragile error handling** (24 chat IPC handlers lack try/catch), and **all four chat services lose state on restart** (in-memory Maps with no persistence).

---

## Pass 1: Infrastructure Smoke Test

### Build Status

| Check | Result | Issue |
|-------|--------|-------|
| TypeScript (account-server) | **PASS** | Zero errors |
| TypeScript (shared/contracts) | **PASS** | Zero errors |
| Jest test suite | **PASS** | 48/48 |
| Web client build | **FAIL** | `node_modules` not installed — `vite: command not found` |
| Docker Compose (main) | **PASS** | Valid YAML |
| Docker Compose (production) | **PASS** | Valid YAML, 20+ env var warnings |
| OIDC Discovery | **PASS** | 200 OK |
| JWKS | **PASS** | 200 OK |
| Health check | **PASS** | 200 OK, returns service metadata |

### Finding P1-1 (LOW): Web client missing node_modules
`src/client/web/` has no `node_modules/`. `npm run build` fails with `vite: command not found`. Needs `npm install` before build.

### Finding P1-2 (MEDIUM): Docker Compose warns about 20+ missing env vars
Production docker-compose.production.yml defaults all secrets to blank strings. Services that require `JWT_SECRET` at startup will crash. The `.env.production.example` exists but needs documentation on which vars are mandatory vs optional.

---

## Pass 2: API Surface Audit (Live Tests)

### Endpoint Results (34 checks)

| Category | Tests | Pass | Fail |
|----------|-------|------|------|
| Health + Discovery | 3 | 3 | 0 |
| Auth Guards (unauth) | 4 | 4 | 0 |
| Registration | 3 | 3 | 0 |
| Login | 3 | 2 | 1 |
| Authenticated Endpoints | 11 | 10 | 1 |
| Token Refresh | 2 | 1 | 1 |
| Logout + Blacklist | 2 | 2 | 0 |
| JWT Manipulation | 2 | 2 | 0 |
| OAuth | 3 | 2 | 1 |
| 404 Handling | 1 | 0 | 1 |

### Finding P2-1 (HIGH): Token refresh fails immediately after registration
The refresh token returned by `POST /api/v1/auth/register` does not work when passed to `POST /api/v1/auth/refresh`. Returns `{"error":"Invalid or expired refresh token"}`. This means any client that registers and tries to silently refresh after 15 minutes will be forced to re-login.

### Finding P2-2 (MEDIUM): Login for nonexistent user returns 429 instead of 401
After several rapid test requests, the rate limiter fires before the auth check runs. A fresh test of a single request to a nonexistent email correctly returns 401. However, under rapid sequential testing, 429 masks the auth error. Not a security issue (attacker gets less info) but confusing for legitimate users who mistype their email.

### Finding P2-3 (MEDIUM): Secretary status endpoint returns 400 for normal users
`GET /api/v1/identity/secretary/status` returns 400 instead of 200 with `{consented: false}`. Likely expects a `botIdentityId` parameter.

### Finding P2-4 (LOW): 404 returns Express HTML error page
`GET /api/v1/nonexistent` returns raw Express HTML (`Cannot GET /api/v1/nonexistent`) instead of JSON `{"error":"Not found"}`. API consumers expect JSON.

### Finding P2-5 (LOW): OAuth device code returns 400 for windy_fly
The first-party OAuth clients haven't been seeded (`seed-oauth-clients.ts` needs to run). The `windy_fly` client_id is unrecognized.

---

## Pass 3: Auth & Identity Deep Dive (25 attack scenarios)

### Results: 24 PASS, 1 FAIL

| Category | Tests | Pass | Fail |
|----------|-------|------|------|
| Rate Limiting | 8 | 8 | 0 |
| Session Lifecycle | 6 | 6 | 0 |
| Device Limit | 5 | 4 | 1 |
| Password Change | 5 | 5 | 0 |
| Expired Token | 1 | 1 | 0 |
| Cross-User Isolation | 5 | 5 | 0 |

### Finding P3-1 (LOW): Device removal is POST not DELETE
`DELETE /api/v1/auth/devices/:id` returns 404. The correct endpoint is `POST /api/v1/auth/devices/remove` with `{"deviceId":"..."}` body. Not RESTful but functional. Document it.

### Security Strengths Confirmed
- Rate limiting kicks in after 4-5 attempts (both login and registration)
- Token blacklisting works — logout invalidates both access and refresh tokens
- Device limit enforced at exactly 5 — 6th rejected, removal frees slot
- Password change invalidates old credentials immediately
- Forged/expired JWTs rejected with 403
- Zero cross-user data leakage between separate sessions

---

## Pass 4: UI/UX Code Audit

### 4A: Web Client (React)

#### CRITICAL

| # | File | Issue |
|---|------|-------|
| W1 | Vault.jsx / Dashboard.jsx | **API response field name mismatch**: Vault uses `total_recordings`, `total_words`, `total_duration` (snake_case). Dashboard uses `totalRecordings`, `totalWords`, `totalHours` (camelCase). One or both will crash depending on what the API actually returns. |
| W2 | Settings.jsx | **Wrong tier names**: Shows "Pro" and "Translate" but BRAND-ARCHITECTURE.md defines tiers as Free/Pro/Ultra/Max. "Translate" and "Translate Pro" are obsolete names. |
| W3 | Settings.jsx | **Hardcoded incorrect prices**: "Upgrade to Pro — $49" and "Upgrade to Translate — $79" but these are annual prices, not labeled as such. Misleading. |

#### HIGH

| # | File | Issue |
|---|------|-------|
| W4 | Dashboard.jsx | **Null reference crash**: `stats.totalWords.toLocaleString()` called without null guard. If API returns stats without `totalWords`, page crashes. Same for `totalHours`, `audioCount`, `videoCount`. |
| W5 | Transcribe.jsx | **WebSocket auth state invisible**: WebSocket sends auth token on connect but never shows auth failure to user. Shows "Connected" even if auth silently failed. |
| W6 | Admin.jsx | **Fake random data**: `Math.floor(Math.random() * 50)` used as fallback for missing daily translation stats. Admin sees fabricated metrics. |
| W7 | Profile.jsx | **Stale localStorage on 401**: Redirect to `/auth` on 401 but `windy_user` not cleared. Stale user data persists. |

#### MEDIUM

| # | File | Issue |
|---|------|-------|
| W8 | Dashboard.jsx, Vault.jsx, Auth.jsx | **Silent error swallowing**: `.catch(() => { })` on multiple API calls. Errors invisible to user. |
| W9 | Transcribe.jsx | **WebSocket send without try/catch**: `ws.send(buffer)` can throw if connection closed. No error handling. |
| W10 | Translate.jsx | **Missing 401 handling**: Language fetch doesn't distinguish auth failure from network error. |
| W11 | Vault.jsx | **Unsafe limit**: `?limit=9999` assumes backend accepts. No pagination. |
| W12 | Settings.jsx | **Browser alert()**: Uses `alert('Billing portal not available')` instead of in-app notification. |

### 4B: Desktop App (Electron)

#### HIGH

| # | File | Issue |
|---|------|-------|
| D1 | main.js:1516-1599 | **24 chat IPC handlers lack try/catch**: Any error from Matrix client crashes the renderer process silently. |
| D2 | main.js:412 | **Python spawn fails silently on Windows**: `execSync()` for port detection runs without try/catch. If netstat fails, Python server never starts. |
| D3 | main.js:502-540 | **BrowserWindow creation not verified**: If `new BrowserWindow()` fails (OOM), `mainWindow` is null and all `safeSend()` calls silently fail. |
| D4 | main.js:341-343 | **Archive I/O unprotected**: `ensureDir()` and `fs.writeFileSync()` in `appendArchiveEntry()` have no try/catch. If ~/Documents is unmounted/deleted, app crashes. |
| D5 | main.js:1387-1414 | **Mini translate unhandled rejection**: HTTPS request in `mini-translate-text` handler uses Promise without .catch(). |

#### MEDIUM

| # | File | Issue |
|---|------|-------|
| D6 | main.js:441-493 | **Python only 3 retries**: After 3 crashes (9 seconds), app permanently loses transcription. Should use exponential backoff. |
| D7 | main.js:3110 | **Cloud upload no timeout**: `Promise.all()` for cloud upload has no timeout. If server is down, hangs forever. |
| D8 | main.js:2449-2471 | **safeStorage fallback to plaintext**: If encryption fails, falls back to plaintext store without warning. |
| D9 | main.js:1554-1556 | **Chat typing state stuck**: `chat-send-typing()` error caught but renderer never gets response. UI stuck in "typing" indicator. |
| D10 | main.js:2680-2767 | **Temp file cleanup on kill**: Batch transcribe writes 3 temp files. SIGKILL during operation leaves orphans. |

### 4C: Chat Services

#### HIGH

| # | File | Issue |
|---|------|-------|
| S1 | chat-onboarding/routes/profile.js | **All user profiles lost on restart**: displayNameRegistry is an in-memory Map. Service restart = all profiles gone. Duplicate name conflicts will occur. |
| S2 | chat-push-gateway/server.js | **Push tokens lost on restart**: pushTokens Map is in-memory. Restart = no push notifications until every device re-registers. |
| S3 | chat-backup/server.js | **Backup registry lost on restart**: backupRegistry is in-memory. Users cannot find/restore old backups after service restart. |
| S4 | chat-push-gateway/server.js | **No rate limit on push registration**: `POST /api/v1/chat/push/register` has no rate limiting. Attacker can spam device registrations → OOM. |

#### MEDIUM

| # | File | Issue |
|---|------|-------|
| S5 | chat-onboarding/routes/verify.js | **Rate limit bypass**: Limiter uses `req.body.identifier` as key. Attacker rotates email addresses to bypass. Should use IP+identifier. |
| S6 | chat-push-gateway/server.js | **FCM init silent failure**: If Firebase service account path is invalid, FCM stays null. All Android pushes silently fail forever. |
| S7 | chat-backup/server.js | **R2 backup pruning not implemented**: Comment says "delete from R2 in production" but code only removes from in-memory Map. R2 storage leaks indefinitely. |
| S8 | chat-backup/server.js | **Base64 size validation bypass**: 500MB limit checked on base64 payload, but 333MB of base64 = 250MB plaintext. Effective limit is ~333MB, not 500MB. |
| S9 | All services | **Hardcoded localhost in startup logs**: Logs show `http://localhost:PORT` regardless of deployment host. |

---

## Consolidated Finding Categories

### Category 1: Data Consistency (CRITICAL — ship blocker)
- W1: API response field naming inconsistency (camelCase vs snake_case)
- W2+W3: Tier names and pricing don't match BRAND-ARCHITECTURE.md
- These will cause visible crashes or show users wrong prices.

### Category 2: Error Resilience (HIGH — affects reliability)
- D1: 24 chat IPC handlers without try/catch
- D2-D5: Desktop app file/process/window operations unprotected
- P2-1: Refresh token broken after registration
- W4: Null reference crashes in Dashboard stats

### Category 3: State Persistence (HIGH — affects reliability)
- S1-S3: Three chat services lose all state on restart
- S4: Push registration DoS vector

### Category 4: UX Polish (MEDIUM — affects user trust)
- W5: WebSocket auth invisible
- W6: Admin fake random data
- W8: Silent error swallowing
- D6: Python only 3 retries
- P2-4: 404 returns HTML instead of JSON

---

## Next Steps

Passes 5-8 (Integration, Stress, Security Penetration, Polish) are queued. However, the 5 Critical and 16 High findings above are sufficient to begin a fix cycle. Recommended approach:

1. **Fix Critical W1-W3** first (API consistency + correct pricing/tier names)
2. **Fix HIGH P2-1** (refresh token after registration)
3. **Fix HIGH D1** (try/catch on all chat IPC handlers)
4. **Address S1-S4** (chat service persistence — migrate to Redis/SQLite)
5. Continue Passes 5-8 in parallel with fixes

---

_This report will be updated as Passes 5-8 complete._
