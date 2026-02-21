# Gap Closure Report

**Sprint**: P0 Gap-Closure · **Date**: February 2026

## Summary

| Gap | Status | Files Changed |
|-----|--------|--------------|
| A: Editable transcript | ✅ Fixed | `styles.css`, `app.js` |
| B: Clear-after-paste | ✅ Fixed | `app.js` |
| C: Version display | ✅ Fixed | `main.js`, `preload.js`, `settings.js` |
| D: Linux launcher | ✅ Fixed | `package.json`, `verify-linux-install.sh` |
| E: Regression tests | ✅ Added | `test_desktop_gaps.py` |

## Changes Detail

### A: Editable Transcript Post-Stop
- **Root cause**: `user-select: none` on `body` globally disabled text selection in the transcript area.
- **Fix**: Added `user-select: text` on `.transcript-content`. Added `contentEditable = 'true'` on stop, `'false'` on start/clear. `getFullTranscript()` reads from DOM `textContent` when user has edited.
- **Safety**: `contentEditable` is locked to `false` during recording to prevent cursor interference.

### B: Clear-After-Paste Reliability
- **Root cause**: Paste logic existed but lacked explicit state boundary resets.
- **Fix**: Both clear and gray modes now reset `contentEditable` to `false` and call `updateWordCount()`. Paste = session boundary.

### C: Dynamic Version Display
- **Root cause**: Settings panel hardcoded `v0.1.0` instead of reading from package metadata.
- **Fix**: Added IPC bridge `get-app-version` → `app.getVersion()` in main.js, exposed via `preload.js`, consumed in `settings.js loadSettings()`.

### D: Linux Launcher Hardening
- **Root cause**: No desktop entry customization meant default `Exec=` lacked quoting.
- **Fix**: Added `desktop` config in `package.json` with `Exec` = `"windy-pro" %U` (quoted). Added `StartupWMClass`, proper categories. Created `scripts/verify-linux-install.sh`.

### E: Regression Tests
- 18 tests in `tests/test_desktop_gaps.py` covering all gaps.

## Test Evidence
```
18 passed in 0.07s
```

## Remaining Risks
- P1 "Model Edit" button not yet implemented (post-P0 follow-on).
- Electron runtime integration testing requires desktop environment.
