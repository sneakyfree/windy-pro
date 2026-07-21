# Windy Word — Book-Launch First-Run Test Checklist

**The behavioral launch gate.** Every fix landed on `book-launch-hardening` this cycle is
syntax- and logic-verified but **not yet exercised on a real clean machine**. This checklist
runs the app end-to-end on each target OS to confirm those fixes actually hold, and to catch
the "grandma test" glitches that only appear on a fresh install.

- **Branch under test:** `book-launch-hardening` (run `git log -1 --oneline` and record the tip below).
- **Audience bar:** a non-technical reader on old/slow hardware, unpacked from the book link. If a
  step needs a terminal beyond the one install one-liner, it fails the bar — note it.
- **Rule:** test on a **fresh** machine / VM / new user account. A dev box that already has
  `~/.windy-pro/`, Python, ffmpeg, or a prior install will hide the exact bugs we're checking.

Tip under test: `__________________`  ·  Tester: `__________`  ·  Date: `__________`

---

## Phase 0 — Prerequisites (READ FIRST — the live R2 artifacts are STALE)

The fixes are committed but the **currently-published R2 artifacts predate them**. You must test
**freshly built** artifacts from the current `book-launch-hardening` tip, or you'll be testing old
bugs. Which fix lives in which artifact:

| Artifact | Built by | Carries the fix? |
|---|---|---|
| Windows offline ZIP | `.github/workflows/build-offline-installers.yml` (needs R2 write secrets re-added) | ffmpeg only after this CI re-cut |
| Linux offline AppImage | same workflow (linux job `if:false` — flip to true) | ffmpeg only after re-cut |
| macOS Reader DMGs (arm64 + x64) | `scripts/release/build-reader-dmg-{arm64,x64}.sh` (needs Apple certs) | all renderer/main fixes after rebuild + notarize |
| `go.sh` / `go.ps1` | **already re-uploaded to R2 — live** | ✅ resume/integrity/messaging already testable |

**Before testing:** rebuild the platform artifact you're about to test from the current tip and
publish it (or side-load it), so the app you install actually contains the fixes. Record which
build you tested in each section.

**Legend:** `[ ]` = pass · `[F]` = fail (write what happened) · `[N/A]` = not applicable this platform.

---

## Section A — Core first-run (run on EVERY platform)

These are the shared "does the product work at all, simply" checks. Repeat per platform.

- [ ] **A1 — Install via the one-liner only.** Fresh machine, run the single documented command
  (`curl … | bash` or `irm … | iex`). No extra steps, no manual dependency install. App ends up
  installed and launches on its own.
- [ ] **A2 — No account / no login / no license.** First launch shows no sign-in wall, no license
  key prompt, no "activate" step, no upgrade nag blocking use. _(validates: DRM neutralization)_
- [ ] **A3 — First dictation works.** Press the dictation hotkey, say a sentence, release. Text is
  transcribed and pasted into the focused app (try a text editor). _(validates: ffmpeg + venv +
  engine end-to-end)_
- [ ] **A4 — Paste lands in the right place.** Repeat A3 into: a plain text editor, a browser text
  field, and a terminal. Text goes to wherever the cursor was, not the Windy Word window.
- [ ] **A5 — Works fully offline.** Turn on airplane mode / disable all networking. Quit and reopen
  the app. Dictate. It must transcribe normally with no error and no hang. _(validates: fully-offline
  guarantee)_
- [ ] **A6 — The "forever offline" DRM proof.** Stay offline, quit, wait, reopen again. Still works —
  no "license expired," no lockout, no model deletion, no grace-period nag. _(validates: license
  machinery neutralized)_
- [ ] **A7 — Unlimited recording.** Record continuously for **>10 minutes**. No auto-stop, no
  "upgrade to record longer" interruption. _(validates: recording clamp removed)_
- [ ] **A8 — Removal is possible.** Confirm a non-technical user can uninstall/remove the app
  (drag to Trash / Add-Remove Programs / delete AppImage) and note whether leftover data
  (`~/.windy-pro`, models, venv) is obvious or orphaned. _(known gap: no uninstaller — record reality)_

---

## Section B — macOS Apple Silicon (M1–M4)

Build tested: `__________`  (arm64 Reader DMG tip / date)

- [ ] **B1 — Core A1–A8** all pass on Apple Silicon.
- [ ] **B2 — curl install has no Gatekeeper block.** The `go.sh` path removes quarantine, so the app
  should open without the "cannot be opened / unidentified developer" wall. _(validates: signed +
  curl-quarantine-free path)_
- [ ] **B3 — Browser-download Gatekeeper.** Separately, download the DMG in Safari/Chrome (this sets
  the quarantine bit), double-click, drag to Applications, open. **On a notarized DMG it opens
  cleanly; if it shows "Apple cannot check it for malicious software," the DMG is NOT notarized** —
  record which. _(validates: notarization; gates the website "Download for Mac" button)_
