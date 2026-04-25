# Auto-updater Test Playbook

Playbook for manually verifying the update flow end-to-end. Run this
before promoting any release to stable.

The updater lives in two layers:
- `src/client/desktop/auto-updater.js` — a lightweight polling check
  that hits `https://windyword.ai/api/v1/updates/check` and pops a
  dialog. Shipped, active today.
- `src/client/desktop/updater.js` + electron-updater — the heavier
  auto-install flow via the GitHub Releases YAML feed. Present but
  not exercised on every release.

`package.json` → `build.publish` names `github` owner `sneakyfree`,
repo `windy-pro`. The feed URL lives at:
```
https://github.com/sneakyfree/windy-pro/releases/latest/download/latest-mac.yml
```

## Prerequisites

- macOS laptop (adjust commands for Linux/Windows — see Cross-platform
  notes at the bottom).
- Two versions built + signed:
  - `N`   — the currently-shipping version.
  - `N+1` — a new build with a higher semver.
- Both `.dmg` files available on disk.
- A local HTTP server to host a mock update feed (or real GitHub
  Releases).
- `pkg.version` in `package.json` of the N build is lower than N+1.

## Step 1 — Pre-flight

```bash
cd /Users/thewindstorm/windy-pro
./scripts/release/preflight.sh --skip-ci-check
```

Confirm:
- [ ] `node -v` ≥ 20
- [ ] `python3 --version` ≥ 3.11
- [ ] `gh auth status` OK (needed for promote.sh)

## Step 2 — Build version N

```bash
# Assume package.json version is already at e.g. 1.7.0
./scripts/release/build-all.sh --target mac-arm64
./scripts/release/sign-and-notarize.sh --target mac-arm64
ls -t dist/*.dmg | head -1      # note the path; call this N_DMG
```

Install it:
```bash
# Mount + copy to /Applications
hdiutil attach "$N_DMG" -nobrowse
cp -R "/Volumes/Windy Pro/Windy Pro.app" /Applications/
hdiutil detach "/Volumes/Windy Pro"
open -a "Windy Pro"
```

Confirm version N is running:
```bash
osascript -e 'tell application "System Events" to get version of application "Windy Pro"'
```

## Step 3 — Build version N+1

```bash
# Bump version
npm version 1.7.1 --no-git-tag-version
./scripts/release/build-all.sh --target mac-arm64
./scripts/release/sign-and-notarize.sh --target mac-arm64
```

Save the N+1 dmg + the companion `latest-mac.yml` + `*.blockmap`:
```bash
mkdir -p /tmp/windy-feed
cp dist/*.dmg dist/*.dmg.blockmap dist/latest-mac.yml /tmp/windy-feed/
```

## Step 4 — Serve a mock update feed

electron-updater reads a YAML feed. Host the N+1 artefacts on a local
HTTP server:

```bash
cd /tmp/windy-feed
python3 -m http.server 8080
# Keep this running in one terminal
```

In another terminal, confirm the feed is reachable:
```bash
curl -I http://localhost:8080/latest-mac.yml
# Should return 200 OK
```

## Step 5 — Point the N install at the local feed

Edit the installed app's update config to point at localhost. The
cleanest way is to set an override env var at launch:

```bash
WINDY_UPDATE_URL=http://localhost:8080/latest-mac.yml open -a "Windy Pro"
```

(If the currently shipped auto-updater doesn't honour `WINDY_UPDATE_URL`,
patch `src/client/desktop/auto-updater.js` first — TODO: make this an
env override for local testing.)

## Step 6 — Trigger update check

The auto-updater checks 10 seconds after launch, then every 4 hours.
Force a check immediately via the DevTools console (enable via
View → Toggle Developer Tools):

```js
require('electron').autoUpdater?.checkForUpdates();
// Or if using the custom checker:
require('./auto-updater').AutoUpdater.prototype.checkForUpdates?.call(window.__autoUpdater);
```

Expect:
- [ ] "Update available" dialog appears with version N+1
- [ ] Release notes render (if present in the feed YAML)
- [ ] Wizard log (`~/Library/Logs/Windy Pro/wizard-install.log`)
      records the check

## Step 7 — Accept the update

Click "Update now" in the dialog. Observe:
- [ ] Download progress toast appears
- [ ] Download completes within ~30s (over localhost)
- [ ] "Restart to apply" prompt appears
- [ ] Clicking Restart quits the app and launches the new .app
- [ ] Version is now N+1 (`osascript ... get version`)
- [ ] `~/.windy-pro/config.json` migrated cleanly (no wizard re-run)

## Step 8 — Rollback test

Simulate a broken N+1 that crashes on launch. This tests whether
users can recover:

```bash
# Break the installed .app intentionally
sudo mv "/Applications/Windy Pro.app/Contents/MacOS/Windy Pro" "/Applications/Windy Pro.app/Contents/MacOS/Windy-Pro-broken"
open -a "Windy Pro"
# App should fail to launch
```

Then:
- [ ] Document the Gatekeeper / launch error the user sees
- [ ] Verify they can re-download the N .dmg from windyword.ai
      and manually install over the broken N+1
- [ ] Confirm ~/.windy-pro/ state survives the downgrade

**Known limitation:** electron-updater only goes forward. If N+1
is stable but bug-discovered, a `./scripts/release/promote.sh
rollback v1.7.0` command:
- marks v1.7.0 as Latest again
- tells users upgrading fresh to get N (good)
- does NOT auto-downgrade users who already got N+1 (bad; documented)

## Step 9 — Full-run health check

After every auto-update:
- [ ] `curl http://127.0.0.1:9876/health` returns status=ok
- [ ] First transcript completes without error
- [ ] Phase 8 signup banner does NOT reappear (localStorage survives)
- [ ] Keyboard shortcuts still registered (Ctrl+Shift+Space works)

## Cross-platform notes

### Linux (AppImage)

AppImage auto-updates use a sidecar `latest-linux.yml`. Same flow but:
```bash
# Make N executable and install somewhere on $PATH
chmod +x windy-pro-N.AppImage
./windy-pro-N.AppImage
```

### Windows (NSIS)

```powershell
# Install N
Start-Process -Wait -FilePath "Windy-Pro-Setup-N.exe" -ArgumentList "/S"
# Point at local feed
$env:WINDY_UPDATE_URL = "http://localhost:8080/latest.yml"
Start-Process "C:\Program Files\Windy Pro\Windy Pro.exe"
```

Windows has no built-in way to override the feed without a build
flag; consider adding one before release.

## What this playbook doesn't cover

- **Signing-chain verification.** electron-updater verifies the .dmg
  signature matches the installed app's public key. Breaking this
  requires swapping certs — out of scope for a smoke test.
- **Delta updates.** electron-updater supports blockmap-based delta
  downloads. The happy-path test downloads the whole .dmg. Delta
  testing needs a real production rollout.
- **Notarization staples.** The .dmg must still be stapled when
  delivered from localhost, else Gatekeeper blocks. Confirm with
  `xcrun stapler validate dist/*.dmg` before step 4.

## References

- `src/client/desktop/auto-updater.js` — lightweight check
- `src/client/desktop/updater.js` — electron-updater wrapper
- `package.json` → `build.publish` — feed config
- [RELEASE.md](../RELEASE.md) — surrounding release process
- [ERRORS.md](ERRORS.md) — WINDY-NNN error codes the updater might surface
