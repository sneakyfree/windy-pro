# Windy Pro Desktop App (Electron) - IPC Audit

**Audit Date:** 2026-03-31
**Files Audited:**
- `src/client/desktop/main.js` (~5900 lines)
- `src/client/desktop/preload.js` (228 lines)
- Separate preloads: `mini-preload.js`, `mini-translate-preload.js`, `chat/chat-preload.js`, `renderer/video-preload.js`

---

## 1. Summary

| Metric | Count |
|--------|-------|
| `ipcMain.handle()` handlers | **95** |
| `ipcMain.on()` handlers | **24** |
| Total IPC handlers | **119** |
| Preload `invoke()` calls | **80** |
| Preload `send()` calls | **14** |
| Preload `safeOn()` listeners | **22** |
| Channel mismatches (preload vs main) | **0** |
| Orphaned main.js handlers (no preload exposure) | **~30** (chat/video/mini — served by separate preloads, expected) |
| Missing error handling | **7 findings** |
| Security issues | **4 findings** |
| Potential crash vectors | **5 findings** |
| API endpoint concerns | **2 findings** |
| Logic bugs | **3 findings** |

---

## 2. Channel Cross-Reference (preload.js vs main.js)

Every channel in `preload.js` has a matching handler in `main.js`. No spelling mismatches found. Full table:

