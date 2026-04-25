# Changelog

All notable changes to Windy Pro are documented here.

## [Unreleased] — installer-bundling-v3 branch

Two autonomous working sessions (2026-04-14 + 2026-04-15) on the
bulletproof installer + platform hardening plan.

### Installer (sessions 1 + 2)

- **Install never hangs at 0%**: fail-fast `withTimeout` around every
  awaited step; sub-second event-loop stalls eliminated by converting
  the bundled-wheels install + CleanSlate kill path from `execSync`
  to `exec` (async).
- **CleanSlate won't kill its own .app bundle** on any platform —
  macOS (`.app`), Windows (`.exe` parent dir), Linux AppImage
  (`.mount_*` root) all guarded.
- **uv (Astral) bundled** alongside pip for offline wheel installs
  — ~5x faster when present.
- **Phase 4 permission verification** — real tests (mic RMS amplitude,
  osascript keystroke probe, Linux paste-tool one-click install via
  pkexec). Auto re-check on window-focus.
- **Phase 6 Linux paste-tool detect + install + test-inject**
  (xdotool / ydotool / wl-clipboard / xclip, including uinput
  permissions + input group + ydotoold).
- **Phase 7 "Recommended for your machine" hero card** with collapsed
  advanced options.
- **Phase 8 moves account creation out of the wizard** entirely —
  free tier silently provisioned; post-first-transcription banner
  in the main app offers signup.
- **P14 `goToScreen` refactor** to stable string IDs; account screen
  markup deleted (was DOM-only dead code after Phase 8).

### Error handling + diagnostics

- **WINDY-NNN error code taxonomy** in `installer-v2/core/errors.js`
  with CI ratchet guard; `docs/ERRORS.md` catalogue.
- **`/health` endpoint** on the engine's sibling HTTP port (9877 by
  default) + WebSocket-level `health` command.
- **Allow-list crash log redaction** (`lib/crash-summary.js`) —
  drops attached `response` / `config` / `headers` objects; applies
  redact patterns for Bearer, sk-, ghp_, xoxb-, AKIA, glpat-, key_.
- **Structured JSON-lines file logger** at
  `~/Library/Logs/Windy Pro/app.log` with 10MB rotation × 5 files.

### Security

- **SEC-PAIR-1 (CRITICAL)**: `pair-delete` IPC path-traversal —
  malicious renderer could `fsp.rm({recursive, force})` arbitrary
  directories. `_validatePairId` now enforces allow-list regex +
  containment check.
- **SEC-WIZARD-1 (MED)**: `wizard-purchase-translate` now requires
  the Stripe Checkout URL to be under `checkout.stripe.com` or
  `billing.stripe.com` — compromised account-server can't redirect
  users to arbitrary hosts via `shell.openExternal`.
- **withTimeout bounds** on chat-login/register/send-message/
  get-messages, mini-translate-text, pair-download, pair-download-
  bundle.
- **Unhandled rejection audit** — `transcript-for-paste` ipcMain.on,
  auto-updater setTimeout/setInterval all wrapped against
  unhandled rejection.

### Accessibility (P10)

- ARIA `role=progressbar` / `role=meter` / `role=region` +
  `aria-live` on every status-updating element.
- Global `:focus-visible` ring at 2px green outline.
- `@media (prefers-reduced-motion: reduce)` honoured — animations
  disabled for vestibular-sensitive users.

### Testing

- **Playwright-electron E2E harness** — 24 tests across 5 spec files
  covering wizard cold-boot, screen flow, verify state matrix,
  signup banner, IPC contract, hang regression.
- **162 unit tests** across 12 jest files: signup-banner,
  transcript-format, logger, crash-summary, lib-timeout, errors,
  bundled-assets, clean-slate, wizard-logger, Windows paths,
  security audits, chat IPC, pair IPC.
- **9 pytest cases**: engine health payload (6) + integration
  (3 HTTP + 1 WebSocket round-trip).
- **CI gates** grew 1 → 8: e2e, test-installer, renderer-tests,
  error-code ratchet, legacy-venv guard, i18n coverage,
  desktop_security, engine integration.

### Release automation (P6)

