# Debugging Windy Pro

How to find the root cause of the failures users actually report. Read
top-down by symptom.

For *what should be happening*, see [ARCHITECTURE.md](ARCHITECTURE.md).
For *Wayland-specific paste/focus weirdness*, see
[docs/WAYLAND-PASTE-FOCUS-GUIDE.md](docs/WAYLAND-PASTE-FOCUS-GUIDE.md)
— far more detail than this file, and many fixes that look obvious are
already-tried dead ends.

## Find the wizard log

The wizard writes a timestamped, append-only log every run.

| Platform | Path |
|---|---|
| macOS | `~/Library/Logs/Windy Pro/wizard-install.log` |
| Windows | `%LOCALAPPDATA%\Windy Pro\Logs\wizard-install.log` |
| Linux | `~/.local/state/windy-pro/logs/wizard-install.log` |

Each run starts with a banner:

```
========== WIZARD START 2026-04-15T01:36:20.683Z (pid 95610) ==========
```

The **last line** before any silence tells you exactly which step
hung. Every awaited operation in `wizard-install` is wrapped in
`withTimeout()` (see `installer-v2/core/wizard-logger.js`); when one
trips the log shows:

```
✗ TIMEOUT after 60000ms in: CleanSlate.run
```

Tail it live:

```bash
tail -f "$HOME/Library/Logs/Windy Pro/wizard-install.log"
```

## Symptom: wizard stuck at 0%

History: this used to be the most common report. Two distinct causes,
both fixed but worth remembering.

### Cause A — execSync in the install path

Any `execSync` call inside an async function blocks the Electron main
event loop, which freezes IPC delivery. The renderer never receives
`sendProgress` callbacks, so the bar appears stuck at 0% even though
the install is making progress under the hood.

Diagnostic:

```bash
grep -nE "execSync\(" installer-v2/wizard-main.js installer-v2/core/*.js
```

Anything that takes more than ~50ms must be `exec` (Promise-wrapped),
not `execSync`. Pattern to use is in
`installer-v2/core/bundled-assets.js` `execAsync()`.

### Cause B — CleanSlate killing our own process tree

The wizard scans for "windy" processes and kills them so the new
install starts clean. The guard list (`safePids` in
`installer-v2/core/clean-slate.js _killProcesses`) protects the
wizard's own pid + ppid + direct children + process group. Last line
of defence: skip any process whose `ps` command line contains the
running .app bundle path (in case Electron reparented a helper to
launchd).

Diagnostic — confirm guard set looks right:

```
grep "_killProcesses: safe-pid guard" "$HOME/Library/Logs/Windy Pro/wizard-install.log"
grep "_killProcesses: SKIPPING own" "$HOME/Library/Logs/Windy Pro/wizard-install.log"
```

If the guard set is `2` (just pid + ppid) and you see SKIPPING lines,
the safety net caught the regression. If you DON'T see SKIPPING lines
but the wizard is dying mid-CleanSlate, the bundle-path check failed —
investigate `_ownBundlePath()` against the actual `process.execPath`.

## Symptom: microphone permission denied

The wizard's verify screen does a real probe (1s of audio + RMS check),
not a System-Settings open-and-pray. If it reports denied:

```bash
# macOS — the OS-level grant
tccutil reset Microphone pro.windy.app   # forces a fresh prompt next launch

# What macOS thinks of us right now
sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" \
  "SELECT client, allowed FROM access WHERE service='kTCCServiceMicrophone' AND client LIKE '%windy%'"
```

If `allowed=0`, the user clicked Deny in the prompt. They have to go
to System Settings → Privacy → Microphone and toggle Windy Pro on.
The wizard's "Open Mic Settings" button deep-links there.

If the OS grant looks fine but the wizard still reports a quiet
amplitude (peak < 2%), the input device is wrong or muted. Check:

```bash
# macOS active input device
SwitchAudioSource -t input -c

# Linux PulseAudio
pactl list sources short | grep -i input
```

## Symptom: paste-to-cursor not working

Linux only — macOS / Windows have native APIs that don't fail this
way. Read `docs/WAYLAND-PASTE-FOCUS-GUIDE.md` *first*; almost every
"obvious" fix is documented there as a dead end.

Detect what the wizard sees:

```bash
echo $XDG_SESSION_TYPE                          # x11 vs wayland
which xdotool ydotool wl-copy xclip
ls -l /dev/uinput
id -nG | tr ' ' '\n' | grep -x input            # user in input group?
pgrep -x ydotoold                               # ydotoold running?
```