| Preload Function | Channel | Type | main.js Handler | Args Match |
|-----------------|---------|------|-----------------|------------|
| `minimize` | `minimize-window` | send | `ipcMain.on` L4767 | YES |
| `maximize` | `maximize-window` | send | `ipcMain.on` L4772 | YES |
| `unmaximize` | `unmaximize-window` | send | `ipcMain.on` L4775 | YES |
| `isMaximized` | `is-maximized` | invoke | `ipcMain.handle` L4778 | YES |
| `getSettings` | `get-settings` | invoke | `ipcMain.handle` L2596 | YES |
| `updateSettings` | `update-settings` | send | `ipcMain.on` L2557 | YES |
| `rebindHotkey` | `rebind-hotkey` | invoke | `ipcMain.handle` L2464 | YES |
| `getServerConfig` | `get-server-config` | invoke | `ipcMain.handle` L4762 | YES |
| `chooseArchiveFolder` | `choose-archive-folder` | invoke | `ipcMain.handle` L2647 | YES |
| `archiveTranscript` | `archive-transcript` | send | `ipcMain.on` L3227 | YES |
| `archiveAudio` | `archive-audio` | invoke | `ipcMain.handle` L3311 | YES |
| `archiveVideo` | `archive-video` | invoke | `ipcMain.handle` L3333 | YES |
| `readArchiveAudio` | `read-archive-audio` | invoke | `ipcMain.handle` L3354 | YES |
| `readArchiveVideo` | `read-archive-video` | invoke | `ipcMain.handle` L3374 | YES |
| `openArchiveFolder` | `open-archive-folder` | send | `ipcMain.on` L2714 | YES |
| `getArchiveHistory` | `get-archive-history` | invoke | `ipcMain.handle` L2977 | YES |
| `deleteArchiveEntry` | `delete-archive-entry` | invoke | `ipcMain.handle` L3134 | YES |
| `getArchiveStats` | `get-archive-stats` | invoke | `ipcMain.handle` L3398 | YES |
| `batchTranscribeLocal` | `batch-transcribe-local` | invoke | `ipcMain.handle` L2836 | YES |
| `autoPasteText` | `auto-paste-text` | invoke | `ipcMain.handle` L2927 | YES |
| `sendVoiceLevel` | `voice-level` | send | `ipcMain.on` L1130 | YES |
| `sendTranscriptForPaste` | `transcript-for-paste` | send | `ipcMain.on` L2518 | YES |
| `notifyBatchComplete` | `batch-complete` | send | `ipcMain.on` L4951 | YES |
| `notifyBatchProcessing` | `batch-processing` | send | `ipcMain.on` L4975 | YES |
| `notifyRecordingFailed` | `recording-failed` | send | `ipcMain.on` L4982 | YES |
| `showVideoPreview` | `show-video-preview` | invoke | `ipcMain.handle` L1237 | YES |
| `hideVideoPreview` | `hide-video-preview` | invoke | `ipcMain.handle` L1259 | YES |
| `sendVideoFrame` | `video-frame-to-preview` | send | `ipcMain.on` L1245 | YES |
| `sendRecordingState` | `recording-state-to-preview` | send | `ipcMain.on` L1252 | YES |
| `getFontSize` | `get-font-size` | invoke | `ipcMain.handle` L1374 | YES |
| `setFontSize` | `set-font-size` | invoke | `ipcMain.handle` L1378 | YES |
| `openExternalUrl` | `open-external-url` | invoke | `ipcMain.handle` L2725 | YES |
| `openCheckoutUrl` | `open-checkout-url` | invoke | `ipcMain.handle` L3821 | YES |
| `copyToClipboard` | `copy-to-clipboard` | invoke | `ipcMain.handle` L2720 | YES |
| `saveFile` | `save-file` | invoke | `ipcMain.handle` L4991 | YES |
| `checkInjectionPermissions` | `check-injection-permissions` | invoke | `ipcMain.handle` L2552 | YES |
| `checkCrashRecovery` | `check-crash-recovery` | invoke | `ipcMain.handle` L5012 | YES |
| `dismissCrashRecovery` | `dismiss-crash-recovery` | invoke | `ipcMain.handle` L5025 | YES |
| `getAppVersion` | `get-app-version` | invoke | `ipcMain.handle` L2593 | YES |
| `checkForUpdates` | `check-for-updates` | invoke | `ipcMain.handle` L5220 | YES |
| `installUpdate` | `install-update` | invoke | `ipcMain.handle` L5003 | YES |
| `installDebUpdate` | `install-deb-update` | invoke | `ipcMain.handle` L5229 | YES |
| `updateTornadoSize` | `update-tornado-size` | send | `ipcMain.on` L1141 | YES |
| `updateWidget` | `update-widget` | send | `ipcMain.on` L1153 | YES |
| `identifySong` | `identify-song` | invoke | `ipcMain.handle` L4811 | YES |
| `checkFpcalc` | `check-fpcalc` | invoke | `ipcMain.handle` L4788 | YES |
| `translateOffline` | `translate-offline` | invoke | `ipcMain.handle` L4696 | YES |
| `translateText` | `translate-text` | invoke | `ipcMain.handle` L4615 | YES |
| `openMiniTranslate` | `open-mini-translate` | send | `ipcMain.on` L1430 | YES |
| `exportSoulFile` | `export-soul-file` | invoke | `ipcMain.handle` L3456 | YES |
| `exportVoiceClone` | `export-voice-clone` | invoke | `ipcMain.handle` L3523 | YES |
| `createCheckoutSession` | `create-checkout-session` | invoke | `ipcMain.handle` L3787 | YES |
| `checkPaymentStatus` | `check-payment-status` | invoke | `ipcMain.handle` L4139 | YES |
| `getCurrentTier` | `get-current-tier` | invoke | `ipcMain.handle` L4188 | YES |
| `getStripeConfig` | `get-stripe-config` | invoke | `ipcMain.handle` L4197 | YES |
| `applyCoupon` | `apply-coupon` | invoke | `ipcMain.handle` L4737 | YES |
| `openBillingPortal` | `open-billing-portal` | invoke | `ipcMain.handle` L4218 | YES |
| `checkModelStatus` | `check-model-status` | invoke | `ipcMain.handle` L4347 | YES |
| `downloadModels` | `download-models` | invoke | `ipcMain.handle` L4430 | YES |
| `showDownloadWizard` | `show-download-wizard` | invoke | `ipcMain.handle` L4609 | YES |
| `validateLicense` | `validate-license` | invoke | `ipcMain.handle` L4311 | YES |
| `getWizardState` | `get-wizard-state` | invoke | `ipcMain.handle` L3619 | YES |
| `setWizardState` | `set-wizard-state` | invoke | `ipcMain.handle` L3623 | YES |
| `detectHardware` | `detect-hardware` | invoke | `ipcMain.handle` L3629 | YES |
| `registerWizardAccount` | `register-wizard-account` | invoke | `ipcMain.handle` L3709 | YES |
| `setupAutostart` | `setup-autostart` | invoke | `ipcMain.handle` L3756 | YES |
| `saveTranslationMemory` | `save-translation-memory` | invoke | `ipcMain.handle` L5375 | YES |
| `lookupTranslationMemory` | `lookup-translation-memory` | invoke | `ipcMain.handle` L5395 | YES |
| `getTranslationMemoryStats` | `get-translation-memory-stats` | invoke | `ipcMain.handle` L5405 | YES |
| `clearTranslationMemory` | `clear-translation-memory` | invoke | `ipcMain.handle` L5416 | YES |
| `getVoiceClones` | `get-voice-clones` | invoke | `ipcMain.handle` L5441 | YES |
| `createVoiceClone` | `create-voice-clone` | invoke | `ipcMain.handle` L5443 | YES |
| `deleteVoiceClone` | `delete-voice-clone` | invoke | `ipcMain.handle` L5455 | YES |
| `setActiveVoiceClone` | `set-active-voice-clone` | invoke | `ipcMain.handle` L5470 | YES |
| `previewVoiceClone` | `preview-voice-clone` | invoke | `ipcMain.handle` L5477 | YES |
| `uploadVoiceCloneFile` | `upload-voice-clone-file` | invoke | `ipcMain.handle` L5485 | YES |
| `extractDocumentText` | `extract-document-text` | invoke | `ipcMain.handle` L5506 | YES |
| `browseDocumentFile` | `browse-document-file` | invoke | `ipcMain.handle` L5539 | YES |
| `saveCloneBundle` | `save-clone-bundle` | invoke | `ipcMain.handle` L5570 | YES |
| `getCloneBundles` | `get-clone-bundles` | invoke | `ipcMain.handle` L5600 | YES |
| `deleteCloneBundle` | `delete-clone-bundle` | invoke | `ipcMain.handle` L5602 | YES |
| `playCloneBundle` | `play-clone-bundle` | invoke | `ipcMain.handle` L5616 | YES |
| `exportCloneBundles` | `export-clone-bundles` | invoke | `ipcMain.handle` L5624 | YES |
| `startCloneTraining` | `start-clone-training` | invoke | `ipcMain.handle` L5649 | YES |
| `getSyncState` | `get-sync-state` | invoke | `ipcMain.handle` L5669 | YES |
| `saveSyncState` | `save-sync-state` | invoke | `ipcMain.handle` L5676 | YES |
| `fetchRemoteBundles` | `fetch-remote-bundles` | invoke | `ipcMain.handle` L5684 | YES |
| `downloadRemoteBundle` | `download-remote-bundle` | invoke | `ipcMain.handle` L5723 | YES |
| `uploadBundleToCloud` | `upload-bundle-to-cloud` | invoke | `ipcMain.handle` L5750 | YES |
| `showSyncNotification` | `show-sync-notification` | invoke | `ipcMain.handle` L5809 | YES |
| `getStorageStats` | `get-storage-stats` | invoke | `ipcMain.handle` L5817 | YES |
| `deleteLocalBundleCopy` | `delete-local-bundle-copy` | invoke | `ipcMain.handle` L5871 | YES |
| `pairCatalog` | `pair-catalog` | invoke | `ipcMain.handle` L2010 | YES |
| `pairBundles` | `pair-bundles` | invoke | `ipcMain.handle` L2022 | YES |
| `pairDownload` | `pair-download` | invoke | `ipcMain.handle` L2034 | YES |
| `pairDownloadBundle` | `pair-download-bundle` | invoke | `ipcMain.handle` L2047 | YES |
| `pairCancel` | `pair-cancel` | invoke | `ipcMain.handle` L2060 | YES |
| `pairDelete` | `pair-delete` | invoke | `ipcMain.handle` L2068 | YES |
| `pairListDownloaded` | `pair-list-downloaded` | invoke | `ipcMain.handle` L2076 | YES |
| `pairStorageInfo` | `pair-storage-info` | invoke | `ipcMain.handle` L2084 | YES |
| `setApiKey` | `set-api-key` | invoke | `ipcMain.handle` L2606 | YES |
| `getApiKey` | `get-api-key` | invoke | `ipcMain.handle` L2630 | YES |
| `dismissWelcome` | `dismiss-welcome` | invoke | `ipcMain.handle` L5147 | YES |

