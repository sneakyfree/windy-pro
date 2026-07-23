# Windy Pro (Windy Word) — AI Context File

This file is automatically loaded by Claude Code / AntiGravity at conversation start.
It contains critical project knowledge that prevents regressions.

## ⚠️ ECOSYSTEM CONTEXT (READ FIRST)

This repo (`windy-pro`) is the **developer name** for what consumers see as **Windy Word** — the hub product of the Windy ecosystem (Electron app + account-server + identity orchestration). It is one of 13 canonical Windy platforms plus Eternitas + the Authenticator + various infrastructure pieces.

**Before working on this repo, load the ecosystem context:**

1. **`~/kit-army-config/docs/adr-010-vision-aligned-engineering-invariants-2026-05-08.md`** — the canonical alignment doc. 13 platforms permanent, dual-shell coexistence, mobile-first, voice-as-API, BYOM via Windy Mind, no-stopwatch ethos. **READ THIS FIRST.**
2. **`~/kit-army-config/docs/adr-011-eternitas-universal-agent-identity-registry.md`** — Eternitas is an independent Utah LLC; treat the integration arms-length.
3. **`~/kit-army-config/docs/adr-012-windy-mobile-mvno-os-hardware.md`** — long-term Windy Mobile vision (deferred until ecosystem maturity).
4. **`~/kit-army-config/ACCESS_LOCKBOX.md`** — credentials lockbox (private repo). Source of truth for all secrets, AWS keys, API tokens, deploy commands.
5. **`~/.claude/projects/-Users-thewindstorm/memory/MEMORY.md`** — auto-loaded persistent memory. Index of all locked decisions across the ecosystem.

