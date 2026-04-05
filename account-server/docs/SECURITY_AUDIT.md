# Security Audit — Windy Pro Account Server

**Date:** 2026-03-29
**Auditor:** Claude (automated)
**Scope:** Full codebase review of `account-server/src/`

---

## 1. Endpoint Auth Middleware Coverage

Every endpoint was checked for proper authentication middleware (`authenticateToken`, `adminOnly`, or `optionalAuth`).

### Protected Endpoints (correct)

| Route File | Endpoints | Auth Middleware |
|---|---|---|
| `auth.ts` | `/register`, `/login` | `authLimiter` (public by design) |
| `auth.ts` | `/me`, `/devices`, `/devices/register`, `/devices/remove`, `/logout`, `/change-password`, `/billing`, `/create-portal-session` | `authenticateToken` |
| `auth.ts` | `/refresh` | `authLimiter` (uses refresh token, not JWT) |
| `admin.ts` | All endpoints | `authenticateToken` + `adminOnly` |
| `admin-console.ts` | All endpoints | `injectTokenFromCookieOrQuery` + `authenticateToken` + `adminOnly` |
| `identity.ts` | `/me`, `/products`, `/scopes`, `/audit`, `/chat/*`, `/api-keys`, `/secretary/*`, `/resolve/*`, `/provision-all` | `authenticateToken` |
| `identity.ts` | `/scopes/grant`, `/scopes/:scope`, `/backfill`, `/hatch/credentials` | `authenticateToken` + `adminOnly` |
| `identity.ts` | `/eternitas/webhook` | `botWebhookLimiter` + signature verification |
| `oauth.ts` | `/clients` (GET/POST) | `authenticateToken` + `adminOnly` |
| `oauth.ts` | `/authorize` (GET/POST), `/userinfo`, `/consents`, `/consents/:clientId`, `/device/approve`, `/consent` | `authenticateToken` |
| `oauth.ts` | `/token` | `tokenLimiter` (public by design — uses client credentials/codes) |
| `oauth.ts` | `/device` | `oauthLimiter` (public by design — device code flow) |
| `verification.ts` | `/send`, `/check`, `/status` | `authenticateToken` + `sendLimiter`/`hourlyLimiter` |
| `recordings.ts` | All endpoints | `authenticateToken` |
| `storage.ts` | All endpoints | `authenticateToken` |
| `translations.ts` | `/speech`, `/text` | `authenticateToken` |
| `clone.ts` | All endpoints | `authenticateToken` |
| `billing.ts` | `/transactions`, `/summary` | `authenticateToken` |

### Intentionally Public Endpoints

| Endpoint | Justification |
|---|---|
| `GET /health` | Health check, returns non-sensitive aggregate counts |
| `GET /api/v1/translate/languages` | Static list of supported languages |
| `POST /api/v1/stripe/webhook` | Stripe webhook — uses signature verification instead of JWT |
| `GET /download/*` | Public download links (proxy to GitHub releases) |
| `GET /api/v1/updates/check` | Public version check |
| `GET /.well-known/jwks.json` | Public key distribution (JWKS standard) |
| `GET /.well-known/openid-configuration` | OIDC discovery (standard) |

### Issues Found and Fixed

| Issue | Severity | Status |
|---|---|---|
| **`POST /api/v1/rtc/signal` — no auth** | HIGH | **FIXED** — Added `authenticateToken`. Without auth, anyone could inject SDP offers/answers and ICE candidates. |
| **`GET /api/v1/rtc/signal` — no auth** | HIGH | **FIXED** — Added `authenticateToken`. |
| **`POST /api/v1/transcribe` — `optionalAuth`** | MEDIUM | **FIXED** — Changed to `authenticateToken`. Resource-intensive endpoint (calls Whisper API) should not be publicly accessible. |
| **`POST /api/v1/transcribe/batch` — `optionalAuth`** | MEDIUM | **FIXED** — Changed to `authenticateToken`. |
| **`POST /api/v1/analytics` — no auth** | LOW | Intentionally public (client telemetry), but **FIXED**: added rate limiting (`30/min`) and schema validation to prevent abuse. |

