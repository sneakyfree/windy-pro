# SECURITY AUDIT REPORT — Windy Pro MVP Hardening

_Generated: 28 March 2026_
_Auditor: Claude Opus 4.6_
_Scope: Full codebase at `/Users/thewindstorm/windy-pro/`_

---

## Executive Summary

| Severity | Count |
|----------|-------|
| **CRITICAL** | 7 |
| **HIGH** | 9 |
| **MEDIUM** | 12 |
| **LOW** | 9 |
| **Total** | 37 |

The codebase has strong foundational security: `nodeIntegration: false`, `contextIsolation: true`, `contextBridge` usage, `safeStorage` for Stripe keys, bcrypt password hashing, parameterized SQL queries, and a reasonable CSP. However, there are several critical issues — particularly around `Math.random()` used for security-sensitive values (OTPs, license keys), a plaintext password stored in `electron-store`, unauthenticated WebSocket audio processing, and CORS wildcard on the gateway proxy — that must be fixed before production.

---

## CRITICAL Findings

### C1. Plaintext Cloud Password Stored in electron-store
- **File**: `src/client/desktop/main.js:3534`
- **Code**: `store.set('engine.cloudPassword', password);`
- **Issue**: User's cloud account password is stored in plaintext in the electron-store config file (typically `~/.config/windy-pro/config.json`). Any process or attacker with filesystem access can read it. The app already uses `safeStorage` for Stripe keys — the same pattern should be used here.
- **Fix**: Use `safeStorage.encryptString(password)` and store the encrypted buffer. On read, use `safeStorage.decryptString()`.

### C2. OTP Generation Uses Math.random()
- **File**: `services/chat-onboarding/routes/verify.js:90-91`
- **Code**:
  ```javascript
  function generateOTP() {
    return String(100000 + Math.floor(Math.random() * 900000));
  }
  ```
- **Issue**: `Math.random()` is not cryptographically secure. OTP values can be predicted if an attacker observes the PRNG state. Combined with only 1M possibilities (6 digits), this is brute-forceable.
- **Fix**: `return String(crypto.randomInt(100000, 999999));` (Node.js 14.10+).

### C3. License Key Generation Uses Math.random()
- **File**: `services/account-server/routes/payments.js:457-459`
- **Code**:
  ```javascript
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  ```
- **Issue**: License keys generated with `Math.random()` are predictable. An attacker could guess valid keys.
- **Fix**: Use `crypto.randomBytes()` or `crypto.randomInt()` for each character selection.

### C4. Hardcoded JWT Secret Fallback Reachable via Misconfiguration
- **File**: `account-server/src/config.ts:12-14`
- **Code**:
  ```typescript
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      if (name === 'JWT_SECRET') return 'windy-pro-dev-only-secret-DO-NOT-USE-IN-PROD';
  }
  ```
- **Also**: `services/account-server/server.js:47` — `const JWT_SECRET = process.env.JWT_SECRET || 'windy-pro-dev-secret-change-in-production';`
- **Issue**: If production accidentally runs without `NODE_ENV=production` or without `JWT_SECRET` set, all tokens become forgeable with a known string. The legacy server has an unconditional fallback.
- **Fix**: In production, throw a hard error if `JWT_SECRET` is not set. Remove the fallback entirely from the legacy server.

### C5. CORS Wildcard on Gateway Proxy
- **File**: `services/gateway-proxy.js:52, 79`
- **Code**: `headers['access-control-allow-origin'] = '*';`
- **Issue**: The gateway proxy sets `Access-Control-Allow-Origin: *` unconditionally, allowing any website to make API requests to the backend.
- **Fix**: Replace with an explicit origin whitelist. Validate the `Origin` header against approved domains.

### C6. Sensitive Data Logged in Plaintext (OTP Codes + Phone Numbers)
- **File**: `services/chat-onboarding/routes/verify.js:104, 118, 135, 161`
- **Code**:
  ```javascript
  console.log(`📱 SMS OTP for ${phone}: ${code}`);
  console.log(`📧 Email OTP for ${email}: ${code}`);
  ```
- **Issue**: OTP codes and user PII (phone numbers, emails) are logged to stdout. In any production logging pipeline, this data would be captured and stored, potentially accessible to anyone with log access.
- **Fix**: Remove OTP code logging entirely. Redact PII: log only `OTP sent to ***1234` (last 4 digits) or `OTP sent to g***@***.com`.