**Dev-name ↔ consumer-brand mapping (don't conflate):**
- `sneakyfree/windy-pro` = "Windy Word" (this hub product)
- `sneakyfree/windy-agent` = "Windy Fly" (the agent product)
- All other repos: 1:1 dev-name ↔ brand (windy-mail ↔ "Windy Mail" etc.)

**Sister repos in the ecosystem** (each is its own product surface):
- `windy-agent` — the AI agent brain (Windy Fly). Source for HiFly OSS fork (deferred).
- `windy-chat` — Matrix-based comms hub. Live at chat.windychat.ai.
- `windy-mail` — Stalwart email. Live at mail.windymail.ai.
- `WindyCloud` — file/document storage. DNS cutover from GoDaddy May 21.
- `Windy-Clone` — digital twin (voice + avatar + behavior).
- `windy-code` — VS Code soft-fork.
- `windy-call` / `windy-text` / `windy-cell` — telephony triad.
- `windy-search` — agent web-access toolkit (Platform 13).
- `windy-mind` — multi-model intelligence layer.
- `eternitas` + `eternitas-authenticator` — independent identity primitive + trust-anchor app.

When making cross-product engineering calls, default to **kit-army-config docs as canonical**. This repo's CLAUDE.md is product-specific (Wayland paste system, hotkey wiring, etc.) — the ecosystem-level decisions live in the ADRs above.

## Project Overview

Windy Pro is a voice-to-text desktop app (Electron + Python backend).
The user presses a global hotkey, speaks, and the transcribed text pastes
directly into whatever app had the cursor — editors, terminals, browsers, anything.

It is also the **hub product** of the Windy ecosystem — the Electron app + account-server + identity orchestration that ties all 13 platforms together via Eternitas-credentialed agent actions. See ecosystem context above.

## Critical: Read Before Touching These Areas

### Wayland Focus & Paste System (MUST READ)

**If you are about to modify ANY of the following, STOP and read
`docs/WAYLAND-PASTE-FOCUS-GUIDE.md` first:**

- Global hotkey registration (`registerHotkeys`, `registerGnomeKeybindings`)
- Recording toggle (`toggleRecording` in main.js or renderer/app.js)
- Auto-paste (`auto-paste-text` IPC handler)
- Clipboard operations (`clipboard.writeText`, `wl-copy`)
- Window focus/visibility (`setFocusable`, `setAlwaysOnTop`, `hide`, `blur`, `show`, `focus`)
- Media stream handling (`getUserMedia`, `MediaRecorder`, `AudioContext`)
- Platform detection (`platform-detect.js`)
- The Wayland control server (port 18765)
- `ydotool` / `xdotool` / paste injection
- `setFocusable(false)` calls

**Why this matters:** Getting paste-to-cursor working on Linux Wayland + GNOME required
solving 4 interlocking problems (keybinding parsing, focus stealing, clipboard isolation,
keystroke injection). Each fix is carefully gated behind `PLATFORM.isWayland` checks so it
doesn't affect macOS, Windows, or Linux X11. Breaking any one piece causes the cursor to
disappear or text to paste to the wrong place — and the bugs are extremely hard to diagnose
because they only manifest on Wayland with specific app combinations.

### Key Rules (Do Not Violate)

1. **NEVER call `mainWindow.show()`, `.focus()`, `.hide()`, `.blur()`, or `.setAlwaysOnTop()`
   during the recording or paste flow on Wayland.** Any of these cause XWayland to request
   focus from Mutter, stealing the cursor from the user's target app.

2. **NEVER call `navigator.mediaDevices.getUserMedia()` during recording start on Wayland.**
   Use the pre-warmed streams cached at app init. A fresh getUserMedia steals focus.

3. **NEVER use complex shell commands in GNOME keybinding registrations.**
   GNOME's `g_shell_parse_argv()` is NOT bash. Nested quotes break silently.
   Use plain `curl` commands only.

4. **NEVER use only `Ctrl+V` for paste on Linux.** Terminals require `Ctrl+Shift+V`.
   Always use `Ctrl+Shift+V` which works in both terminals and GUI apps.

5. **NEVER write only to Electron's clipboard on Wayland.** It only sets the X11 clipboard.
   Also write to the Wayland clipboard via `wl-copy` for Wayland-native apps.

6. **NEVER remove `setFocusable(false)` from `toggleRecording()`.** This is the core mechanism
   that prevents Electron from stealing Wayland focus during recording start AND stop.

7. **ALL Wayland-specific code MUST be gated behind `PLATFORM.isWayland` checks.**
   macOS, Windows, and Linux X11 have their own working code paths. Don't touch them
   when fixing Wayland issues.

8. **`org.gnome.Shell.Eval` does NOT work on GNOME 45+.** It returns `(false, '')`.
   Do not attempt to use it for focus detection or window activation.

### Platform Architecture Summary

| Platform | Hotkeys | Paste Injection | Clipboard |
|----------|---------|-----------------|-----------|
| macOS | Electron globalShortcut | osascript | Electron API |
| Windows | Electron globalShortcut | PowerShell SendKeys | Electron API |
| Linux X11 | Electron globalShortcut (X11 grabs) | xdotool Ctrl+V | Electron API |
| Linux Wayland+GNOME | GNOME keybindings -> curl -> control server | ydotool Ctrl+Shift+V | Electron + wl-copy |

### Common Mistakes That WILL Break Wayland (We Already Tried These)

These are approaches that seem logical but DO NOT WORK. They are documented in detail
in the "Dead Ends" section of `docs/WAYLAND-PASTE-FOCUS-GUIDE.md`. Do not retry them.

- **Using `org.gnome.Shell.Eval` for anything** — disabled on GNOME 45+, returns `(false, '')`
- **Using `xdotool getactivewindow` to find the focused window** — only sees XWayland windows, not Wayland-native apps
- **Using `mainWindow.blur()` to release focus** — generates X11 events that CAUSE focus changes
- **Using `mainWindow.hide()` during paste** — window disappears for seconds, terrible UX, focus doesn't transfer reliably
- **Using `mainWindow.setAlwaysOnTop(false)` during recording** — generates X11 property change events, Mutter may shift focus
- **Assuming `ydotool` works if `which ydotool` succeeds** — it needs a running ydotoold daemon AND write access to /dev/uinput
- **Editing the `ydotool` paste branch when `PLATFORM.pasteStrategy === 'xdotool'`** — check which branch actually runs on the target system
- **Pre-warming audio but not video** — the video getUserMedia also steals focus
- **Binding the app's `pasteTranscript` hotkey to Ctrl+Shift+V on Linux** — it collides with the Ctrl+Shift+V paste *strategies* (Mutter swallows the synthetic keystroke and routes it back to Windy), so the chain demotes to `ydotool_type`. Typing a multi-thousand-char transcript as raw uinput events overflows the focused client's Wayland event queue → GTK apps abort with `Error flushing display` → single-process terminals (Ptyxis) lose EVERY window at once. This killed all of Grant's terminals twice on 2026-07-12. Linux default is now **Ctrl+Alt+V** with a one-time migration (`migrateCollidingPasteHotkey()` in main.js); `ydotool_type` is also chunked (500 chars + 150ms drain pause) as a backstop. See the guide's "Incident: ydotool_type keystroke flood" section.

### Key Files

- `src/client/desktop/platform-detect.js` — all platform branching starts here
- `src/client/desktop/main.js` — hotkeys, control server, toggleRecording, auto-paste
- `src/client/desktop/renderer/app.js` — media pre-warming, recording start/stop
- `docs/WAYLAND-PASTE-FOCUS-GUIDE.md` — **THE comprehensive guide** (~700 lines). Contains:
  - Full problem/solution documentation for all 4 Wayland issues
  - 8 dead ends with explanations of why they fail
  - Copy-paste diagnostic commands for every component
  - Step-by-step chronological narrative of how the bugs were found and fixed
  - Testing checklist for all platforms
  - Debugging playbook organized by symptom

### Linux Wayland Machine Requirements

The app needs these for paste injection on Wayland:
- `ydotool` + `wl-clipboard` + `xdotool` installed
- `/dev/uinput` accessible (udev rule: `KERNEL=="uinput", GROUP="input", MODE="0660"`)
- User in `input` group
- The app starts its own `ydotoold` daemon automatically

## Build & Run

```bash
# Desktop (Electron)
npm install
npm run dev          # Dev mode
npm run start        # Production mode

# Python engine (transcription backend)
python -m src.engine.server --host 127.0.0.1 --port 9876

# Account server
cd account-server && npm install && npx tsx src/server.ts
```

## Testing

```bash
npm test                    # Python tests
npm run test:api            # Account server API tests
```

## Windy Admin telemetry (stress-test contract) — 2026-07-07

**There is ONE super-admin dashboard for the whole ecosystem at
`https://admin.windyword.ai`** (repo `sneakyfree/windy-admin`, ADR-WA-001).
Every platform PUSHES small content-free JSON events to its central ingest;
the dashboard reads them (Fleet / Members / Agents / Cost / Experiment /
Audit). **When you stress-test this platform, it is part of the job to prove
its activity shows up on that dashboard.** Missing telemetry is a GAP to
close, exactly like a bug — and each platform verifying its own telemetry in
parallel doubles as a load test of the panel.

**This repo:** LIVE — account-server emits funnel.signup_completed / funnel.email_verified / hatch.started / hatch.completed{duration_ms} / hatch.failed. Code: `account-server/src/services/admin-telemetry.ts`; env `WINDY_ADMIN_INGEST_URL` + `WINDY_ADMIN_INGEST_TOKEN` (token name `…__WINDY_PRO_HATCH`).

**Verify during your stress test** (read token `verify-oc5` in lockbox
`secrets/windy-admin/ingest-tokens.env`):
```bash
curl -s "https://admin.windyword.ai/v1/events/tail?limit=10&platform=windy-pro" \
  -H "Authorization: Bearer <verify-oc5>" | python3 -m json.tool
```
Drive real traffic, then confirm your events appear here AND on the dashboard
page they feed. If they don't, fix the emitter (or the aggregation query).

**Hard rules (non-negotiable):**
- **Fire-and-forget**: post async, short timeout, swallow every error. A dead
  ingest must NEVER break this product (proven: chat runs fine with the ingest
  down).
- **Inert unless configured**: no-op when `WINDY_ADMIN_INGEST_URL` /
  `WINDY_ADMIN_INGEST_TOKEN` are unset.
- **Privacy hard line**: counts / costs / durations / models / ids only. Cost
  is INTEGER microcents (10^-6 USD). The ingest 422s any metadata key whose
  camelCase/snake tokens match content/text/body/message/prompt/transcript/
  subject/html/completion/reply — if you get 422'd, FIX THE EVENT, never ask
  for the guard to be loosened.

**Full brief + per-platform table + how-to-instrument:**
`~/kit-army-config/docs/windy-admin-telemetry-campaign-2026-07-07.md`.

## CI: self-hosted runner (since 2026-07)
GitHub Actions runs on OUR runner (kit0-windy-pro on the Kit 0 VPS), not GitHub's cloud.
Always `runs-on: [self-hosted, linux, x64]` — NEVER `ubuntu-latest` (billing-locked; runner-lint enforces).
Jobs stuck "Queued" = runner down, not billing: ssh Kit 0 → cd /home/github-runner/runners/windy-pro && sudo ./svc.sh status
Full runbook: ~/kit-army-config/docs/ci-runner-runbook.md
