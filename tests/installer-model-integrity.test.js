/**
 * @jest-environment node
 *
 * Unit tests for BundledAssets.verifyModelIntegrity — WINDY-052.
 *
 * Creates a fake bundle + manifest with known sha256s, then:
 *   - Verifies a clean install matches (ok: true).
 *   - Mutates one byte in a model file → mismatch.
 *   - Deletes a model file → missing.
 *   - Removes modelFiles from manifest → backward-compatible skip.
 *   - Removes manifest entirely → skip with reason.
 *
 * Pins the contract for both build-portable-bundle.js (produces the
 * manifest) and the installer runtime (consumes it).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { BundledAssets } = require('../installer-v2/core/bundled-assets');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function scaffoldBundle(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-'));
  const bundleDir = path.join(root, 'bundled');
  // Stamp the minimum layout BundledAssets._findBundleDir recognises
  // (requires a `python/` subdir).
  fs.mkdirSync(path.join(bundleDir, 'python', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'python', 'bin', 'python3'), '#!/bin/sh\n');

  // Fake starter model — two files
  const modelDir = path.join(bundleDir, 'model', 'faster-whisper-base');
  fs.mkdirSync(modelDir, { recursive: true });
  const files = opts.files || {
    'model.bin': Buffer.from('fake-model-payload'),
    'config.json': Buffer.from('{"id":"base"}'),
    'vocab.txt': Buffer.from('a\nb\nc\n'),
  };
  const hashes = {};
  for (const [name, buf] of Object.entries(files)) {
    fs.writeFileSync(path.join(modelDir, name), buf);
    hashes[name] = sha256(buf);
  }

  // Manifest — keyed by relative path under modelDir
  const manifest = {
    target: 'mac-arm64',
    hasModel: true,
    modelFiles: opts.stripModelFiles ? null : hashes,
  };
  if (!opts.skipManifest) {
    fs.writeFileSync(path.join(bundleDir, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2));
  }

  // Point process.resourcesPath at the bundle parent so
  // BundledAssets._findBundleDir picks our dir.
  Object.defineProperty(process, 'resourcesPath', { value: root, configurable: true });
  return { root, bundleDir, modelDir, hashes };
}

afterEach(() => { delete process.resourcesPath; });

describe('BundledAssets.verifyModelIntegrity', () => {
  test('clean install returns ok: true with the correct verified count', () => {
    const s = scaffoldBundle();
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(3);
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });

  test('flips ok: false when a model file is mutated (1 byte change)', () => {
    const s = scaffoldBundle();
    // Mutate one file
    fs.writeFileSync(path.join(s.modelDir, 'config.json'), '{"id":"base","sneaky":true}');
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].file).toBe('config.json');
    expect(r.issues[0].reason).toBe('sha256 mismatch');
    expect(r.message).toMatch(/model integrity mismatch/);
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });

  test('flags missing file separately', () => {
    const s = scaffoldBundle();
    fs.unlinkSync(path.join(s.modelDir, 'vocab.txt'));
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(false);
    const miss = r.issues.find(i => i.file === 'vocab.txt');
    expect(miss.reason).toBe('missing');
    expect(miss.actual).toBeNull();
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });

  test('skips (ok: true, skipped) when manifest lacks modelFiles (older bundles)', () => {
    const s = scaffoldBundle({ stripModelFiles: true });
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/lacks modelFiles/);
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });

  test('skips when manifest is missing entirely', () => {
    const s = scaffoldBundle({ skipManifest: true });
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });

  test('skips when manifest JSON is unparseable (does not throw)', () => {
    const s = scaffoldBundle();
    fs.writeFileSync(path.join(s.bundleDir, 'bundle-manifest.json'), '{not valid');
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/unparseable/);
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });

  test('multiple issues reported together, not just the first', () => {
    const s = scaffoldBundle();
    fs.unlinkSync(path.join(s.modelDir, 'vocab.txt'));
    fs.writeFileSync(path.join(s.modelDir, 'config.json'), 'mutated');
    const ba = new BundledAssets();
    const r = ba.verifyModelIntegrity(s.modelDir);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(2);
    const reasons = r.issues.map(i => i.reason).sort();
    expect(reasons).toEqual(['missing', 'sha256 mismatch']);
    try { fs.rmSync(s.root, { recursive: true, force: true }); } catch (_) {}
  });
});