### C7. No File Type Validation (Magic Bytes) on Upload
- **File**: `services/cloud-storage/server.js:131, 246, 265, 284`
- **Issue**: Multer accepts files based on extension and MIME type only — both are trivially spoofable. An attacker could upload an executable renamed as `.wav`.
- **Fix**: Use the `file-type` npm package to validate magic bytes after upload. Reject files whose detected type doesn't match the expected type.

---

## HIGH Findings

### H1. WebSocket Accepts Audio Without Authentication
- **File**: `account-server/src/server.ts:121-162`
- **Code**:
  ```typescript
  ws.on('message', (data: Buffer | ArrayBuffer | string) => {
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          chunkCount++;  // No auth check — processes audio immediately
          return;
      }
  ```
- **Issue**: The WebSocket endpoint accepts and processes binary audio data before the client has sent an auth token. An unauthenticated client can consume transcription resources.
- **Fix**: Reject all binary data until `authenticated === true`. Close the connection if no auth message is received within 5 seconds.

### H2. Guest Access to Resource-Intensive Translation Endpoint
- **File**: `account-server/src/routes/translations.ts:40`
- **Code**: `router.post('/speech', optionalAuth, upload.single('audio'), ...)`
- **Issue**: The speech translation endpoint uses `optionalAuth`, allowing unauthenticated "guest" users to upload audio for transcription + translation. This consumes expensive API calls (Groq/OpenAI).
- **Fix**: Change `optionalAuth` to `authenticateToken` for resource-intensive endpoints.

### H3. About Window: shell.openExternal Without URL Validation
- **File**: `src/client/desktop/main.js:768-771`
- **Code**:
  ```javascript
  aboutWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);  // No isSafeURL() validation
    return { action: 'deny' };
  });
  ```
- **Issue**: The About window opens external URLs without passing them through the `isSafeURL()` validator that exists elsewhere in the codebase. Could be exploited if the About window content is modified.
- **Fix**: Add `if (isSafeURL(url))` guard before `shell.openExternal(url)`.

### H4. OAuth Popup: Unrestricted URL Loading
- **File**: `src/client/desktop/main.js:2581-2604`
- **Code**:
  ```javascript
  popupWin.webContents.setWindowOpenHandler(({ url: nestedUrl }) => {
    popupWin.loadURL(nestedUrl);  // No protocol validation
    return { action: 'deny' };
  });
  ```
- **Issue**: Nested OAuth popup loads any URL without validating the protocol. An attacker controlling redirect URLs could inject `file://` or `javascript:` schemes.
- **Fix**: Validate that `nestedUrl` starts with `https://` before loading.

### H5. JWT Algorithm Not Explicitly Set in Sign or Verify
- **File**: `account-server/src/routes/auth.ts:38-42` (sign) and `account-server/src/middleware/auth.ts:33` (verify)
- **Code**:
  ```typescript
  // Sign — no algorithm specified:
  const accessToken = jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRY });
  // Verify — no algorithms whitelist:
  const decoded = jwt.verify(token, config.JWT_SECRET);
  ```
- **Issue**: Without an explicit `algorithms: ['HS256']` in `jwt.verify()`, the library's default behavior is relied upon. While `jsonwebtoken` defaults safely today, this is a known attack surface (algorithm confusion / `"alg": "none"` attacks) and should be locked down.
- **Fix**: Add `{ algorithm: 'HS256' }` to `jwt.sign()` and `{ algorithms: ['HS256'] }` to `jwt.verify()`.

### H6. Hardcoded Stripe Test Key Placeholder
- **File**: `services/account-server/routes/payments.js:29`
- **Code**: `const stripeClient = stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');`
- **Issue**: Fallback to a placeholder key if the environment variable is missing. The app will start without error and silently fail billing operations.
- **Fix**: Throw on startup if `STRIPE_SECRET_KEY` is not set.

### H7. Error Messages Expose Internal Details
- **File**: `web-proxy.js:29`
- **Code**: `res.end(JSON.stringify({ error: 'API server unavailable', details: e.message }));`
- **Issue**: `e.message` may contain internal paths, stack frames, or database error details. This helps attackers map the backend.
- **Fix**: Return generic error messages. Log detailed errors server-side only.