- `scripts/release/{preflight,build-all,smoke,sign-and-notarize,
  promote}.sh` — each with `--help` and `--dry-run`.

### Docs

- `ARCHITECTURE.md`, `RELEASE.md`, `DEBUGGING.md` (session 1).
- `SECURITY-AUDIT-2026-04.md`, `ERRORS.md`, `A11Y.md`, `I18N-AUDIT.md`,
  `ENGINE-PROTOCOL.md`, `UPDATER-TEST.md`, `DOGFOOD-PLAYBOOK.md`,
  `CODE-REVIEW-2026-04.md` (session 2).

### Code organisation

- `src/client/desktop/chat/ipc.js` — 21 chat-* IPC handlers
  extracted (was inline in main.js).
- `src/client/desktop/chat/pair-ipc.js` — 8 pair-* handlers
  extracted.
- `src/client/desktop/lib/timeout.js`, `lib/crash-summary.js` — new
  pure utility modules.
- `src/client/desktop/renderer/signup-banner.js`,
  `transcript-format.js` — extracted from app.js for testability.
- `installer-v2/core/errors.js`, `core/paste-verify.js` — new
  wizard utility modules.

### CI

- Cross-platform installer builds: mac-arm64, mac-x64, linux-x64,
  win-x64 all producing signed .dmg / .AppImage / .deb / .exe
  artefacts on every push (session 1).
- Triage of weeks-red `ci.yml`: fixed zod install, dropped Python
  3.10 (numpy incompatibility), resolved `Privacy.jsx` merge
  conflict markers, updated stale CSP / crash-log structural
  tests.

## [1.6.1] — 2026-03-11

### Desktop Hardening — 20 Bug Fixes

#### Chat System (12 fixes)
- **Critical**: Added try/catch to 8 unguarded async methods (`sendMessage`, `createDM`, `setPresence`, `setDisplayName`, `setAvatar`, `acceptInvite`, `declineInvite`, `sendTyping`) — prevents crash on network disconnect
- **Input validation**: 4000-character message limit with inline warning
- **Double-send guard**: `_sending` flag prevents duplicate messages on rapid Enter
- **Log levels**: Converted 2 `console.log` to `console.debug` for production
- **Translation engine**: Rewritten to use persistent WebSocket (was creating new connection per call), request-id tracking, auto-reconnect, `destroy()` cleanup

#### Cloud Storage (5 fixes)
- **Critical**: CORS wildcard (`*`) → origin whitelist (windypro.thewindstorm.uk + localhost + Electron)
- **Critical**: Safe `JSON.parse` on user-supplied metadata field (was crashing server on bad JSON)
- **Email validation**: Regex format check on `/auth/register`
- **Admin delete**: Now async, deletes R2 objects before removing user records
- **R2 cleanup**: Admin user deletion no longer orphans cloud files

#### Wizard (3 fixes)
- Stepper labels: 15px → 11px with `text-overflow: ellipsis` (9 labels fit)
- Feature card descriptions: 16px → 13px (reduced vertical overflow)
- Welcome quote: 20px → 14px (Get Started button visible without scrolling)

### Security Audit — All Clear
- 0 `eval()` usage, 0 npm vulnerabilities
- CSP set, `contextIsolation: true` + `sandbox: true` on all windows
- `escapeHtml()`/`escapeAttr()` applied to all user-generated content
- `.env` files properly in `.gitignore`
- 119 IPC handlers with client-side guards
- 7 installer adapters: all pass syntax, 26-43 error handlers each

### Packaging
- AppImage: 107 MB, .deb: 74 MB, unpacked: 281 MB
- Build config verified: appId, productName, icon, extraResources all correct

## [1.6.0] — 2026-03-04

### Phase 5: Rebrand, API Fixes & Release Prep
- **Rebrand**: Removed all user-facing Whisper, OpenAI, Deepgram, Groq references — replaced with Windy Pro Engine branding
- **API Fix**: Translate page now calls correct `/api/v1/translate/text` endpoint (was 404)
- **API Fix**: i18n dynamic translation system now uses correct endpoint with auth
- **License**: Added `POST /api/v1/license/activate` endpoint for online license activation
- **Trust Signals**: US-based trust badges on landing page (hero, footer, privacy, download sections)
- **Installer**: Storage-aware model recommendations with disk/RAM detection
- **Download**: Cache-proof download system with GitHub API redirects
- **Linux**: Fixed .desktop file Exec quoting for paths with spaces
- **Tests**: Fixed `test_final_qa.py` pytest compatibility (sys.exit guard)
- **Build**: Verified clean web build (0 errors, 324KB)

