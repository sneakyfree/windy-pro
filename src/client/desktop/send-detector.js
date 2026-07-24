// Stage 7 "Send" detection (macOS).
//
// Turns a raw Enter press into a SCOPED "send" event: fires ONLY when the user
// hits Enter in the very app they just dictated into, within a window after the
// paste, at most once per paste. That scoping is the whole point — it must never
// fire on random Enters elsewhere.
//
// The keystroke source is a NATIVE NSEvent global monitor running INSIDE the
// main Electron process (native/enter-monitor). It is inherently listen-only —
// it can never consume or modify the Enter, so it can't interfere with the app
// the user is typing into — and it observes from the app's own window-server
// session + Accessibility identity (which a spawned helper binary lacked). All
// policy lives here in JS; the native surface only forwards the Enter key.

const { EventEmitter } = require('events');

const ARM_WINDOW_MS = 90 * 1000; // only treat an Enter as "send" within 90s of a paste

class SendDetector extends EventEmitter {
  constructor({ nativeMonitor, getFrontmostPid } = {}) {
    super();
    this._native = nativeMonitor || null;
    this._getFrontmostPid = getFrontmostPid || (() => null);
    this._armed = null;   // { pid, at } — set on paste, cleared on fire/expiry
    this._started = false;
    this.ready = false;
    this.axTrusted = false;
    this.permissionNeeded = false;
  }

  available() { return !!(this._native && this._native.available()); }
  running() { return this._started; }

  start() {
    if (this._started) return true;
    if (!this.available()) { this.emit('unavailable'); return false; }
    this.axTrusted = this._native.isTrusted();
    this.emit('ax', this.axTrusted);
    // Input Monitoring is the grant keyboard monitors actually require (separate
    // from Accessibility). Report it, and request it if not yet granted.
    this.inputMon = this._native.inputMonitoring ? this._native.inputMonitoring() : 'n/a';
    this.emit('inputmon', this.inputMon);
    if (this.inputMon !== 'granted' && this._native.requestInputMonitoring) {
      this._native.requestInputMonitoring();
    }
    if (this.inputMon === 'denied' || !this.axTrusted) { this.permissionNeeded = true; this.emit('permission-needed'); }
    const ok = this._native.start((ev) => {
      // ev: { keyCode, shift, cmd, alt, ctrl } — only Enter is ever delivered.
      this.emit('raw-enter', ev);
      // Shift+Enter = newline in chat apps → never a "send".
      if (ev && ev.shift) return;
      this._onEnter(ev || {});
    });
    this._started = !!ok;
    if (this._started) { this.ready = true; this.emit('ready'); }
    else this.emit('error', new Error('native monitor failed to start'));
    return this._started;
  }

  stop() {
    try { this._native && this._native.stop(); } catch (_) { /* best-effort */ }
    this._started = false;
    this._armed = null;
    this.ready = false;
  }

  /** Called on a successful paste — the next scoped Enter is a "send". */
  arm(targetPid) {
    if (targetPid) this._armed = { pid: targetPid, at: Date.now() };
  }
  disarm() { this._armed = null; }

  _onEnter(ev) {
    const a = this._armed;
    if (!a) return;                                   // not armed — ignore
    if (Date.now() - a.at > ARM_WINDOW_MS) { this._armed = null; return; } // stale
    const front = this._getFrontmostPid();
    if (front && front === a.pid) {
      this._armed = null;                             // fire ONCE per paste
      this.emit('send', { pid: a.pid, ev });
    }
    // Enter elsewhere (not the paste target): ignore but stay armed, so the
    // send still counts when the user returns to the app they dictated into.
  }
}

module.exports = { SendDetector, ARM_WINDOW_MS };
