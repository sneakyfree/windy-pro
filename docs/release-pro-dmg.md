# Windy Word DMG release runbook

The last-mile step to ship the in-Pro Control Panel marketplace to grandmas. Current public DMG is `Windy-Word-1.6.1-{arm64,x64}.dmg` from 2026-05-14 — predates the WD-31 Phase 3 work. This runbook builds + signs + notarizes + uploads a new DMG so end users get the marketplace experience.

Estimated wall-clock: ~45 min active + 15-60 min async notarization wait per arch.

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

# Make sure no stale build state.
rm -rf dist node_modules/.cache

npm install
npm run build:web   # bundle the SPA before the desktop build

# Build both Mac architectures (electron-builder takes care of the afterPack
# signing hook + native zsh-quote dance per [[feedback_electron_python_wheel_notarization]]).
# electron-builder's `notarize: true` (per package.json) auto-submits + waits
# when APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID are set.
npm run build:mac   # produces dist/mac-arm64/*.dmg + dist/mac/*.dmg
```

Watch the output for `electron-builder notarization` activity. Expect ~10-30 min per arch (Apple's quoted SLA is 3-5 business days but recent submissions have cleared in minutes).

If notarization stalls or fails: separate the signing + notarize steps via
`xcrun notarytool submit ./dist/mac-arm64/Windy-Word-{ver}-arm64.dmg --keychain-profile windy-notary --wait` and rerun the afterPack signing per PR #109.

## 3. Verify + staple

For each .dmg produced:

```bash
~/notarize-work/finalize-notarized-dmg.sh dist/mac-arm64/Windy-Word-1.6.2-arm64.dmg
~/notarize-work/finalize-notarized-dmg.sh dist/mac/Windy-Word-1.6.2-x64.dmg
```

The script staples, validates the staple, runs Gatekeeper assessment, and prints the SHA256 + size. All three green checkmarks = ready for distribution.

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

## Why this isn't autonomous

The Claude Code session that wrote this runbook (2026-05-22) considered running the full build but didn't:

1. **Heavy + interactive failure modes.** `npm install` can fail on native deps; electron-builder can fail mid-bundle; notarization can reject for non-obvious signing issues — and each failure leaves stale state that's painful to clean up unattended.
2. **Async waits with side effects.** Notarization is 10 min - 34h wall-clock. If the session ends mid-wait, recovery requires polling notarytool status by submission ID + manually completing.
3. **R2 distribution is public-facing.** A mis-uploaded DMG (wrong arch, bad notarization, corrupt) reaches end users immediately via downloads.windyword.ai. The session preferred to err on the side of "operator-verified before shipping" rather than "ship and pray."

Everything ELSE in the launch campaign (registry, R2 bucket, marketplace site, in-Pro UI, drift guards, docs) was code + idempotent + roll-back-able. The DMG release is the one step where the cost of an automated mistake is materially higher than the cost of a 1-hour manual session.
