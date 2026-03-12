# QA Report — Windy Pro Desktop (macOS)

**Date:** 2026-03-11  
**Platform:** macOS 13.7.8 (Ventura), Intel x86_64  
**Electron:** 28.3.3 · Node v18  
**App Version:** 1.6.1  

---

## 1. Launch

```
cd ~/windy-pro && npx electron . --no-sandbox
```

✅ **PASS** — App launches without errors. Python server starts, tray icon appears, main window renders.

---

## 2. macOS-Specific Behavior

| Check | Result | Notes |
|---|---|---|
| Dock icon with proper icon | ⚠️ PARTIAL | Dock shows an icon but `icon.icns` is only 512×512 — no 1024×1024 variant for Retina/5K. Appears slightly soft on HiDPI. |
| Cmd+Q quit | ✅ PASS | Wired via `createMacOSMenu()` — correctly sets `app.isQuitting = true` before `app.quit()`. |
| Cmd+H hide | ✅ PASS | Uses Electron `role: 'hide'`. |
| Cmd+M minimize | ✅ PASS | Uses Electron `role: 'minimize'` in Window menu. |
| Cmd+, opens Settings | ✅ PASS | Custom accelerator sends `open-settings` IPC. |
| Menu bar (File, Edit, View, Help) | ✅ PASS | Full macOS menu: App menu (About, Settings, New Recording, Services, Hide, Quit), Edit (undo/redo/cut/copy/paste/selectAll), View (reload, devtools, zoom, fullscreen), Window (minimize, zoom, front), Help (shortcuts, privacy, terms, website, bugs, about). |
| Right-click context menu | ✅ PASS | Electron default context menu works; Edit menu provides Cmd+C/V/X. |
| Dock click re-opens window | ✅ PASS | `app.on('activate')` correctly shows or re-creates the window. |
| Hide Others (Cmd+Opt+H) | ✅ PASS | Uses `role: 'hideOthers'`. |

---

## 3. Audio Recording — Microphone Permission

✅ **PASS** — macOS microphone permission prompt appears on first recording attempt. `Info.plist` includes:
- `NSMicrophoneUsageDescription`: "Windy Pro needs microphone access for voice-to-text transcription."
- `NSCameraUsageDescription`: "Windy Pro needs camera access for the video preview feature."

Entitlements (`build/entitlements.mac.plist`) correctly request:
- `com.apple.security.device.audio-input`
- `com.apple.security.device.camera`
- `com.apple.security.network.client`

---

## 4. Installer Wizard — macOS Adapter Detection

Tested against this machine's actual environment:

| Dependency | Detection | Notes |
|---|---|---|
| Homebrew | ✅ Detected | `/usr/local/bin/brew` (v5.0.16) |
| Python | ✅ Detected | Python 3.14.3 found. Adapter has 6-strategy fallback chain (bundled → system → Xcode CLI → Homebrew → python.org → Miniforge). |
| ffmpeg | ✅ Detected | ffmpeg 8.0.1 (evermeet.cx). Adapter has 4-strategy chain (bundled → system → Homebrew → static download). |
| GPU/Metal | ✅ Detected | Correctly identifies x86_64 as "Intel (CPU only)". Apple Silicon would get MPS. |

**Note:** Adapter unconditionally checks `nvidia-smi` for GPU detection on all platforms — always fails silently on macOS (line 2889). Not a bug, but wasted shell exec.

---

## 5. Electron-Builder Packaging

```
npx electron-builder --mac --dir
```

✅ **PASS** — Builds successfully.

| Property | Value |
|---|---|
| Output | `dist/mac/Windy Pro.app` |
| .app size | **1.0 GB** |
| Code signing | **Skipped** (`identity: null`) |
| Notarization | **Disabled** (`notarize: false`) |
| Hardened Runtime | Configured (`hardenedRuntime: true`) |
| Target | `dmg` (x64 + arm64), built as `--dir` for testing |
| Category | `public.app-category.productivity` |
| Min macOS | 10.15 (Catalina) |

> [!WARNING]
> Code signing and notarization are disabled. The app **will** trigger Gatekeeper warnings on other machines. Users must right-click → Open to bypass. This must be resolved before public distribution.

---

## 6. File Path Audit

| Pattern | Occurrences | Severity |
|---|---|---|
| `/home/` | 1 in source code | 🟡 Low — `settings.js:128` has `placeholder="/home/user/Documents/WindyProArchive"`. Should be `~/Documents/WindyProArchive` or dynamically set. |
| `/tmp/` | 1 in source code | ✅ Non-issue — `main.js:4309` uses `/tmp/` only inside a Linux-only `.deb` update code path (`if (platform !== 'linux')` returns before reaching it). |
| `/etc/` | 0 | ✅ Clean |
| `df -BG` | 1 occurrence | 🔴 **BUG** — `main.js:2908` uses `df -BG` for disk space detection. `-BG` is a GNU/Linux-only flag. **Fails on macOS** with "illegal option". Should use `df -g` on macOS. Disk space will always report `null` on macOS in the installer wizard. |

---

## 7. Dark Mode

🔴 **NOT FUNCTIONAL**

