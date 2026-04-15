# Windy Pro — Error Reference

Stable codes for every user-facing error the install path can surface.
Single source of truth: [`installer-v2/core/errors.js`](../installer-v2/core/errors.js).

If you saw an error code (`WINDY-NNN`) in the wizard or in
`~/Library/Logs/Windy Pro/wizard-install.log`, find it below.

For a broader symptom-based guide see [DEBUGGING.md](../DEBUGGING.md).

## Adding a new code

1. Pick the next free WINDY-NNN below.
2. Add an entry to `ERROR_CATALOG` in `installer-v2/core/errors.js`.
3. Throw via `WindyError.from('WINDY-NNN', detail)` at the originating
   site — never use `throw new Error('...')` for user-facing failures.
4. Add a section to this file with diagnostic + fix.
5. The unit tests in `tests/installer-errors.test.js` will fail if you
   skip step 1 or 2.

---

## WINDY-001 — Network unreachable

**What:** The wizard tried to contact a download server and got
`ENOTFOUND` / `ENETUNREACH`.

**Why:** No internet. Most often: airplane mode, hotel captive portal
not signed-in, VPN with no upstream, or DNS broken.

**Fix:**
1. Open a browser. Can you load https://windyword.ai? If not, fix
   that first (sign in to captive portal, reconnect VPN, etc.).
2. Click Retry in the wizard.

**Diagnostic:**
```bash
ping -c 3 windyword.ai
curl -v https://windyword.ai 2>&1 | head -20
```

---

## WINDY-002 — Network timeout

**What:** A download started but didn't progress for the configured
timeout (per-step in `installer-v2/wizard-main.js TIMEOUT_*` constants).

**Why:** Slow / unreliable network, or the server stopped responding
mid-download.

**Fix:**
1. Switch to a faster network if available.
2. If you're on hotel/captive Wi-Fi, sign in via your browser first,
   then retry.
