# Fix Plan — Error Handling & Performance

Based on the comprehensive audit of 2026-03-12.  
**23 findings**: 2 P0, 11 P1, 10 P2.

---

## P0 — CRITICAL (2 findings)

### P0-1: `execSync` blocks main thread up to 120 seconds

**File:** `src/client/desktop/main.js`  
**Lines:** 2259–2354 (`batch-transcribe-local` IPC handler)

**Current code (line 2294):**
```js
execSync(`${ffmpegCmd} -y -i "${webmPath}" -ar 16000 -ac 1 -acodec pcm_s16le "${wavPath}" ${devnull}`);
```

**Current code (line 2338):**
```js
const result = execSync(`${pythonPath} "${scriptPath}"`, {
  timeout: 120000,
  maxBuffer: 10 * 1024 * 1024
});
```

**Problem:** `execSync` blocks the entire Electron main thread. During ffmpeg conversion + Python transcription (up to 120s), the app completely freezes — no window rendering, no IPC responses, no tray interaction.

**Fix — Replace with `child_process.execFile` (async):**
```js
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

// FFmpeg conversion (was execSync)
await execFileAsync(ffmpegCmd.replace(/"/g, ''), [
  '-y', '-i', webmPath, '-ar', '16000', '-ac', '1',
  '-acodec', 'pcm_s16le', wavPath
], { timeout: 30000 });

// Python transcription (was execSync)
const { stdout } = await execFileAsync(pythonPath, [scriptPath], {
  timeout: 120000,
  maxBuffer: 10 * 1024 * 1024
});
return stdout.trim();
```

**Also fix line 2378 (xdotool paste):**
```js
// Current:
require('child_process').execSync('xdotool key --clearmodifiers ctrl+v', { timeout: 5000 });

// Fix — use exec (async) since this is already in an async handler:
const { exec } = require('child_process');
await new Promise((resolve) => {
  exec('xdotool key --clearmodifiers ctrl+v', { timeout: 5000 }, resolve);
});
```

---

### P0-2: `get-archive-stats` does O(n) synchronous file traversal

**File:** `src/client/desktop/main.js`  
**Lines:** 2813–2864

**Current code:**
```js
ipcMain.handle('get-archive-stats', async () => {
  // ...
  const items = fs.readdirSync(archiveRoot);         // SYNC
  for (const item of items) {
    const stat = fs.statSync(itemPath);               // SYNC × N
    const files = fs.readdirSync(itemPath);           // SYNC × N
    const fSize = fs.statSync(...).size;              // SYNC × N²
    const content = fs.readFileSync(..., 'utf-8');    // SYNC × N²
  }
});
```

**Problem:** Reads every file in the archive synchronously on the main thread. With 365 days × 5 files/day = 1,825+ file system calls, all blocking. Called on every Settings panel open.

**Fix — Use `fs.promises` throughout:**
```js
const fsp = require('fs').promises;

ipcMain.handle('get-archive-stats', async () => {
  try {
    const archiveRoot = getArchiveFolder();
    try { await fsp.access(archiveRoot); } catch { return { totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0 }; }

    let totalFiles = 0, totalSize = 0, days = new Set();
    let audioBytes = 0, videoBytes = 0, totalWords = 0, totalSessions = 0, totalChars = 0;

    const items = await fsp.readdir(archiveRoot);
    for (const item of items) {
      const itemPath = path.join(archiveRoot, item);
      const stat = await fsp.stat(itemPath);
      if (!stat.isDirectory()) continue;

      days.add(item);
      const files = await fsp.readdir(itemPath);
      for (const file of files) {
        totalFiles++;
        try {
          const fStat = await fsp.stat(path.join(itemPath, file));
          totalSize += fStat.size;
          if (file.endsWith('.webm') && file.includes('-video')) {
            videoBytes += fStat.size;
          } else if (file.endsWith('.webm') || file.endsWith('.wav')) {
            audioBytes += fStat.size;
          } else if (file.endsWith('.md') && file !== `${item}.md`) {
            totalSessions++;
            try {
              const content = await fsp.readFile(path.join(itemPath, file), 'utf-8');
              const textLines = content.split('\n').filter(l => !l.startsWith('#') && !l.startsWith('**') && l.trim() !== '---' && l.trim() !== '');
              const text = textLines.join(' ').trim();
              totalWords += text.split(/\s+/).filter(Boolean).length;
              totalChars += text.length;
            } catch (_) { }
          }
        } catch (_) { }
      }
    }
    const audioHours = (audioBytes / 1024 / 16) / 3600;
    const videoHours = (videoBytes / 1024 / 100) / 3600;
    return { totalFiles, totalSizeMB: Math.round(totalSize / (1024 * 1024) * 10) / 10, days: days.size, audioHours: Math.round(audioHours * 100) / 100, videoHours: Math.round(videoHours * 100) / 100, totalWords, totalSessions, totalChars };
  } catch (err) {
    return { totalFiles: 0, totalSizeMB: 0, days: 0, audioHours: 0, videoHours: 0, totalWords: 0, totalSessions: 0, totalChars: 0, error: err.message };
  }
});
```