### H8. Linux External Browser Window Allows Unrestricted Navigation
- **File**: `src/client/desktop/main.js:2609-2612`
- **Code**:
  ```javascript
  extWin.webContents.on('will-navigate', (event, navUrl) => {
    // Allow all navigation — needed for OAuth flows
  });
  ```
- **Issue**: Empty `will-navigate` handler with a comment explaining it's intentional. However, it permits navigation to `file://`, `javascript:`, and other dangerous protocols.
- **Fix**: Allow only `https://` and `http://` protocols.

### H9. CHAT_API_TOKEN Falls Through on Empty String
- **File**: `services/chat-backup/server.js:42-55` (and chat-onboarding, chat-directory, chat-push-gateway)
- **Code**:
  ```javascript
  const CHAT_API_TOKEN = process.env.CHAT_API_TOKEN || '';
  // ...
  if (!CHAT_API_TOKEN || token !== CHAT_API_TOKEN) { ... }
  ```
- **Issue**: If `CHAT_API_TOKEN` is set to empty string, the `!CHAT_API_TOKEN` check passes, so `token !== ''` must also fail — meaning an empty Bearer token would be rejected. However, the pattern is fragile and each service duplicates this logic slightly differently.
- **Fix**: Throw on startup if `CHAT_API_TOKEN` is not set or is empty. Centralize the auth middleware.

---

## MEDIUM Findings

### M1. Installer Wizard Missing Sandbox
- **File**: `installer-v2/wizard-main.js:105-109`
- **Code**:
  ```javascript
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'wizard-preload.js')
    // Missing: sandbox: true
  }
  ```
- **Fix**: Add `sandbox: true`.

### M2. CSP Missing `base-src` and `object-src` Directives
- **File**: `src/client/desktop/main.js:542-557`
- **Issue**: The CSP doesn't restrict `<base>` or `<object>` tags.
- **Fix**: Add `base-src 'self'; object-src 'none';` to the CSP.

### M3. Overly Permissive CORS on Chat Services (localhost Allowed)
- **File**: `services/chat-onboarding/server.js:32-42`
- **Code**:
  ```javascript
  if (!origin) return callback(null, true);  // No origin = allowed
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
  ```
- **Issue**: Requests with no `Origin` header are allowed (server-to-server is fine, but this also allows curl/Postman). HTTP localhost is allowed in production.
- **Fix**: Remove localhost from production CORS. Require `Origin` header for browser-facing endpoints.

### M4. Model Server Uses Default CORS (Wildcard)
- **File**: `model-server/server.js:64`
- **Code**: `app.use(cors());`
- **Fix**: Configure explicit origin whitelist.

### M5. Deepgram API Key Passed in WebSocket URL
- **File**: `src/client/desktop/renderer/app.js:2924`
- **Code**: `this._deepgramWs = new WebSocket(dgUrl, ['token', apiKey]);`
- **Issue**: The API key is passed as a WebSocket sub-protocol, which appears in the HTTP Upgrade request and may be logged by proxies.
- **Fix**: Pass via custom header or authenticate server-side before proxying.

### M6. No Access Token Blacklisting on Logout
- **File**: `account-server/src/routes/auth.ts:289`
- **Issue**: Logout only deletes refresh tokens. The 24-hour access token remains valid. An attacker with a stolen access token has 24 hours of access even after the user logs out.
- **Fix**: Implement a token blacklist (the legacy schema already has a `token_blacklist` table). Or reduce access token lifetime to 15 minutes.

### M7. No Refresh Token Reuse Detection
- **File**: `account-server/src/routes/auth.ts:244-282`
- **Issue**: If an attacker steals and uses a refresh token before the legitimate user, the legitimate user's refresh fails — but no alarm is raised and no tokens are revoked.
- **Fix**: Implement refresh token family tracking. If a previously-used refresh token is presented, revoke the entire token family.

### M8. Checkout Window Uses Predictable Temp File Path
- **File**: `src/client/desktop/main.js:3866-3869`
- **Code**: `const tmpCheckoutPath = path.join(os.tmpdir(), 'windy-checkout-' + Date.now() + '.html');`
- **Issue**: On shared systems, the temp file is readable by other users between creation and deletion. Contains checkout HTML.
- **Fix**: Use `crypto.randomBytes(8).toString('hex')` in the filename, or use `data:` URLs.

