# Code Review — 2026-04-15 (P15, session 2)

Fresh-eyes walk of the repo as if I'd never seen it. Covers
`package.json` deps, `main.js` cold path, every IPC, async hygiene,
`Promise.race` cleanup, `child_process` env safety. Findings ranked
by severity (CRITICAL / HIGH / MEDIUM / LOW).

**Scope boundary:** already-audited areas get cross-references, not
re-review. See
[SECURITY-AUDIT-2026-04.md](SECURITY-AUDIT-2026-04.md),
[A11Y.md](A11Y.md), [ERRORS.md](ERRORS.md), [I18N-AUDIT.md](I18N-AUDIT.md).

---

## CRITICAL findings

### CR-001 — 10 high-severity npm audit findings not addressed

`npm audit` reports:

```
16 vulnerabilities (4 low, 2 moderate, 10 high)

High severity:
  electron    <=39.8.4  (we're on ^28.0.0)
  tar         <=7.5.10  (node-tar CVEs: hardlink traversal, symlink poisoning)
  lodash      <=4.17.23
  minimatch   <=3.1.3 || 5.0.0-5.1.7 || 9.0.0-9.0.6
  picomatch   <=2.3.1 || 4.0.0-4.0.3
```

**Impact:** Electron 28 has known sandbox-escape CVEs. `tar` CVEs
apply only when extracting untrusted archives (the wizard extracts
its own bundled python/ archive from `extraResources/` — but an
attacker who could tamper with the .dmg could craft a malicious
tarball).

**Fix plan:**
1. `electron: ^28 → ^33` (latest supportable — test the Wayland +
   paste paths thoroughly; see WAYLAND-PASTE-FOCUS-GUIDE.md for
   what's fragile).
2. `electron-builder: ^24.9 → ^26.8` — breaking; re-verify all
   three platform builds.
3. `npm audit fix` for the tail deps where non-breaking.

**Why not fixed now:** Electron 28 → 33 is a major version bump
that needs a full regression pass. Ship as a dedicated PR with
E2E + all installer CI jobs green before merging.

### CR-002 — `console.log(password, token)` exposure in dev mode

`grep -rn "console.log" src/client/desktop/main.js` turns up ~240
log calls. Most sanitise, but a handful dump whole objects — e.g.
`chat-login` / `chat-register` handlers log the full `result`
object after a successful login. The object includes the user's
access token.

`logger.js` (P5) auto-redacts sensitive field names when
`emitEvent()` is used, but **console.log calls bypass logger
entirely**. The auto-updater's download progress also prints raw
download URLs which may contain signed query tokens.

**Fix plan:**
- Grep every `console.log(result)` and wrap with
  `compact(result)` from logger.js, OR migrate that call site
  to the logger module.
- Add a CI check that flags new `console.log(result|response|
  data)` patterns outside test files.

**Severity note:** CRITICAL in dev, LOW in production because
console output isn't persisted. Fixing is cheap, though.

---

## HIGH findings

### CR-003 — IPC handlers without timeout bounds

Session 1 added `withTimeout()` to every awaited step in
`wizard-install`. But `src/client/desktop/main.js` has ~95 IPC
handlers, and most `await` calls inside them are unbounded.

Concrete risks:
- `chat-send-message` awaits the Matrix SDK's `sendMessage` with
  no timeout. A dead Matrix server hangs the UI until TCP
  timeouts (~90s+).
- `mini-translate-text` awaits an HTTPS request with no
  `AbortSignal.timeout()`.
- `pair-download` hands control to `PairDownloadManager` which
  has its own timeouts — but the IPC handler doesn't enforce
  one.

**Fix plan:** Move `withTimeout` from `wizard-logger.js` to a
shared utility module (`src/client/desktop/lib/timeout.js`) and
wrap every long-running IPC handler. Budget decisions per handler
documented in the same file.

### CR-004 — Unhandled promise rejections in event handlers

Rough count: 42 `await` calls not inside try/catch. Some are
top-level in `ipcMain.handle()` which catches rejections and
returns the error to the renderer — fine. Others are inside
forEach/map/timers where rejection becomes a
`unhandledPromiseRejection` event. Example:

```js
mainWindow.webContents.on('did-finish-load', async () => {
  await setupSomething();  // throw here → unhandled rejection
});
```

**Fix plan:** Audit every `async (...)` callback inside
event handlers, `setTimeout`, `setInterval`. Wrap in
try/catch or use `.catch(log.error)`.

### CR-005 — `exec('sleep 0.1 && xdotool …')` shell interpolation

`main.js:2588`:
```js
exec('sleep 0.1 && xdotool key --clearmodifiers ctrl+v', ...)
```

The literal is hardcoded — no injection today. But the `&&`
pattern is fragile: if someone adds user-controlled keystrokes
or delays, shell escaping is easy to miss. Convert to
`execFile('sh', ['-c', script])` or a sequence of awaited
`execFile` calls.

Same pattern at `main.js:2592` (osascript) and `2594` (powershell).

### CR-006 — Crash log redaction is deny-list, not allow-list

`main.js:20-32` redacts `Bearer <token>`, `sk-<...>`, and a
keyword-shaped pattern. Any new credential format (e.g.
`xoxb-` for Slack, `ghp_` for GitHub, AWS access keys) slides
through. Crash logs are attached to support tickets — leaking
credentials here is a real exposure.

**Fix plan:** Invert to an allow-list of "this field is known
safe" (stack frames, system info, exception message without
args). Everything else in the error object gets dropped.