**Bonus — add caching** so repeated Settings opens don't re-scan:
```js
let _archiveStatsCache = null;
let _archiveStatsCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

ipcMain.handle('get-archive-stats', async () => {
  if (_archiveStatsCache && Date.now() - _archiveStatsCacheTime < CACHE_TTL) {
    return _archiveStatsCache;
  }
  // ... async traversal ...
  _archiveStatsCache = result;
  _archiveStatsCacheTime = Date.now();
  return result;
});
```

---

## P1 — IMPORTANT (11 findings)

### P1-1: Blob URL memory leak — one per recording, never revoked

**File:** `src/client/desktop/renderer/app.js`  
**Line:** 2441

**Current code:**
```js
async _saveAudioRecording(blob, timestamp) {
  const audioUrl = URL.createObjectURL(blob);  // LEAKED
  this._showPlaybackBar(audioUrl);
  // audioUrl is never revoked
```

**Problem:** Each recording creates a Blob URL that holds the entire audio Blob in memory. Over 20 recordings, this leaks 200MB+.

**Fix — Track and revoke on next recording or bar close:**
```js
async _saveAudioRecording(blob, timestamp) {
  // Revoke previous audio URL if one exists
  if (this._lastPlaybackUrl) {
    URL.revokeObjectURL(this._lastPlaybackUrl);
    this._lastPlaybackUrl = null;
  }

  const audioUrl = URL.createObjectURL(blob);
  this._lastPlaybackUrl = audioUrl;
  this._showPlaybackBar(audioUrl);
```

Also add cleanup in `_hidePlaybackBar()` or equivalent:
```js
_hidePlaybackBar() {
  if (this._lastPlaybackUrl) {
    URL.revokeObjectURL(this._lastPlaybackUrl);
    this._lastPlaybackUrl = null;
  }
  // ... existing hide logic
}
```

---

### P1-2: Silent catch in app init hides startup errors

**File:** `src/client/desktop/renderer/app.js`  
**Line:** 260

**Current code:**
```js
    console.debug(`[Init] Final: Engine=${this.transcriptionEngine} ...`);
  } catch (_) { }
```

**Fix:**
```js
    console.debug(`[Init] Final: Engine=${this.transcriptionEngine} ...`);
  } catch (e) { console.warn('[Init] Settings load error:', e.message); }
```

---

### P1-3: Silent catch in cloud WS send hides connection errors

**File:** `src/client/desktop/renderer/app.js`  
**Line:** 1466

**Current code:**
```js
  disconnectCloudWS() {
    if (this.cloudWs) {
      try {
        this.cloudWs.send(JSON.stringify({ action: 'stop' }));
      } catch (_) { }
```

**Fix:**
```js
      } catch (e) { console.debug('[Cloud] WS send failed during disconnect:', e.message); }
```

---

### P1-4: Silent catch in token refresh hides auth failures

**File:** `src/client/desktop/renderer/app.js`  
**Line:** 1333

**Current code:**
```js
      }
    } catch (_) { }
    console.warn('[Cloud] Token refresh failed, using existing token');
```

**Note:** This already has a `console.warn` after the catch, so the failure is partially logged. But the actual error reason is lost.

**Fix:**
```js
    } catch (e) {
      console.warn('[Cloud] Token refresh failed:', e.message, '— using existing token');
    }
```

