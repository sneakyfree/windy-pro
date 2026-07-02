# Windy Word — Artifact Re-Cut Runbook (operator)

**Why this exists.** The book-launch reliability fixes (Windows ffmpeg, venv self-heal,
long-dictation freeze/data-loss, offline phone-home, first-run camera/mic UX, WindyTune ratio)
are committed on `book-launch-hardening` but **the artifacts published on R2 predate them**.
Users install the R2 artifacts, so the fixes only reach them after these re-cuts. This is
operator work: it needs credentials/certs and outward-facing publishes, so it's documented
here rather than run automatically.

**Secret hygiene:** every credential below is referenced by **name / location only** — never
paste values into commits, PRs, or public docs. Two local env files already hold what you need:
`~/.windy-r2.env` (R2 upload keypair) and `~/.windy-notary.env` (Apple signing + notary). Both
are gitignored and already staged on OC5.

**Build from the current tip.** Everything must build from the current `book-launch-hardening`
HEAD or you'll re-ship old bugs. Confirm first:

```bash
cd ~/windy-pro && git checkout book-launch-hardening && git pull
git log -1 --oneline        # record this tip; all three re-cuts must build from it
```

| Artifact | How | Who/where | Status of the fix |
|---|---|---|---|
| Windows offline ZIP | CI (`build-offline-installers.yml`) | GitHub Actions | ✅ ffmpeg fix in code; needs re-cut |
| Linux offline AppImage | same CI (linux job is gated off) | GitHub Actions | ✅ ffmpeg fix in code; needs re-cut |
| macOS Reader DMG arm64 | `build-reader-dmg-arm64.sh` + publish | **Apple Silicon Mac** (see ⚠️) | ✅ all fixes in code; needs re-cut |
| macOS Reader DMG x64 | `build-reader-dmg-x64.sh` + publish | Intel Mac (OC5 works) | ✅ all fixes in code; needs re-cut |
| `go.sh` / `go.ps1` | — | — | ✅ already re-uploaded, live. No action. |

---

## Runbook 1 — Windows + Linux offline builds (GitHub Actions)

The workflow builds the ~4.3 GB offline bundles (fetches the 7 engines + the ffmpeg fix pulls
ffmpeg from R2), asserts ffmpeg is present, and uploads straight to R2. Both live artifacts
currently lack ffmpeg, so **re-cut both** (Linux relies on system ffmpeg today, which not all
users have — bundling it is the fix).

**Prereqs**
- The workflow triggers on a push to the `ci/offline-build` branch (its `workflow_dispatch` only
  works once the file is on the repo's *default* branch, which it isn't).
- It needs two repo secrets that are **currently absent** (confirmed: repo has only
  CF_PAGES_TOKEN / DEPLOY_* / RELEASE_PAT): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
  Their values = the **windycloud-userdata** R2 keypair, i.e. the `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` in `~/.windy-r2.env` (also in the lockbox). windy-pro is **public**,
  so add them only for the run and **delete them after**.

**Steps**

```bash
cd ~/windy-pro

# 1. Add the R2 write secrets (public repo — temporary). Pull the values from ~/.windy-r2.env:
#    (do NOT echo them into shell history in a shared log)
gh secret set R2_ACCESS_KEY_ID     -R sneakyfree/windy-pro   # paste AWS_ACCESS_KEY_ID from ~/.windy-r2.env
gh secret set R2_SECRET_ACCESS_KEY -R sneakyfree/windy-pro   # paste AWS_SECRET_ACCESS_KEY from ~/.windy-r2.env

# 2. Re-enable the Linux job (it ships gated off). In .github/workflows/build-offline-installers.yml,
#    change the linux-offline job's `if: false` -> `if: true`, commit on book-launch-hardening.
#    (Leave a note to flip it back after — see cleanup.)

# 3. Fire the run: push the current book-launch-hardening content to the trigger branch.
git push origin book-launch-hardening:ci/offline-build --force

# 4. Watch it.
gh run watch -R sneakyfree/windy-pro "$(gh run list -R sneakyfree/windy-pro -w 'Build Offline Installers (Win + Linux)' -L1 --json databaseId -q '.[0].databaseId')"
```

