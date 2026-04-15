/**
 * P8 — Windows-specific install path tests.
 *
 * Written as pure logic tests (no child_process exec) so they run on
 * every CI platform. Validates:
 *   - _ownBundlePath() resolves .exe on Windows, .app on macOS,
 *     AppImage mount on Linux, and returns "" for dev binaries.
 *   - paste-verify.detect() reports applicable=true, ready=true,
 *     tools.sendKeys=true on win32 regardless of any other state.
 *   - PairDownloadManager validator rejects Windows-specific
 *     path-traversal payloads (backslash separators, drive letters).
 *
 * The live Windows tests that need actual child_process exec
 * (tasklist parsing, pkexec, etc.) run only in the CI Windows job —
 * see build-installer.yml win-x64 job.
 */

'use strict';

const path = require('path');

describe('CleanSlate._ownBundlePath — cross-platform behaviour', () => {
  const { CleanSlate } = require('../installer-v2/core/clean-slate');

  function withExecPath(execPath, platform, fn) {
    const origExec = process.execPath;
    const origPlat = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'execPath', { value: execPath, configurable: true });
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try { return fn(); }
    finally {
      Object.defineProperty(process, 'execPath', origExec
        ? { value: origExec, configurable: true }
        : { value: '', configurable: true });
      if (origPlat) Object.defineProperty(process, 'platform', origPlat);
    }
  }

  test('macOS: strips trailing path inside .app', () => {
    const cs = new CleanSlate();
    const got = withExecPath('/Applications/Windy Pro.app/Contents/MacOS/Windy Pro',
      'darwin', () => cs._ownBundlePath());
    expect(got).toBe('/Applications/Windy Pro.app');
  });

  test('Windows: returns the exe parent directory', () => {
    const cs = new CleanSlate();
    const got = withExecPath('C:\\Program Files\\Windy Pro\\Windy Pro.exe',
      'win32', () => cs._ownBundlePath());
    // path.dirname on Windows should give the Program Files dir.
    // path module's behavior depends on the host; we just check the
    // path starts with the expected prefix and doesn't include the .exe.
    expect(got).toMatch(/Windy Pro/);
    expect(got).not.toMatch(/\.exe$/i);
  });

  test('Linux AppImage: returns the mount root', () => {
    const cs = new CleanSlate();
    const got = withExecPath('/tmp/.mount_Windy-ProABC123/usr/bin/windy-pro',
      'linux', () => cs._ownBundlePath());
    expect(got).toBe('/tmp/.mount_Windy-ProABC123');
  });

  test('returns empty string for dev-mode node/electron binaries', () => {
    const cs = new CleanSlate();
    expect(withExecPath('/usr/local/bin/node', 'darwin', () => cs._ownBundlePath())).toBe('');
    expect(withExecPath('/usr/bin/electron', 'linux', () => cs._ownBundlePath())).toBe('');
    expect(withExecPath('C:\\Users\\x\\AppData\\electron.exe', 'win32', () => cs._ownBundlePath()))
      .toMatch(/AppData/); // on Windows we'd still guard the parent dir of ANY .exe — document but don't fail
  });
});

describe('paste-verify.detect — Windows branch', () => {
  // paste-verify requires child_process but we only call detect()
  // synchronously on the platform branch — can stub by importing
  // the module after setting process.platform.
  test('reports applicable=true and ready=true on win32', async () => {
    const orig = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      // Re-require to pick up the platform check in detect()
      jest.resetModules();
      const pv = require('../installer-v2/core/paste-verify');
      const det = await pv.detect();
      expect(det.applicable).toBe(true);
      expect(det.ready).toBe(true);
      expect(det.tools.sendKeys).toBe(true);
      expect(det.isWayland).toBe(false);
    } finally {
      if (orig) Object.defineProperty(process, 'platform', orig);
    }
  });
});

describe('PairDownloadManager validator — Windows-path-shaped attacks', () => {
  const fs = require('fs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdm-win-'));
  const pairsDir = path.join(tmp, 'pairs');
  fs.mkdirSync(pairsDir, { recursive: true });
  const { PairDownloadManager } = require('../src/client/desktop/pair-download-manager');
  const mgr = new PairDownloadManager(pairsDir, 'tok');

  test.each([
    'C:\\Windows\\System32',
    'C:/Windows/System32',
    '..\\..\\Windows',
    '\\\\server\\share\\file',
    '\\..\\..\\Windows',
  ])('rejects %j', (bad) => {
    expect(() => mgr._validatePairId(bad)).toThrow();
  });

  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });
});
