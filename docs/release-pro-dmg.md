# Windy Word DMG release runbook

The recipe to build + sign + notarize + upload a Windy Word DMG. Used 2026-05-22 to ship v1.7.0 (in-Pro Control Panel marketplace) on top of the v1.6.1 foundation.

Estimated wall-clock: ~10 min active + ~16 min async notarization per arch (can run both archs in parallel) + ~30 min R2 upload (parallel).

## Prerequisites (one-time check)

```bash
# Code-signing identity (should already be in keychain — set up 2026-04 per lockbox §Apple cert)
security find-identity -v -p codesigning | grep "VXZ434QL89"
# → 1) ... "Developer ID Application: Grant Whitmer (VXZ434QL89)"

# Notarization env vars (per lockbox §Apple App-Specific Password)
export CODESIGN_IDENTITY="Developer ID Application: Grant Whitmer (VXZ434QL89)"
export APPLE_ID="<lockbox §Apple App-Specific Password>"
export APPLE_APP_SPECIFIC_PASSWORD="<lockbox §Apple App-Specific Password>"
export APPLE_TEAM_ID="VXZ434QL89"
export CSC_LINK="$HOME/kit-army-config/secrets/developer-id-app.p12"
export CSC_KEY_PASSWORD="<lockbox §Apple Developer ID Application cert>"

# R2 keys for upload (lockbox §windycloud-userdata)
export AWS_ACCESS_KEY_ID=<lockbox>
export AWS_SECRET_ACCESS_KEY=<lockbox>
export AWS_DEFAULT_REGION=auto
```

## 1. Version bump (decide first)

Phase 3 is a meaningful feature: in-Pro marketplace + drop install/switch/uninstall.

- **Option A: 1.6.2** — continues the in-flight release that was building when Apple notarization stalled. Treats Phase 3 as a feature add inside the 1.6.x line.
- **Option B: 1.7.0** — announces marketplace as a minor version bump. Better for marketing ("new in 1.7"), more honest about the feature delta.

Edit `package.json`'s `"version"` field accordingly. Commit.

## 2. Clean build

```bash
cd ~/windy-pro
git checkout main && git pull --ff-only origin main

# Make sure no stale build state — the build won't fail if dist exists
# but the file timestamps from a partial prior build are confusing later.
rm -rf "dist/Windy Word"*.dmg dist/mac dist/mac-arm64

npm install
npm run build:web   # bundle the SPA before the desktop build

# Build both Mac architectures. The afterPack hook signs the bundled .app
# (handles .whl recursion per [[feedback_electron_python_wheel_notarization]]).
# IMPORTANT — must pass CODESIGN_IDENTITY to the afterPack hook environment,
# otherwise it prints "CODESIGN_IDENTITY not set, skipping" and the .app
# ships unsigned. Confirmed regression during v1.7.0 release (2026-05-22).
CODESIGN_IDENTITY="Developer ID Application: Grant Whitmer (VXZ434QL89)" \
  CSC_LINK="$HOME/kit-army-config/secrets/developer-id-app.p12" \
  CSC_KEY_PASSWORD="<lockbox §Apple cert>" \
  APPLE_ID="<lockbox §Apple App-Specific Password>" \
  APPLE_APP_SPECIFIC_PASSWORD="<lockbox §Apple App-Specific Password>" \
  APPLE_TEAM_ID="VXZ434QL89" \
  npm run build:mac
```

The DMGs land at the *root* of `dist/` (not under `dist/mac/` + `dist/mac-arm64/` — the `mac/` dirs hold the un-DMG-wrapped .app bundles):

```
dist/Windy Word-1.7.0.dmg            ← x64
dist/Windy Word-1.7.0-arm64.dmg      ← arm64
```

## 2.5. Sign the DMG envelopes

⚠️ **Gotcha caught during v1.7.0 release**: package.json's `"sign": null` (intentional — we use the afterPack hook for the .app's signing) makes electron-builder skip its own DMG signing AND skip its auto-notarization (`"notarize": true` becomes a no-op when `sign: null`). The .app inside is signed but the DMG envelope itself is not, and nothing has been submitted to Apple.

Sign each DMG envelope explicitly before submitting to notary:

```bash
codesign --sign "Developer ID Application: Grant Whitmer (VXZ434QL89)" \
  --options runtime --timestamp \
  "dist/Windy Word-1.7.0.dmg"
codesign --sign "Developer ID Application: Grant Whitmer (VXZ434QL89)" \
  --options runtime --timestamp \
  "dist/Windy Word-1.7.0-arm64.dmg"
```

## 2.6. Submit to Apple notary

`xcrun notarytool` with `--wait` blocks until Apple decides. Recent submissions clear in ~15-20 min; quoted SLA is 3-5 business days. Run both in parallel:

```bash
xcrun notarytool submit "dist/Windy Word-1.7.0-arm64.dmg" \
  --apple-id "<APPLE_ID>" --team-id "VXZ434QL89" \
  --password "<APPLE_APP_SPECIFIC_PASSWORD>" --wait &

xcrun notarytool submit "dist/Windy Word-1.7.0.dmg" \
  --apple-id "<APPLE_ID>" --team-id "VXZ434QL89" \
  --password "<APPLE_APP_SPECIFIC_PASSWORD>" --wait &

wait
```