- [ ] **B4 — ffmpeg runs on Apple Silicon.** ⚠️ The bundled `ffmpeg` is an x86_64 Mach-O. Confirm
  transcription (A3) works on a **clean** Apple Silicon Mac that may not have Rosetta 2 installed —
  if the first dictation fails or silently prompts to install Rosetta, flag it (this is an untested
  risk, not a fixed bug).
- [ ] **B5 — First-run permissions.** On first launch you get **only** a microphone prompt — **no
  camera prompt**. _(validates: launch-time camera pre-request removed)_ Then enable Settings ▸ "Save
  video recordings" and confirm the camera prompt appears **at that point**.
- [ ] **B6 — Mic-denial recovery.** On the mic prompt, click **Don't Allow**. Try to dictate. You get
  a **persistent** message naming the exact path ("System Settings ▸ Privacy & Security ▸ Microphone
  ▸ turn on Windy Word"), not a toast that vanishes. Grant it there, dictate — works. _(validates:
  mic-denial dead-end fix)_

---

## Section C — macOS Intel (pre-2020 Macs)

Build tested: `__________`  (x64 Reader DMG tip / date)

- [ ] **C1 — Core A1–A8** all pass on an Intel Mac.
- [ ] **C2 — ffmpeg runs natively.** Transcription works (bundled ffmpeg is x86_64 = native here — this
  is the arch B4 worries about, so it should be clean on Intel).
- [ ] **C3 — Gatekeeper B2 + B3** behave as on Apple Silicon (curl path clean; browser path depends on
  notarization).
- [ ] **C4 — Permissions B5 + mic-denial B6** behave the same.

---

## Section D — Windows 10 / 11  ⭐ (largest audience, least-tested)

Build tested: `__________`  (offline ZIP tip / date — **must be a post-ffmpeg-fix rebuild**)

- [ ] **D1 — Install via `irm … | iex` in PowerShell.** (Note: this fails in cmd/Command Prompt — must
  be PowerShell. Record if the instruction is clear enough for a non-technical user.)
- [ ] **D2 — 🔑 THE ffmpeg test: dictation actually produces text.** Press the hotkey, speak, release.
  Text appears. **If you get no text / a "spawn ffmpeg ENOENT" / silent failure, the ffmpeg fix did
  NOT make it into this build — you're testing a stale artifact (see Phase 0).** _(validates: Windows
  ffmpeg bundling — the #1 critical)_
- [ ] **D3 — No black console flash on paste.** When text pastes, confirm no PowerShell console window
  flashes on screen. _(known medium — record if still present)_
- [ ] **D4 — SmartScreen.** Unsigned build shows "Windows protected your PC." Confirm the "More info ▸
  Run anyway" path works. _(known gap: no code-signing cert yet — record the friction level)_
- [ ] **D5 — Antivirus / Defender.** Watch for the 3.6 GB bundle being quarantined or flagged
  ("threat removed"). Test with Defender on, and if possible one third-party AV. _(known unaudited
  risk — record any quarantine)_
- [ ] **D6 — Core A2–A8** (offline, unlimited, forever-offline) pass on Windows.
- [ ] **D7 — Paste into apps.** A4 into Notepad, a browser field, and a terminal (PowerShell/Windows
  Terminal). _(PowerShell SendKeys strategy is untested — this is where it proves out.)_
- [ ] **D8 — Mic-denial recovery.** Deny the mic, try to dictate, confirm the persistent per-OS message
  names "Settings ▸ Privacy & security ▸ Microphone." _(validates: mic-denial fix)_
- [ ] **D9 — Re-run while open (half-delete guard).** With Windy Word **running**, re-run the
  `irm … | iex` one-liner. It must stop the running instance and reinstall cleanly — **not** error out
  and leave a half-deleted install. _(validates: go.ps1 Stop-Process-before-Remove-Item fix)_
- [ ] **D10 — Uninstall.** Attempt removal via normal Windows means. Record that there is no
  Add/Remove Programs entry (portable ZIP) and how a non-technical user would remove it. _(known gap)_

---

## Section E — Linux (Ubuntu 22.04/24.04 + Fedora)

Build tested: `__________`  (offline AppImage tip / date — **post-ffmpeg-fix rebuild**)

- [ ] **E1 — Install via `curl … | bash`** on Ubuntu.
- [ ] **E2 — 🔑 libfuse2 honest messaging.** On a machine **without** `libfuse2` (default Ubuntu 22.04+),
  the installer must **NOT** print a green "✓ installed and starting" — it must say the AppImage
  didn't stay open and give the `sudo apt install -y libfuse2` fix + the `--appimage-extract-and-run`
  fallback, and exit non-zero. Then install libfuse2, run, confirm it launches. _(validates: go.sh
  Linux liveness check)_
- [ ] **E3 — ffmpeg + dictation** (A3) works once running. _(validates: Linux ffmpeg bundling)_
- [ ] **E4 — Fedora pass.** Repeat E1–E3 on Fedora (different package manager; FUSE package name
  differs). Record any divergence.