### M9. No Input Sanitization on Upload Metadata
- **File**: `services/cloud-storage/server.js:291`
- **Code**: `metadata: req.body.metadata ? (() => { try { return JSON.parse(req.body.metadata); } catch (_) { return {}; } })()`
- **Issue**: Arbitrary JSON stored as metadata. If rendered without escaping, this is a stored XSS vector.
- **Fix**: Validate metadata against a schema (Zod/Joi). Limit depth and size.

### M10. Command Injection: execSync with String Interpolation
- **File**: `src/client/desktop/main.js:3477`
- **Code**: `` execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /value`) ``
- **Also**: Line 414 (`lsof -ti :${port}`), lines 3482/3486 (`df -g "${homeDir}"`)
- **Issue**: Shell commands constructed with template literals. While the inputs (`drive` from `homeDir.charAt(0)`, `port` from config, `homeDir` from `os.homedir()`) are unlikely to be attacker-controlled, this establishes a dangerous pattern.
- **Fix**: Use `execFileSync()` with array arguments instead of `execSync()` with string interpolation. This eliminates shell interpretation entirely.

### M11. Checkout Window DevTools Enabled in Production
- **File**: `src/client/desktop/main.js:3863`
- **Code**: `devTools: true`
- **Fix**: Set `devTools: !app.isPackaged` or `devTools: process.argv.includes('--dev')`.

### M12. Multer Temp Files Not Cleaned on Upload Error
- **File**: Multiple upload endpoints in `services/cloud-storage/server.js` and `account-server/`
- **Issue**: If an upload fails after multer writes the file to disk, the temp file may not be cleaned up.
- **Fix**: Add error middleware that deletes `req.file` on failure. Add a periodic cleanup job.

---

## LOW Findings

### L1. CSP Allows `unsafe-inline` for Styles
- **File**: `src/client/desktop/main.js:549`
- **Fix**: Move inline styles to CSS files or use nonces. Low priority for desktop app.

### L2. Bcrypt Rounds Slightly Below Modern Recommendation
- **File**: `account-server/src/config.ts:35` — `BCRYPT_ROUNDS: 10`
- **Recommendation**: Increase to 12 for new hashes. Existing hashes remain valid.

### L3. Missing Security Headers on Web Proxy
- **File**: `web-proxy.js`
- **Issue**: No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `X-XSS-Protection` headers.
- **Fix**: Add standard security headers.

### L4. No HTTPS Enforcement in Web Proxy
- **File**: `web-proxy.js`
- **Issue**: Plain HTTP server with no HTTPS redirect.
- **Fix**: Add HSTS header and HTTP→HTTPS redirect in production.

### L5. xdotool Window ID Passed Unsanitized
- **File**: `src/client/desktop/main.js:2199`
- **Code**: `` exec(`xdotool windowactivate ${savedWindowId}`) ``
- **Fix**: Use `execFile('xdotool', ['windowactivate', savedWindowId])`.

### L6. os.system() in Python Script
- **File**: `scripts/certify_local_models.py:225`
- **Code**: `os.system("openclaw system event ...")`
- **Fix**: Use `subprocess.run()` with array arguments.

### L7. Excessive Preload API Surface (~100+ Handlers)
- **File**: `src/client/desktop/preload.js`
- **Issue**: Large IPC surface increases risk. Each handler appears validated, but the sheer number increases audit burden.
- **Fix**: Group related APIs under namespaced objects. Add rate limiting on sensitive handlers.

### L8. No Rate Limiting on Health Check Endpoints
- **File**: Multiple services (`/health` endpoint)
- **Fix**: Add basic rate limiting to prevent enumeration/DoS.

### L9. Path Traversal Protection Pattern Inconsistent
- **File**: `src/client/desktop/main.js` — archive handlers
- **Issue**: Some archive file handlers check for `..` traversal; others rely on `path.join` behavior. Pattern is inconsistent.
- **Fix**: Use a shared `validateSafePath()` utility across all handlers.

---

## Security Strengths (Positive Findings)

The codebase gets many things right:

1. **Electron fundamentals are solid**: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` on main windows, proper `contextBridge` usage, no `remote` module.
2. **No eval() or Function()**: No dangerous dynamic code evaluation anywhere in the JS codebase.
3. **Parameterized SQL everywhere**: Both TypeScript (prepared statements via better-sqlite3) and Python (positional parameters) use parameterized queries. No SQL injection found.
4. **safeStorage for Stripe keys**: Electron's OS-level encryption is correctly used for the Stripe secret key.
5. **isSafeURL() helper exists**: URL validation function properly checks protocols — just needs to be used consistently.
6. **setPermissionRequestHandler**: Media permissions are properly whitelisted.
7. **AES-256-GCM for chat backup**: Proper authenticated encryption with PBKDF2 key derivation (100K iterations).
8. **Refresh token rotation**: Old tokens are deleted on refresh — single-use pattern.
9. **Rate limiting on auth endpoints**: Login/register have per-IP rate limits.
10. **User-scoped data queries**: All recording/translation/file queries are scoped by `user_id`.
11. **Zod validation middleware**: Request bodies are validated against schemas in the TypeScript account server.
12. **Profanity filter on display names**: Includes leet-speak variant detection and reserved word blocking.

