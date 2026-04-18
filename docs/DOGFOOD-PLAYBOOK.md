# Dogfood / Normie-Test Playbook

Walk a first-time user through every feature in the order a normie
would hit them. Each step captures:

- **See** — what renders on screen
- **Do** — the user's action
- **Expect** — intended behaviour
- **Actual** — what actually happens (needs in-person testing)
- **Rough edges** — confusion points + friction
- **Grandma score** — 1-10, could an 87-year-old succeed?

Run this as a structured pair-session before each stable release.
Fill in Actual + Rough edges from the session; file issues for any
Grandma score ≤5.

Target audience: a Mac/Windows user who has never seen Windy Pro
and doesn't use voice-to-text today. **No terminal. No docs. No
preparation.**

---

## Act 1 — Install (steps 1-6)

### Step 1. Download the .dmg

- **See:** windyword.ai download page with a single "Download for
  macOS" button.
- **Do:** Click the button.
- **Expect:** Browser downloads `Windy Pro-X.Y.Z-arm64.dmg` (~400 MB).
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - 400 MB is big. The page should show the size upfront so users
    on metered connections can decide. `build.extraResources` could
    probably be trimmed (e.g. the starter model's French tokens).
  - Does windyword.ai auto-detect the user's arch and serve x64 to
    Intel Macs?
- **Grandma score:** 9 (the button is obvious)

### Step 2. Open the .dmg

- **See:** macOS mounts the .dmg; a Finder window opens showing the
  .app and an arrow to /Applications.
- **Do:** Drag the .app icon onto the /Applications folder icon.
- **Expect:** Standard macOS install ritual; copy completes in seconds.
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - If the user double-clicks the .app from inside the .dmg (without
    dragging to /Applications first), the wizard will run but any
    writes to /Applications will fail. The DMG background image
    should make the drag-target obvious.
- **Grandma score:** 7 (drag-to-install is unintuitive for non-Mac
  natives but standard on macOS)

### Step 3. Launch Windy Pro for the first time

- **See:** Gatekeeper dialog: "Windy Pro is an app downloaded from
  the Internet. Are you sure you want to open it?"
- **Do:** Click "Open".
- **Expect:** Once signed + notarized (RELEASE.md §4), no warning
  — app opens directly. Until Apple Developer enrollment completes,
  Gatekeeper shows the warning and users may need to right-click →
  Open.
- **Actual:** _Depends on signing state. Currently UNSIGNED._
- **Rough edges:**
  - Unsigned path means the user must right-click → Open, which
    grandma cannot discover.
  - The WINDY_PRO memory (session 1) flagged macOS signing as P0
    for v1.9. Until then, signal "unsigned" clearly on the download
    page.
- **Grandma score:** 3 (unsigned) / 9 (signed)

### Step 4. Wizard screen 0 (welcome)

- **See:** "🌪️ Welcome to Windy Pro" headline, three feature cards
  (100% Private, 15 Engines, No Internet), "Get Started" button.
- **Do:** Click Get Started.
- **Expect:** Animates to screen 1 (hardware scan).
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - The Bob quote ("Let there be no more typing") is charming but
    takes vertical space; test on a 13" MacBook Air.
  - Emoji-heavy — check screen-reader pronounces them reasonably.
- **Grandma score:** 9

### Step 5. Wizard screen 1 (hardware scan)

- **See:** Six scan cards (processor, memory, graphics, storage,
  network, battery) populating one-by-one as the scan runs.
- **Do:** Wait ~3-5s for populated cards, then Continue.
- **Expect:** Each card shows the detected value + sub-label (e.g.
  "Apple M2 · 8 cores"). Continue enables when scan completes.
- **Actual:** _NEEDS VERIFICATION_ (scan includes a network
  speedtest hitting speed.cloudflare.com with an 8s timeout — on
  captive Wi-Fi or VPN blocking, this hangs 8s silently.)
- **Rough edges:**
  - Progress indication during scan is minimal — "Detecting…" text
    doesn't animate. Consider a subtle shimmer.
  - Network card can say "Measuring..." for 8s if Cloudflare is
    unreachable. Users might think wizard is frozen.
- **Grandma score:** 7 (the "Continue" button disabled state is
  clear, but the wait can feel like a hang)

### Step 6. Wizard screen 3 (languages)

_Skips screen 2 (account) — Phase 8 + P14 deleted it._

- **See:** Two-column layout. Left: search box + scrollable language
  list. Right: empty "YOUR LANGUAGES" area.
- **Do:** Type "English", press Enter, repeat for any other language.
- **Expect:** Selected languages appear on the right with usage
  percentage sliders. Continue button enables once ≥1 selected.
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - The "Equal Split" / "Clear All" buttons only appear after 2+
    languages selected — discoverability issue.
  - The search-and-press-Enter pattern isn't obvious; users might
    click the language names in the list instead (which also works).
- **Grandma score:** 6 (two ways to add a language is good, but the
  UI doesn't telegraph either)

---

## Act 2 — Continue the install (steps 7-12)

### Step 7. Translate upsell / skip (screen 4)

- **See:** If ≥2 languages selected, a translate-pro upsell card
  appears. Otherwise skipped to screen 5.
- **Do:** Click "Maybe later" or a paid tier.
- **Expect:** "Maybe later" routes to screen 5 immediately. Paid
  choice routes to Stripe checkout (external browser).
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - The SEC-WIZARD-1 fix means a compromised API can't open
    arbitrary URLs. User sees no difference.
- **Grandma score:** 8

### Step 8. Screen 5 — hero

- **See:** "Let's Get Windy" headline + "Use Recommended Setup" big
  green button + "Choose My Engines" alternative.
- **Do:** Click "Use Recommended Setup" (the normie path).
- **Expect:** Navigates to screen 6 with recommended engines
  pre-selected.
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - The "Choose My Engines" button is smaller than the green button
    — good hierarchy. But some users want to read the "What is
    WindyTune?" link before clicking either.
- **Grandma score:** 10

### Step 9. Screen 6 — models (P7 hero card)

- **See:** "★ RECOMMENDED FOR YOUR MACHINE — Edge Standard · 244 MB"
  hero card with "Use this →" button. Below: collapsed "Show
  advanced options" button.
- **Do:** Click "Use this →".
- **Expect:** Wizard selects the recommended set and proceeds to
  install (free tier) or pair picker (paid).
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - The hero card hides itself when
    `recommendation.recommended[0]` isn't in the engine catalog.
    If the user sees the advanced picker instead of the hero, it's
    a hardware-profile edge case worth flagging.
- **Grandma score:** 10 (this IS the grandma path)

### Step 10. Screen 8 — install

- **See:** Progress bar (0 → 100%), current-step text ("🧹 Checking
  for prior installation…" etc.), rotating moniker banner,
  per-engine download list.
- **Do:** Wait. ~30s on good hardware + network.
- **Expect:** No stall. Progress reaches 100%, transitions to screen
  9 (verify) after 1.5s.
- **Actual:** _NEEDS VERIFICATION — BUT session 1 found "stuck at
  0%" bugs. Session 1 fixes + P1 E2E harness cover the common
  regressions. Still worth testing on a never-installed Mac._
- **Rough edges:**
  - 30s feels long. The rotating moniker helps but the log pane
    scrolling is actually the most reassuring signal. Keep both.
  - If install fails, the error code (WINDY-NNN from P7) should
    now appear with a fix suggestion. Test that path by pulling
    the network mid-install.
- **Grandma score:** 7 (depends on whether timeouts fire visibly)

### Step 11. Screen 9 — verify (Phase 4)

- **See:** "🔐 Final check" screen. Mic card + Accessibility card
  (macOS only). "Test Mic" and "Verify Accessibility" buttons.
- **Do:**
  - Click "Test Mic" — speak for 1 second — amplitude meter fills
    — ✅ appears.
  - Accessibility card auto-runs on entry; shows ✅ if system
    preferences already grant it, otherwise ❌ with "Open
    Accessibility Settings" button.
  - Click "Finish setup →" when both ✅.
- **Expect:** Transitions to screen 10 (complete).
- **Actual:** _NEEDS VERIFICATION on fresh macOS install where no
  app has been granted accessibility yet._
- **Rough edges:**
  - First mic test triggers the macOS permission dialog. Users may
    not expect this. The card should mention it upfront.
  - If user clicks Skip, the Finish-anyway path bypasses — make
    sure the next app launch still prompts for mic on first
    recording.
- **Grandma score:** 8 (the test-mic flow is genuinely delightful
  once it works)

### Step 12. Screen 10 — complete

- **See:** "You're Ready! 🌪️" + shortcuts grid + "What's Next?"
  list + animated green strobe (unless prefers-reduced-motion).
- **Do:** Click "Launch Windy Pro".
- **Expect:** Wizard window closes; main app window opens.
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - Is the handoff between wizard-close and main-window-open
    seamless? Any flash of empty screen?
- **Grandma score:** 10

---

## Act 3 — First-use (steps 13-22)

### Step 13. Main window first paint

- **See:** Empty transcript area with keyboard-shortcut placeholder;
  status bar; record button.
- **Do:** Nothing yet — orient.
- **Expect:** Python engine starts in background (see
  ARCHITECTURE.md §4); status bar goes from "Connecting…" to
  "Ready" within ~5s.
- **Actual:** _NEEDS VERIFICATION — cold-start timing logged to
  wizard-install.log per P9. First-paint latency matters._
- **Rough edges:**
  - If engine fails to connect (port 9876 busy, venv broken), the
    status bar needs to show actionable text, not just spin.
- **Grandma score:** 8

### Step 14. First recording

- **See:** Record button, "Press Ctrl+Shift+Space to start"
  placeholder.
- **Do:** Press Ctrl+Shift+Space (Cmd on macOS), speak "this is a
  test", release.
- **Expect:** Status bar shows "🎙 Recording" then "✍️
  Transcribing" then "✅ Ready"; transcript area fills with "this
  is a test".
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - On Wayland, focus-handling must not grab the wizard back. See
    WAYLAND-PASTE-FOCUS-GUIDE.md. Spot-check on Linux.
- **Grandma score:** 9 (if it works on first press, magic; if the
  hotkey conflicts with another app, confusion)

### Step 15. Signup banner (Phase 8)

- **See:** Bottom-centre banner: "🌪️ Loved that? Save your
  sessions to the cloud — sync across devices…" with
  [Create free account] [No thanks] buttons.
- **Do:** Click "No thanks".
- **Expect:** Banner fades out; never reappears.
- **Actual:** ✅ Tested by the P1 E2E suite.
- **Rough edges:**
  - The 30s auto-dismiss fires without stamping localStorage —
    banner will reappear on the next transcript if not explicitly
    dismissed. Is that the right call? Arguable either way.
- **Grandma score:** 10

### Step 16. Paste to cursor

- **See:** (assuming transcript present and a TextEdit window open
  behind Windy)
- **Do:** Click the TextEdit window to focus it, then press
  Ctrl+Shift+V.
- **Expect:** The transcript text types into TextEdit at the cursor.
- **Actual:** _NEEDS VERIFICATION. Wayland has known gotchas (see
  CLAUDE.md + WAYLAND-PASTE-FOCUS-GUIDE.md)._
- **Rough edges:**
  - Linux: if ydotool daemon isn't running, silent failure.
    Verify screen should have caught this but re-verify.
  - Ctrl+Shift+V vs Ctrl+V: terminals need Shift; GUI apps accept
    both. We always send Shift — correct.
- **Grandma score:** 6 (the concept is novel; "paste where my
  cursor is" is unusual for grandma to conceptualise)

### Step 17. Clear transcript

- **See:** Clear button in the control bar.
- **Do:** Click Clear.
- **Expect:** Transcript area empties; placeholder returns.
- **Actual:** _NEEDS VERIFICATION_
- **Grandma score:** 10

### Step 18. Export as .txt

- **See:** Export bar with .txt / .md / .srt buttons.
- **Do:** Click .txt.
- **Expect:** macOS Save dialog with default filename
  `transcript-YYYY-MM-DDTHH-mm-ss.txt`. User picks a location;
  toast confirms "✅ Saved to …".
- **Actual:** _NEEDS VERIFICATION. P4 tests pin the filename
  format and the toTxt logic._
- **Rough edges:**
  - The default location is the user's chosen save path from last
    time. Consider defaulting to Documents on first export.
- **Grandma score:** 9

### Step 19. Export as .md

- **See:** Same dialog, `.md` extension.
- **Do:** Accept default.
- **Expect:** File opens in Finder; content is `# Transcript —
  <date>` + the transcript paragraphs.
- **Actual:** _NEEDS VERIFICATION_
- **Grandma score:** 9

### Step 20. Export as .srt

- **See:** Same dialog, `.srt` extension.
- **Do:** Accept default.
- **Expect:** SRT-format subtitle file. Each cue has 1-indexed
  number, HH:MM:SS,000 timecode range, and ≤15 words of text.
- **Actual:** ✅ Format pinned by P4 tests.
- **Rough edges:**
  - The synthetic 2.5 wps timing is a placeholder. A future
    "real SRT with actual timing" feature should come from the
    engine's per-segment timestamps.
- **Grandma score:** 6 (SRT is niche; most grandmas don't know
  what a subtitle file is)

### Step 21. Settings

- **See:** Settings button in the control bar; opens Settings panel.
- **Do:** Browse tabs; change a preference (e.g. theme).
- **Expect:** Preferences persist to electron-store; visual change
  applies immediately where possible.
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - The Settings panel is a major surface; expand this section of
    the playbook before v1.9 stable.
- **Grandma score:** 7

### Step 22. Switch engine

- **See:** Engine selector in Settings OR via shortcut
  Ctrl+Shift+M.
- **Do:** Open selector, pick a different model.
- **Expect:** The Python engine reloads the selected model; status
  bar shows "Switching…" then "Ready". First transcript on the
  new model may be slower (cold load).
- **Actual:** _NEEDS VERIFICATION. P9 `/health cold_start_ms`
  exposes the load time so we can track regressions._
- **Rough edges:**
  - Switching to a larger model while one is loaded shouldn't
    block the UI. Confirm.
- **Grandma score:** 5 (power-user feature; hide under "Advanced"
  in settings)

---

## Act 4 — Longer-term use (steps 23-30)

### Step 23. Long recording session

- **Do:** Start recording, speak for 5+ minutes continuously.
- **Expect:** Transcript keeps appending; no partial-text
  accumulator bugs; CPU/RAM stay steady.
- **Actual:** _NEEDS VERIFICATION_
- **Rough edges:**
  - Long sessions stress the WebSocket buffer (50MB cap per
    server.py). Ensure 5+ minute sessions don't hit it on
    smaller models.
- **Grandma score:** 8

### Step 24. Second recording (same session)

- **Do:** Stop the long one, immediately start another.
- **Expect:** Transitions cleanly; no "buffering" hang; previous
  transcript still visible (append or replace — decide).
- **Actual:** _NEEDS VERIFICATION_
- **Grandma score:** 7

### Step 25. Quit the app

- **Do:** Cmd+Q.
- **Expect:** Python engine shuts down cleanly. Tray icon gone.
- **Actual:** _NEEDS VERIFICATION. Check
  `lsof -ti:9876` after quit — should return nothing._
- **Rough edges:**
  - If the Python engine zombies, next launch will fail to bind
    port 9876. `_kill_port_holder()` in server.py handles this,
    but it's fragile if the zombie is SIGKILL-resistant.
- **Grandma score:** 10

### Step 26. Re-open the app

- **Do:** Click Windy Pro in /Applications or Spotlight.
- **Expect:** Main window opens directly (no wizard — config.json
  exists). Engine starts, status bar goes Ready.
- **Actual:** _NEEDS VERIFICATION_
- **Grandma score:** 10

### Step 27. Engine selector settings survive re-launch

- **Do:** Check previous engine selection is still active.
- **Expect:** Yes — settings persisted to electron-store.
- **Actual:** _NEEDS VERIFICATION_
- **Grandma score:** 10

### Step 28. Auto-updater prompt

- **Do:** If a newer version is published to GitHub Releases, wait
  10s after launch or manually trigger via DevTools.
- **Expect:** Dialog: "Update available: vX.Y.Z+1" with release
  notes. Clicking "Update now" downloads + prompts restart.
- **Actual:** _NEEDS VERIFICATION. See UPDATER-TEST.md for the
  full 9-step playbook._
- **Grandma score:** 9 (if the dialog is clear about what's
  happening; if not, users click past it)

### Step 29. Uninstall

- **Do:** Drag /Applications/Windy Pro.app → Trash. Empty trash.
- **Expect:** App is gone but ~/.windy-pro/ state remains (models,
  transcripts, settings). User must manually `rm -rf ~/.windy-pro/`
  to fully uninstall.
- **Actual:** _NEEDS VERIFICATION. Consider shipping an official
  uninstall helper._
- **Rough edges:**
  - "App is gone but state remains" is macOS-standard behaviour
    but not intuitive. A "Completely uninstall" option in
    Settings would close this gap.
- **Grandma score:** 6 (drag-to-trash is obvious, but
  "your transcripts are still on disk" is a privacy surprise)

### Step 30. Re-install after uninstall

- **Do:** Download the .dmg again, install again, launch.
- **Expect:** If ~/.windy-pro/ still present, skips wizard and
  loads old state. If not, wizard runs fresh.
- **Actual:** _NEEDS VERIFICATION_
- **Grandma score:** 8

---

## Scoring + Next Actions

After each session:

1. Sum grandma scores. Target: ≥260 of 300 (average ≥8.6).
2. For any step ≤5: file an issue tagged `grandma-block`.
3. For any step ≤7: flag in SESSION-NOTES for next release cycle.
4. Update Actual / Rough edges inline — this doc is meant to
   accumulate findings, not be re-written each time.

## Cross-references

- [RELEASE.md](../RELEASE.md) — the release checklist this playbook
  complements
- [DEBUGGING.md](../DEBUGGING.md) — symptom-based troubleshooting
- [ERRORS.md](ERRORS.md) — error codes you might encounter
- [UPDATER-TEST.md](UPDATER-TEST.md) — the auto-updater's own
  playbook
- [A11Y.md](A11Y.md) — re-run this playbook with VoiceOver + only
  keyboard for a separate a11y pass
