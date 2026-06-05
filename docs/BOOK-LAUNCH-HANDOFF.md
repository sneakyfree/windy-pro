# Windy Word Book-Launch — Autonomous Session Handoff
_Written 2026-06-05 while you slept. Companion to `windyword-book-launch-PLAN.md`._
_Secrets are referenced by lockbox location, never pasted._

## TL;DR
The free app's functional core **and** the marketing site are both built, verified, committed, and pushed. Models are mirrored to your R2. What's left is the stuff that genuinely needs you (or is unsafe to do unsupervised): a **signed/notarized build**, a **clean-machine first-run**, **deploying the site to windyword.ai**, and **lifting the password walls** — all with exact runbooks below.

---

## ✅ Done, verified, committed & pushed

### App — `sneakyfree/windy-pro`, branch `book-launch` (pushed)
Tag `pre-book-launch` (77c9a9b) = pristine pre-shear snapshot. Commits on top:
| Commit | What |
|---|---|
| `1b9e68e` | R2-primary model downloads + HuggingFace fallback; **license-DRM neutralized** (no heartbeat/offline-lockout/model-wipe — works forever offline) |
| `506f9cb` | **Unlimited recording** (removed 5-min clamp, upsell nag, auto-stop) — Wayland code untouched |
| `554dafc` | Wizard installs the **fixed edition set** (no hardware branching) |
| `5488f7d` | **WINDY_EDITION bake** → `build:mac:lite` (2 engines) / `build:mac:reader` (7) |

**Verified:** CI build (run 26993337255) green on macOS arm64 + Windows + Linux + **E2E wizard test**. The arm64 DMG artifact was downloaded and confirmed to contain ALL edits (DRM-off, unlimited recording, R2 base, edition config). Edition bake tested functionally (lite→2, reader→7, no-stamp→reader).

### Website — `sneakyfree/windyword-site-book-launch`, branch `main` (pushed, **PRIVATE**)
Commit `94b5ea7`. **Builds clean** (vite, 403 modules). Cloned from the live `windyword-site`; `upstream` points read-only at the original so it was never touched.
- **Offering** → two FREE editions (Free + Reader/book) front-and-center; Pro/Ultra/Max grayed "Coming Soon" + notify; accurate copy (unlimited, no account, unlimited devices).
- **TheVault** → repurposed from the paid WindyTranslate pack store into a showcase of the **7 free engines**.
- **Kingdom / Footer** → ecosystem links are now non-clickable "Coming Soon" (no more links into gated/dead domains).
- **Scrolls (FAQ) / Powers / Voices** → removed unverifiable claims (96%/73%), $399 translation packs, "one account", cloud modes, and fabricated paid testimonials.
- **Download** → canonical un-versioned URLs (`downloads.windyword.ai/Windy-Word-arm64.dmg`).

### Infra
- **7 int8 engines mirrored to R2** at `downloads.windyword.ai/models/listen-windy-<name>/ct2-int8/` (bucket `windyword-releases`). Verified serving 200. _(Flagship `pro-engine` was finishing its 1.5 GB upload at write time — confirm all 7 below.)_

---

## ⛔ NOT done — needs you, or unsafe unsupervised (with runbooks)

### A. Signed + notarized launch DMG  ← the real launch artifact
Creds are all in the lockbox (`ACCESS_LOCKBOX.md` → Apple sections; `secrets/developer-id-app.p12`). Do this **after** the first-run test (below) so you don't notarize an unverified build.
```bash
cd ~/windy-pro && git checkout book-launch
export CSC_LINK="$HOME/kit-army-config/secrets/developer-id-app.p12"
export CSC_KEY_PASSWORD='<lockbox: developer-id-app .p12 password>'
export APPLE_ID='grantwhitmer3@gmail.com'
export APPLE_APP_SPECIFIC_PASSWORD='<lockbox: app-specific password>'
export APPLE_TEAM_ID='VXZ434QL89'
npm run stamp:reader                                   # Reader edition (book); or stamp:lite
./scripts/release/sign-and-notarize.sh --target mac-arm64
./scripts/release/sign-and-notarize.sh --target mac-x64
```
Then publish to R2 (the site already points at these canonical names):
```bash
# uses the windycloud-userdata S3 keypair (lockbox → Cloudflare → R2)
R2=https://193b347aedeaafe35de0b5a534b2d9aa.r2.cloudflarestorage.com
aws s3 cp "dist/Windy Word-1.7.0-arm64.dmg" s3://windyword-releases/Windy-Word-arm64.dmg --endpoint-url "$R2"
aws s3 cp "dist/Windy Word-1.7.0-x64.dmg"   s3://windyword-releases/Windy-Word-x64.dmg   --endpoint-url "$R2"
# also upload latest-mac.yml to windyword.ai/releases so auto-update works
```
For the **Reader edition** the book links to: build with `stamp:reader`, upload as `Windy-Word-Reader-arm64.dmg`, and set that URL in the book. (Website download = Lite; book link = Reader.)