Each should print `status: Accepted` at the end. If either returns `Invalid`, fetch the log with `xcrun notarytool log <submission-id>` and chase from there. The most common cause is missing `--timestamp` on the DMG codesign (Apple requires a timestamp server signature).

## 3. Verify + staple

For each .dmg:

```bash
~/notarize-work/finalize-notarized-dmg.sh "dist/Windy Word-1.7.0-arm64.dmg"
~/notarize-work/finalize-notarized-dmg.sh "dist/Windy Word-1.7.0.dmg"
```

The script staples, validates, runs Gatekeeper assessment, and prints SHA256 + size. The Gatekeeper line should print `accepted` with `source=Notarized Developer ID`. If it prints `rejected source=no usable signature`, the DMG envelope wasn't signed (skip back to step 2.5 + redo 2.6).

## 4. Upload to R2

```bash
R2_ENDPOINT="https://193b347aedeaafe35de0b5a534b2d9aa.r2.cloudflarestorage.com"
BUCKET="s3://windyword-releases"

# Stable filenames (latest version sits at predictable URLs).
aws --endpoint-url=$R2_ENDPOINT s3 cp dist/mac-arm64/Windy-Word-*.dmg "$BUCKET/Windy-Word-arm64.dmg" --content-type application/x-apple-diskimage
aws --endpoint-url=$R2_ENDPOINT s3 cp dist/mac/Windy-Word-*.dmg       "$BUCKET/Windy-Word-x64.dmg"   --content-type application/x-apple-diskimage

# Also archive the versioned filename for history.
aws --endpoint-url=$R2_ENDPOINT s3 cp dist/mac-arm64/Windy-Word-*.dmg "$BUCKET/archive/Windy-Word-1.6.2-arm64.dmg"
aws --endpoint-url=$R2_ENDPOINT s3 cp dist/mac/Windy-Word-*.dmg       "$BUCKET/archive/Windy-Word-1.6.2-x64.dmg"

# Verify
curl -sS -o /dev/null -w "arm64: HTTP %{http_code} size=%{size_download}\n" https://downloads.windyword.ai/Windy-Word-arm64.dmg
curl -sS -o /dev/null -w "x64:   HTTP %{http_code} size=%{size_download}\n" https://downloads.windyword.ai/Windy-Word-x64.dmg
```

## 5. Smoke test

On a fresh Mac (or a clean VM):
1. Download from `https://downloads.windyword.ai/Windy-Word-arm64.dmg`
2. Open + drag to Applications
3. First launch — should not get any "from unidentified developer" prompts (notarization + Gatekeeper green)
4. Walk through `docs/control-panel-grandma-walkthrough.md` — all 8 steps should pass

## 6. Update lockbox + announce

In `~/kit-army-config/ACCESS_LOCKBOX.md` §"R2 distribution → Notarized + uploaded artifacts", append a new table row with the new version + SHA256s + timestamps.

The launch announcement at https://windydrops.com/launch is already live — no edit needed. Once the DMG is reachable at downloads.windyword.ai, share `/launch` with the world.

## Rollback (if needed)

The previous notarized 1.6.1 DMGs are in `~/notarize-work/Windy-Word-1.6.1-{arm64,x64}-signed-v2.dmg` and in R2 at `s3://windyword-releases/archive/`. If a regression is found, re-upload them to the stable filenames:

```bash
aws --endpoint-url=$R2_ENDPOINT s3 cp ~/notarize-work/Windy-Word-1.6.1-arm64-signed-v2.dmg "$BUCKET/Windy-Word-arm64.dmg"
aws --endpoint-url=$R2_ENDPOINT s3 cp ~/notarize-work/Windy-Word-1.6.1-x64-signed-v2.dmg "$BUCKET/Windy-Word-x64.dmg"
```

## Lessons from the v1.7.0 release (2026-05-22)

Two gotchas caught in flight that drove the corrections above:

1. **`CODESIGN_IDENTITY` must be in the env passed to the build command.** The afterPack hook reads it directly; without it the .app ships unsigned ("CODESIGN_IDENTITY not set, skipping" in the build log). Setting it as an exported shell variable in a parent shell is NOT sufficient — pass it inline to `npm run build:mac`.
2. **`"sign": null` makes electron-builder skip notarization too.** Even with `"notarize": true` in package.json + APPLE_ID env vars set, electron-builder won't auto-notarize when its own signing is disabled. The DMG envelopes ship unsigned + Apple has no record of them. Must sign envelopes manually (step 2.5) and submit to notarytool manually (step 2.6) before stapling.

This runbook can be run end-to-end without manual intervention IF you set all env vars correctly + the build doesn't fail on native dep rebuilds (`better-sqlite3` rebuilt fresh on this machine in ~10s). The async parts (notarization wait, R2 upload) parallelize cleanly across arm64 + x64.
