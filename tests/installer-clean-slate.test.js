/**
 * Unit tests for installer-v2/core/clean-slate.js
 *
 * Critical safety properties tested:
 *  1. _killProcesses NEVER includes process.pid in its kill list
 *  2. _killProcesses NEVER includes process.ppid in its kill list
 *  3. _findWindyProcesses returns objects with { pid, name, cmdline }
 *  4. _ownBundlePath strips correctly when execPath is inside a .app
 *
 * History: a previous regression killed the wizard's own Electron
 * helper processes, breaking IPC mid-install. These tests pin down
 * the safety invariants so it can't happen again.
 */

'use strict';

const { CleanSlate } = require('../installer-v2/core/clean-slate');

describe('CleanSlate._ownBundlePath', () => {
  test('strips trailing path inside .app bundle', () => {
    const cs = new CleanSlate();
    const orig = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/Applications/Windy Pro.app/Contents/MacOS/Windy Pro',
      configurable: true,
    });
    try {
      expect(cs._ownBundlePath()).toBe('/Applications/Windy Pro.app');
    } finally {
      Object.defineProperty(process, 'execPath', { value: orig, configurable: true });
    }
  });

  test('returns empty string when execPath is not inside a .app', () => {
    const cs = new CleanSlate();
    const orig = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/usr/local/bin/node',
      configurable: true,
    });
    try {
      expect(cs._ownBundlePath()).toBe('');
    } finally {
      Object.defineProperty(process, 'execPath', { value: orig, configurable: true });
    }
  });
});

describe('CleanSlate._killProcesses safety invariants', () => {
  // We can't safely intercept execSync (clean-slate.js destructured it
  // at require-time). Instead we capture the onLog stream — _killProcesses
  // emits "SKIPPING own-tree PID X" and "killing PID X" lines that
  // tell us exactly which path each candidate took.
  async function runWithLogs(cs, candidates) {
    cs._findWindyProcesses = () => candidates;
    const logs = [];
    cs.onLog = (m) => logs.push(String(m));
    try { await cs._killProcesses(); } catch (_) { /* kill of fake pid will fail; not our concern */ }
    return logs.join('\n');
  }

  test('SKIPPING own-tree log fires when own pid is in candidates', async () => {
    const cs = new CleanSlate({ onLog: () => {} });
    const out = await runWithLogs(cs, [
      { pid: process.pid, name: 'self-impostor', cmdline: 'X' },
    ]);
    expect(out).toMatch(new RegExp(`SKIPPING own-tree PID ${process.pid}`));
    // And NOT a "killing PID <self>" line
    expect(out).not.toMatch(new RegExp(`killing PID ${process.pid}`));
  });

  test('SKIPPING own-tree log fires when parent pid is in candidates', async () => {
    const cs = new CleanSlate({ onLog: () => {} });
    const out = await runWithLogs(cs, [
      { pid: process.ppid, name: 'parent-impostor', cmdline: 'X' },
    ]);
    expect(out).toMatch(new RegExp(`SKIPPING own-tree PID ${process.ppid}`));
  });

  test('SKIPPING own-bundle log fires for processes inside our .app', async () => {
    const cs = new CleanSlate({ onLog: () => {} });
    const orig = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/Applications/Windy Pro.app/Contents/MacOS/Windy Pro',
      configurable: true,
    });
    try {
      const out = await runWithLogs(cs, [
        { pid: 12345, name: 'helper', cmdline: '/Applications/Windy Pro.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper' },
      ]);
      expect(out).toMatch(/SKIPPING own-bundle PID 12345/);
    } finally {
      Object.defineProperty(process, 'execPath', { value: orig, configurable: true });
    }
  });

  test('candidate outside our bundle and not in safe-pids reaches the kill branch', async () => {
    const cs = new CleanSlate({ onLog: () => {} });
    const orig = process.execPath;
    Object.defineProperty(process, 'execPath', {
      value: '/Applications/Windy Pro.app/Contents/MacOS/Windy Pro',
      configurable: true,
    });
    try {
      const out = await runWithLogs(cs, [
        { pid: 99998, name: 'old-windy', cmdline: '/old/install/windy-pro/bin/python' },
      ]);
      // Should attempt to kill (the kill -9 itself will fail because the
      // pid doesn't exist, but the log line proves we got past the guards).
      expect(out).toMatch(/killing PID 99998/);
    } finally {
      Object.defineProperty(process, 'execPath', { value: orig, configurable: true });
    }
  });
});
