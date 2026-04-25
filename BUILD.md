# Building Windy Pro

Reference for how to build the Windy Pro desktop app from source. Covers the
new portable-bundling architecture (Phase 1+2 of the bulletproof installer
plan) and the verification rituals that catch regressions before users do.

> **Principle:** the app is the runtime. The user's OS is just a host. We
> bundle Python, all wheels, ffmpeg, and a starter model inside the app so
> the wizard never installs anything on the user's system.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | ≥20 | Use `nvm` or `volta` to pin |
| npm | ≥10 | Ships with Node 20+ |
| Python | 3.11 | Used by the build script for `pip download` |
| curl | any | Bulletproof downloader for python-build-standalone |

Plus platform-specific tooling for `electron-builder`:

| Platform | Required |
|---|---|
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Linux | `dpkg`, `fakeroot`, `rpm` (for .deb / AppImage) |
| Windows | Visual Studio Build Tools or full Visual Studio |

## Build flow at a glance

```
                    ┌─────────────────────────────────┐
                    │  scripts/build-portable-bundle  │
                    │                                 │
                    │  Downloads python-build-        │
                    │  standalone for target platform │
                    │  + pre-downloads all wheels     │
                    │  + collects ffmpeg + model      │
                    └────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────┐
                    │   bundled-portable/<target>/    │
                    │     python/  wheels/            │
                    │     ffmpeg/  model/             │
                    └────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────┐
                    │  scripts/stage-portable-bundle  │
                    │                                 │
                    │  Copies bundled-portable/       │
                    │  <target>/ → extraResources/    │
                    └────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────┐
                    │       extraResources/           │
                    │  (electron-builder reads from   │
                    │   here per package.json)        │
                    └────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────┐
                    │   electron-builder              │
                    │   npm run build:mac/win/linux   │
                    └────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────┐
                    │            dist/                │
                    │   .dmg / .exe / .AppImage       │
                    └─────────────────────────────────┘
```

## Quick build (for local testing)

Build for the host machine's platform:

```bash
git clone https://github.com/sneakyfree/windy-pro
cd windy-pro
npm ci
node scripts/build-portable-bundle.js     # downloads ~250MB
node scripts/stage-portable-bundle.js     # copies to extraResources/
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac    # or build:win / build:linux
```

The unsigned `.dmg` (or `.exe` / `.AppImage`) lands in `dist/`.

`CSC_IDENTITY_AUTO_DISCOVERY=false` disables the macOS code-signing lookup
so unsigned dev builds don't fail looking for a certificate that isn't there.

## Cross-platform builds

The `--target` flag lets you build for any supported platform from any host,
**but** the wheel-download phase needs to actually execute the bundled Python.
That means cross-platform wheel downloads only work if the bundled Python
binary is executable on the build host:

| Build host | Can build for | Cannot build for |
|---|---|---|
| macOS arm64 (Apple Silicon) | mac-arm64 | mac-x64, linux-x64, win-x64 |
| macOS x64 (Intel) | mac-x64 | mac-arm64, linux-x64, win-x64 |
| Ubuntu x64 | linux-x64 | mac-arm64, mac-x64, win-x64 |
| Windows x64 | win-x64 | mac-arm64, mac-x64, linux-x64 |

For multi-platform releases, **build each target on matching hardware in CI**.
See `.github/workflows/build-installer.yml`.

## Verifying a build (the smoke test)

After building, verify the bundled Python+wheels actually work end-to-end:

```bash
# 1. Mount the .dmg (macOS) or extract the .AppImage
hdiutil attach "dist/Windy Pro-X.Y.Z.dmg" -nobrowse -readonly
APP="/Volumes/Windy Pro X.Y.Z/Windy Pro.app/Contents/Resources"

# 2. Confirm bundled Python boots
"$APP/bundled/python/bin/python3" --version
# Expected: Python 3.11.15

# 3. Confirm a venv created from bundled Python + bundled wheels works
rm -rf /tmp/smoke-venv
"$APP/bundled/python/bin/python3" -m venv /tmp/smoke-venv
/tmp/smoke-venv/bin/pip install --no-index --find-links "$APP/bundled/wheels/" -r "$APP/bundled/requirements-bundle.txt"
/tmp/smoke-venv/bin/python -c "import faster_whisper, websockets, sounddevice, numpy; print('OK')"
# Expected: OK

# 4. Unmount
hdiutil detach "/Volumes/Windy Pro X.Y.Z"
```