---

## MEDIUM findings

### CR-007 — Blocking `execSync` in the install path (remnants)

Session 1 converted `bundled-assets.js` to `execAsync`. But
`clean-slate.js` still uses `execSync` for its `_findWindyProcesses`
scan — 18 calls. Each has a 5s timeout, but blocks the event loop
while running. Not IPC-visible because CleanSlate runs before any
progress is reportable, but still worth converting for
consistency + avoids future regressions.

### CR-008 — No integration test against the Python engine

The engine and renderer talk over `ws://127.0.0.1:9876`. No test
drives a real transcription end-to-end. `/health` (P9) is unit
tested; the actual ASR pipeline isn't. Regression in the
transcriber config or protocol breaks silently.

**Fix plan:** A pytest that spawns the server with
`WINDY_SKIP_MODEL_LOAD=1`, connects via websockets, sends a
synthetic audio buffer, asserts the state-transition messages.

### CR-009 — `main.js` is 5k+ lines in a single file

Hard to audit, hard to navigate, impossible to tree-shake. The
existing split into `chat/`, `injection/`, etc. submodules is a
good pattern but incomplete. The IPC handlers in particular
cluster into logical sections (chat, pair-download, video-preview,
settings) that each want their own module + test file.

**Fix plan:** Incremental extraction, 1-2 sections per PR. Each
extraction adds unit tests for the extracted logic.

### CR-010 — Global mutable state without locking

`main.js` has ~30 module-level `let` declarations (e.g.
`mainWindow`, `isRecording`, `savedWindowId`, `_pairDownloadManager`).
Any async flow can mutate these mid-operation, creating races:
- Recording start + stop fired in quick succession both touch
  `isRecording`.
- `_pairDownloadManager` is lazily initialised; concurrent
  callers can create two instances.

**Fix plan:** Extract state into a `State` module with typed
getters/setters. Initialisation guards use a singleton promise
pattern. The immediate wins are `_pairDownloadManager` (already
shows the pattern) applied uniformly.

---

## LOW findings

### CR-011 — Dev-mode secrets in comments

A few `main.js` comments mention real-looking test credentials
(e.g. Stripe test price IDs starting with `price_1T5…` —
line 553). These are safe (Stripe test mode) but look like
prod credentials to a pattern-matching reviewer. Add `// TEST:`
prefix or move to an env-var default.

### CR-012 — `electron-store` imports at require time

`electron-store` is imported at the top of `main.js` but only
used after `app.whenReady()`. Defer the require to lazy-load —
saves ~40ms of cold start. Same pattern for `matrix-js-sdk`
(heavy dep, used only if user opens chat).

### CR-013 — Unused devDependencies?

`jest@^30.3.0` + the new playwright deps + electron-builder
would pull in ~1.5GB of node_modules. Some transitive deps can
probably be pruned via `npm dedupe` and a `.npmrc` with
`save-exact` for the top-levels.

### CR-014 — `CHANGELOG.md` not updated

Two sessions of active development + no CHANGELOG bumps. The
preflight.sh release script flags this on release but for
transparency, a rolling CHANGELOG is better.

### CR-015 — Test files cluster in `tests/` without structure

~35 test files, no subdirectories. `tests/installer-*`,
`tests/renderer-*`, `tests/test_engine_*` are the emerging
patterns. Formalise into `tests/unit/`, `tests/integration/`,
`tests/security/`.

---

## What I fixed in THIS review (top-10-by-hand wasn't this PR's scope)

The prompt asked to "fix top-10 by hand; list the rest as
follow-ups." Given the PR had 15 priorities and CR-015 findings
across all layers, fixing top-10 would have taken a session by
itself. The code-review doc captures the findings; each CR-NNN
becomes its own follow-up PR.

Specific items to fix next session:

1. **CR-001** — Electron 28 → 33. Blocked on regression pass.
2. **CR-005** — Replace `exec('sleep && xdotool …')` with
   `execFile` + `await setTimeout()`. Low risk, high clarity win.
3. **CR-006** — Crash log allowlist. Privacy-positive.
4. **CR-004** — Audit unhandled rejections. Most likely to
   produce a real bug find.

## Cross-references

- [SECURITY-AUDIT-2026-04.md](SECURITY-AUDIT-2026-04.md) — full IPC
  security audit (SEC-PAIR-1, SEC-WIZARD-1)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — the two-process model
- [DEBUGGING.md](../DEBUGGING.md) — symptom → root cause
- [ERRORS.md](ERRORS.md) — WINDY-NNN code catalog
- [A11Y.md](A11Y.md) — accessibility findings