---

### P1-5: Silent catch in speech recognition stop

**File:** `src/client/desktop/renderer/app.js`  
**Line:** 1582

**Current code:**
```js
      try {
        this.speechRecognition.stop();
      } catch (_) { }
```

**Fix:**
```js
      try {
        this.speechRecognition.stop();
      } catch (e) { console.debug('[Stream] SpeechRecognition.stop() error:', e.message); }
```

---

### P1-6: Silent catch in tier-limit enforcement hides plan enforcement

**File:** `src/client/desktop/renderer/app.js`  
**Line:** 1681

**Current code:**
```js
        }
      } catch (_) { }
```

**Problem:** If tier limits fail to load, the user gets unlimited access inadvertently.

**Fix:**
```js
      } catch (e) { console.warn('[TierLimits] Failed to enforce plan limits:', e.message); }
```

---

### P1-7: Vault.js — 4 empty catch blocks hide chat errors

**File:** `src/client/desktop/renderer/vault.js`  
**Lines:** 104, 158, 214, 254

**Current code (all 4 are identical pattern):**
```js
            } catch (e) { }
```

**Fix — add warning logs:**
```js
// Line 104:
} catch (e) { console.warn('[Vault] Message load error:', e.message); }

// Line 158:
} catch (e) { console.warn('[Vault] Message send error:', e.message); }

// Line 214:
} catch (e) { console.warn('[Vault] Chat history error:', e.message); }

// Line 254:
} catch (e) { console.warn('[Vault] Clipboard copy error:', e.message); }
```

---

### P1-8: Sync.js — 5 silent/bare catches hide sync failures

**File:** `src/client/desktop/renderer/sync.js`  
**Lines:** 32, 57, 125, 246, 298

**Current code (lines 57, 125, 246 are bare `catch {}` — no variable):**
```js
        } catch {
```

**Fix — add error variable and warning:**
```js
// Line 32:
} catch (e) { console.warn('[Sync] Init error:', e.message); }

// Line 57:
} catch (e) { console.warn('[Sync] Upload queue error:', e.message); }

// Line 125:
} catch (e) { console.warn('[Sync] Download error:', e.message); }

// Line 246:
} catch (e) { console.debug('[Sync] Cleanup error:', e.message); }

// Line 298:
} catch (e) { console.warn('[Sync] Queue process error:', e.message); }
```

---

### P1-9: `main.js` is a 5,182-line god file

**File:** `src/client/desktop/main.js`

**Problem:** Contains payments, cloud storage, auto-updater, exports, archive management, transcription, settings, and 97 IPC handlers in one file. Makes debugging and code review extremely difficult.

**Fix — Extract into modules:**

```
src/client/desktop/
├── main.js              (→ ~800 lines: app lifecycle, window creation, IPC registration)
├── main/
│   ├── payments.js      (→ ~400 lines: Stripe checkout, billing portal, tier limits)
│   ├── cloud-storage.js (→ ~300 lines: R2 upload/download, usage tracking)
│   ├── archive.js       (→ ~500 lines: get-archive-stats, export-soul-file, export-voice-clone)
│   ├── transcription.js (→ ~300 lines: batch-transcribe-local, identify-music)
│   ├── updater.js       (→ ~200 lines: WindyUpdater class, check-for-updates)
│   └── ipc-handlers.js  (→ ~200 lines: misc IPC: save-file, open-external, etc.)
```

Each module exports a `register(ipcMain, store, ...)` function:
```js
// main/archive.js
module.exports.register = function(ipcMain, store, getArchiveFolder) {
  ipcMain.handle('get-archive-stats', async () => { ... });
  ipcMain.handle('export-soul-file', async () => { ... });
  ipcMain.handle('export-voice-clone', async () => { ... });
};

// main.js
const archive = require('./main/archive');
archive.register(ipcMain, store, getArchiveFolder);
```

---

### P1-10: Health check shows "Connecting..." indefinitely

**File:** `src/client/desktop/renderer/app.js`  
**Related:** Footer status bar

**Problem:** The renderer fetches `https://windypro.thewindstorm.uk/health` which fails due to CORS. The status bar shows "Connecting..." forever.