---

## Quick Wins (Under 30 Minutes Each)

| # | Finding | Fix | Time |
|---|---------|-----|------|
| 1 | **C2**: OTP uses `Math.random()` | Replace with `crypto.randomInt(100000, 999999)` | 5 min |
| 2 | **C3**: License key uses `Math.random()` | Replace with `crypto.randomBytes()` per character | 10 min |
| 3 | **C6**: OTP codes logged in plaintext | Delete the `console.log` lines or redact PII | 5 min |
| 4 | **H3**: About window `shell.openExternal` unvalidated | Add `if (isSafeURL(url))` guard | 2 min |
| 5 | **H4**: OAuth popup loads any URL | Add `https://` protocol check | 5 min |
| 6 | **H5**: JWT algorithm not explicit | Add `algorithm: 'HS256'` to sign, `algorithms: ['HS256']` to verify | 5 min |
| 7 | **H6**: Stripe placeholder key | Replace fallback with `throw new Error()` | 5 min |
| 8 | **H8**: Linux nav handler allows all protocols | Add protocol validation (allow only http/https) | 5 min |
| 9 | **M1**: Installer wizard missing sandbox | Add `sandbox: true` to webPreferences | 2 min |
| 10 | **M2**: CSP missing directives | Add `base-src 'self'; object-src 'none';` | 5 min |
| 11 | **M11**: Checkout DevTools enabled | Change to `devTools: !app.isPackaged` | 2 min |
| 12 | **L2**: Bcrypt rounds low | Change `BCRYPT_ROUNDS: 10` to `12` | 1 min |
| 13 | **L5**: xdotool unsanitized | Change `exec()` to `execFile()` with array args | 5 min |

These 13 quick wins address 2 Critical, 4 High, 3 Medium, and 2 Low findings in approximately 1 hour total.

---

## Recommended Fix Priority

### Immediate (Before Any Production Deployment)
1. C1 — Encrypt cloud password with safeStorage
2. C2 — Cryptographic OTP generation
3. C3 — Cryptographic license key generation
4. C4 — Remove JWT secret fallbacks, require env var
5. C5 — Replace CORS wildcard with origin whitelist
6. C6 — Stop logging OTP codes and PII
7. C7 — Add magic byte validation on file uploads
8. H1 — Require WebSocket auth before processing audio
9. H2 — Require auth for translation endpoint
10. H5 — Lock JWT algorithm to HS256

### Before Public Launch
11. H3, H4, H8 — Fix all `shell.openExternal` and navigation handlers
12. H6 — Remove Stripe placeholder
13. H7 — Sanitize error responses
14. M6 — Reduce access token lifetime or implement blacklisting
15. M10 — Replace all `execSync` string interpolation with `execFileSync` arrays
16. L3, L4 — Add security headers and HTTPS enforcement

### Ongoing Hardening
17. M3, M4, M5 — Tighten CORS across all services
18. M7 — Refresh token family tracking
19. M9 — Validate upload metadata schemas
20. L7 — Reduce preload API surface area

---

_End of report. No code changes were made. This is research and analysis only._