### B. Clean-machine first-run  ← the behavioral gate
The DMG is verified to *build & contain our code*, but behavior is unverified. On a **fresh** Mac/VM (not your workstation — I deliberately didn't install it there):
1. Install (unsigned CI DMG → right-click → Open; the *signed* build from A won't need this).
2. Wizard downloads the 7 engines from `downloads.windyword.ai/models` (watch the network = R2, not HF).
3. **No account, no license prompt, no upgrade nags.**
4. Hotkey → speak → text pastes.
5. **Record >5 min** → confirm no auto-stop. **(memory note:** long sessions hold audio in RAM — stress-test a multi-hour batch.)
6. **The DRM proof:** quit → airplane mode → reopen → still works, no lockout.
7. Confirm it stays local (no cloud transcription on free).

### C. Deploy the sheared site to windyword.ai
```bash
cd ~/windyword-site-book-launch && npm install && npm run build
# Deploy dist/ to the windyword.ai Cloudflare Pages project (WindyProCIDeployToken, or connect the repo).
```
⚠️ **Deploy `dist/`, NOT `.`** (the known wrangler-pages footgun that shipped a blank page once).

### D. Lift password walls + Coming Soon pages  (live prod — ordered!)
A ready Coming Soon page is staged at `~/windyword-coming-soon/index.html`. For each gated domain (windytranslate.com, windytraveler.com, windyclone.ai, windymail.ai, eternitas.ai, windyfly.ai):
1. **Deploy the Coming Soon page first** (CF Pages).
2. **Then** detach the `windyword-gate` Basic-Auth Worker route via **WindyWorkersGateToken** (lockbox). Order matters — never expose a half-built site.
Dead-DNS domains (windysearch.ai, windycloud.com, windycode.ai, windycall/cell/text.ai) just need a Coming Soon Pages project + DNS.

### E. Notify backend (upgrade from mailto)
`NotifyForm.jsx` uses `mailto:hello@windyword.ai` (honest, unbreakable). To make it an inline form: create a **KV namespace in the CF dashboard** (no lockbox token has KV scope — must be dashboard), bind it to the Pages project, add `functions/api/notify.js`, point the form at `/api/notify`.

### F. Windows installer
`npm run build:win:reader` (+ Windows code-signing cert). Site currently marks Windows "Soon" — flip `available: true` in `Download.jsx` when it ships. **Windows matters for a mass book audience — prioritize.**

---

## ⚠️ Review before launch
- **`Voices.jsx` testimonials are illustrative** — swap for real reader testimonials or your own book-writing story.
- **`Offering.jsx` `BOOK_URL` is empty** → Reader card shows "notify me". Set the Amazon/Kindle link when the book is purchasable.
- **`NotifyForm.jsx` `NOTIFY_EMAIL`** = `hello@windyword.ai` — confirm that inbox exists/routes.
- **Site download** currently resolves to the *old* live v1.7.0 build until you run runbook A and replace the R2 files.
- **"3,500+ models" is TRUE** (your HF org) — kept and framed honestly (the free app ships 7 hand-picked engines from that library).

## Confirm the mirror finished
```bash
for e in nano lite core edge plus turbo pro-engine; do
  printf "%s=%s " "$e" "$(curl -s -o /dev/null -w '%{http_code}' "https://downloads.windyword.ai/models/listen-windy-$e/ct2-int8/config.json")"
done; echo
```
All should be `200`. If `pro-engine` is still 404, re-run: `WINDY_EDITION=reader` not needed — just re-mirror that one engine (HF → `s3://windyword-releases/models/listen-windy-pro-engine/ct2-int8/`).
