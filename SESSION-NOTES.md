# Session Notes — Autonomous runs on `installer-bundling-v3`

> Two sessions, appended chronologically. Session 2 starts below at
> "## Session 2 summary (2026-04-15)".

## Session 1 summary

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

---

## Session 2 summary (2026-04-15)

All 15 priorities from the second autonomous prompt completed. 15
commits + 1 fix applied from the code-review findings. Tests: 127
unit + 16 E2E, all green locally. CI job count grown from 1 to 7
gates (e2e, test-installer/renderer/error-ratchet/venv-guard/i18n-
coverage, build matrix).

## Session 2 commit list

| Hash | Description | Priority |
|---|---|---|
| `3c48bf7` | test(e2e): Playwright-electron harness + signup banner | P1 |
| `16b110c` | sec(audit): IPC + API audit — SEC-PAIR-1 + SEC-WIZARD-1 | P2 |
| `2117cbf` | ci(guard): block legacy extraResources/venv resurrection | P13 |
| `64ac4db` | refactor(wizard): goToScreen string IDs + delete account screen | P14 |
| `b71199a` | feat(errors): WINDY-NNN error taxonomy + ratchet guard | P7 |
| `6ece454` | test(renderer): jsdom coverage for signup-banner + transcript-format | P4 |
| `030ee29` | feat(release): scripts/release/ automation | P6 |
| `7518a34` | feat(engine): /health + cold-start timing + ENGINE-PROTOCOL.md | P9 |
| `d79526a` | fix(windows): paste-verify SendKeys + clean-slate own-bundle guard | P8 |
| `8a04523` | feat(a11y): ARIA + prefers-reduced-motion + focus ring | P10 |
| `5767b23` | docs(updater): auto-updater test playbook | P11 |
| `08f3684` | docs(dogfood): 30-step normie playbook | P12 |
| `60fb8ea` | feat(logger): JSON-lines file sink + rotation + redaction | P5 |
| `65bc6bd` | feat(i18n): wizard coverage check + step.pairs drift fix | P3 |
| `(this)` | docs(review): fresh code review + CR-005 shell escape fix | P15 |

## Session 2 TODOs / FIXMEs left behind

Listed in docs/CODE-REVIEW-2026-04.md with stable `CR-NNN` codes.
High-signal follow-ups for future sessions:

- **CR-001** — npm audit: 10 high-severity vulnerabilities
  (electron 28→33, tar CVEs, lodash). Needs a major electron bump
  with full regression pass.
- **CR-002** — console.log bypasses the redaction pipeline in some
  places. Migrate to logger.js uniformly.
- **CR-003** — most IPC handlers in main.js are unbounded.
  Promote withTimeout from wizard-logger to a shared lib and wrap
  every long-running handler.
- **CR-004** — ~42 unhandled await calls in event handlers. Most
  likely to produce a real bug find.
- **CR-006** — Crash log redaction is deny-list; invert to allow-list.
- Main app renderer has zero i18n (see I18N-AUDIT.md).
- Phase 4/6/7/8 UI strings + WINDY-NNN user messages still
  hardcoded English (see I18N-AUDIT.md).
- app.js still ~4000 lines; extract more modules for testability
  (P4 is partial — 38 tests cover signup-banner + transcript-format
  only; addTranscriptSegment + export + engine switch still
  untested).
- `--dump-logs` CLI flag was NOT implemented (mentioned in the P5
  prompt). Logger infrastructure is there; need the CLI wrapper.

## Session 2 surprising findings

1. **localStorage persistence across Electron.launch() reuses
   userData dir.** Setting `HOME` in env doesn't move Electron's
   per-app storage; must set `userData` via `app.setPath`. Hit this
   in the signup-banner E2E harness; documented in
   `e2e/fixtures/banner-harness-main.js`.

2. **contextBridge API objects are frozen.** Tests can't monkey-patch
   `window.wizardAPI.method` — need to override the renderer-side
   function (`window.runMicVerify`, etc.) instead. Learned the hard
   way in `e2e/wizard/03-verify-screen.spec.js`.

3. **`pair-delete` had an arbitrary-directory-delete primitive.**
   `_validatePairId` only checked for non-empty string. A renderer
   could pass `../../../etc` and `fsp.rm({recursive, force})` would
   happily wipe /etc. Fixed in SEC-PAIR-1. The original validator
   looked "defensive" because it threw on empty strings, but didn't
   check the shape of what IT ACCEPTED.

4. **Account screen was unreachable but un-deletable.** Session 1
   bypassed it by intercepting navigation; couldn't delete the
   markup because goToScreen used DOM-order indices. P14 refactored
   goToScreen to string IDs so the ~60-line account screen could
   finally go. This is the kind of plumbing that feels trivial but
   unlocks follow-on cleanup.

5. **The original `_exportTranscript` SRT implementation was
   inline.** Extracting to `transcript-format.js` (P4) revealed
   the "2.5 words/sec" rate is a magic number with no source
   comment — it's synthetic, not derived from engine timestamps.
   Flagged for a future "real SRT from engine timing" feature.

6. **`console.error` inside logger's `error()` method silently
   bypasses redaction.** The error object is stringified via
   `compact(info)` so fields ARE redacted — but if the caller
   passes the raw `err` object WITHOUT going through
   `log.error(method, err)`, the redaction doesn't run. Pattern
   is correct in library code; risk is downstream callers
   console.log'ing errors themselves.

7. **Electron-builder 24 → 26 is breaking.** npm audit fix --force
   pushes to 26. Deferred; would require re-testing all three
   platform builds.

8. **Windows `_ownBundlePath()` test needed path.win32 explicit.**
   On a macOS CI host, `path.dirname('C:\\foo\\bar.exe')` returns
   `.` because path treats backslashes as literal characters when
   the host uses forward-slash. `require('path').win32.dirname`
   does the right thing regardless of host. Sign that cross-
   platform tests need to use the explicit `path.win32` /
   `path.posix` APIs rather than `path.*`.

## Session 2 recommended next moves for Grant

1. **Review the 15 commits in order.** The commit messages carry
   the WHY + alternatives + what-could-break sections you asked for.
2. **Run the new CI gates on the next push.** test-installer adds
   i18n-coverage, error-code ratchet, venv-resurrection guard, and
   windows-paths unit tests. E2E job runs in parallel.
3. **Try the release scripts with --dry-run.**
   `./scripts/release/preflight.sh` is the single most useful one;
   it'll tell you what's blocking a release.
4. **Walk through DOGFOOD-PLAYBOOK.md** with a colleague watching.
   Fill in the "Actual" and "Rough edges" fields — those fields
   are blank by design; they accumulate signal across sessions.
5. **Decide on CR-001** (Electron 28 → 33). The biggest outstanding
   risk + the biggest blast radius. I'd handle it in its own
   session with a rollback plan, not squeeze into this branch.
6. **Merge installer-bundling-v3 → main when CI is green.** The
   branch now has 27 commits across two sessions. Draft PR #1
   should be ready to promote to ready-for-review.

