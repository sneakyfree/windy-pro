# Security Audit — 2026-04-15

Scope: every `ipcMain.handle`/`ipcMain.on` in `installer-v2/wizard-main.js`
and `src/client/desktop/main.js`, every `exec`/`execSync` call in the
install adapters and runtime path, account-server route validation
against the shared/contracts schemas.

Threat model: the renderer is sandboxed (`webPreferences.sandbox: true`,
`contextIsolation: true`) but **assume it is compromised**. A bug in
the renderer or a successful XSS turns into RCE if any IPC handler
trusts renderer input without validation.

Severity definitions:
- **CRITICAL** — RCE or arbitrary file write/delete from a compromised renderer.
- **HIGH** — privilege escalation, data exfiltration of arbitrary files.
- **MEDIUM** — data integrity compromise, unauthorised network requests.
- **LOW** — DoS via large payloads, information leakage.

---

## CRITICAL findings

### SEC-PAIR-1 — `pair-delete` arbitrary directory recursive delete (FIXED)

**Where:** `src/client/desktop/pair-download-manager.js` `_validatePairId`
+ `deletePair` + `downloadPair` + cancel/encrypted/meta path helpers.

**Impact:** A renderer call of
`window.electronAPI.invoke('pair-delete', '../../../../../etc')`
resolved to `path.join(<userData>/translation-pairs/, '../../../../../etc')`
and got passed to `fsp.rm(..., { recursive: true, force: true })`. With
the default user permissions, that wipes anything writable from the
user's HOME up to filesystem root. Same primitive applied to
`downloadPair` (write into arbitrary directory) and pair-cancel
(unlink temp file outside pairsDir).

**Fix:** `_validatePairId` now enforces:
1. Type check: must be a non-empty string
2. Allowlist regex: `^[a-zA-Z0-9_-]+$` (matches catalog format
   `windy-pair-<src>-<tgt>`)
3. Length cap: ≤80 chars
4. Defence in depth: `path.resolve(pairsDir, pairId)` must remain
   inside `pairsDir`, even on Windows where backslashes might bypass
   the regex.

**Test:** `tests/pair-download-manager.security.test.js` — 26 cases
covering `..`, `/`, `\\`, NUL bytes, newlines, oversized payloads,
non-string types. CI runs on every push.

**Diagnostic to verify the fix shipped:**
```js
const m = new (require('./src/client/desktop/pair-download-manager').PairDownloadManager)('/tmp/p', 'tok');
try { m._validatePairId('../etc'); console.log('REGRESSED'); }
catch { console.log('safe'); }
```

---

## MEDIUM findings

### SEC-WIZARD-1 — `wizard-purchase-translate` opens arbitrary URLs from API response (FIXED)

**Where:** `installer-v2/wizard-main.js` IPC handler `wizard-purchase-translate`.

**Impact:** The handler POSTs to the account-server's
`/api/v1/payments/create-checkout` endpoint, then unconditionally
passes `data.url` to `shell.openExternal(data.url)`. If the
account-server were compromised (or the response MITM'd in a
non-HTTPS-pinned scenario), `data.url` could be `javascript:alert(1)`
or `file:///etc/passwd`. `shell.openExternal` will hand any URL to
the OS's default URL handler — a `javascript:` URL in some browsers
executes; a `file://` URL discloses arbitrary local files.

**Fix:** Added `_isAllowedStripeUrl()` allowlist that requires:
- `https:` protocol (not http, javascript, file, ...)
- Hostname is exactly `checkout.stripe.com` or `billing.stripe.com`

Refusals are logged via `wizardLog` with the offending URL prefix
for incident response.

**Test:** `tests/wizard-main.security.test.js` — 13 accept/reject cases
including lookalike hosts, javascript: schemes, file: schemes, and
`evil.com/checkout.stripe.com` path-not-host variants.

### SEC-MAIN-1 — `mini-translate-text` unbounded payload to upstream API (DOCUMENTED, NOT FIXED)

**Where:** `src/client/desktop/main.js` IPC handler `mini-translate-text`.

**Impact:** The handler POSTs renderer-supplied `text`, `sourceLang`,
`targetLang` to `https://windyword.ai/api/v1/translate/text` with no
length check. A compromised renderer can send arbitrary-sized payloads
which the server accepts (or rejects 413), wasting bandwidth/cost
quota. Server-side validation in `shared/contracts/validation.ts`
caps `text` at 5000 chars — but the client should refuse early.

**Recommended fix:** add length checks on `text` (≤5000), `sourceLang`/
`targetLang` (≤16, allowlist of language codes). Mirror the server's
`TranslateTextRequestSchema`. Same fix applies to `chat-translate-text`.

### SEC-MAIN-2 — `chat-*` handlers pass renderer input straight to matrix-js-sdk (DOCUMENTED, NOT FIXED)

**Where:** `src/client/desktop/main.js` lines 1724–1947 (~25 handlers).