## [1.5.1] — 2026-03-02

### Phase 4: Docker, CI/CD & Launch Prep
- **Docker**: Multi-stage production Dockerfile (web builder → API deps → runtime)
- **Docker Compose**: 7-service stack with health checks (web, account, transcription, translate, nginx, postgres, redis)
- **CI/CD**: GitHub Actions pipeline — lint, test, web build, Electron cross-platform, Docker deploy
- **Config**: `.env.example` with 20+ documented variables
- **Docs**: Comprehensive README.md with architecture diagram, API reference, security overview
- **Packaging**: electron-builder config verified (DMG, AppImage, DEB, NSIS) with auto-update channel

### Phase 3: Desktop Security & Production Hardening
- **P0 Fix**: Path traversal guard on `delete-archive-entry` — validates paths within archive folder
- **P1 Fix**: `open-external-url` now uses `shell.openExternal` instead of `spawn(browser)`
- **P1 Fix**: `will-navigate` handler blocks navigation away from `file://` origins
- **P2 Fix**: `sandbox: true` enabled on all 4 BrowserWindows
- **P2 Fix**: Permission handler whitelists only `media` + `clipboard-read`
- **P2 Fix**: CSP tightened — removed wildcard `wss:`/`https:`, added exact API origins
- **Tests**: 29 structural security tests (`test_desktop_security.py`)

### Phase 2: Web Portal & Dashboard
- **SPA Fix**: `appType: 'spa'` in Vite config, removed broken `/translate` proxy
- **Dashboard**: Translation stats (total translations, favorites), profile/settings links
- **Settings Page**: Current plan display, upgrade buttons, password change, Stripe billing portal
- **Admin Panel**: Stats grid, translation volume chart, plan breakdown, user management table
- **Profile Page**: User card, translation history, account deletion with triple confirmation
- **Landing Page**: Feature comparison table (4 tiers), testimonials (4 cards), CTA banner
- **Backend**: Admin endpoints (`/admin/users`, `/admin/stats`, `/admin/revenue`), billing endpoints
- **PWA**: Service worker v3 with API response caching (24h expiry), manifest shortcuts
- **Tests**: 42 structural tests (`test_web_portal.py`)

### Phase 1: Desktop Core Features
- **Speech Translation UI**: Press-and-hold mic button, animated waveform, language dropdowns
- **Translation Backend**: `/translate/speech`, `/translate/text`, `/translate/languages` endpoints
- **System Tray**: Quick-translate menu, restore/quit actions
- **Global Hotkeys**: `Ctrl+Shift+T` floating mini-translate, `Ctrl+Shift+Space` record, `Ctrl+Shift+V` paste
- **Auto-Update**: electron-updater with GitHub Releases, DEB update fallback for Linux
- **Mini-Translate Window**: Always-on-top floating translation panel with offline fallback
- **Video Preview**: Detached webcam preview window with camera permission auto-grant

### Pre-Phase: Foundation
- **Electron App**: Frameless, always-on-top, transparent window with green strobe indicator
- **WebSocket**: Real-time connection to Python transcription backend
- **Transcription**: Local engine models (base/small/medium) with batch processing
- **Archive System**: Local + cloud archiving with timestamped folders
- **History Panel**: Full session history with playback and export
- **Installation Wizard**: TurboTax-style 9-screen setup (hardware detection, account creation)
- **Cloud Sync**: Encrypted recording upload to Windy Pro Cloud
- **Crash Recovery**: Automatic transcript recovery from orphaned sessions
- **Zoom/Font Controls**: Ctrl+/-, font size persistence
- **Offline Mode**: Full transcription without internet via local engine models

## [1.0.0] — 2026-02-01

### Initial Release
- Basic voice-to-text transcription
- Python transcription engine backend
- Electron desktop client
- Local file archiving
