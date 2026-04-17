# Wave 4 wizard Complete-screen eyeball test

**Goal:** confirm screen-9's "Your Windy Ecosystem" section flips its three rows (📫 Mailbox / 💬 Chat handle / ☁️ Cloud quota) from `—` to `✓` within 4 seconds of reaching the screen.

**Why this is a manual test (and not run from a shell):** the wizard requires interactive form input (email, password, model selection) across nine screens before it ever reaches the Complete screen. A shell-driven agent can launch the wizard but can't drive the GUI to a specific state without a Playwright/Spectron harness — which we don't have wired up yet. The programmatic equivalent that proves the SAME data lands in `<4s` is `tests/e2e/test_wizard_complete_flow.py` and runs green as of this commit.

---

## One-shot setup

```sh
# Terminal A — account-server
cd /Users/thewindstorm/windy-pro/account-server
NODE_ENV=development npx tsx src/server.ts
# Wait for: "Account server listening on :8098"
```

```sh
# Terminal B — wizard
cd /Users/thewindstorm/windy-pro
# Optional: nuke prior install state so you start fresh
rm -rf ~/.windy-pro/account.json
npx electron installer-v2/test-wizard.js --real
```

The wizard window appears (it may open behind your active window on macOS — `Cmd-Tab` to it).

---

## Walkthrough (≈ 90 seconds)

| # | Screen | Action |
|---|---|---|
| 0 | Welcome | Click **Get Started** |
| 1 | Hardware scan | Wait for the scan, click **Continue** |
| 2 | Account | Click the **✨ Create Account** card. Fill name/email/password (any valid email; password must be ≥8 chars with upper, lower, digit). Click **Create Account →** — wait for the success banner. Click **Continue →** |
| 3 | Languages | Pick at least one. Click **Continue** |
| 4 | (intermediate) | If shown, accept defaults |
| 5 | Models | Accept the recommended set or pick a small one (e.g. `edge-spark` — only ~42 MB, fastest install). Click **Continue** |
| 6 | (intermediate) | Accept |
| 7 | (intermediate) | Accept |
| 8 | Install | Click **Install**. Wait through download + extraction. **In dev with bundled assets present this is ~30s; with downloads it can be 1–3 minutes.** |
| 9 | **Complete** | **This is the one to screenshot.** |

---

## What to look for on screen 9

Within ~4 seconds of the screen rendering:

- A new card titled **"YOUR WINDY ECOSYSTEM"** appears between the model tags and the "shortcuts" grid.
- It contains three rows:

  | Row | Expected text | Expected status dot |
  |---|---|---|
  | 📫 Mailbox | `<your-email-localpart>@windy.mail` (or `Provisioning…`) | green ✓ if Windy Mail receiver is up; amber `…` while pending; gray `—` if mail provisioning failed |
  | 💬 Chat handle | A `@windy_xxx:chat.windypro.com`-style handle (or `Provisioning…`) | green ✓ once chat profile lands |
  | ☁️ Cloud quota | `500.0 MB free` | green ✓ — set synchronously inside register, should never be `…` |

- **Pass criteria:** all three rows show **either ✓ (green) or `…` (amber)** — never `—` (gray) unless the corresponding consumer service is genuinely offline.
- If anything starts as `…`, it should flip to `✓` on the next poll (2s later) once provisioning settles.

---

## Capture

Save 3 screenshots into this directory (`docs/wizard-screenshots/wave4/`):

| File | Moment |
|---|---|
| `01-screen-9-first-render.png` | Right after the screen appears (before the 2s poll). The "Your Windy Ecosystem" card is hidden — this is the baseline. |
| `02-screen-9-after-2s.png` | ~2.5s after the screen appears. The ecosystem card is visible with status dots. |
| `03-screen-9-after-poll-retry.png` | ~5s after the screen appears. Any `…` rows should have flipped to `✓`. |

macOS shortcut: `Cmd-Shift-4` then click on the wizard window. Save into this directory using a kebab-case name above.

---

## Cleanup

```sh
# Stop both terminals (Ctrl-C). Optional clean state:
rm -rf ~/.windy-pro/                                 # full reset
rm -f /Users/thewindstorm/windy-pro/account-server/accounts.db   # reset server DB
```

---

## What the agent verified without GUI access

`tests/e2e/test_wizard_complete_flow.py` — boots the same account-server the wizard talks to, registers a user, waits the same 2s the wizard's `loadProvisioningStatus()` waits, calls `/api/v1/identity/me`, and asserts:

1. The total wall-clock time from `POST /register` to `GET /identity/me` is **under 4 seconds** (the user-visible budget).
2. The cloud row would render as **✓** (storage_limit > 0).
3. The chat row would render as **✓** or **…** (never `—` in the happy path).
4. The mail row may be `—` when `WINDY_MAIL_URL` isn't configured — that maps to "Unavailable" on screen, which is correct UX.

Plus a structural check that `installer-v2/core/account-manager.js` still exposes `getIdentity()` and still calls `/api/v1/identity/me` (guards against a future refactor silently breaking the wizard polling).

When a Playwright/Spectron harness is added, this manual test should be ported to it and screenshots captured automatically.