- [ ] **E5 — Wayland vs X11 paste.** Test A4 under **both** a Wayland+GNOME session and an X11 session.
  Confirm paste lands in the target app and the Windy Word window doesn't steal focus. _(the Wayland
  paste system is fragile — see docs/WAYLAND-PASTE-FOCUS-GUIDE.md; do NOT "fix" it, just record.)_
- [ ] **E6 — Core A2–A8** pass on Linux.

---

## Section F — Cross-cutting deep tests (do on at least one platform each; note which)

- [ ] **F1 — 🔑 Interrupted-setup self-heal (the venv brick).** During the **very first launch**, while
  the engine is still setting up (the silent first minute), **force-quit the app** (or reboot / put
  the machine to sleep). Reopen it. It must **rebuild and work** — not stay permanently broken. Then
  do the harder version: force-quit mid-setup, then **reinstall the app**, reopen — must still recover.
  _(validates: venv ready-marker + rebuild-on-incomplete; platform: any, ideally a slow disk)_
- [ ] **F2 — 🔑 Long-dictation stress (freeze/OOM).** With WindyTune (Auto) selected, dictate for
  **30+ minutes** in one session (or feed a long recording). Confirm no freeze, no crash, no runaway
  memory; the transcript comes back. _(validates: chunked base64 on the transcribe path)_
- [ ] **F3 — 🔑 Recording survives a failed transcription.** Do a long recording, then force the
  transcription to fail (e.g., kill the Python engine process mid-transcribe, or corrupt the model
  dir before stopping). Confirm the app shows "your recording was saved" and the audio is actually in
  the archive / playback bar — **not** lost. _(validates: save-on-failure path)_
- [ ] **F4 — 🔑 WindyTune doesn't punish long recordings.** With WindyTune (Auto) active and a
  higher-accuracy engine selected by the ladder, do a **long** dictation (5–10 min). Confirm WindyTune
  does **not** immediately drop to Windy Nano just because the transcription took >30s. Short, genuinely
  slow clips may still downgrade; long clips at a healthy speed ratio must not. _(validates: ratio-based
  downgrade)_
- [ ] **F5 — 🔑 Download resume.** Start the install, let the ~4 GB download run a bit, **kill it**
  (Ctrl+C / close terminal). Re-run the exact same one-liner. It must **resume** from where it stopped,
  not restart from 0%. Test on macOS (was the broken one), Windows, and Linux. _(validates: go.sh stable
  cache path + go.ps1 curl `-C -`)_
- [ ] **F6 — 🔑 Offline / no-phone-home audit.** With a network monitor running (macOS: `sudo lsof -i -nP
  | grep -i "Windy\|python"`; Windows: Resource Monitor ▸ Network; Linux: `ss -tnp | grep -i windy`),
  do a full dictation while online. Confirm **no** outbound connection is opened for transcription —
  especially **nothing to `wss://windyword.ai` / `windyword.ai`**. _(validates: cloud STT hard-off +
  HF_HUB_OFFLINE)_
- [ ] **F7 — Upgrader phone-home guard.** Simulate an upgrader from a paid build: set
  `windy_transcriptionMode` to `cloud_only` in the app's storage (DevTools localStorage, or the config),
  relaunch. Confirm the free build **forces local-only** and does **not** connect to the cloud.
  _(validates: stale cloud_only override)_
- [ ] **F8 — Privacy-claim accuracy.** Compare what the app/site claims ("fully offline," "no telemetry")
  against F6 observations and the analytics opt-in. Record any mismatch to reconcile before launch.
- [ ] **F9 — Corrupt-download integrity.** (macOS) Truncate/corrupt the cached DMG, re-run install.
  Confirm hdiutil verification rejects it with an honest "may be corrupt — re-run for a fresh copy"
  message rather than installing a broken app. _(validates: `-noverify` removal + mount-fail scrub)_
- [ ] **F10 — Low disk space.** On a machine with only a few GB free, run the install. Record whether
  it fails gracefully with a clear message or bricks/half-installs. _(known gap: no disk preflight on
  the go.* path)_

---

## Sign-off

| Platform | Core (A) | Platform-specific | Deep (F) | Overall |
|---|---|---|---|---|
| macOS Apple Silicon | ☐ | ☐ (B) | ☐ | ☐ ship / ☐ block |
| macOS Intel | ☐ | ☐ (C) | ☐ | ☐ ship / ☐ block |
| Windows 10/11 | ☐ | ☐ (D) | ☐ | ☐ ship / ☐ block |
| Linux (Ubuntu + Fedora) | ☐ | ☐ (E) | ☐ | ☐ ship / ☐ block |

**Blockers found (must fix before launch):**

1. _______________________________________________
2. _______________________________________________

**Notes / glitches to watch (non-blocking):**

1. _______________________________________________

---

_Companion docs: `docs/BOOK-LAUNCH-HANDOFF.md` (remaining launch items), `~/windyword-book-launch-PLAN.md`
(the launch spec), `docs/WAYLAND-PASTE-FOCUS-GUIDE.md` (Linux paste — do not modify while testing)._
