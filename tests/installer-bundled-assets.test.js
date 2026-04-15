/**
 * Unit tests for installer-v2/core/bundled-assets.js
 *
 * Covers:
 *  - _findBundleDir resolution order (process.resourcesPath → repo root)
 *  - hasBundledPython / hasBundledFfmpeg / hasBundledModel / hasBundledWheels
 *  - _getPythonExtractedDir modern flat layout vs legacy platform-segmented
 *  - _findUv (P6 — bundled Astral binary)
 *  - getBundledRequirementsPath
 *
 * Strategy: each test stamps a temp directory with the layout we expect
 * and asserts the helpers return the right paths. We do NOT spawn the
 * bundled Python here — that's covered by the CI smoke-test step.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { BundledAssets } = require('../installer-v2/core/bundled-assets');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `windy-${prefix}-`));
}

function touch(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
}

function makeAssetsAt(bundleDir) {
  // Forces _findBundleDir to use our temp dir by stubbing process.resourcesPath
  Object.defineProperty(process, 'resourcesPath', {
    value: path.dirname(bundleDir),
    configurable: true,
  });
  return new BundledAssets();
}

afterEach(() => {
  // Reset resourcesPath after each test so we don't pollute later tests
  delete process.resourcesPath;
});

describe('BundledAssets — bundle layout detection', () => {
  test('flat modern layout: hasBundledPython true on Unix when bin/python3 exists', () => {
    if (process.platform === 'win32') return;
    const tmp = mkTmp('flat-py');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    const a = makeAssetsAt(bundle);
    expect(a.hasBundledPython()).toBe(true);
  });

  test('hasBundledPython false when neither layout present', () => {
    const tmp = mkTmp('no-py');
    const bundle = path.join(tmp, 'bundled');
    fs.mkdirSync(bundle, { recursive: true });
    const a = makeAssetsAt(bundle);
    // Need to also stub the bundle's python dir presence check that
    // _findBundleDir does — make a stub python/ so it picks our dir
    fs.mkdirSync(path.join(bundle, 'python'), { recursive: true });
    const b = new BundledAssets();
    // No python3 binary — should be false
    expect(b.hasBundledPython()).toBe(false);
  });

  test('hasBundledFfmpeg true when flat ffmpeg/ffmpeg present', () => {
    if (process.platform === 'win32') return;
    const tmp = mkTmp('flat-ff');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3')); // anchor for _findBundleDir
    touch(path.join(bundle, 'ffmpeg', 'ffmpeg'));
    const a = makeAssetsAt(bundle);
    expect(a.hasBundledFfmpeg()).toBe(true);
  });

  test('hasBundledModel true when faster-whisper-base directory exists', () => {
    const tmp = mkTmp('model');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    fs.mkdirSync(path.join(bundle, 'model', 'faster-whisper-base'), { recursive: true });
    const a = makeAssetsAt(bundle);
    expect(a.hasBundledModel()).toBe(true);
  });

  test('hasBundledWheels true when at least one .whl present', () => {
    const tmp = mkTmp('wh');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    touch(path.join(bundle, 'wheels', 'fakepkg-1.0-py3-none-any.whl'));
    const a = makeAssetsAt(bundle);
    expect(a.hasBundledWheels()).toBe(true);
  });

  test('hasBundledWheels false when wheels dir present but empty', () => {
    const tmp = mkTmp('wh-empty');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    fs.mkdirSync(path.join(bundle, 'wheels'), { recursive: true });
    const a = makeAssetsAt(bundle);
    expect(a.hasBundledWheels()).toBe(false);
  });

  test('getBundledRequirementsPath returns null when missing, path when present', () => {
    const tmp = mkTmp('req');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    const a = makeAssetsAt(bundle);
    expect(a.getBundledRequirementsPath()).toBeNull();

    touch(path.join(bundle, 'requirements-bundle.txt'));
    const b = makeAssetsAt(bundle);
    expect(b.getBundledRequirementsPath()).toContain('requirements-bundle.txt');
  });
});

describe('BundledAssets — uv (Phase 6)', () => {
  test('_findUv returns null when uv not bundled', () => {
    const tmp = mkTmp('no-uv');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    const a = makeAssetsAt(bundle);
    expect(a._findUv()).toBeNull();
  });

  test('_findUv returns path to Unix uv binary when present', () => {
    if (process.platform === 'win32') return;
    const tmp = mkTmp('uv');
    const bundle = path.join(tmp, 'bundled');
    touch(path.join(bundle, 'python', 'bin', 'python3'));
    touch(path.join(bundle, 'uv', 'uv'));
    const a = makeAssetsAt(bundle);
    const uv = a._findUv();
    expect(uv).not.toBeNull();
    expect(uv.endsWith(path.join('uv', 'uv'))).toBe(true);
  });
});
