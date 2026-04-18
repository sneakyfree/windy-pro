# Windy Pro — Architecture

How the desktop app is structured, what runs where, and what holds the
two halves of it (Electron + Python) together.

For *building* the app see [BUILD.md](BUILD.md). For *fixing it when it
breaks* see [DEBUGGING.md](DEBUGGING.md). For *shipping a release* see
[RELEASE.md](RELEASE.md).

## 1. Two processes, one app

Windy Pro is two long-running processes glued by a localhost
WebSocket.

```
┌─────────────────────────────────────────────────────────────┐
│  Electron .app                                              │
│                                                             │
│  src/client/desktop/main.js          ← Electron main proc.  │
│  src/client/desktop/renderer/app.js  ← UI (record/paste UX) │
│  installer-v2/wizard-main.js         ← First-run wizard     │
│                                                             │
│           │                                                 │
│           │  ws://127.0.0.1:9876                            │
│           ▼                                                 │
│  src/engine/server.py                ← Python ASR backend   │
│   - faster_whisper                                          │
│   - sounddevice / portaudio                                 │
│   - websockets                                              │
└─────────────────────────────────────────────────────────────┘
```

* The **Electron main process** owns global hotkeys, window focus,
  clipboard, paste injection, and the wizard.
* The **renderer** drives the in-app UI, captures audio (pre-warmed
  streams to avoid Wayland focus theft), and renders transcripts.
* The **Python engine** holds the model, runs ASR/translation, and
  streams results back over the WebSocket. Spawned by `main.js`
  `startPythonServer()`.

## 2. The bundle (extraResources/)

