# Merge Triage — Windy Pro (account-server + installer)

Snapshot: 2026-04-17. Wave 7 gap-analysis follow-ups shipped as PRs #14–#36
(all merged). Only TWO PRs remain open on this repo; both are PRE-Wave-7 and
both currently conflict with main because the Wave 7 sweep touched the files
they modify.

Total open PRs: **2**
Total cumulative diff: **+14,375 / −862** lines (14,144/−860 from #1, 231/−2 from #13).

## Bucket A — MERGE NOW (0 PRs)

None. Every trivial doc / comment / log fix from the sweep already landed via PRs #14–#36.

## Bucket B — SAFE WITH SMOKE (0 PRs)

None.

## Bucket C — HIGH RISK (2 PRs)

- **#13** — *Add eternitas_passport claim to JWT payload (Code issue #9)* — +231/−2 — touches `routes/auth.ts` + `routes/oauth.ts`, both JWT-minting paths. Adds a new `eternitas_passport` claim to every issued access token when the identity has an active passport. Classified high-risk because **every downstream consumer reads JWT claims**; a regression here silently breaks bot auth across the ecosystem. **Currently CONFLICTING with main** — auth.ts was modified in PRs #18, #20, #29, #30, #34, #36. Needs rebase + re-review before merge.

- **#1** — *Bulletproof installer: bundled Python+wheels architecture (Phase 1+2)* — +14,144/−860 — touches `src/client/desktop/*`, `scripts/*`, installer pipeline, bundling. User-visible install flow rework (ships Python + venv + ffmpeg + starter model INSIDE the app bundle instead of post-install downloading). Classified high-risk because of **size alone** (14k-line PR) and because install is the single most common path for new-user failure. **Currently CONFLICTING with main**. Needs rebase + manual install eyeball test on macOS + Windows + Linux X11 + Linux Wayland per `docs/WAYLAND-PASTE-FOCUS-GUIDE.md` rules.

## Bucket D — BLOCKED ON GRANT (0 PRs)

None. Both open PRs are code-ready in principle; neither needs a Grant decision before merge.

## Bucket E — DEFER (0 PRs)

None.

---

## TOP 3 MUST-MERGE BEFORE LAUNCH

Only 2 PRs in queue, listed in order of user-pain blast radius:

1. **#1 — Bulletproof installer** — Without this, new users hitting the installer see pre-Wave-0 behaviour: post-install Python downloads that fail on restricted networks, version-mismatch bugs with system Python, `ffmpeg` not found, starter model absent. The whole "Grant's normie-first mandate" (see `feedback_normie_first.md`) fails at step 0 if install doesn't "just work" from a single bundle. This is the single-largest gate between "Windy Pro is a toy" and "Windy Pro is a product."

2. **#13 — JWT eternitas_passport claim** — Without this, Pink-center cannot remove the `WINDY_DEV_PASSPORT` scaffold from windy-code's `agentBusServer`. Every real-passport auth attempt currently falls through to the dev scaffold. Shipping any bot/agent flow to production users leaves the scaffold exposed, which at best is an embarrassing log line and at worst is a cross-tenant auth hole if someone figures out how to assert `WINDY_DEV_PASSPORT`. Cross-repo blocker.

3. *(no third — queue is empty)*

---

## Context for tomorrow's batch-merge

- **All Wave 7 P0/P1 work is on main.** GAP_ANALYSIS.md in `docs/` still accurately describes what was found; closure status is implicit in the #15–#36 PR titles.
- **Both open PRs will need rebase.** Main moved substantially while they sat. Rebase #13 first — it's the smaller, cleaner diff and verifies the rebase path before attempting the 14k-line #1.
- **#1 needs real GUI smoke, not just test suite.** The programmatic install-test in `account-server/MANUAL_TEST.md` is not a substitute for launching the built installer on a clean macOS VM and clicking through the 9-screen wizard.
