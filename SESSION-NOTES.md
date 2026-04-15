# Session Notes — Autonomous run on `installer-bundling-v3`

## Summary

Twelve commits across all ten priorities Grant set out. The wizard's
"stuck at 0%" hang has a root cause (execSync blocking the Electron
event loop) and a fix; Phases 4, 6, 7, and 8 of the install plan are
implemented; CI now builds Mac arm64/x64 + Linux + Windows; the
weeks-red `ci.yml` is triaged with concrete fixes; ARCHITECTURE/RELEASE/
DEBUGGING docs are written; and the safety-critical install code paths
have unit tests wired into CI.

## What shipped

| Hash | Description |
|---|---|
| `382d497` | fix(wizard): fail-fast timeouts on every awaited install step (`withTimeout` helper) |
| `e027a8f` | fix(clean-slate): never kill processes inside our own .app bundle |
| `b079c3f` | fix(install): convert blocking `execSync` to async `exec` — unblocks IPC delivery |
| `80a9a37` | feat(install): bundle uv (Astral) for ~5x faster offline install |
| `3d7ccdc` | feat(wizard): Phase 4 — real permission verification loops (mic RMS + osascript) |
| `d12287b` | feat(wizard): Phase 6 — Linux paste-tool one-click install + verify (xdotool/ydotool/uinput/input group) |
| `08ab780` | feat(wizard): Phase 7 — hero recommended-engine card + collapsed advanced options |
| `175d8b1` | feat(account): Phase 8 — move account creation out of wizard (post-first-transcription banner) |
| `1334455` | ci(installer): add mac-x64, linux-x64, win-x64 build jobs |
| `b647040` | ci(triage): fix the four red ci.yml jobs that have been failing for weeks |
| `4c48c3a` | docs: add ARCHITECTURE.md, RELEASE.md, DEBUGGING.md |
| `56f40f8` | test(installer): unit tests for bundled-assets, clean-slate, withTimeout — wired into CI |

## What's blocked

Nothing's blocked code-wise. Three things require Grant's machine /
Grant's accounts to verify:

1. **Real verification of the wizard hang fix on the iMac.** The two
   diagnoses (execSync blocking IPC + own-bundle process kill safety)
   are both plausible root causes and both have fixes shipped. The
   wizard log file at `~/Library/Logs/Windy Pro/wizard-install.log`
   will now show exactly which step fires first if anything still
   hangs (every step has a `withTimeout` budget). Needs Grant to
   re-run the BUILD.md clean-state install test on the iMac.

2. **Phase 4 microphone verification on Wayland.** The renderer-side
   `getUserMedia` + RMS check works on macOS / X11 / Windows. On
   Wayland with strict portal config, the wizard's getUserMedia may
   fail silently — needs an actual Wayland test environment to
   confirm. The accessibility card is gated to `darwin`-only so
   Linux testers won't see a confusing "denied" message there.

3. **uv install timing.** Code path is wired (uv preferred, pip
   fallback) and the build script downloads + stages uv 0.5.13. CI
   should produce an artifact whose first install measures <15s
   on the smoke-test step. Local timing not measured because the
   user wasn't present to confirm we should re-run the bundle build
   (it overwrites ~700MB of existing extraResources).

## Recommended next moves for Grant when he wakes up

1. **Pull the branch**, review the 12 commits in order, and merge
   into a draft PR if you haven't already (`gh pr view 1`).

2. **Build a fresh DMG and run the clean-install test from BUILD.md
   on this iMac.** If the wizard still hangs, the log will say
   `✗ TIMEOUT after Nms in: <label>` — that label is the next
   investigation anchor. Share the log file as the next session's
   starting evidence.

3. **Watch the cross-platform CI builds finish** for the first time.
   The mac-x64 / linux-x64 / win-x64 jobs are now active; first run
   on this branch will take ~30 minutes. Any platform-specific
   wheel issues will surface there before reaching users.

4. **Decide on signing timing.** Apple Developer ID enrollment is
   the only thing standing between us and a shipping v1.9 macOS
   build. RELEASE.md §4 has the env vars + commands ready.

5. **Ship a beta build** to test Phase 4/6/8 in the wild. The
   permission verification + Linux paste-tool flow + post-first-
   transcript banner all need real-user signal before going stable.

## Anything weird/surprising

* **The bundled wheels directory in the repo is x86_64 only.** Even
  though the host is arm64, the staged extraResources/wheels/ contains
  `*macosx_11_0_x86_64.whl` files. Either the wizard never picked the
  arm64 path, or the prior bundle was built on an Intel Mac and never
  refreshed. The new CI matrix builds per-arch, so this should
  self-resolve once `mac-arm64` artifacts are downloaded.

* **A merge conflict marker was sitting in `Privacy.jsx` on main.**
  Lines 42–47 had `<<<<<<< HEAD ... =======` markers committed —
  that's been failing `build-web-portal` for weeks. Resolved in
  favour of the canonical "How We Store Your Data" heading. The web
  portal probably wasn't actually serving a broken build because
  Vite refused to compile, which means the prod artifact stayed at
  whatever was deployed before the conflict landed. Worth checking
  what `windyword.ai` is currently serving.

* **`extraResources/venv/` (gigabytes) is still on disk and gitignored.**
  Per the project memory it's the legacy pre-built venv with hard-coded
  `/Users/thewindstorm/...` paths that's broken on every other machine.
  Nothing references it anymore — the fast path uses bundled wheels +
  bundled Python and creates the venv at install time. Grant can
  `rm -rf extraResources/venv/` to reclaim ~443MB whenever convenient.
  I didn't delete it autonomously because the priority memo said
  "DO NOT delete files unless you're 100% sure they're unused."

* **The wizard-window-focus IPC** I added for Phase 4 re-verification
  fires on every focus event, including incidental ones (cmd-tab
  away and back). This is fine for the verify screen but if anyone
  later wants to listen for window-focus elsewhere, they'll get a
  stream of events — not a single "user just came back from System
  Settings" pulse. Document this if it becomes load-bearing.

* **Phase 8 leaves screen-2 (account) in the DOM.** The whole DOM
  ordering of `.screen` divs is what `goToScreen(n)` reads, so
  removing screen-2 would shift every subsequent screen's index
  and break a dozen `goToScreen(N)` calls scattered through
  wizard.html. Bypassing via `continueFromHardware()` was safer.
  Future cleanup: switch `goToScreen` to take a string id and
  walk the DOM by id; then screen-2 can finally be deleted.