The app ships everything it needs inside its own bundle. Nothing is
ever installed on the user's system at install time — see
[Install Architecture](https://github.com/sneakyfree/windy-pro)
memory note for the why.

`scripts/build-portable-bundle.js` produces this layout per target
(under `bundled-portable/<target>/`); `scripts/stage-portable-bundle.js`
copies it into `extraResources/` so electron-builder picks it up:

```
extraResources/
  python/                 ← python-build-standalone (≈57 MB)
    bin/python3           ← Unix entry point
    python.exe            ← Windows entry point
    lib/, include/, ...
  wheels/                 ← ~38 .whl files (≈350 MB) for offline pip install
    faster_whisper-*.whl
    ctranslate2-*.whl
    ...
  ffmpeg/
    ffmpeg                ← static binary
  uv/
    uv                    ← Astral's pip replacement (≈10 MB)
  model/
    faster-whisper-base/  ← starter model so first-run works offline
  requirements-bundle.txt ← driving file for offline pip install
  bundle-manifest.json    ← versions, sha256s, sizes, build metadata
```

`package.json` `build.extraResources` maps `extraResources/` →
`process.resourcesPath/bundled/` inside the packaged `.app/.exe/.AppImage`.

## 3. Install flow (the wizard)

`installer-v2/` is the entire first-run experience. Decoupled from the
main app so we can iterate on it independently.

### Sequence

1. **wizard-main.js** opens a BrowserWindow, loads
   `installer-v2/screens/wizard.html` (one HTML file, ten screens).
2. Renderer (`wizard.html`) walks the user through:
   1. welcome → 2. *(was account, bypassed in Phase 8)* → 3. languages
   4. translate → 5. hero → 6. models → 7. pairs → 8. install
   9. **verify (Phase 4)** → 10. complete
3. On clicking *Install*, the renderer calls
   `wizardAPI.install()` (preload bridge in `wizard-preload.js`).
4. `wizard-main.js` `wizard-install` IPC handler runs phases 0–4
   sequentially, each wrapped in `withTimeout()` so a hung step
   surfaces fast (see DEBUGGING.md):
   * **Phase 0** — `CleanSlate.run()` — kills any prior install,
     skipping anything in our own .app bundle.
   * **Phase 1** — `DependencyInstaller.installAll()`. Fast path:
     bundled Python + bundled wheels (uv if present, else pip) →
     ~5–10s. Legacy fallback: brew/apt/dnf → minutes.
   * **Phase 2** — `DownloadManager.downloadModels()` — pulls
     selected engines from Hugging Face mirror.
   * **Phase 3** — verify (platform adapter).
   * **Phase 4** — request OS permissions.
5. After install success the renderer routes through screen 9
   (Phase 4 verification), then screen 10 (complete).

### Verify screen (Phase 4)

The wizard doesn't trust System Settings. Three real probes:

* **Microphone** — renderer-side. `getUserMedia` + AudioContext
  captures 1s, computes RMS amplitude, threshold at 2%.
* **Accessibility (macOS)** — main-process. `osascript -e 'tell application "System Events" to keystroke ""'`.
  If accessibility is denied, osascript exits with `1002: not allowed
  assistive access` and we surface a deep-link to the right pane.
* **Linux paste tools (Phase 6)** — `installer-v2/core/paste-verify.js`.
  Detects xdotool/ydotool/wl-clipboard/xclip + Wayland-specific
  bits (uinput perms, input group, ydotoold). Offers a one-click
  pkexec install. Test-paste injects "Hello from Windy Word" into
  a hidden scratch textarea and verifies the keystrokes arrived.

The wizard re-runs verification automatically when its window regains
focus (via the `wizard-window-focus` event from main).

## 4. Runtime Python resolution order

When the main app starts, `src/client/desktop/main.js startPythonServer()`
looks for a Python interpreter in this order:

1. **Bundled venv** — `process.resourcesPath/bundled/venv/bin/python` —
   what the wizard's fast path creates from the bundled wheels.
   Preferred and almost always present in production.
2. **User-dir venv** — `~/.windy-pro/venv/bin/python` — created by
   the wizard from the bundled (or system) Python on first run.
3. **System Python** — `python3` on PATH. Last-resort fallback for
   dev installs.

If none are found, the app launches the wizard.

## 5. IPC contract (wizard ↔ main)

The wizard is sandboxed (`webPreferences.sandbox: true`). All IPC
crosses the preload bridge in `installer-v2/wizard-preload.js`,
which exposes `window.wizardAPI`.

| Renderer call | IPC channel | Returns |
|---|---|---|
| `wizardAPI.scanHardware()` | `wizard-scan-hardware` | `{ hardware, recommendation, models, storageState }` |
| `wizardAPI.selectModels(ids)` | `wizard-select-models` | `{ selected, ... }` |
| `wizardAPI.toggleModel(id, on)` | `wizard-toggle-model` | `{ selected, ... }` |
| `wizardAPI.createFreeAccount()` | `wizard-free-account` | `{ success, account }` |
| `wizardAPI.login(email, pwd)` | `wizard-login` | `{ success, account, error? }` |
| `wizardAPI.register(name, email, pwd)` | `wizard-register` | `{ success, account, error? }` |
| `wizardAPI.saveLanguageProfile(langs)` | `wizard-save-language-profile` | `{ success }` |
| `wizardAPI.purchaseTranslate(tier)` | `wizard-purchase-translate` | `{ success, checkoutUrl? }` |
| `wizardAPI.install()` | `wizard-install` | `{ success, models } / { success: false, error }` |
| `wizardAPI.complete()` | `wizard-complete` | `true` |
| `wizardAPI.openExternal(url)` | `wizard-open-external` | `boolean` |
| `wizardAPI.verifyAccessibility()` | `wizard-verify-accessibility` | `{ status: 'granted'\|'denied'\|'unknown', message }` |
| `wizardAPI.micStatus()` | `wizard-mic-status` | `{ status }` |
| `wizardAPI.openPermSettings(which)` | `wizard-open-perm-settings` | `{ ok, error? }` |
| `wizardAPI.pasteDetect()` | `wizard-paste-detect` | full detection blob |
| `wizardAPI.pasteInstall()` | `wizard-paste-install` | `{ ok, ranCommands?, requiresReLogin?, error? }` |
| `wizardAPI.pasteTestInject()` | `wizard-paste-test-inject` | `{ ok, text?, error? }` |
| `wizardAPI.onProgress(cb)` | `wizard-progress` event | progress objects from main |
| `wizardAPI.onWindowFocus(cb)` | `wizard-window-focus` event | `void` (main fires when window regains focus) |

Every awaited operation in the install handler is wrapped in
`withTimeout()` (see `installer-v2/core/wizard-logger.js`). Timeout
errors surface to the user with the step label and log path.

## 6. Persistent state

| Path | Owner | Purpose |
|---|---|---|
| `~/.windy-pro/config.json` | wizard | Marks install complete; lists installed engines/pairs |
| `~/.windy-pro/venv/` | wizard | Python venv created from bundled wheels |
| `~/.windy-pro/python/` | wizard (legacy) | Legacy bundled-Python copy; deprecated, present only on old installs |
| `~/.windy-pro/bin/` | wizard | Bundled ffmpeg copy |
| `~/.windy-pro/models/` | wizard + main | Downloaded ASR engines (and pre-bundled starter) |
| `~/.windy-pro/engines/` | DownloadManager | Per-engine subdirs (download targets) |
| `~/.windy-pro/pairs/` | DownloadManager | Translation pair models |
| `~/.windy-pro/language-profile.json` | wizard | User-selected languages |
| `~/.windy-pro/translate-config.json` | wizard | Translation tier choice |
| `~/Library/Logs/Windy Pro/wizard-install.log` (macOS) | wizard-logger | Append-only diagnostic log |
| `~/AppData/Local/Windy Pro/Logs/wizard-install.log` (Win) | wizard-logger | Same |
| `~/.local/state/windy-pro/logs/wizard-install.log` (Linux) | wizard-logger | Same |

## 7. Things to NOT touch without reading first

* **Wayland focus + paste flow** — see `CLAUDE.md` and
  `docs/WAYLAND-PASTE-FOCUS-GUIDE.md`. Eight specific dead-ends are
  catalogued there. Don't re-try any of them.
* **Account screen index in wizard.html** — Phase 8 bypasses screen
  2 by intercepting the Continue button. The screen DOM stays in
  place to avoid shifting the integer indices that `goToScreen()`
  depends on.
* **execSync inside the install handler** — blocks the Electron
  event loop, freezes IPC, makes the progress bar appear stuck at
  0%. Always use the async exec helpers in
  `installer-v2/core/bundled-assets.js` and
  `installer-v2/core/paste-verify.js`.