---

## 2. Rate Limiting on Auth Endpoints

| Endpoint | Rate Limit | Status |
|---|---|---|
| `POST /register` | 5/min (`authLimiter`) | OK |
| `POST /login` | 5/min (`authLimiter`) | OK |
| `POST /refresh` | 5/min (`authLimiter`) | **FIXED** — was missing rate limiting |
| `POST /change-password` | Via `authenticateToken` (requires valid JWT) | OK |
| `POST /logout` | Via `authenticateToken` | OK |
| OAuth `/authorize` | 30/min (`oauthLimiter`) | OK |
| OAuth `/token` | 20/min (`tokenLimiter`) | OK |
| OAuth `/device` | 30/min (`oauthLimiter`) | OK |
| Verification `/send` | 5/min + 10/hour per identifier | OK |
| Verification `/check` | Via `authenticateToken` | OK |
| Bot API key creation | Via `authenticateToken` | OK |
| Eternitas webhook | 10/min (`botWebhookLimiter`) | OK |

---

## 3. SQL Injection Review

All database queries use parameterized queries (`?` placeholders via better-sqlite3 prepared statements or the PostgreSQL adapter's parameter translation). **No SQL injection vulnerabilities found.**

Verified patterns:
- `db.prepare('SELECT ... WHERE id = ?').get(userId)` — parameterized
- `stmts.findUserByEmail.get(email.toLowerCase())` — prepared statement
- `db.prepare('UPDATE users SET ... WHERE id = ?').run(...)` — parameterized
- Dynamic `WHERE` clauses in `admin.ts` use LIKE with parameterized values: `.all(like, like, limit, offset)`
- `clone.ts` builds `IN (${placeholders})` dynamically but uses `.get(...bundle_ids, userId)` — safe (values are parameterized, only the placeholder count is dynamic)

---

## 4. CORS Configuration

### Issue Found and Fixed

**Before:** `app.use(cors())` — allows requests from any origin with no restrictions.

**After:** CORS now respects `CORS_ALLOWED_ORIGINS` environment variable:
- If set (e.g., `CORS_ALLOWED_ORIGINS=https://windypro.thewindstorm.uk,https://app.windypro.com`), only listed origins are allowed.
- If unset, defaults to `true` (allow all) for development compatibility.
- `credentials: true` is set to support cookie-based auth for the admin console.

**Recommendation:** Set `CORS_ALLOWED_ORIGINS` in production deployments.

---

## 5. Sensitive Data in Logs and Error Responses

### Error Response Leaks (FIXED)

Multiple endpoints returned `err.message` in error responses, which can leak internal details (file paths, SQL errors, stack traces) to clients.

**Fixed in:**
- `auth.ts` — register, login, change-password, billing errors
- `recordings.ts` — all catch blocks (12 instances)
- `storage.ts` — all catch blocks (4 instances)
- `billing.ts` — webhook parse error, transactions, summary
- `transcription.ts` — single and batch transcription
- `clone.ts` — training-data, start-training
- `downloads.ts` — release fetch errors
- `misc.ts` — license activation, OCR translation
- `identity.ts` — backfill error

All now return generic error messages. Internal error details are only logged server-side via `console.error`.

### Logging Review

| What's logged | Safe? |
|---|---|
| User email on register/login | Acceptable (server logs only) |
| User ID (truncated to 8 chars) | OK |
| OTP codes | **Safe** — never logged, redacted in audit trail |
| Passwords | **Safe** — never logged |
| API keys | **Safe** — only prefix stored/logged |
| License keys | Logged with first 7 chars only | OK |
| Analytics properties | **FIXED** — removed `JSON.stringify(properties)` from log output |
| Matrix access tokens | **Safe** — never returned in GET endpoints |
| JWT tokens | **Safe** — never logged |

### Admin Console

Admin-facing error pages (admin-console.ts) still show `escapeHtml(err.message)`. This is acceptable since these pages are behind `authenticateToken` + `adminOnly` middleware — only admins can see them.

---

## 6. Token Blacklist Verification (Logout Flow)

### How it works

1. **Logout** (`POST /api/v1/auth/logout`):
   - Deletes all refresh tokens for the user from the DB
   - Hashes the current access token with SHA-256
   - Adds the hash to both Redis (with 15-min TTL matching token expiry) and the SQLite/PostgreSQL `token_blacklist` table
   - Cleans expired blacklist entries

2. **Token verification** (`authenticateToken` middleware):
   - Verifies JWT signature and expiry
   - Computes SHA-256 hash of the token
   - Checks Redis blacklist (if available), falls back to DB blacklist
   - Rejects the token if blacklisted

### Issue Found and Fixed

**Race condition in Redis blacklist check:** The async Redis check could allow both the error response and the success path to execute if timing was unlucky.

**Fix:** Added `res.headersSent` guards to prevent double responses.

### Remaining Considerations

- **Refresh tokens are stored in plaintext:** If the DB is compromised, all refresh tokens are exposed. Hashing with SHA-256 (like access tokens) would be more secure. Noted as a future improvement.
- **Blacklist cleanup:** Expired entries are cleaned on logout and by the maintenance job. No unbounded growth risk.

---

## Additional Findings

### HIGH Severity

| Finding | Status |
|---|---|
| **RTC sessions grow unbounded** — `rtcSessions` Map in `misc.ts` never cleaned up. Attacker could exhaust memory by creating thousands of sessions. | **FIXED** — Added 5-minute TTL, periodic cleanup, and cap of 1000 sessions. |
| **Chunk upload store grows unbounded** — In-memory `chunkStore` in `recordings.ts` has no limit on concurrent bundles or chunk data size. | **FIXED** — Added 50-bundle cap, 10MB per-chunk limit, and 10-minute auto-cleanup. |

### MEDIUM Severity

| Finding | Status |
|---|---|
| **`bcrypt.compareSync` in change-password** blocks the event loop. | **FIXED** — Changed to async `bcrypt.compare` + `bcrypt.hash`. |
| **Stripe webhook accepts unverified requests** when `STRIPE_WEBHOOK_SECRET` is unset. | **FIXED** — Webhook now rejects all requests if secret is not configured. Also uses `crypto.timingSafeEqual` for constant-time signature comparison. |
| **`/refresh` endpoint had no rate limiting** — could be brute-forced. | **FIXED** — Added `authLimiter` (5/min). |

### LOW Severity (Not Fixed — Noted for Future)

| Finding | Notes |
|---|---|
| Refresh tokens stored in plaintext in DB | Should hash with SHA-256 like access token blacklist. Requires migration. |
| No password complexity enforcement | Registration accepts any password. Consider minimum 8 chars. |
| `PATCH /api/v1/identity/me` accepts unvalidated `avatarUrl` | Could be a `data:` URI or phishing URL. Add URL validation. |
| Admin tier change accepts arbitrary `storageLimit` values | Should validate non-negative and within bounds. |
| OAuth consent form has no CSRF token | The form posts to the same origin and requires a valid JWT, mitigating most CSRF risk. |
| PostgreSQL adapter uses `execSync` per query | Performance concern, not a direct security vulnerability. |

---

## Summary

| Category | Issues Found | Fixed | Noted |
|---|---|---|---|
| Auth middleware gaps | 5 | 5 | 0 |
| Rate limiting gaps | 2 | 2 | 0 |
| SQL injection | 0 | — | — |
| CORS misconfiguration | 1 | 1 | 0 |
| Sensitive data leaks | 15+ | 15+ | 0 |
| Token blacklist issues | 1 | 1 | 1 |
| Memory DoS vectors | 2 | 2 | 0 |
| Sync crypto blocking | 1 | 1 | 0 |
| Webhook signature bypass | 1 | 1 | 0 |
| **Total** | **28+** | **28+** | **1** |
