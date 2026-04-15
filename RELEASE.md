# Releasing Windy Pro

End-to-end checklist for shipping a new version. Build, smoke-test,
sign, notarize, upload, promote.

For *how the build works internally*, see [BUILD.md](BUILD.md).
For *what to do when a release breaks*, see [DEBUGGING.md](DEBUGGING.md).

## Promotion ladder

```
alpha → beta → stable
 │       │       │
 │       │       └─ Default download on windyword.ai
 │       └─ Opt-in via Settings → Update Channel → Beta
 └─ Internal team only; tags begin with v*-alpha.N
```

Tags drive everything. The CI workflow `.github/workflows/build-installer.yml`
builds installers for every push and PR; `.github/workflows/ci.yml`
`build-electron` job runs only when a `v*` tag is pushed.

## 1. Pre-flight

Run from the repo root on a clean working tree.

```bash
git switch main
git pull --ff-only
git status                # must be clean
node -v                   # ≥ 20
python3 --version         # ≥ 3.11
which curl                # required by build-portable-bundle.js
```

* CI is green on `main`: `gh run list --workflow=ci.yml --branch main --limit 1`
* `CHANGELOG.md` updated with the new version's notes
* `package.json` `version` bumped (semver):
  * patch (`1.7.0 → 1.7.1`) for bug fixes
  * minor (`1.7.x → 1.8.0`) for features
  * major (`1.x.0 → 2.0.0`) for breaking changes
* `BUILD.md` and `DEBUGGING.md` reflect any new behaviour

Commit the bumps:

```bash
git add package.json CHANGELOG.md
git commit -m "release: vX.Y.Z"
git push origin main
```

## 2. Build the bundle (per platform)

CI does this on every push. To build locally:

```bash
node scripts/build-portable-bundle.js --target mac-arm64
node scripts/stage-portable-bundle.js  --target mac-arm64
npm run build:mac      # → dist/*.dmg
```

Repeat with `--target mac-x64`, `--target linux-x64`, `--target win-x64`.
On Apple Silicon, building Linux/Windows installers needs the bundle
built on the matching CI runner — cross-bundling is partially supported
but Windows code-signing requires Windows.

Verify each `dist/` artifact exists and the bundle manifest matches
`package.json` version:

```bash
ls -la dist/
cat extraResources/bundle-manifest.json
```

## 3. Smoke test before signing

Don't sign a build that doesn't work — signing is slow and irreversible.

* Run BUILD.md's "Clean-state install test" on the platform you just
  built for. Renames `~/.windy-pro/`, installs the artifact, runs the
  wizard end-to-end, restores.
* Verify on a never-installed VM if you have one (cleanest signal).
* On macOS check the .app launches and the wizard reaches the verify
  screen without hanging. The wizard log lives at
  `~/Library/Logs/Windy Pro/wizard-install.log` — its last line tells
  you exactly where the wizard stopped if it stops.

## 4. Sign + notarize (macOS)

Requires:
* Apple Developer ID Application certificate in the login keychain.
* App-specific password for `notarytool` stored in keychain profile
  `windy-notary` (see Apple docs for `xcrun notarytool store-credentials`).

Set the env vars electron-builder reads, then re-build:

```bash
export CSC_LINK="$HOME/Library/Keychains/Developer ID Application.p12"
export CSC_KEY_PASSWORD='<the .p12 password>'
export APPLE_ID='dev@windyword.ai'
export APPLE_APP_SPECIFIC_PASSWORD='@keychain:windy-notary'
export APPLE_TEAM_ID='<10-char team id>'

npm run build:mac    # signs + notarizes + staples in one shot
```

Verify:

```bash
codesign -dv --verbose=4 "dist/mac/Windy Pro.app"
spctl -a -vv "dist/mac/Windy Pro.app"     # → "accepted"
xcrun stapler validate "dist/Windy-Pro-X.Y.Z-arm64.dmg"
```

Windows code signing (EV cert) is deferred to v2.1 — until then,
SmartScreen will warn on .exe downloads.

Linux .AppImage / .deb don't get signed; users verify via the
`SHA256SUMS.txt` we publish alongside.

## 5. Tag and push

```bash
git tag -s vX.Y.Z -m "Windy Pro vX.Y.Z"
git push origin vX.Y.Z
```

This triggers `ci.yml` `build-electron` job which:
1. Re-runs the cross-platform build on GitHub runners
2. Creates a GH Release if missing
3. Uploads `.dmg / .exe / .AppImage / .deb` to it

Watch:

```bash
gh run watch
gh release view vX.Y.Z
```

## 6. Promote alpha → beta → stable

The repo's release artifacts are sorted by tag. The `update-server`
field in `package.json` points to GitHub Releases; the desktop app's
`updater.js` filters on tag prefix.

### To promote

| From | To | Action |
|---|---|---|
| alpha | beta | Re-tag (`vX.Y.Z` instead of `vX.Y.Z-alpha.N`), push, recreate release |
| beta | stable | Mark the existing GH Release as "Latest" and unmark beta |

```bash
gh release edit vX.Y.Z --latest
gh release edit vX.Y.Z --prerelease=false
```

### Rollback

If a stable release breaks for a non-trivial slice of users:

```bash
gh release edit vX.Y.Z-OLD --latest        # promote prior release back
gh release edit vX.Y.Z-NEW --prerelease    # demote the broken one
```

The desktop auto-updater will pick up the new "latest" tag on next
heartbeat. Users who already updated will need to manually downgrade.

## 7. Marketing site

`windyword.ai` does not auto-update. After a release goes stable:

* Update the version pin on the Download page.
* If install timing changed materially (we promise "30 seconds"),
  update copy. Otherwise leave wording untouched (Grant's domain).

## 8. Post-release

* Tail the wizard logs from any beta tester for the first 24h —
  `~/Library/Logs/Windy Pro/wizard-install.log` (mac), equivalent on
  other platforms (see ARCHITECTURE.md §6).
* Watch GitHub Issues + support email for install-time reports.
* Update `CHANGELOG.md`'s release date if you slipped.