The main process correctly listens for `nativeTheme.updated` events and sends `system-theme-changed` IPC to the renderer (lines 4243–4251). The preload exposes `onSystemThemeChanged` (line 198).

**However, the renderer never subscribes to this event.** Neither `app.js` nor `styles.css` contains any handler for `onSystemThemeChanged` or `prefers-color-scheme`. The app is permanently dark-themed via hardcoded CSS. Toggling macOS system dark mode has **zero effect** on the app.

**Verdict:** Dark mode infrastructure exists in main+preload but is dead code. The renderer ignores theme changes entirely.

---

## 8. Retina Rendering

| Item | Result | Notes |
|---|---|---|
| `NSHighResolutionCapable` | ✅ Set to `true` in Info.plist | Electron renders at native resolution. |
| Text rendering | ✅ Crisp | System font `-apple-system, BlinkMacSystemFont` renders perfectly. |
| UI elements | ✅ Crisp | CSS-based UI scales cleanly. |
| App icon (Dock) | ⚠️ Slightly soft | `icon.icns` only contains 512×512 (ic07). Missing 1024×1024 for Retina. |
| Tray icon | ✅ OK | Programmatically generated 16×16 colored circle — resolution-appropriate for menu bar. |
| `vibrancy` | ✅ Applied | `'under-window'` vibrancy correctly applied only on darwin. |

---

## 9. macOS-Specific Bugs

| # | Severity | Description |
|---|---|---|
| 1 | 🔴 Critical | **Dark mode is dead code** — `system-theme-changed` events sent but never consumed by renderer. App ignores system theme. |
| 2 | 🔴 Critical | **Code signing disabled** — `identity: null`, `notarize: false`. Gatekeeper will block the app on other machines. |
| 3 | 🔴 High | **`df -BG` fails on macOS** — Disk space detection in hardware wizard (`main.js:2908`) uses GNU-only flag. Returns `null` on macOS. |
| 4 | 🟡 Medium | **About window links broken** — About window (`showAboutWindow()`) uses inline HTML with `require('electron').shell.openExternal()`, but the window has `contextIsolation: true` and `sandbox: true` — `require('electron')` is not available. Website/Support/GitHub links are non-functional. |
| 5 | 🟡 Medium | **Icon missing 1024×1024** — `icon.icns` only has 512×512 (39KB, `ic07` type). Retina/5K displays show a slightly upscaled icon. Should include 1024×1024 (`ic10`). |
| 6 | 🟢 Low | **Settings placeholder shows Linux path** — Archive folder input placeholder reads `/home/user/Documents/WindyProArchive` instead of `~/Documents/WindyProArchive`. |
| 7 | 🟢 Low | **`nvidia-smi` called on macOS** — Hardware detection unconditionally runs `nvidia-smi` (line 2889) which will always fail on macOS. Harmless (caught) but wasteful. |

---

## 10. Features That Work on Linux but Break on macOS

| Feature | Status on macOS | Details |
|---|---|---|
| `df -BG` disk space | ❌ Broken | GNU-only flag. Returns `null`. Fix: use `df -g` on macOS. |
| About window links | ❌ Broken | `require('electron')` not available in sandboxed inline HTML. Works on Linux because the window might be created differently or tested without sandbox. |
| Code signing/Gatekeeper | ❌ N/A on Linux | Linux has no equivalent. macOS requires signing+notarization for distribution. Currently disabled. |
| Dark mode response | ⚠️ Dead code | Infrastructure exists but renderer doesn't consume theme events. Same bug on all platforms, but macOS users expect dark mode parity. |
| `.deb` in-app update | ✅ N/A | Correctly gated behind `platform === 'linux'` check. |
| `xdotool` for paste/focus | ✅ N/A | Correctly uses `osascript` on macOS instead. |

---

## 11. Ratings

| Category | Score | Justification |
|---|---|---|
| **macOS Integration** | **7 / 10** | Full menu bar, Cmd shortcuts, dock badge, tray icon, vibrancy, `osascript` paste, crash logs to `~/Library/Logs/WindyPro/`, microphone permission prompt all work. Deductions for: missing code signing (-2), dead dark mode (-1). |
| **Visual Quality** | **8 / 10** | Premium dark UI with glassmorphism, vibrancy effect, gradient badges, smooth animations. Text is crisp at Retina resolution. Deductions for: icon only 512px (-1), hardcoded dark theme (-1). |
| **Feature Parity with Linux** | **9 / 10** | All core features work: recording, transcription, translation, archive, vault, chat, mini-widget, tray, hotkeys, upgrade flow. Only missing: disk space detection via `df -BG` bug (-1). |

---

## Summary

Windy Pro on macOS is **functionally solid** with excellent menu bar integration, proper permission handling, and a polished dark UI. The three critical items blocking production release are:

1. **Enable code signing and notarization** — without this, macOS Gatekeeper blocks the app.
2. **Connect dark mode to renderer** — the plumbing exists but the renderer ignores theme events.
3. **Fix `df -BG` → `df -g`** — disk space detection fails silently on macOS.

Secondary items: fix About window links (use preload/IPC instead of inline `require`), add 1024×1024 icon variant, update the `/home/` placeholder in settings.

---

*Report generated by automated QA audit on 2026-03-11.*