Wayland-specific failure modes:

| Symptom | Likely cause |
|---|---|
| `ydotool: failed to open uinput device` | `/dev/uinput` not writable. Run wizard's "Install paste tools" again — adds udev rule + group. |
| Type works briefly then stops | ydotoold daemon died. `systemctl --user restart ydotoold`. |
| Group added but ydotool still fails | User must log out + back in (group membership only takes effect at login). |
| Test paste fires but text doesn't appear | Wizard window lost focus before keystrokes arrived. Re-focus and click Test paste again. Don't add `mainWindow.focus()` workarounds — see WAYLAND-PASTE-FOCUS-GUIDE.md dead-end #3. |

## Symptom: bundled Python not detected

If `bundled-assets.js hasBundledPython()` returns false, the wizard
falls back to system Python (or fails on machines without 3.11+).

```bash
# Confirm extraResources/ layout
ls -la /Applications/Windy\ Pro.app/Contents/Resources/bundled/python/bin/
/Applications/Windy\ Pro.app/Contents/Resources/bundled/python/bin/python3 --version

# Confirm wheels are present
ls /Applications/Windy\ Pro.app/Contents/Resources/bundled/wheels/ | wc -l
```

If `python3` exists but the venv module fails:

```bash
/Applications/Windy\ Pro.app/Contents/Resources/bundled/python/bin/python3 -c "import venv; print('ok')"
```

If venv is missing the bundle was built without `--with-ensurepip`.
Re-run `node scripts/build-portable-bundle.js --target <platform> --force`.

## Symptom: pip install fails offline (fast path)

Look in the wizard log for:

```
[BundledAssets] pip install failed (12345ms): ...
[BundledAssets]   stderr: ...
```

If the stderr mentions "no matching distribution", a wheel for the
*current* platform is missing from the bundle. The build script may
have downloaded host-only wheels even though `--target` was specified
(see `build-portable-bundle.js buildWheels()` cross-platform notes).
Rebuild on the actual target platform.

## Symptom: Python engine doesn't start in main app

After install, `src/client/desktop/main.js` `startPythonServer()`
spawns the Python engine. If it never starts, the main window keeps
showing "Connecting to engine..."

```bash
# Find the venv that main.js will pick (precedence in ARCHITECTURE.md §4)
ls /Applications/Windy\ Pro.app/Contents/Resources/bundled/venv/bin/python  || true
ls "$HOME/.windy-pro/venv/bin/python" || true

# Try launching the engine manually with that python
/Applications/Windy\ Pro.app/Contents/Resources/bundled/venv/bin/python -m src.engine.server --host 127.0.0.1 --port 9876
```

Common causes:

* Port 9876 already taken (another Windy install left a process behind).
  `lsof -ti:9876 | xargs kill -9` clears it.
* Bundled `ffmpeg` not on PATH. Engine looks in
  `~/.windy-pro/bin/` — if missing, copy from
  `<.app>/Contents/Resources/bundled/ffmpeg/`.
* Wrong arch venv on Apple Silicon (running x86_64 wheels under
  Rosetta is slow). `file <.app>/Contents/Resources/bundled/python/bin/python3`
  must report `arm64` on Apple Silicon machines.

## Symptom: "Open Settings" deep-links don't open

macOS only. The deep-link URLs change between major macOS versions.
If `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`
no longer opens the right pane, fall back to:

```bash
open "/System/Library/PreferencePanes/Security.prefPane"
```

Then update `wizard-open-perm-settings` IPC handler in
`installer-v2/wizard-main.js`.

## Last resort: clean uninstall

Removes everything Windy Pro ever wrote. Useful when reproducing a
bug from a fresh state.

```bash
# macOS
rm -rf "$HOME/.windy-pro"
rm -rf "$HOME/Library/Application Support/windy-pro"
rm -rf "$HOME/Library/Logs/Windy Pro"
rm -rf "/Applications/Windy Pro.app"

# Linux
rm -rf "$HOME/.windy-pro"
rm -rf "$HOME/.config/windy-pro"
rm -rf "$HOME/.local/state/windy-pro"
rm -f "$HOME/.local/share/applications/windy-pro.desktop"

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:USERPROFILE\.windy-pro"
Remove-Item -Recurse -Force "$env:APPDATA\windy-pro"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Windy Pro"
```

Then re-run the .dmg/.exe/.AppImage. CleanSlate will detect a fresh
state and skip its kill/cleanup phases.
