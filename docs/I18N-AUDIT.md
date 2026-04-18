# i18n Audit (P3) — Wizard + Main App

## State of the nation

- **Wizard:** `installer-v2/screens/wizard-i18n.json` has 139 keys
  across 10 locales (en/es/fr/zh/ar/pt/de/ja/ko/hi). All data-i18n
  attributes in `wizard.html` now resolve to real keys in every
  locale — enforced by `scripts/ci/check-i18n-coverage.sh`.

- **Main app renderer:** `src/client/desktop/renderer/index.html`
  + `app.js` have zero i18n wiring today. Hardcoded English everywhere.

## What shipped in P3

1. `scripts/ci/check-i18n-coverage.sh` — new CI gate with two
   assertions:
   - Every `data-i18n="foo.bar"` attribute in wizard.html has a key
     in the `en` locale (catches typos + added-without-register).
   - Every non-`en` locale contains exactly the same key set as
     `en` (catches locale drift — missing translations that fall
     back to English silently).

2. Added the missing `step.pairs` key to all 10 locales. This was
   the only drift — all 139 other keys were in sync.

3. Wired the check into `.github/workflows/ci.yml` →
   `test-installer` job.

## What's NOT yet covered

### Wizard (minor gaps)

The strings I added in session 1 & 2 phases (4/6/7/8 and P10) that
went into the wizard HTML verify-screen card and signup banner are
currently **hardcoded English** rather than going through i18n:

| Location | String | Status |
|---|---|---|
| Phase 4 verify card header | "🔐 Final check — make sure permissions actually work" | hardcoded |
| Mic card copy | "Click **Test Mic** and speak for one second…" | hardcoded |
| Accessibility card copy | "Required so Windy Word can paste…" | hardcoded |
| Paste card copy | "Detecting…", "Install paste tools", etc. | hardcoded |
| Hero card copy | "★ RECOMMENDED FOR YOUR MACHINE", "Use this →" | hardcoded |
| Signup banner | "Loved that?", "Save your sessions to the cloud…" | hardcoded |
| Error taxonomy user messages | WINDY-NNN user fields in errors.js | hardcoded |

**Why not fixed in this PR:** Translating ~40 new strings into 10
locales needs human translation review, not machine output. Filing
as a follow-up so native speakers on the team can do a proper pass.

**Workaround until then:** Every non-English user sees English for
these specific strings. The CI gate above ensures no EXISTING
translated string drifts — just new additions.

### Main app renderer

`src/client/desktop/renderer/app.js` and `index.html` have no
`data-i18n` attributes at all. A minimum-viable i18n pass would:

1. Extract every hardcoded string into a flat key/value file at
   `src/client/desktop/renderer/i18n.json`.
2. Add a loader module (same pattern as `wizard.html`'s i18n hydrator).
3. Gate the CI check against main-app strings too.

This is weeks of work and should be a dedicated priority, not
squeezed into the installer-bundling PR. Flagged as follow-up.

## For reviewers adding new wizard strings

1. Add a `data-i18n="section.key"` attribute to the element.
2. Add the English value to `installer-v2/screens/wizard-i18n.json`
   `en` dict.
3. Add translations to every other locale. If you don't speak that
   language, copy the English value for now AND add a TODO comment
   in the same PR tagging the translation-review owner.
4. Run `bash scripts/ci/check-i18n-coverage.sh` locally — must
   return `✓`.
5. The CI gate will fail if you forget any of the above.

## Cross-references

- `scripts/ci/check-i18n-coverage.sh` — the gate script
- `installer-v2/screens/wizard-i18n.json` — source of truth for
  wizard strings
- `installer-v2/screens/wizard.html` — data-i18n attributes +
  hydrator JS
