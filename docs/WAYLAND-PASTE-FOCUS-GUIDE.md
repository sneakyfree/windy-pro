# Wayland Focus Preservation & Universal Paste — Engineering Guide

> **Purpose:** This document captures everything learned while making Windy Pro's
> "record → transcribe → paste to cursor" workflow work reliably on Linux Wayland + GNOME.
> Any future developer or AI instance working on this project should read this before
> touching hotkey, focus, clipboard, or paste injection code.
>
> **Date:** 2026-04-04
> **Platform tested:** Fedora 43, GNOME 49, Wayland, XWayland, Electron 28

---

## Table of Contents

1. [The Goal](#the-goal)
2. [Why Wayland Is Different](#why-wayland-is-different)
3. [The Four Problems We Solved](#the-four-problems-we-solved)
4. [Platform Matrix](#platform-matrix)
5. [Architecture: How Paste Works on Each Platform](#architecture-how-paste-works-on-each-platform)
6. [File Map: Where the Code Lives](#file-map-where-the-code-lives)
7. [Deep Dive: Each Problem & Solution](#deep-dive-each-problem--solution)
8. [Machine Setup Requirements](#machine-setup-requirements)
9. [Testing Checklist](#testing-checklist)
10. [Known Gaps & Future Work](#known-gaps--future-work)
11. [Debugging Playbook](#debugging-playbook)

---

## The Goal

When the user presses the global hotkey (Ctrl+Shift+Space):

1. Recording starts
2. **The blinking cursor stays exactly where it was** — in whatever app, text field, terminal, browser, or editor the user was typing in
3. Recording stops on second press
4. Transcribed text **pastes directly to where the cursor is blinking**
5. The Windy Pro window stays visible as a floating overlay the entire time

This must work identically whether the target app is:
- An XWayland app (Electron apps like AntiGravity/VS Code, Firefox, Chrome)
- A Wayland-native app (GNOME Terminal/ptyxis, Nautilus, gedit, any GTK4 app)
- A web app (Google search box, Gmail compose, Amazon search)
- A terminal (running Claude Code, vim, bash prompt, etc.)

---

## Why Wayland Is Different

Wayland's security model is fundamentally different from X11, macOS, and Windows.
Understanding these differences is essential to understanding the solutions.

### X11 (Linux legacy)
- **Any app can send keystrokes to any other app** via `xdotool`
- **Any app can read/write a shared clipboard**
- **Any app can query or set the focused window**
- **Global hotkeys work via X11 grabs** — Electron's `globalShortcut` works everywhere
- Result: Paste injection "just works"

### Wayland (Linux modern)
- **Apps CANNOT send keystrokes to other apps** — this is blocked by design for security
- **Clipboard is per-surface** — X11 apps have an X11 clipboard, Wayland apps have a Wayland clipboard, and they only sync when the XWayland surface has compositor focus
- **Apps CANNOT query the focused window** — there is no equivalent of `xdotool getactivewindow` for Wayland-native windows
- **Apps CANNOT set focus on other windows** — the compositor (Mutter) controls focus exclusively
- **Global hotkeys don't work** — Electron runs under XWayland, so `globalShortcut` X11 grabs only fire when the Electron window itself has focus
- **`org.gnome.Shell.Eval` is disabled** — GNOME locked down this D-Bus API for security starting around GNOME 45. It returns `(false, '')` on GNOME 45+.
- Result: Every aspect of "record → paste" requires a different approach

### macOS
- Accessibility framework (`osascript`, System Events) provides universal input injection
- Single shared clipboard
- `globalShortcut` works via macOS hotkey APIs
- Result: Works natively, no workarounds needed

### Windows
- `SendKeys` / PowerShell provides universal input injection
- Single shared clipboard
- `globalShortcut` works via Windows hotkey APIs
- Result: Works natively, no workarounds needed

---

## The Four Problems We Solved

### Problem 1: Global Hotkeys Don't Fire on Wayland
**Symptom:** Pressing Ctrl+Shift+Space does nothing when another app has focus.
**Root cause:** Electron's `globalShortcut.register()` uses X11 keyboard grabs, which only work when the XWayland surface has focus.
**Solution:** Register GNOME custom keybindings via `gsettings` that run `curl` commands to a local HTTP control server (port 18765) inside the Electron main process.

### Problem 2: GNOME Keybinding Command Was Broken
**Symptom:** Toggle-recording hotkey never fired, even though GNOME keybinding was registered.
**Root cause:** The `bash -c` command for toggle-recording contained nested single quotes, double quotes, and `\x27` escape sequences around `org.gnome.Shell.Eval` calls. GNOME's `g_shell_parse_argv()` (GLib shell parser) could not parse the string and reported "Text ended before matching quote was found."
**Solution:** Simplified all keybinding commands to plain `curl -s http://127.0.0.1:18765/<action>`.

### Problem 3: Electron Steals Wayland Focus During Recording
**Symptom:** The blinking cursor disappears from the target app the moment recording starts or stops.
**Root cause:** Multiple things in the Electron renderer cause XWayland to request focus from Mutter:
- `navigator.mediaDevices.getUserMedia({ video })` — camera access request
- `new AudioContext()` or `audioContext.resume()` — WebAudio initialization
- `MediaRecorder.start()` / `.stop()` — media pipeline changes
- DOM updates (recording indicator, strobe effects)
- `mainWindow.show()` / `.hide()` / `.blur()` / `.setAlwaysOnTop()` — all cause X11 focus events that Mutter may honor

**Solution (multi-layered):**
1. **`setFocusable(false)`** on ALL Electron BrowserWindows (main, mini, video preview) before sending the toggle-recording IPC. This tells X11/XWayland that these windows cannot accept input focus, so Mutter ignores all focus requests from them.
2. **Pre-warm media streams at startup** — call `getUserMedia({ audio })` and `getUserMedia({ video })` during app init (when the window legitimately has focus) and cache the streams. Reuse them when recording starts instead of requesting fresh streams.
3. **Do NOT manipulate the window during recording** — no `hide()`, `blur()`, `setAlwaysOnTop()`, or opacity changes on Wayland. The window stays exactly as-is.
4. **Keep windows non-focusable for the entire flow** — 3 seconds for recording start (covers MediaRecorder + AudioContext), 10 seconds for recording stop (covers transcription + Python processing + auto-paste).

### Problem 4: Paste Doesn't Reach Wayland-Native Apps
**Symptom:** Text pastes correctly into XWayland apps (Electron, Firefox) but not into Wayland-native apps (GNOME Terminal/ptyxis, gedit).
**Root cause (clipboard):** Electron's `clipboard.writeText()` writes to the X11 clipboard via XWayland. Wayland-native apps read from the Wayland clipboard. These are separate clipboard buffers that only sync when the XWayland surface has compositor focus — which it doesn't during recording (we set it non-focusable).
**Root cause (keystroke):** `xdotool` can only send keystrokes to X11/XWayland windows. Wayland-native windows are invisible to xdotool. The only tool that can send keystrokes to the Wayland-focused window is `ydotool`, which works at the kernel level via `/dev/uinput`.
**Root cause (key combo):** Linux terminals use `Ctrl+Shift+V` for paste, not `Ctrl+V`.

**Solution:**
1. **Dual clipboard write** — write to X11 clipboard via Electron's API, then also write to Wayland clipboard via `wl-copy` (piping text to stdin).
2. **`ydotool` for keystroke injection** — the app starts its own `ydotoold` daemon (user-level, with its own socket at `/tmp/ydotool-<uid>.socket`) and uses `ydotool key` to send Ctrl+Shift+V, which works in both terminals and GUI apps.
3. **Fallback chain** — if ydotool fails, fall back to `xdotool key ctrl+v` (works for XWayland apps).
4. **`/dev/uinput` access** — ydotool requires write access to `/dev/uinput`. This is granted via a udev rule (`KERNEL=="uinput", GROUP="input", MODE="0660"`) and adding the user to the `input` group. The app's Linux installer must do this.

---

## Platform Matrix

| Platform | Global Hotkeys | Focus Preservation | Clipboard | Paste Injection | Setup Required |
|----------|---------------|-------------------|-----------|-----------------|----------------|
| **macOS** | Electron `globalShortcut` | Not needed | Electron API | `osascript` | None |
| **Windows** | Electron `globalShortcut` | Not needed | Electron API | PowerShell `SendKeys` | None |
| **Linux X11 + any DE** | Electron `globalShortcut` (X11 grabs) | Not needed (xdotool manages) | Electron API (X11 shared) | `xdotool key ctrl+v` | xdotool installed |
| **Linux Wayland + GNOME** | GNOME custom keybindings → curl → control server | `setFocusable(false)` on all windows | Electron + `wl-copy` | `ydotool key Ctrl+Shift+V` | udev rule + input group |
| **Linux Wayland + KDE** | Needs KDE-specific impl | `setFocusable(false)` | Electron + `wl-copy` | `ydotool key Ctrl+Shift+V` | udev rule + input group |
| **Linux Wayland + Sway** | Needs sway-specific impl | `setFocusable(false)` | Electron + `wl-copy` | `ydotool key Ctrl+Shift+V` | udev rule + input group |

---

## Architecture: How Paste Works on Each Platform

### macOS / Windows / Linux X11
```
User presses hotkey
  → Electron globalShortcut fires
  → toggleRecording() → safeSend IPC → renderer starts/stops recording
  → Renderer calls auto-paste-text IPC
  → Main process: clipboard.writeText(text)
  → Main process: osascript/powershell/xdotool sends Ctrl+V
  → Text appears at cursor
```

### Linux Wayland + GNOME
```
User presses Ctrl+Shift+Space
  → GNOME intercepts (gsettings custom keybinding)
  → GNOME runs: curl -s http://127.0.0.1:18765/toggle-recording
  → Electron control server receives HTTP request
  → All Electron windows set to focusable=false
  → toggleRecording() → safeSend IPC → renderer starts/stops recording
  → [Recording happens, user's app keeps Wayland focus the entire time]
  → Renderer calls auto-paste-text IPC
  → Main process: clipboard.writeText(text)     ← X11 clipboard
  → Main process: wl-copy (text via stdin)       ← Wayland clipboard
  → Main process: ydotool key Ctrl+Shift+V       ← kernel-level keystroke
  → Text appears at cursor in ANY app (Wayland-native or XWayland)
  → After 10s: windows set back to focusable=true
```

---

## File Map: Where the Code Lives

### `src/client/desktop/platform-detect.js`
- Detects OS, display server (wayland/x11), desktop environment (gnome/kde/etc.)
- Derives strategies: `hotkeyStrategy`, `pasteStrategy`, `focusStrategy`
- Sets convenience booleans: `isWayland`, `isGnome`, `needsWaylandWorkaround`
- **All platform branching starts here** — other files use `PLATFORM.*` properties

### `src/client/desktop/main.js`
- **Lines ~186-240:** `_saveWaylandFocus()` / `_restoreWaylandFocus()` — focus save/restore via xdotool window IDs
- **Lines ~2504-2550:** `startUserYdotoold()` — starts user-level ydotoold daemon for Wayland paste
- **Lines ~2550-2600:** `startWaylandControlServer()` — HTTP server on port 18765 for GNOME keybinding actions
- **Lines ~2608-2700:** `registerGnomeKeybindings()` — registers gsettings custom keybindings
- **Lines ~2777-2810:** `toggleRecording()` — the core toggle with `setFocusable(false)` for Wayland
- **Lines ~3230-3350:** `auto-paste-text` IPC handler — clipboard write + paste injection (all platforms)
- **Lines ~5505-5515:** Startup: launches Wayland control server + ydotoold + GNOME keybindings

### `src/client/desktop/renderer/app.js`
- **Lines ~275-330:** Mic + video pre-warming at init (`getUserMedia` cached to prevent focus steal)
- **Lines ~1805-1820:** Batch recording uses pre-warmed mic stream
- **Lines ~1850-1875:** Batch recording uses pre-warmed video stream
- **Lines ~3115-3200:** `toggleRecording()` renderer-side (hotkey flag, start/stop logic)

### `/etc/udev/rules.d/80-uinput.rules` (machine config)
- Grants `/dev/uinput` access to the `input` group for ydotool

---

## Deep Dive: Each Problem & Solution

### GNOME Keybinding Registration

GNOME custom keybindings are stored in `gsettings` (dconf) at:
```
/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/customN/
```

Each keybinding has three properties:
- `name` — display name (e.g., "Windy Pro: Toggle Recording")
- `command` — shell command to run (e.g., `curl -s http://127.0.0.1:18765/toggle-recording`)
- `binding` — key combo in GNOME format (e.g., `<Ctrl><Shift>space`)

The master list must also be updated:
```
org.gnome.settings-daemon.plugins.media-keys custom-keybindings
```

**Critical lesson:** The `command` string is parsed by `g_shell_parse_argv()` (GLib). This is NOT bash — it has its own quoting rules. Complex `bash -c '...'` commands with nested quotes will fail silently. Keep commands simple. If you need to pass data, use query parameters in the curl URL.

**Critical lesson:** GNOME keybindings are persistent in dconf. If you register a broken command, it stays broken even after restarting the app. The app must clean up old "Windy Pro:" keybindings before registering new ones (the code does this by checking the `name` property).

### Focus Preservation with setFocusable(false)

`BrowserWindow.setFocusable(false)` is an Electron API that sets the X11 `WM_HINTS` to mark the window as not accepting input focus. When Mutter (GNOME's compositor) sees an XWayland surface that says "I don't want focus," it ignores all focus requests from that surface.

This must be set BEFORE any renderer activity that could trigger focus:
```javascript
// In toggleRecording(), BEFORE safeSend():
if (PLATFORM.isWayland) {
  allWindows.forEach(w => w.setFocusable(false));
  setTimeout(() => {
    allWindows.forEach(w => w.setFocusable(true));
  }, isRecording ? 3000 : 10000);
}
safeSend('toggle-recording', isRecording); // This triggers renderer work
```

**Critical lesson:** You must set ALL windows non-focusable, not just `mainWindow`. The video preview window, mini widget, dev tools — any XWayland surface can steal focus. Use:
```javascript
const allWindows = [mainWindow, miniWindow, videoWindow].filter(w => w && !w.isDestroyed());
```

**Critical lesson:** The delay before re-enabling focusable must cover the ENTIRE flow:
- Recording start: 3 seconds (getUserMedia + AudioContext + MediaRecorder)
- Recording stop: 10 seconds (stop recording + send to Python + transcription + auto-paste)
If you re-enable too early, the remaining renderer work will steal focus right before paste.

### Pre-Warming Media Streams

`navigator.mediaDevices.getUserMedia()` on Linux/XWayland triggers an X11 focus request. On Wayland, this steals focus from the user's app.

**Solution:** Call it once at app startup (when the Electron window legitimately has focus) and cache the streams:

```javascript
// At init (app.js constructor):
this._preWarmedMicStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
this._preWarmedMicStream.getAudioTracks().forEach(t => { t.enabled = false; }); // Muted until needed

this._preWarmedVideoStream = await navigator.mediaDevices.getUserMedia({ video: constraints });
this._preWarmedVideoStream.getVideoTracks().forEach(t => { t.enabled = false; });
```

When recording starts, re-enable the tracks instead of requesting fresh streams:
```javascript
if (this._preWarmedMicStream?.getAudioTracks()[0]?.readyState === 'live') {
  this._preWarmedMicStream.getAudioTracks().forEach(t => { t.enabled = true; });
  stream = this._preWarmedMicStream;
} else {
  stream = await navigator.mediaDevices.getUserMedia({ audio: constraints }); // Fallback
}
```

### Dual Clipboard (X11 + Wayland)

Electron runs under XWayland, so `clipboard.writeText()` writes to the X11 selection. Wayland-native apps can't read this unless the XWayland surface has compositor focus (which it doesn't — we set it non-focusable).

**Solution:** Also write to the Wayland clipboard using `wl-copy`:
```javascript
clipboard.writeText(text);  // X11 clipboard (for XWayland apps)

if (PLATFORM.isWayland) {
  const wlProc = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  wlProc.stdin.write(text);
  wlProc.stdin.end();
  await new Promise(resolve => wlProc.on('close', resolve));
}
```

**Critical lesson:** Use `spawn` with stdin pipe, not `exec` with string interpolation. The transcribed text could contain quotes, backticks, dollar signs, etc. that would break shell escaping. Piping to stdin is injection-safe.

**Critical lesson:** `wl-copy` forks a background process that stays alive to serve clipboard paste requests. The main process exits immediately. Wait for `close` event before proceeding to paste.

### ydotool for Universal Keystroke Injection

`ydotool` works by writing events to `/dev/uinput`, which creates a virtual input device at the kernel level. The kernel routes these events to whatever window has compositor focus — it works for ALL apps regardless of whether they're X11 or Wayland.

**Architecture:**
```
ydotool → ydotoold (daemon) → /dev/uinput → kernel → Mutter → focused app
```

**Setup:**
1. `/dev/uinput` must be accessible (mode 0660, group input)
2. User must be in the `input` group
3. A `ydotoold` daemon must be running with a socket the user can access

**The app starts its own ydotoold:**
```javascript
function startUserYdotoold() {
  if (!PLATFORM.isWayland) return;
  const socketPath = path.join(os.tmpdir(), `ydotool-${process.getuid()}.socket`);
  fs.accessSync('/dev/uinput', fs.constants.W_OK); // Check access
  spawn('ydotoold', ['--socket-path', socketPath], { stdio: 'ignore', detached: true }).unref();
  _ydotoolSocket = socketPath;
}
```

**Paste command:**
```bash
YDOTOOL_SOCKET=/tmp/ydotool-1000.socket ydotool key 29:1 42:1 47:1 47:0 42:0 29:0
# 29 = KEY_LEFTCTRL, 42 = KEY_LEFTSHIFT, 47 = KEY_V
# :1 = key down, :0 = key up
```

**Critical lesson:** Use `Ctrl+Shift+V`, NOT `Ctrl+V`. On Linux, terminals use Ctrl+Shift+V for paste. GUI apps accept BOTH Ctrl+V and Ctrl+Shift+V. So Ctrl+Shift+V is the universal choice.

**Critical lesson:** The system-level ydotoold (PID 1, running as root) creates its socket at `/tmp/.ydotool_socket` with root-only permissions. The app cannot use this socket. It must start its own user-level ydotoold with a user-writable socket.

---

## Machine Setup Requirements

### macOS
No special setup required.

### Windows
No special setup required.

### Linux X11
- `xdotool` must be installed (`sudo apt install xdotool` / `sudo dnf install xdotool`)

### Linux Wayland + GNOME
All of the above, plus:
- `wl-clipboard` must be installed (`sudo apt install wl-clipboard` / `sudo dnf install wl-clipboard`) — provides `wl-copy`
- `ydotool` must be installed (`sudo apt install ydotool` / `sudo dnf install ydotool`)
- `/dev/uinput` must be accessible:
  ```bash
  # Create persistent udev rule (survives reboots):
  echo 'KERNEL=="uinput", GROUP="input", MODE="0660"' | sudo tee /etc/udev/rules.d/80-uinput.rules
  sudo udevadm control --reload-rules
  sudo udevadm trigger

  # Add user to input group:
  sudo usermod -aG input $USER
  # User must log out and back in for group change to take effect
  # OR temporarily: sudo chmod 0666 /dev/uinput (resets on reboot)
  ```

**The installer (`scripts/linux/postinst`) should automate all of this.**

---

## Testing Checklist

For each platform, verify ALL of these scenarios:

### Core Flow
- [ ] Cursor in text editor → record → stop → text pastes at cursor
- [ ] Cursor in terminal → record → stop → text pastes at cursor
- [ ] Cursor in browser search box → record → stop → text pastes at cursor
- [ ] Cursor in Electron app (e.g., VS Code) → record → stop → text pastes at cursor

### Focus Preservation
- [ ] Cursor blinks continuously from start of recording through paste completion
- [ ] Windy Pro window stays visible as overlay during recording
- [ ] Windy Pro window does NOT flash, hide, or disappear at any point
- [ ] Moving cursor to a different app mid-recording → text pastes to new location

### Edge Cases
- [ ] Very long transcription (30+ seconds) — paste still works, focus still preserved
- [ ] Rapid start/stop (double-tap hotkey quickly) — no crash or duplicate paste
- [ ] Target app is fullscreen — hotkey still works, paste still works
- [ ] Multiple monitors — paste goes to correct monitor's focused window
- [ ] Target app is a Wayland-native terminal (ptyxis, GNOME Console) — paste works
- [ ] Target app is an XWayland app (Firefox, Chrome, VS Code) — paste works

### Wayland-Specific
- [ ] `ydotoold` process starts automatically with the app
- [ ] `wl-copy` sets Wayland clipboard (verify with `wl-paste` in a terminal)
- [ ] Ctrl+Shift+V keystroke reaches Wayland-native apps
- [ ] GNOME custom keybindings appear in Settings → Keyboard → Custom Shortcuts
- [ ] Keybindings survive app restart (old ones cleaned up, new ones registered)
- [ ] App works after system reboot (udev rule persists, group membership persists)

---

## Known Gaps & Future Work

### Wayland + KDE Plasma
GNOME custom keybindings (`gsettings`) don't exist on KDE. Need to implement:
- `kwriteconfig5` or `kwriteconfig6` for KDE global shortcuts
- OR use KDE's D-Bus interface for custom shortcuts
- The control server (port 18765) and ydotool paste would work as-is

### Wayland + Sway / Hyprland / wlroots
These compositors don't use GNOME's gsettings. Need to:
- Detect the compositor
- Write to `~/.config/sway/config` or `~/.config/hypr/hyprland.conf`
- OR use a compositor-agnostic approach like a background daemon with `libinput`

### Flatpak / Snap Sandboxing
Sandboxed apps may not have access to:
- `/dev/uinput` — may need a Flatpak portal or `--device=all` permission
- `gsettings` — may need `--talk-name=org.gnome.Settings` permission
- `wl-copy` — may need `--socket=wayland` permission

### Installer Automation
The Linux installer (`scripts/linux/postinst`) should:
1. Install `xdotool`, `ydotool`, `wl-clipboard` if not present
2. Create the udev rule for `/dev/uinput`
3. Add the user to the `input` group
4. Show a dialog explaining why these permissions are needed
5. Detect if a reboot/re-login is needed for group changes

### First-Run Detection
The app should detect at startup if ydotool/wl-copy are available and `/dev/uinput` is writable. If not, show a friendly in-app banner with setup instructions rather than silently failing.

---

## Debugging Playbook

### "Hotkey doesn't fire"
1. Check if GNOME keybindings are registered: `gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings`
2. Check each binding: `gsettings get org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command`
3. Test the curl manually: `curl -s http://127.0.0.1:18765/toggle-recording`
4. Check the app log for `[WaylandCtrl] Executed: toggle-recording`
5. Check `journalctl --user -u gsd-media-keys` for keybinding errors

### "Cursor disappears when recording starts"
1. Check log for `[WaylandFocus]` entries — is setFocusable being called?
2. Check if the renderer is requesting fresh getUserMedia (look for `[BatchRec] Pre-warmed stream unavailable`)
3. Check if any window is calling `.show()`, `.focus()`, or `.setAlwaysOnTop(true)` during recording

### "Text doesn't paste to terminal"
1. Verify ydotool works: `YDOTOOL_SOCKET=/tmp/ydotool-$(id -u).socket ydotool key 28:1 28:0`
2. Verify wl-copy works: `echo test | wl-copy && wl-paste`
3. Check `/dev/uinput` permissions: `ls -la /dev/uinput` (should be `crw-rw----` or `crw-rw-rw-`)
4. Check user groups: `groups` (should include `input`)
5. Check if ydotoold is running: `pgrep -a ydotoold`
6. Check app log for `[ydotool]` entries

### "Text pastes to wrong app"
1. The `setFocusable(false)` timeout may be too short — increase the delay
2. Check if another Electron window (video preview, dev tools) is stealing focus
3. On stop-recording, the 10-second non-focusable window may not be enough for long transcriptions — consider making it dynamic based on audio length

### "Works in some apps but not others"
- XWayland-only apps (Electron, Firefox): X11 clipboard + xdotool works
- Wayland-native apps (GNOME Terminal): needs wl-copy + ydotool
- If it works in Firefox but not Terminal: clipboard or keystroke issue
- If it works in Terminal but not Firefox: unlikely, but check xdotool fallback

---

## Key Takeaways

1. **Wayland is not X11 with a new coat of paint.** It has fundamentally different security guarantees. Every assumption about focus, clipboard, and input injection from X11 is wrong on Wayland.

2. **`setFocusable(false)` is the single most important fix.** Without it, any renderer activity (DOM updates, media APIs, AudioContext) will cause XWayland to request focus, and Mutter will honor it.

3. **Dual clipboard is mandatory.** X11 and Wayland clipboards are separate. If you only write to one, half the apps on the system can't see it.

4. **`ydotool` is the only universal keystroke injection tool on Wayland.** xdotool only reaches XWayland apps. There is no pure Wayland API for input injection (by design). ydotool bypasses this via `/dev/uinput` at the kernel level.

5. **`Ctrl+Shift+V` is the universal paste shortcut on Linux.** Terminals require it, and GUI apps also accept it. Never use just `Ctrl+V` on Linux.

6. **Keep keybinding commands simple.** GNOME's `g_shell_parse_argv()` is not bash. Nested quotes will break. Use plain `curl` commands and pass data via URL parameters.

7. **Test on Wayland-native AND XWayland apps.** It's easy to think "it works" when you only test in Firefox (XWayland). Always test in GNOME Terminal or ptyxis (Wayland-native) too.

8. **This is Linux-Wayland-specific.** macOS, Windows, and Linux X11 don't need any of these workarounds. All Wayland-specific code is gated behind `PLATFORM.isWayland` checks and won't execute on other platforms.