---

## 3. FINDINGS: Missing Error Handling

### F1 -- `check-injection-permissions` has no try/catch (L2552)

```js
ipcMain.handle('check-injection-permissions', async () => {
  return getInjector().checkPermissions();
});
```

If `getInjector()` throws (e.g. missing `./injection/injector` module on some platform), or `checkPermissions()` rejects, the unhandled rejection propagates to the renderer as a generic error. Should be wrapped in try/catch returning a structured `{ ok, error }` response.

**Severity:** Medium -- can crash the renderer's await call with an opaque error.

### F2 -- `get-archive-history` has no outer try/catch on the handler itself (L2977)

The handler has inner try/catch blocks per entry, but the `readdirSync` / `statSync` calls at the directory level (L2995-2999) can throw if the archive directory is corrupted or on a disconnected network drive. The handler does have a top-level catch at L3126, so this is actually OK on review. **Downgraded to informational.**

### F3 -- `clear-translation-memory` returns undefined on success (L5416)

```js
ipcMain.handle('clear-translation-memory', async () => {
  const db = getTMDb();
  if (!db) return;
  try { db.prepare('DELETE FROM translations').run(); } catch { }
});
```

Returns `undefined` on both success and failure. The renderer has no way to know if the operation succeeded. Should return `{ success: true }` or `{ success: false }`.

