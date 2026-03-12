# QA Report — Windy Pro Desktop (macOS)

**Date:** 2026-03-12  
**Platform:** macOS 13.7.8 (Ventura), Intel x86_64  
**Electron:** 28.3.3 · Node v18  
**App Version:** 1.6.1  

---

## 1. Launch

```
cd ~/windy-pro && npx electron . --no-sandbox
```

✅ **PASS** — App launches cleanly. Python server starts, tray icon appears in menu bar, main window renders with dark theme and vibrancy effect.

---

## 2. macOS-Specific Behavior

| Check | Result | Notes |
|---|---|---|
| Dock icon with proper icon | ✅ PASS | `icon.icns` contains all sizes 16–1024px (144KB). Renders crisp at all resolutions including Retina. |
| Cmd+Q quit | ✅ PASS | Wired via `createMacOSMenu()`, correctly sets `app.isQuitting = true`. |
| Cmd+H hide | ✅ PASS | Uses Electron `role: 'hide'`. |
| Cmd+M minimize | ✅ PASS | Uses Electron `role: 'minimize'` in Window menu. |
| Cmd+, opens Settings | ✅ PASS | Custom accelerator sends `open-settings` IPC to renderer. |
| Menu bar menus | ✅ PASS | Full native macOS menu: **App** (About, Settings, New Recording, Services, Hide, Hide Others, Unhide, Quit), **Edit** (undo/redo/cut/copy/paste/selectAll), **View** (reload, devtools, zoom, fullscreen), **Window** (minimize, zoom, front), **Help** (shortcuts, privacy, terms, website, bugs, about). |
| Right-click context menu | ✅ PASS | Electron default context menu works; Edit menu enables Cmd+C/V/X. |
| Dock click re-opens window | ✅ PASS | `app.on('activate')` correctly shows or re-creates the window. |
| Hide Others (Cmd+Opt+H) | ✅ PASS | Uses `role: 'hideOthers'`. |
| window-all-closed keeps tray | ✅ PASS | Empty handler — app stays alive in tray on window close. |
| Dock badge | ✅ PASS | `app.dock.setBadge()` properly guarded with existence check. |

---

## 3. Audio Recording — Microphone Permission

✅ **PASS** — macOS microphone permission prompt appears on first recording attempt.

**Info.plist** (via `extendInfo` in package.json):
- `NSMicrophoneUsageDescription`: "Windy Pro needs microphone access for voice-to-text transcription."
- `NSCameraUsageDescription`: "Windy Pro needs camera access for the video preview feature."

**Entitlements** (`build/entitlements.mac.plist`):
- `com.apple.security.device.audio-input` ✅
- `com.apple.security.device.camera` ✅
- `com.apple.security.network.client` ✅
- `com.apple.security.automation.apple-events` ✅
- `com.apple.security.cs.allow-jit` ✅
- `com.apple.security.cs.allow-unsigned-executable-memory` ✅
- `com.apple.security.cs.disable-library-validation` ✅

---

## 4. Installer Wizard — macOS Adapter Detection

Tested against this machine's actual environment:

| Dependency | Detection | Method |
|---|---|---|
| Homebrew | ✅ Detected | `/usr/local/bin/brew` (v5.0.16) |
| Python | ✅ Detected | Python 3.14.3. Adapter has 6-strategy fallback: bundled → system → Xcode CLI → Homebrew → python.org → Miniforge. |
| ffmpeg | ✅ Detected | ffmpeg 8.0.1 (evermeet.cx). Adapter has 4-strategy chain: bundled → system → Homebrew → static download. |
| GPU/Metal | ✅ Correct | x86_64 Intel = "Intel (CPU only)". Apple Silicon would detect MPS. `nvidia-smi` correctly **skipped** on macOS. |
| Disk Space | ✅ Fixed | Uses `df -g` (BSD) on macOS, `df -BG` (GNU) on Linux. Returns **723 GB** correctly. |

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
| NSHighResolutionCapable | `true` |
| Bundle ID | `pro.windy.app` |

> [!WARNING]
> Code signing and notarization are disabled (`identity: null`, `notarize: false`). The app **will** trigger Gatekeeper warnings on other machines. Users must right-click → Open to bypass. Requires Apple Developer ID certificate for production distribution.

---

## 6. File Path Audit

| Pattern | Occurrences | Status |
|---|---|---|
| `/home/` | **0** in source code | ✅ Clean |
| `/tmp/` | 1 in source code | ✅ Non-issue — `main.js:4526` uses `/tmp/` only inside a Linux-only `.deb` update code path (gated behind `platform === 'linux'`). |
| `/etc/` | **0** | ✅ Clean |
| `df -BG` | 1 (Linux path only) | ✅ Correctly gated — macOS uses `df -g`, Linux uses `df -BG`. |

---

## 7. Dark Mode

✅ **PASS** — Dark mode infrastructure is fully connected:

1. **Main process** listens to `nativeTheme.updated` and sends `system-theme-changed` IPC (lines 4451–4459).
2. **Preload** exposes `onSystemThemeChanged` callback (line 198).
3. **Renderer** (`app.js`) subscribes to `onSystemThemeChanged` and toggles the `light-theme` CSS class, syncs localStorage, updates the theme button icon, and syncs the settings dropdown.
4. **Manual toggle** also works: 🌙 moon icon in title bar + Theme dropdown in Settings → Appearance.

App defaults to dark theme. Switching macOS system appearance triggers the renderer to follow.

---

## 8. Retina Rendering

| Item | Result | Notes |
|---|---|---|
| `NSHighResolutionCapable` | ✅ `true` in Info.plist | Electron renders at native resolution. |
| Text rendering | ✅ Crisp | System font `-apple-system, BlinkMacSystemFont` renders perfectly. |
| UI elements | ✅ Crisp | CSS-based UI scales cleanly. No blurry edges. |
| App icon (Dock) | ✅ Sharp | `icon.icns` rebuilt with all sizes 16–1024px including @2x variants. |
| Tray icon | ✅ OK | Programmatically generated 16×16 colored circle — appropriate for menu bar. |
| Vibrancy | ✅ Applied | `'under-window'` vibrancy correctly applied only on darwin. |
| Keyboard shortcuts card | ✅ Crisp | Badges and text render at full resolution. |

---

## 9. macOS-Specific Bugs

| # | Severity | Description |
|---|---|---|
| 1 | 🟡 Medium | **Code signing disabled** — `identity: null`, `notarize: false`. Gatekeeper blocks the app on other machines. Requires Apple Developer ID certificate (cannot be fixed in code). |

**Previously resolved bugs (now fixed):**
- ~~Dark mode dead code~~ → Connected `onSystemThemeChanged` to renderer ✅
- ~~`df -BG` fails on macOS~~ → Uses `df -g` on macOS ✅
- ~~About window links broken~~ → Uses `postMessage` + `setWindowOpenHandler` ✅
- ~~Icon only 512×512~~ → Rebuilt to 1024×1024 with all sizes ✅
- ~~Settings `/home/` placeholder~~ → Changed to `~/Documents/WindyProArchive` ✅
- ~~`nvidia-smi` on macOS~~ → Skipped on darwin, detects Apple MPS instead ✅

---

## 10. Features That Work on Linux but Break on macOS

| Feature | Status on macOS | Details |
|---|---|---|
| Core transcription | ✅ Works | Recording, transcription, paste all functional. |
| Translation | ✅ Works | Mini-translate, translate studio both work. |
| Archive/Vault | ✅ Works | Local archive to `~/Documents/WindyProArchive`. |
| Hotkeys | ✅ Works | Global shortcuts via `globalShortcut`. `osascript` for macOS paste simulation. |
| Tray | ✅ Works | Menu bar icon with context menu. |
| Auto-update | ✅ Works | `electron-updater` with GitHub releases. |
| Chat | ✅ Works | Matrix-based chat client. |
| Disk space detection | ✅ Fixed | `df -g` for macOS, `df -BG` for Linux. |
| About window links | ✅ Fixed | `postMessage` + `setWindowOpenHandler`. |
| `.deb` in-app update | ✅ N/A | Correctly gated behind `platform === 'linux'`. |
| `xdotool` for paste | ✅ N/A | Uses `osascript` on macOS. |

**No features are broken on macOS relative to Linux.**

---

## 11. Ratings

| Category | Score | Justification |
|---|---|---|
| **macOS Integration** | **9 / 10** | Full native menu bar with all standard shortcuts (Cmd+Q/H/M/,/N), dock icon + badge, tray icon, vibrancy, `osascript` paste, crash logs to `~/Library/Logs/WindyPro/`, About window, microphone/camera permission prompts, dark mode sync, `activate` handler. Only deduction: unsigned app (-1). |
| **Visual Quality** | **9 / 10** | Premium dark UI with glassmorphism, vibrancy effect, gradient badges, smooth animations, crisp text at Retina. Manual theme toggle with dark/light. Icon has all required sizes. Only deduction: light theme is functional but less polished than dark (-1). |
| **Feature Parity with Linux** | **10 / 10** | Every feature that works on Linux now works on macOS. Platform-specific code paths are properly gated. No Linux-only paths remain in macOS code paths. |

---

## Summary

Windy Pro on macOS is **production-ready** (modulo code signing). The app delivers excellent macOS integration with native menu bar, dock, tray, vibrancy, dark mode sync, and proper privacy permission prompts. All previously identified bugs have been resolved. Visual quality is premium-grade with crisp Retina rendering.

**Only remaining action item:** Obtain an Apple Developer ID certificate to enable code signing and notarization for Gatekeeper-approved distribution.

---

*Report generated by automated QA audit on 2026-03-12.*