3. The wizard's withTimeout wrappers cap each step — see
   [DEBUGGING.md](../DEBUGGING.md#symptom-wizard-stuck-at-0)
   for which step's timeout fired.

---

## WINDY-003 — Download server misconfigured

**What:** A download URL returned too many HTTP redirects in a row
(curl `--max-redirs` or Node `http.request` followRedirects cap).

**Why:** A misconfigured Hugging Face mirror, or a temporary
DNS-redirect loop.

**Fix:** Wait 5 minutes and retry. If it persists, file a bug — the
upstream model registry needs fixing.

---

## WINDY-004 — Download server error

**What:** A download URL returned HTTP 4xx or 5xx.

**Why:** The model file isn't where the catalog says it is, or the
model server is down.

**Fix:**
1. Retry — most server errors are transient.
2. Check https://status.windyword.ai for known incidents.
3. If a specific engine consistently fails, swap to a different one
   in the wizard's "Show advanced options" section.

---

## WINDY-010 — Disk full

**What:** A write failed with `ENOSPC`.

**Why:** Not enough free disk space to store the bundled Python +
wheels + selected model(s).

**Fix:**
1. The wizard's hardware-scan screen shows free-space and what each
   engine costs. Free at least 2GB.
2. Pick a smaller engine via the hero card or "Show advanced options".
3. Empty Trash, clear browser caches, and retry.

**Diagnostic:**
```bash
df -h ~/.windy-pro
du -sh ~/.windy-pro/* 2>/dev/null
```

---

## WINDY-011 — Permission denied

**What:** A filesystem operation failed with `EACCES` / `EPERM`.

**Why:** Either the wizard tried to write to a directory it doesn't
own (e.g. `/Applications` without admin), or the user moved the
`.app` to a write-protected location.

**Fix:**
- **macOS:** Drag `Windy Pro.app` to your `/Applications/` (the
  installer asks you to). Then re-launch.
- **Linux:** Run with `sudo` or fix the udev rules per the install
  script.
- **Windows:** Right-click → "Run as administrator".

---

## WINDY-020 — Python install failed

**What:** The wizard's bundled-Python detection failed AND every
fallback (system Python, package-manager install, Miniforge) also
failed.

**Why:** This indicates the `.app` bundle is broken — bundled Python
should always be present in shipped builds.

**Fix:**
1. Re-download the installer from windyword.ai (the local file may
   be corrupted).
2. If it still fails, file a bug with the wizard log attached. The
   build pipeline produced a broken bundle.

**Diagnostic:**
```bash
ls /Applications/Windy\ Pro.app/Contents/Resources/bundled/python/bin/
/Applications/Windy\ Pro.app/Contents/Resources/bundled/python/bin/python3 --version
```

---

## WINDY-021 — pip install failed

**What:** Offline `pip install --no-index --find-links wheels/ -r req.txt`
exited non-zero.

**Why:**
1. A wheel for the host architecture is missing from the bundle
   (cross-platform wheel download was incomplete at build time).
2. Disk full mid-install (see WINDY-010).
3. The bundled Python's `pip` is broken.

**Fix:**
1. Re-run install. Often a single retry works.
2. If it fails again, attach the wizard log when contacting support.
   The stderr includes the missing-wheel name.

**Diagnostic:**
```bash
ls /Applications/Windy\ Pro.app/Contents/Resources/bundled/wheels/ | wc -l
# Should match the count in extraResources/bundle-manifest.json
```

---

## WINDY-030 — ffmpeg install failed

**What:** Bundled ffmpeg copy failed AND the system fallbacks (brew,
apt, dnf) also failed.

**Why:** Same as WINDY-020 — broken bundle. Bundled ffmpeg should
always be present.

**Fix:** Re-download installer. File bug if it persists.

---

## WINDY-040 — Setup step timed out

**What:** One of the install handler's awaited operations exceeded
its `withTimeout()` budget. The error message includes the step
label (e.g. `CleanSlate.run`, `DependencyInstaller.installAll`,
`DownloadManager.downloadModels`).

**Why:** The named step never resolved within its budget. Common causes:
- Network so slow the download timed out (large model, slow link)
- A pkexec/sudo prompt left unanswered on Linux
- Real upstream outage

**Fix:**
1. Re-run install. If it consistently times out on the same step,
   try a different network.
2. The wizard log file shows exactly which step:
   ```
   ✗ TIMEOUT after Nms in: <label>
   ```
3. If you can attach the log to a support ticket, we can pinpoint.

See also [DEBUGGING.md "wizard stuck at 0%"](../DEBUGGING.md).

---

## WINDY-050 — Unknown model selected

**What:** The user-selected `modelId` doesn't exist in the catalog.

**Why:** Either a stale wizard state (model removed from the
catalog after the user opened the wizard) or a corrupt catalog file.

**Fix:**
1. Refresh the wizard. Pick a different model.
2. If the engine you want is missing entirely, the catalog file
   may be stale — re-run install or update the .app.

---

## WINDY-052 — Bundled model failed integrity check

**What:** The installed starter model's SHA-256 doesn't match the
manifest (`bundle-manifest.json`) that shipped with the .app.
Detected by `BundledAssets.verifyModelIntegrity()` which hashes
every file in the model directory against the pinned `modelFiles`
map in the manifest.

**Why:** Two causes:
1. The `.dmg` / `.AppImage` / `.exe` was tampered with between
   download and install.
2. A disk or filesystem error corrupted a model file during copy
   (laptop closed mid-install, disk full, permission flip).

Older bundles (pre-2026-04-15) don't include `modelFiles` in the
manifest; `verifyModelIntegrity` skips silently for those.

**Fix:**
1. Re-download the installer from windyword.ai and re-install.
2. If it fails on the fresh download too, file a bug with the
   mismatched file names from the wizard log.

**Diagnostic:**
```bash
# Compare shipped sha to installed sha manually
jq '.modelFiles' /Applications/Windy\ Pro.app/Contents/Resources/bundled/bundle-manifest.json
shasum -a 256 ~/.windy-pro/models/faster-whisper-base/model.bin
```

---

## WINDY-051 — Empty model repository

**What:** The model server returned a directory listing with zero
files for the requested repo.

**Why:** The Hugging Face mirror occasionally returns empty listings
during a propagation window. Also possible: a model was removed
upstream but the catalog still references it.

**Fix:**
1. Wait 5 minutes and retry.
2. Switch to a different engine if it persists.

---

## What's NOT in this list

- Background errors that don't surface to the user (network polling
  failures while the app is running, etc.) — those go to the crash log
  at `~/Library/Logs/WindyPro/crash.log`.
- Renderer-side JS errors — caught by `pageerror` handlers in
  `main.js`; logged to crash.log without surfacing to the user.
- Server-side errors from windyword.ai — see status page.