**Severity:** Low -- UX issue only.

### F4 -- `save-file` handler has no try/catch around `fs.writeFileSync` (L4991)

```js
ipcMain.handle('save-file', async (event, { content, defaultName, defaultPath: dp, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, { ... });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf8');  // Can throw!
    return { ok: true, saved: true, path: result.filePath };
  }
  return { ok: false, saved: false };
});
```

If the user picks a read-only path or disk is full, `writeFileSync` throws and the error propagates as an unhandled rejection to the renderer.

**Severity:** Medium.

### F5 -- `install-update` references `updaterInstance` from closure scope but it is defined inside a `setTimeout` (L5003 vs L5155)

```js
ipcMain.handle('install-update', async () => {
  if (updaterInstance) { ... }
});
// ...
setTimeout(() => {
  let updaterInstance = null;  // <-- scoped inside setTimeout callback
}, 3000);
```

The `ipcMain.handle` at L5003 references a *different* `updaterInstance` than the one declared at L5155. The one at L5003 sees the module-level scope, which does NOT have `updaterInstance`. The `let updaterInstance` at L5155 is local to the setTimeout callback. This means `install-update` and `check-for-updates` will ALWAYS return `{ ok: false, error: 'Updater not available' }`.

**Severity: HIGH -- install-update and check-for-updates are broken.** The updater never works because of a scoping bug. The `let updaterInstance = null` on L5155 shadows any module-level variable, and L5003's handler sees the module scope where no such variable was declared (it will be `undefined`).

### F6 -- `transcript-for-paste` uses `ipcMain.on` with async callback (L2518)

```js
ipcMain.on('transcript-for-paste', async (event, transcript) => {
  // ... await getInjector().inject(transcript);
});
```

`ipcMain.on` does not handle promise rejections from async callbacks. If `getInjector().inject()` throws outside the try/catch, or if the `new Promise` for the 200ms delay rejects, it becomes an unhandled rejection. The inner try/catch covers `inject()`, but the outer `await new Promise(resolve => setTimeout(resolve, 200))` could still fail in edge cases. Low practical risk since `setTimeout` callbacks rarely fail, but the pattern is incorrect.

**Severity:** Low.

### F7 -- `archive-transcript` uses `ipcMain.on` with async callback (L3227)

Same pattern as F6. However this handler has a top-level try/catch, so it is properly guarded. **Downgraded to informational.**

---

## 4. FINDINGS: Security Issues

### S1 -- `browse-document-file` reads binary files as UTF-8 (L5539)

```js
ipcMain.handle('browse-document-file', async () => {
  // ...
  const text = fs.readFileSync(filePath, 'utf8');  // BUG: PDF and DOCX are binary!
  return { text, name: path.basename(filePath) };
});
```

The file picker allows PDF and DOCX, but the handler reads ALL files as UTF-8 text. For binary files (PDF, DOCX), this returns garbled data and may corrupt the renderer's state. The separate `extract-document-text` handler exists for proper extraction, but `browse-document-file` bypasses it entirely.

**Severity:** Medium -- data corruption bug, not a security hole per se.

### S2 -- No path traversal guard on `read-archive-audio` / `read-archive-video` symlinks

The handlers at L3354 and L3374 use `path.resolve()` and check `startsWith()`, which is correct for basic traversal. However, they do NOT resolve symlinks. A malicious actor who can write a symlink inside the archive folder can read arbitrary files on disk.

**Severity:** Low -- requires local write access to the archive directory, which implies compromise already.

### S3 -- `open-external-url` blocks `http:` protocol (L2725) but `isSafeURL()` allows it (L74)

