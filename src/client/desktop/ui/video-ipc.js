/**
 * Video-preview IPC handlers — extracted from main.js (CR-009c).
 *
 * The video-preview BrowserWindow floats over the main app while the
 * user is recording, mirroring their webcam feed for mid-recording
 * composure checks. 15 IPC channels manage its lifecycle:
 *
 *   Show/hide:   show-video-preview, hide-video-preview,
 *                close-video-preview, minimize-video-preview,
 *                toggle-video-always-on-top
 *   Messaging:   video-frame-to-preview, recording-state-to-preview
 *   Sizing:      resize-video-preview, resize-move-video-preview,
 *                start-resize-video, stop-resize-video
 *
 * Same registrar + deps-object pattern as chat/ipc.js and
 * chat/pair-ipc.js. Module-private `_resizeInterval` holds the
 * active mouse-poll timer — explicitly NOT shared with main.js
 * because the timer is always scoped to one active drag at a time.
 *
 * Deps that need to mutate cross-module globals (videoWindow,
 * videoDismissed) are passed via ref wrappers so the registrar can
 * write through to main.js's `let` state without losing the
 * reference on reassignment.
 */

'use strict';

function registerVideoIpc(deps) {
  const {
    ipcMain, createVideoWindow, videoWindowRef, videoDismissedRef, screen,
  } = deps;

  if (!ipcMain || !createVideoWindow || !videoWindowRef || !videoDismissedRef || !screen) {
    throw new Error('[video-ipc] missing required deps');
  }

  // Module-private mouse-poll timer for resize drags.
  let _resizeInterval = null;

  // Local helper so the per-handler guards don't repeat the same
  // triple-check. Returns the live window (or null) and never
  // throws.
  const getLiveWindow = () => {
    const w = videoWindowRef.current;
    return (w && !w.isDestroyed() && !w.webContents.isDestroyed()) ? w : null;
  };

  // ── Show / hide ──────────────────────────────────────────────
  ipcMain.handle('show-video-preview', async () => {
    if (videoDismissedRef.current) return { ok: false, dismissed: true };
    const win = createVideoWindow();
    win.show();
    return { ok: true };
  });

  ipcMain.handle('hide-video-preview', async () => {
    const w = getLiveWindow();
    if (w) {
      w.webContents.send('stop-camera');
      w.hide();
    }
    return { ok: true };
  });

  ipcMain.on('close-video-preview', () => {
    videoDismissedRef.current = true; // Don't auto-show again until app restart
    const w = getLiveWindow();
    if (w) {
      w.webContents.send('stop-camera');
      w.hide();
    }
  });

  ipcMain.on('minimize-video-preview', () => {
    const w = getLiveWindow();
    if (w) w.minimize();
  });

  ipcMain.handle('toggle-video-always-on-top', async () => {
    const w = getLiveWindow();
    if (!w) return false;
    const isOnTop = w.isAlwaysOnTop();
    w.setAlwaysOnTop(!isOnTop);
    return !isOnTop;
  });

  // ── Messaging to the preview window ──────────────────────────
  ipcMain.on('video-frame-to-preview', (event, dataUrl) => {
    const w = getLiveWindow();
    if (w) w.webContents.send('video-frame', dataUrl);
  });

  ipcMain.on('recording-state-to-preview', (event, state) => {
    const w = getLiveWindow();
    if (w) w.webContents.send('recording-state', state);
  });

  // ── Sizing ───────────────────────────────────────────────────
  ipcMain.on('resize-video-preview', (event, w, h) => {
    const win = getLiveWindow();
    if (win) win.setSize(Math.round(w), Math.round(h));
  });

  ipcMain.on('resize-move-video-preview', (event, w, h, x, y) => {
    const win = getLiveWindow();
    if (!win) return;
    const rw = Math.round(w);
    const rh = Math.round(h);
    if (x !== null && y !== null) {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: rw, height: rh });
    } else if (x !== null) {
      const b = win.getBounds();
      win.setBounds({ x: Math.round(x), y: b.y, width: rw, height: rh });
    } else if (y !== null) {
      const b = win.getBounds();
      win.setBounds({ x: b.x, y: Math.round(y), width: rw, height: rh });
    } else {
      win.setSize(rw, rh);
    }
  });

  // ── Resize drag (main-process mouse polling) ─────────────────
  // Bypasses Electron's pointer-capture limit during a drag. The
  // timer is cleared on stop-resize-video OR when the window
  // disappears.
  ipcMain.on('start-resize-video', (event, corner, startScreenX, startScreenY, startW, startH, startWinX, startWinY) => {
    if (_resizeInterval) clearInterval(_resizeInterval);
    _resizeInterval = setInterval(() => {
      const win = getLiveWindow();
      if (!win) {
        clearInterval(_resizeInterval);
        _resizeInterval = null;
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      const dx = cursor.x - startScreenX;
      let newW, newX, newY;
      switch (corner) {
        case 'br': newW = Math.max(160, Math.min(800, startW + dx)); break;
        case 'bl':
          newW = Math.max(160, Math.min(800, startW - dx));
          newX = startWinX + (startW - newW);
          break;
        case 'tr': newW = Math.max(160, Math.min(800, startW + dx)); break;
        case 'tl':
          newW = Math.max(160, Math.min(800, startW - dx));
          newX = startWinX + (startW - newW);
          break;
      }
      const newH = Math.round(newW * 9 / 16);
      if (corner === 'tr' || corner === 'tl') {
        newY = startWinY + (startH - newH);
      }
      const rw = Math.round(newW);
      const rh = Math.round(newH);
      if (newX !== undefined && newY !== undefined) {
        win.setBounds({ x: Math.round(newX), y: Math.round(newY), width: rw, height: rh });
      } else if (newX !== undefined) {
        const b = win.getBounds();
        win.setBounds({ x: Math.round(newX), y: b.y, width: rw, height: rh });
      } else if (newY !== undefined) {
        const b = win.getBounds();
        win.setBounds({ x: b.x, y: Math.round(newY), width: rw, height: rh });
      } else {
        win.setSize(rw, rh);
      }
      try { win.webContents.send('resize-feedback', rw, rh); } catch (_) { /* ignore */ }
    }, 16); // ~60fps
  });

  ipcMain.on('stop-resize-video', () => {
    if (_resizeInterval) {
      clearInterval(_resizeInterval);
      _resizeInterval = null;
    }
  });

  return {
    // Exposed so main.js (or future shutdown hooks) can force-clear
    // the resize timer (e.g. on app.quit).
    stopResizeTimer() {
      if (_resizeInterval) {
        clearInterval(_resizeInterval);
        _resizeInterval = null;
      }
    },
  };
}

const VIDEO_IPC_CHANNELS = Object.freeze([
  'show-video-preview', 'hide-video-preview',
  'close-video-preview', 'minimize-video-preview',
  'toggle-video-always-on-top',
  'video-frame-to-preview', 'recording-state-to-preview',
  'resize-video-preview', 'resize-move-video-preview',
  'start-resize-video', 'stop-resize-video',
]);

module.exports = { registerVideoIpc, VIDEO_IPC_CHANNELS };