**Impact:** Handlers like `chat-send-message`, `chat-create-dm`,
`chat-set-display-name` forward renderer-supplied strings to the
Matrix SDK, which signs them with the user's e2ee identity. A
compromised renderer can impersonate the user to all their Matrix
contacts. This is intrinsic to the trust model (renderer ARE the
user's typing interface), but two specific concerns:

1. `chat-set-display-name` lets the renderer change the user's
   visible identity without confirmation.
2. `chat-send-message` doesn't rate-limit; a renderer XSS could spam
   every contact with phishing.

**Recommended fix:** rate-limit per-handler at the main process; for
`chat-set-display-name`, require an explicit user-visible confirm
modal before applying.

---

## LOW findings

### SEC-WIZARD-2 — `wizard-open-external` opens any HTTP(S) URL (ACCEPTED)

The handler accepts any URL starting with `http://` or `https://` and
opens it via `shell.openExternal`. A compromised renderer can force
the user's default browser to open arbitrary URLs (phishing).

The OS's default browser is the trust boundary — not our problem to
prevent navigation to external sites. Refused `javascript:` and
`file:` already (they don't start with `http(s)://`). Accept as is.

### SEC-WIZARD-3 — `wizard-open-perm-settings` interpolates `which` into shell command (LOW, MITIGATED)

`installer-v2/wizard-main.js`:
```js
exec(`open "${url}"`)
exec(`start ${urls[which] || 'ms-settings:privacy'}`)
```

`url` is always from a hardcoded dict (`urls['microphone']` /
`urls['accessibility']`); renderer can only pick a key, not supply
the value. Safe today. Documented in code as "if `urls` ever becomes
dynamic, switch to execFile()".

### SEC-MAIN-3 — `pair-download-manager.js _getDiskFreeBytes` shell injection in pairsDir (LOW, NOT EXPLOITABLE)

```js
execSync(`wmic logicaldisk where "DeviceID='${this.pairsDir.charAt(0)}:'" get FreeSpace`)
execSync(`df -k "${this.pairsDir}" | tail -1`)
```

`pairsDir` is set in `main.js` from `app.getPath('userData')`, never
from renderer input. If `app.getPath('userData')` ever returns a
path with a `"` character (Electron sanitises it; not currently
possible), command injection results. Document but don't fix.

### SEC-ADAPTER-1 — adapter `osascript -e 'do shell script "..." with admin'` interpolation (LOW, INTERNAL ONLY)

`installer-v2/adapters/macos.js`:
```js
execSync(`osascript -e 'do shell script "installer -pkg ${pkgPath} -target /" with administrator privileges'`)
```

`pkgPath` is built internally from a hardcoded `pkgUrl` curl download.
If pkgPath ever became renderer-controlled, this is RCE-as-root.
Recommended rewrite: use `execFileSync('osascript', ['-e', script])`
to remove shell interpolation entirely, with the inner `do shell
script` text built via osascript-quoted variable substitution.

Same pattern in `linux-debian.js`, `linux-fedora.js`, `linux-arch.js`,
`windows.js` (pkexec, sudo, runas). Document; no immediate user
exposure because the arguments are not renderer-controlled today.

---

## account-server gap audit

Cross-referenced `account-server/src/server.ts` route handlers against
`shared/contracts/validation.ts` Zod schemas. Findings:

### SEC-API-1 — translation request: unified `source/target` aliasing (FIXED in session 1)

`TranslateTextRequestSchema` accepts both `sourceLang/targetLang`
(desktop) and `source/target` (mobile). The Zod refine() requires at
least one of each pair — fixed in session 1 to use proper TS types.
No exploit; documenting the dual-path so reviewers know to keep
both validated.

### SEC-API-2 — file-upload routes unaudited

Recording / model upload routes in account-server were not deeply
audited in this session. They're already gated by JWT middleware
(`requireAuth`), but the multipart parsers (multer) need their own
review for:
- Disk-fill DoS (max upload size cap)
- Filename escape (path traversal in stored filenames)
- MIME-type bypass

**Recommended next session priority.**

---

## What this audit didn't cover

- **Python engine WebSocket protocol** (`src/engine/server.py`) —
  scheduled for P9 hardening this session.
- **Account-server file-upload routes** — see SEC-API-2.
- **Web portal** (`src/client/web/`) — XSS risk in user-supplied
  transcript display.
- **Auto-updater integrity** — electron-updater verifies signed
  artefacts, but the YAML feed (`latest-mac.yml`) is HTTP-fetchable
  and could be MITM'd to point at a malicious .dmg. macOS code
  signing protects against installation, but the user sees a
  Gatekeeper warning instead of a clean update flow.
- **Crash log redaction completeness** — `main.js` redacts `Bearer`
  + `sk-*` keys but the regex is permissive. Any new credential
  shape introduced won't be redacted. Recommend a deny-listing
  approach with a positive allowlist of "this field is safe".

---

## How to extend this audit

When adding a new IPC handler:
1. Document the input shape and trust level (renderer-supplied? trusted? untrusted?).
2. If renderer-supplied, validate with explicit type/length/regex
   checks before any filesystem, network, or shell operation.
3. If the handler does I/O on a path constructed from renderer input,
   `path.resolve()` and confirm the result stays under the intended
   root. See `_validatePairId` for the canonical pattern.
4. Prefer `execFile(cmd, [argv...])` over `exec('cmd ' + arg)` — kills
   shell injection by construction.
5. Add a unit test under `tests/*.security.test.js` that pins the
   safety property. CI will fail when the property regresses.