If steps 2–3 succeed, the bundling architecture is working. The .dmg can
ship Python+deps to any user's machine without internet or system Python.

## Clean-state install test (the real test)

The smoke test above proves the bundled assets work in isolation. The real
test is whether the wizard correctly uses them when a fresh user installs:

```bash
# 1. Back up your current install state (DO NOT SKIP)
mv ~/.windy-pro ~/.windy-pro.bak

# 2. Install the new .dmg
open "dist/Windy Pro-X.Y.Z.dmg"
# Drag Windy Pro.app → Applications, eject

# 3. Launch it
open "/Applications/Windy Pro.app"

# 4. Run through the wizard. Verify:
#    - No "install Python" step takes >30 seconds
#    - No system Python is invoked (check Activity Monitor for unexpected python3 processes)
#    - Wizard completes without errors
#    - Main app launches and shows "READY"
#    - Pressing Cmd+Shift+Space records, transcribes, pastes

# 5. Restore your previous state when done testing
rm -rf ~/.windy-pro
mv ~/.windy-pro.bak ~/.windy-pro
```

This test is the gold-standard verification. Run it before promoting any
release from alpha → beta or beta → stable.

## Bundle composition

After `stage-portable-bundle.js`, `extraResources/` contains:

| Path | Size | Purpose |
|---|---|---|
| `python/` | ~65 MB | Portable Python 3.11.15 (no system deps) |
| `wheels/` | ~88 MB | All production deps as `.whl` files (offline pip install) |
| `ffmpeg/` | ~80 MB | Static ffmpeg binary |
| `model/faster-whisper-base/` | ~141 MB | Starter Whisper model (~99 languages) |
| `requirements-bundle.txt` | <1 KB | Minimal production deps for wizard's pip install |
| `bundle-manifest.json` | <1 KB | Build metadata: target, version, SHA, sizes |

Total: **~374 MB**. Final `.dmg` ends up around 375 MB after compression.

## CI

`.github/workflows/build-installer.yml` runs on every push to `main` or
`installer-*` branches and on every PR. It:

1. Builds the portable bundle for macOS arm64
2. Stages it
3. Verifies bundled Python boots
4. Verifies bundled wheels create a working venv (offline)
5. Packages an unsigned `.dmg`
6. Uploads `.dmg` + manifest as workflow artifacts (14-day retention)

Cross-platform builds (mac-x64, linux-x64, win-x64) need to be added as
separate jobs once GitHub Actions billing is configured for the repo
(macOS runners count as 10× normal minutes on private repos).

## Common failure modes

### `bad CPU type in executable`
You built the bundle for one architecture and tried to run it on another.
The script's `detectHostTarget()` should pick the right target by default;
only override `--target` for cross-builds in CI.

### `Could not find a version that satisfies the requirement X==Y.Z`
A version in `requirements-bundle.txt` doesn't exist on PyPI. Either the
pin is wrong or the package was yanked. Check
`https://pypi.org/project/<package>/#history` and update the pin.

### `pyvenv.cfg` references your local home directory
You're running the legacy `prepare-bundle.js` instead of the new
`build-portable-bundle.js`. The legacy script ships a pre-built venv with
hardcoded paths. Switch to the new script.

### Build succeeds but `bundled/` is missing inside `.app`
Check that `extraResources/` exists and is non-empty before running
`npm run build:mac`. The stage step must run after the build-bundle step.

## See also

- `scripts/build-portable-bundle.js` — bundle builder
- `scripts/stage-portable-bundle.js` — bridge into electron-builder
- `installer-v2/core/bundled-assets.js` — runtime detection of bundled assets
- `requirements-bundle.txt` — production runtime deps (vs `requirements.txt`
  which is the dev/CI-wide superset)