**Verify (the workflow self-checks, but confirm):**
- The "Assert ffmpeg is bundled" step passes in both jobs (this is the guard that would catch a
  regression of the #1 critical).
- The upload steps report HTTP 200 for the two R2 keys.
- Sanity a header:
  ```bash
  for k in Windy-Word-Reader-Offline-win-x64.zip Windy-Word-Reader-Offline-linux-x86_64.AppImage; do
    curl -sI "https://downloads.windyword.ai/$k" | grep -iE '^HTTP|last-modified|content-length'
  done
  ```
  Last-Modified should be today; the win ZIP ~3.6 GB, the AppImage ~3.9 GB.

**Cleanup (do NOT skip — public repo):**
```bash
gh secret delete R2_ACCESS_KEY_ID     -R sneakyfree/windy-pro
gh secret delete R2_SECRET_ACCESS_KEY -R sneakyfree/windy-pro
```
Revert the Linux `if: true` back to `if: false` on `book-launch-hardening` (so idle pushes don't
rebuild it) unless you want it permanently on.

**Result:** the win/linux one-liners (`irm … | iex`, `curl … | bash`) now serve builds that
contain ffmpeg — Windows transcription works out of the box.

---

## Runbook 2 — macOS Reader DMGs (local, on a Mac)

Builds → afterPack full inside-out sign → DMG-envelope sign → notarize → staple → validate, then
`publish-reader-dmgs.sh` gates (spctl + stapler on BOTH) and uploads. **Credentials are already
staged in `~/.windy-notary.env`** (CODESIGN_IDENTITY, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
APPLE_TEAM_ID=VXZ434QL89, CSC_LINK → Developer ID .p12, CSC_KEY_PASSWORD) and `~/.windy-r2.env`.
This uses the **existing individual Apple Developer ID** — it does **not** depend on the deferred
LLC App-Store org enrollment.

> ⚠️ **Hardware constraint:** the arm64 DMG must be built on an **Apple Silicon** Mac (arch-native
> Python/wheels/ffmpeg). OC5 is a 2017 **Intel** iMac, so it can build the **x64** DMG but **not**
> arm64. If there's no Apple Silicon Mac in the fleet, build arm64 on a borrowed/rented M-series
> machine or a `macos-14` (arm64) GitHub runner. Apple Silicon is the majority of modern Mac users —
> don't ship x64-only.

**x64 (runnable on OC5):**
```bash
cd ~/windy-pro && git checkout book-launch-hardening && git pull
source ~/.windy-notary.env        # signing + notary creds (gitignored, already present)
./scripts/release/build-reader-dmg-x64.sh
# → builds, signs, notarizes (~16-30 min Apple queue), staples, validates. Ends at "✅ DONE → <dmg>"
```

**arm64 (on an Apple Silicon Mac):**
```bash
cd ~/windy-pro && git checkout book-launch-hardening && git pull
source ~/.windy-notary.env
./scripts/release/build-reader-dmg-arm64.sh
```

**Publish (after BOTH DMGs exist + are stapled — the script hard-gates this):**
```bash
# publish-reader-dmgs.sh sources ~/.windy-r2.env, archives the current-live DMGs first
# (reversible), refuses to upload unless both pass `stapler validate` + `spctl`, then uploads
# to canonical (Windy-Word-{arm64,x64}.dmg — what the SITE buttons hit) + Reader-suffixed names
# (what go.sh hits).
./scripts/release/publish-reader-dmgs.sh
```

**Verify:**
```bash
for k in Windy-Word-arm64.dmg Windy-Word-x64.dmg Windy-Word-Reader-arm64.dmg Windy-Word-Reader-x64.dmg; do
  curl -sI "https://downloads.windyword.ai/$k" | grep -iE '^HTTP|last-modified'
done
# Then on a Mac, prove notarization on the downloaded file:
#   spctl -a -vv <dmg>      → "accepted, source=Notarized Developer ID"
#   xcrun stapler validate <dmg>
```

**Result:** both the site's "Download for Mac" buttons (canonical names) and the `go.sh` one-liner
(Reader names) serve freshly-signed **notarized** DMGs carrying all the renderer/engine fixes —
which also resolves the earlier "site points at stale May-22 DMGs" issue for Mac.

---

## Runbook 3 — Installer one-liners

**No action.** `go.sh` and `go.ps1` were already rebuilt and re-uploaded to R2 this cycle
(live == repo verified). They point at the canonical/Reader keys above, so once Runbooks 1–2
overwrite those keys, the one-liners serve the new builds automatically — no URL change.

---

## After the re-cuts

1. **Run the first-run test checklist** (`docs/BOOK-LAUNCH-FIRST-RUN-TEST.md`) against the
   freshly-published artifacts — this is the whole point: the checklist's Phase 0 assumes these
   re-cuts are done.
2. **Website (separate, do last):** `windyword-site-book-launch` `Download.jsx` still points its
   direct buttons at the canonical names (now fixed by Runbook 2) but marks Windows/Linux "Soon"
   with 404 targets — flip those to available and confirm the one-liners are shown. Then deploy
   the site. (Out of scope for artifact re-cutting; tracked in BOOK-LAUNCH-HANDOFF.md.)

## Safety notes

- **Public repo:** the R2 write secrets must be deleted after Runbook 1. Never commit `.p12`,
  `~/.windy-*.env`, or any token value.
- **Reversible:** `publish-reader-dmgs.sh` archives the previous live DMGs under `archive/` before
  overwriting, so a bad cut can be rolled back from R2.
- **Fail-closed:** both the CI (ffmpeg assertion) and `publish-reader-dmgs.sh` (notarization gate)
  refuse to publish a broken/un-notarized artifact — trust those gates; if they fail, fix the cause,
  don't bypass them.
