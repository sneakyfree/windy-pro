// Stage 7 "Send" detection (macOS).
//
// Spawns the mac-enter-tap helper (a listen-only CGEventTap that emits ONLY the
// Enter key — see native/mac-enter-tap.swift) and turns a raw Enter press into a
// scoped "send" event: it fires ONLY when the user hits Enter in the very app
// they just dictated into, within a window after the paste, and at most once per
// paste. That scoping is the whole point — it must never fire on random Enters
// elsewhere.
//
// Requires the macOS "Input Monitoring" permission (separate from the
// Accessibility grant auto-paste uses). If the tap can't see events the helper
// prints TAP_FAILED and we surface 'permission-needed' so the UI can guide the
// user to grant it. Opt-in and off by default — a keystroke observer, even a
// single-key listen-only one, should never be silently on.

const { spawn } = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');

const ARM_WINDOW_MS = 90 * 1000; // only treat an Enter as "send" within 90s of a paste

class SendDetector extends EventEmitter {
  constructor({ helperPath, getFrontmostPid } = {}) {
    super();
    this._helperPath = helperPath;
    this._getFrontmostPid = getFrontmostPid || (() => null);
    this._proc = null;
    this._armed = null;   // { pid, at } — set on paste, cleared on fire/expiry
    this.ready = false;
    this.permissionNeeded = false;
  }

  available() { return !!this._helperPath && fs.existsSync(this._helperPath); }
  running() { return !!this._proc; }

  start() {
    if (this._proc) return true;
    if (!this.available()) { this.emit('unavailable'); return false; }
    try {
      this._proc = spawn(this._helperPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this._proc = null;
      this.emit('error', err);
      return false;
    }
    let buf = '';
    this._proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === 'ENTER') { this.emit('raw-enter'); this._onEnter(); }
      }
    });
    this._proc.stderr.on('data', (d) => {
      const t = d.toString();
      if (t.includes('PERM_GRANTED')) { this.perm = 'granted'; this.permissionNeeded = false; this.emit('perm', 'granted'); }
      if (t.includes('PERM_DENIED')) { this.perm = 'denied'; this.permissionNeeded = true; this.emit('perm', 'denied'); this.emit('permission-needed'); }
      if (t.includes('PERM_UNKNOWN')) { this.perm = 'unknown'; this.emit('perm', 'unknown'); }
      if (t.includes('AX_TRUSTED')) { this.axTrusted = true; this.emit('ax', true); }
      if (t.includes('AX_UNTRUSTED')) { this.axTrusted = false; this.permissionNeeded = true; this.emit('ax', false); this.emit('permission-needed'); }
      if (t.includes('MONITOR_READY') || t.includes('TAP_READY')) { this.ready = true; this.emit('ready'); }
      if (t.includes('TAP_FAILED')) { this.permissionNeeded = true; this.emit('permission-needed'); }
    });
    this._proc.on('exit', () => { this._proc = null; this.ready = false; });
    return true;
  }

  stop() {
    try { this._proc?.kill(); } catch (_) { /* already gone */ }
    this._proc = null;
    this._armed = null;
    this.ready = false;
  }

  /** Called on a successful paste — the next scoped Enter is a "send". */
  arm(targetPid) {
    if (targetPid) this._armed = { pid: targetPid, at: Date.now() };
  }
  disarm() { this._armed = null; }

  _onEnter() {
    const a = this._armed;
    if (!a) return;                                   // not armed — ignore
    if (Date.now() - a.at > ARM_WINDOW_MS) { this._armed = null; return; } // stale
    const front = this._getFrontmostPid();
    if (front && front === a.pid) {
      this._armed = null;                             // fire ONCE per paste
      this.emit('send', { pid: a.pid });
    }
    // Enter elsewhere (not the paste target): ignore but stay armed, so the
    // send still counts when the user returns to the app they dictated into.
  }
}

module.exports = { SendDetector, ARM_WINDOW_MS };