The `open-external-url` handler explicitly blocks non-https/mailto URLs at L2730. However, the fallback `shell.openExternal` call at L2817 and L2828 uses `isSafeURL()` which allows `http:` protocol. This is inconsistent: the explicit URL check is stricter than the `isSafeURL()` guard. Non-TLS URLs could theoretically reach `shell.openExternal` via the xdg-open fallback path on Linux (which doesn't go through the validation).

Actually on review, the xdg-open path at L2806 passes `url` directly, and that `url` already passed the https/mailto check at L2730. So this is safe in practice. **Downgraded to informational.**

### S4 -- `register-wizard-account` sends plaintext password over HTTPS (L3709)

The handler sends `{ email, password, name }` over HTTPS to `windypro.thewindstorm.uk`. While HTTPS provides transport encryption, the password is stored encrypted locally via safeStorage but travels in plaintext inside the JSON body. This is standard practice for registration APIs but worth noting.

**Severity:** Informational.

### S5 -- `batch-transcribe-local` constructs Python script with string interpolation (L2898)

```js
const scriptContent = [
  'from faster_whisper import WhisperModel',
  `model = WhisperModel(${modelRef}, device="cpu", compute_type="int8")`,
  `segments, info = model.transcribe("${wavPath.replace(/\\/g, '/')}", ...)`,
  // ...
].join('\n');
```

Both `modelRef` and `wavPath` are interpolated into a Python script. `wavPath` is constructed from `os.tmpdir()` + fixed filename, so it's safe. `modelRef` comes from either a model name (alphanumeric) or a local directory path. However, if the model name in `store.get('engine.model')` were ever set to a malicious value (e.g. via a compromised settings file), it could inject arbitrary Python code.

**Severity:** Low -- requires local settings file compromise.

---

## 5. FINDINGS: Potential Crash Vectors

### C1 -- `updaterInstance` scoping bug (DUPLICATE OF F5)

The `install-update` and `check-for-updates` handlers silently fail (return error response) rather than crash, so this is a broken-feature bug, not a crash vector.

### C2 -- `get-archive-stats` has no protection against massive archive directories

The handler at L3398 reads every file in every date directory, including reading the full contents of every `.md` file. An archive with thousands of entries would block the main process for seconds. The 30-second cache helps on repeated calls but the first call is unbounded.

**Severity:** Medium -- can freeze the app on large archives.

### C3 -- `export-soul-file` and `export-voice-clone` use synchronous fs operations (L3456, L3523)

Both handlers use `readdirSync`, `readFileSync`, `statSync` in loops. On large archives, these block the main process. For archives with hundreds of files, this can trigger Electron's "page unresponsive" dialog.

**Severity:** Medium.

### C4 -- `download-models` handler has no concurrency limit (L4430)

The handler loops through `modelNames` sequentially (which is fine), but there is no validation on the length of `modelNames`. A renderer bug could pass hundreds of model names, causing downloads to run for hours.

**Severity:** Low.

### C5 -- `start-clone-training` uses `ipcMain.emit()` incorrectly (L5661)

```js
return ipcMain.emit('export-clone-bundles-redirect', event, bundleIds);
```

`ipcMain.emit()` is used to try to redirect to the export handler, but there is no `ipcMain.on('export-clone-bundles-redirect', ...)` handler registered anywhere. This call returns `false` (no listeners) and the renderer gets `false` as the return value instead of a meaningful response.

**Severity:** Medium -- broken feature.

---

## 6. FINDINGS: Logic Bugs

### L1 -- `browse-document-file` reads PDF/DOCX as UTF-8 (DUPLICATE OF S1)

When the user picks a PDF or DOCX file, the handler reads it as `utf8`, returning garbled text. The `extract-document-text` handler exists but is not called by `browse-document-file`. The renderer must call both `browse-document-file` (for file picker) and `extract-document-text` (for extraction) separately, or the handler should detect binary formats and route to extraction.

### L2 -- `open-checkout-url` uses `require('../../package.json').version` (L3508)

Inside `export-soul-file`, the manifest references:
```js
appVersion: require('../../package.json').version || '1.6.1',
```

The relative path `../../package.json` from `src/client/desktop/main.js` resolves to `src/package.json` which does not exist. The correct path is `../../../package.json` or better, use `app.getVersion()`. The `|| '1.6.1'` fallback masks this bug.

**Severity:** Low -- hardcoded fallback hides the bug.

### L3 -- `onPairDownloadProgress` calls `removeAllListeners` in preload (L220)

```js
onPairDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('pair-download-progress');
    safeOn('pair-download-progress', (event, data) => callback(data));
},
```

This removes all listeners before adding a new one, which prevents listener leaks. However, it bypasses the `safeOn` channel validation for the removal -- `removeAllListeners` operates directly on `ipcRenderer`. This is functionally correct but inconsistent with the security model.

**Severity:** Informational.

---

## 7. FINDINGS: Orphaned Handlers (main.js handlers with no preload exposure)

These handlers exist in `main.js` but are NOT exposed in `preload.js`. They are likely served by the separate preload files for their respective windows:

| Channel | Expected Preload |
|---------|-----------------|
| `mini-expand` | `mini-preload.js` |
| `mini-move` | `mini-preload.js` |
| `open-windy-chat` | `chat/chat-preload.js` |
| `chat-login` through `chat-translate-text` (20 handlers) | `chat/chat-preload.js` |
| `mini-translate-close` | `mini-translate-preload.js` |
| `mini-translate-text` | `mini-translate-preload.js` |
| `mini-translate-speech` | `mini-translate-preload.js` |
| `resize-video-preview`, `close-video-preview`, etc. | `renderer/video-preload.js` |
| `store-license-token` | **NOT EXPOSED IN ANY PRELOAD** |
| `toggle-video-always-on-top` | `renderer/video-preload.js` |

**NOTE:** `store-license-token` (L1880) has a handler in main.js but is not exposed in any of the known preload files. This handler may be dead code, or it may be called from a preload that was not found. Worth verifying.

---

## 8. FINDINGS: Electron Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| `nodeIntegration: false` | PASS | All BrowserWindows use `nodeIntegration: false` |
| `contextIsolation: true` | PASS | All BrowserWindows use `contextIsolation: true` |
| `sandbox: true` | PASS | Main window + all child windows |
| `shell.openExternal()` URL validation | PASS | `isSafeURL()` + explicit protocol checks |
| `webPreferences` on child windows | PASS | Checkout, popup, video windows all have secure defaults |
| CSP headers on main window | PASS | Strict CSP with no `unsafe-eval`, `unsafe-inline` only for styles |
| File paths use `path.join()` | PASS | No string concatenation for paths |
| Path traversal guards on file-reading handlers | PASS | `delete-archive-entry`, `read-archive-audio`, `read-archive-video`, `delete-voice-clone`, `delete-clone-bundle`, `delete-local-bundle-copy` all validate paths |
| `will-navigate` handler | PASS | Global handler blocks non-file: navigation |
| `setWindowOpenHandler` | PASS | Global handler denies popups, validates URLs |
| Permission request handler | PASS | Only allows media + clipboard |
| DevTools disabled in production | PARTIAL | Checkout windows check `!app.isPackaged`, but main window does not explicitly disable DevTools |

---

## 9. Priority Action Items

### P0 (Critical / Broken Features)

1. **F5 -- `updaterInstance` scoping bug.** `install-update` and `check-for-updates` handlers are broken. The `let updaterInstance` inside the `setTimeout` callback shadows the module scope. Fix: declare `let updaterInstance = null;` at the module level (near L162-170) and remove the `let` from inside `setTimeout`.

2. **C5 -- `start-clone-training` uses invalid `ipcMain.emit()`.** The redirect to export does not work. Fix: call the export logic directly or use the handler's return value.

### P1 (Should Fix)

3. **S1/L1 -- `browse-document-file` reads binary files as UTF-8.** Fix: detect file extension and route to `extract-document-text` logic for PDF/DOCX, or read as Buffer.

4. **F1 -- `check-injection-permissions` missing try/catch.** Wrap in try/catch.

5. **F4 -- `save-file` missing try/catch around `writeFileSync`.** Wrap in try/catch.

6. **L2 -- Wrong `require()` path for package.json in soul export.** Use `app.getVersion()` instead.

### P2 (Nice to Have)

7. **F3 -- `clear-translation-memory` returns undefined.** Return `{ success: true }`.
8. **C2/C3 -- Blocking fs operations on large archives.** Convert to async where possible.
9. **C4 -- No validation on `modelNames` array length in `download-models`.** Add a reasonable cap.

---

## 10. Handler-by-Handler Error Handling Audit

Handlers with proper try/catch or structured error responses: **~105 of 119** (88%).

Handlers missing try/catch or returning undefined on error:
- `check-injection-permissions` (L2552)
- `save-file` (L4991)
- `clear-translation-memory` (L5416)
- `get-app-version` (L2593) -- single expression, acceptable
- `get-settings` (L2596) -- single expression, acceptable
- `get-server-config` (L4762) -- single expression, acceptable
- `is-maximized` (L4778) -- single expression, acceptable

Overall error handling is solid. The codebase has a disciplined pattern of try/catch with structured `{ ok, error }` responses in most handlers.

---

*Audit performed by automated code review. Manual verification recommended for P0 items.*
