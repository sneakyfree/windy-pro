# Merge Triage — Windy Pro (account-server + installer)

Snapshot: 2026-04-18. Queue fully drained. Both previously-open PRs (#1, #13)
rebased and squash-merged against current main.

Total open PRs: **0**

## Bucket A — MERGE NOW (0 PRs)
## Bucket B — SAFE WITH SMOKE (0 PRs)
## Bucket C — HIGH RISK (0 PRs)
## Bucket D — BLOCKED ON GRANT (0 PRs)
## Bucket E — DEFER (0 PRs)

---

## TOP MUST-MERGE BEFORE LAUNCH — DONE

1. **#1 — Bulletproof installer** — merged as `9d94638` on 2026-04-18. Install flow now ships Python + venv + ffmpeg + starter model bundled; no post-install network download required.
2. **#13 — JWT `eternitas_passport` claim** — merged as `a3eecb4` on 2026-04-18. Both `/api/v1/auth/login` and `/api/v1/oauth/token` now embed `eternitas_passport` when the identity has an active passport. Pink-center unblocked to delete `WINDY_DEV_PASSPORT` scaffold.

## Merge notes (for forensics if anything regresses)

- **#13 rebase**: auto-merged `routes/auth.ts`, `routes/oauth.ts`, `webhook-bus.ts`. One trivial comment-wording conflict in `tests/email-verification.test.ts`. Dedicated claim-test needed `jest.setTimeout(30000)` on bcrypt paths — folded into the rebased commit via `--amend`. 8/8 claim tests + 559/559 full suite green.
- **#1 squash-merge via `git merge origin/main`** (chose over serial 61-commit rebase since target was squash anyway — flattens 61 replays into a single conflict pass). Two conflicts: `tests/api.test.ts` dropped main's duplicative `/health` assertions in favour of HEAD's superset; `installer-v2/screens/wizard.html` kept HEAD's intentional Phase 4 verify-screen routing instead of main's older `loadProvisioningStatus` 2s-head-start flow. PR was in draft state — marked ready, merged squash.
- **559/559 tests green** on both merges.

## Remaining gap-analysis work (not PRs — future waves)

Tracked in `docs/GAP_ANALYSIS.md`. Not in the merge queue because there's
nothing to merge yet — these are future implementation tasks:

- **P2-1** MFA backup-code bcrypt rounds (30 min)
- **P2-2** `PATCH /auth/me/email` pre-verification (1 hr)
- **P2-5** Unify `otp_codes` and Redis-OTP flows (half day)
- **P2-6** `pending_provisions` pruner (30 min — mirrors P1-10 pattern)
- **P2-4** Terraform output doc for HTTP→HTTPS redirect (5 min)
- **P3-1** Deploy `.env` → 1Password / Keychain migration
- **P3-3** JWKS key rotation production schedule
- **P3-4** `services/r2-adapter.ts` at 8.1% coverage — needs real test

## GUI verification reminder

`#1` was merged on test-suite + programmatic verification alone. Before
cutting a release, someone must launch the built installer on a clean
macOS VM and click through all 9 screens of the wizard, verifying Phase 4
permission checks and Phase 6 Linux paste-tool install per
`docs/WAYLAND-PASTE-FOCUS-GUIDE.md`.