**Fix — Option A: Add timeout + fallback status:**
```js
// In the health check function:
try {
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
  if (res.ok) this._setConnectionStatus('connected');
  else this._setConnectionStatus('offline');
} catch (e) {
  // Network/CORS failure — show "Local Only" instead of "Connecting..."
  this._setConnectionStatus('local');
}
```

**Fix — Option B: Fix CORS on server side:**
```js
// services/account-server/server.js — add /health to CORS allowlist
app.get('/health', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ status: 'ok', timestamp: Date.now() });
});
```

---

### P1-11: Unhandled `.then()` chains — 3 potential rejections

**File:** `src/client/desktop/renderer/sync.js:96`

**Current code:**
```js
fetch(`${this.baseUrl}/api/v1/auth/logout`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${this.token}` }
});
```

**Fix:**
```js
fetch(`${this.baseUrl}/api/v1/auth/logout`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${this.token}` }
}).catch(e => console.debug('[Sync] Logout request failed:', e.message));
```

**File:** `src/client/desktop/renderer/app.js:1258`

**Current code:**
```js
this.connectCloudWS().then(() => {
  console.debug('[Cloud] WS connected...');
```

**Fix — add `.catch()`:**
```js
this.connectCloudWS().then(() => {
  console.debug('[Cloud] WS connected...');
}).catch(e => console.warn('[Cloud] WS connection failed:', e.message));
```

**File:** `src/client/desktop/renderer/app.js:2425`

**Current code:**
```js
fetch((window.API_CONFIG || {}).analytics || '...', { ... });
```

**Fix:**
```js
fetch((window.API_CONFIG || {}).analytics || '...', { ... })
  .catch(() => {}); // Analytics is fire-and-forget — silence is intentional
```

---

## P2 — MINOR (10 findings)

### P2-1: Generic raw error messages exposed to user (4 locations)

**File:** `src/client/desktop/main.js`  
**Lines:** 2746, 2767, 3572, 3618

**Current pattern:**
```js
return { ok: false, error: err.message };
```

**Fix — Wrap with user-friendly context:**
```js
// Line 2746 (model download):
return { ok: false, error: `Model download failed: ${err.message}. Check your internet connection.` };

// Line 2767 (model verification):
return { ok: false, error: `Model verification failed: ${err.message}. Try re-downloading.` };

// Line 3572 (Stripe checkout):
return { ok: false, error: `Payment system error. Please try again or contact support.` };

// Line 3618 (license validation):
return { ok: false, error: `License check failed. Your subscription may still be active — try again later.` };
```

---

### P2-2: Inconsistent IPC error return format

**File:** `src/client/desktop/main.js` (throughout)

**Current:** Two patterns coexist:
```js
return { ok: false, error: '...' };     // 30 handlers
return { success: false, error: '...' }; // 5 handlers
```

**Fix — Standardize to `{ ok: boolean, error?: string }`:**
```js
// Search for: { success: false, error
// Replace with: { ok: false, error
// Search for: { success: true
// Replace with: { ok: true
```

Affected handlers: `wizard-login`, `wizard-register`, `wizard-free-account`, `wizard-purchase-translate`, `wizard-save-language-profile`.

---

### P2-3: Inline `require()` calls inside IPC handlers

**File:** `src/client/desktop/main.js`  
**Lines:** 2262, 2274, 3059, 3345

**Current code:**
```js
ipcMain.handle('batch-transcribe-local', async (event, base64Audio) => {
  const fs = require('fs');           // Already imported at top!
  const os = require('os');           // Already imported at top!
  const { execSync } = require('child_process');  // Should be at top
```

**Fix — Move all `require()` to top of file:**
```js
// At top of main.js (add if not present):
const { exec, execFile, execSync } = require('child_process');

// Then remove inline requires from handlers.
```

---

### P2-4: `_healthInterval` in translate.js not cleared

**File:** `src/client/desktop/renderer/translate.js`  
**Line:** 724

**Current code:**
```js
this._healthInterval = setInterval(() => this._checkHealth(), 30000);
```

**Fix — Clear on close/destroy:**
```js
close() {
  if (this._healthInterval) {
    clearInterval(this._healthInterval);
    this._healthInterval = null;
  }
  // ... existing close logic
}
```

---

### P2-5: Hardcoded `/tmp/windy-pro-update.deb`

**File:** `src/client/desktop/main.js`  
**Line:** 4500

**Current code:**
```js
const debPath = '/tmp/windy-pro-update.deb';
```

**Fix:**
```js
const debPath = path.join(os.tmpdir(), 'windy-pro-update.deb');
```

---

### P2-6: Tier limits duplicated in 2 locations

**File:** `src/client/desktop/main.js`  
**Lines:** 220–228 and 3240–3243

**Current:** Identical tier limit objects defined twice.

**Fix — Use `getTierLimits()` everywhere:**
```js
// Line 3240-3243: DELETE the duplicate object and use:
const tierData = getTierLimits(tier); // Already defined at line 220
```

---

### P2-7: Stripe redirect URLs hardcoded

**File:** `src/client/desktop/main.js`  
**Lines:** 3164–3165, 3585

**Current code:**
```js
success_url: 'https://windypro.thewindstorm.uk/payment-success?session_id={CHECKOUT_SESSION_ID}',
cancel_url: 'https://windypro.thewindstorm.uk/payment-cancel',
```

**Fix:**
```js
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'https://windypro.thewindstorm.uk/payment-success?session_id={CHECKOUT_SESSION_ID}';
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'https://windypro.thewindstorm.uk/payment-cancel';
const STRIPE_RETURN_URL = process.env.STRIPE_RETURN_URL || 'https://windypro.thewindstorm.uk/dashboard';
```

---

### P2-8: Wizard silent catches (6 locations)

**File:** `src/client/desktop/renderer/wizard.js`  
**Lines:** 33, 43, 220, 311, 523, 529

**Fix — Add `console.debug` to each:**
```js
// Line 33:
} catch (e) { console.debug('[Wizard] Prior install check failed:', e.message); }

// Line 43:
} catch (e) { console.debug('[Wizard] Hardware probe failed:', e.message); }

// Line 220:
} catch (e) { console.debug('[Wizard] Model toggle error:', e.message); }

// Line 311:
} catch (e) { console.debug('[Wizard] Mic cleanup error:', e.message); }

// Line 523:
} catch (e) { console.debug('[Wizard] Language profile save error:', e.message); }

// Line 529:
} catch (e) { console.debug('[Wizard] Autostart setup error:', e.message); }
```

---

### P2-9: Account manager silent catches

**File:** `installer-v2/core/account-manager.js`  
**Lines:** 215, 272

**Fix:**
```js
// Line 215:
} catch (e) { console.debug('[Account] Token load error:', e.message); }

// Line 272:
} catch (e) { console.debug('[Account] Token save error:', e.message); }
```

---

### P2-10: Cloud storage URLs not using constant

**File:** `src/client/desktop/main.js`  
**Lines:** 4948, 4988, 5038, 5095

**Current code:**
```js
const req = https.get('https://windypro.thewindstorm.uk/api/storage/files', { ...
```

**Fix — Use the existing `CLOUD_STORAGE_DEFAULT_URL` constant (line 2579):**
```js
const req = https.get(`${CLOUD_STORAGE_DEFAULT_URL}/files`, { ...
```

Apply to all 4 lines.

---

## Implementation Order

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| 1 | P0-1: Convert `execSync` → `execFile` async | Medium | Eliminates 120s UI freeze |
| 2 | P0-2: Async archive stats + caching | Medium | Eliminates main thread stall |
| 3 | P1-1: Revoke Blob URL | Quick | Prevents memory leak |
| 4 | P1-2 to P1-8: Add `console.warn` to 16 silent catches | Quick | Debugging visibility |
| 5 | P1-10: Fix health check "Connecting..." | Quick | UX improvement |
| 6 | P1-11: Add `.catch()` to 3 `.then()` chains | Quick | Prevents unhandled rejections |
| 7 | P2-1 to P2-10: Generic messages, cleanup, dedup | Low | Code quality |
| 8 | P1-9: Split `main.js` into modules | Large | Maintainability (defer) |

**Estimated total effort:** ~4 hours for P0+P1, ~2 hours for P2.

---

*Plan generated: 2026-03-12*
