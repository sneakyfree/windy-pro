// Loader for the native Enter monitor. macOS-only; returns a no-op stub
// elsewhere (or if the binary is missing) so callers never crash.
let native = null;
try {
  if (process.platform === 'darwin') native = require('./build/Release/enter_monitor.node');
} catch (_) { native = null; }

module.exports = {
  available: () => !!native,
  isTrusted: () => { try { return native ? native.isTrusted() : false; } catch (_) { return false; } },
  start: (cb) => { try { return native ? native.start(cb) : false; } catch (_) { return false; } },
  stop: () => { try { if (native) native.stop(); } catch (_) { } },
  inputMonitoring: () => { try { return native && native.inputMonitoring ? native.inputMonitoring() : 'n/a'; } catch (_) { return 'n/a'; } },
  requestInputMonitoring: () => { try { return native && native.requestInputMonitoring ? native.requestInputMonitoring() : false; } catch (_) { return false; } },
};
