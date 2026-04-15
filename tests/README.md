# Test layout

Tests live in a flat `tests/` directory for historical reasons
(moving would cascade through `.github/workflows/ci.yml` references,
`pytest.ini`, and pair-download-manager internal paths). Category is
conveyed by filename prefix:

## Prefixes

| Prefix | Category | Runner | Purpose |
|---|---|---|---|
| `installer-*.test.js` | unit (node) | jest | Install path modules (bundled-assets, clean-slate, wizard-logger, errors, Windows paths) |
| `renderer-*.test.js` | unit (jsdom) | jest | Renderer-side modules extracted from app.js (signup-banner, transcript-format) |
| `lib-*.test.js` | unit (node) | jest | Pure library helpers under `src/client/desktop/lib/` (timeout) |
| `chat-*.test.js` / `pair-*.test.js` | unit (node) | jest | IPC registrar modules under `src/client/desktop/chat/` |
| `crash-summary.test.js` / `logger.test.js` | unit (node) | jest | Error + observability infrastructure |
| `wizard-main.*.test.js` | unit (node) | jest | Module-private helpers rebuilt locally for testing |
| `pair-download-manager.security.test.js` | security | jest | SEC-PAIR-1 (path traversal) regression pin |
| `chat-smoke.test.js` / `marketplace.test.js` / `ecosystem-smoke.test.js` / `model-protection.test.js` | smoke | jest | Legacy smoke tests; kept for coverage |
| `test_desktop_*.py` | structural | pytest | Source-level assertions (e.g. "main.js contains contextIsolation: true") |
| `test_engine_health.py` | unit (python) | pytest | `_health_payload` shape contract |
| `test_engine_integration.py` | integration | pytest | Spawns the engine, hits /health + WS health |
| `test_cloud_api.py`, `test_features.py`, etc. | integration | pytest | Historical integration runners |

## When adding a new test

1. Pick the prefix that matches the category.
2. Wire into `.github/workflows/ci.yml` under the right step:
   - Installer / wizard tests → `test-installer` job
   - Renderer jsdom tests → `Run renderer unit tests (P4)` step
   - Pytest → `test-backend` matrix
3. If the test hits the network, file system outside `tmpdir`, or
   needs secrets: make it an integration test and gate on CI-only.
4. Never commit a test that depends on a developer's absolute paths
   (e.g. `/Users/thewindstorm/...`) — use `mkdtemp` or an env-var
   override.

## Future: physical subdirectories

If the flat layout gets noisy (target: ≥50 files), migrate in one
dedicated PR:

```
tests/
  unit/
  integration/
  security/
  structural/
```

That PR needs to update:
- `.github/workflows/ci.yml` — every `tests/foo.test.js` path
- `pytest.ini` — `testpaths` directive
- `src/client/desktop/pair-download-manager.js` — the
  `testPathIgnorePatterns` it sets
- This README — drop in favor of per-subdir READMEs

The value isn't worth the blast radius until the signal-to-noise
drops. Flat + prefix conventions cover the need for now.
