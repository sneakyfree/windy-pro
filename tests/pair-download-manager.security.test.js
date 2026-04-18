/**
 * Unit tests for PairDownloadManager._validatePairId.
 *
 * These pin SEC-PAIR-1 (path traversal in pair-delete IPC) — a malicious
 * renderer must not be able to escape the pairsDir via crafted pairIds.
 *
 * Re-running these on every push catches future regressions: if anyone
 * loosens the regex (e.g. adds "." to allow language sub-tags like
 * "windy-pair-zh.cn-en"), at least one of these tests will fail and
 * force them to re-think the allowlist.
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { PairDownloadManager } = require('../src/client/desktop/pair-download-manager');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pdm-sec-'));
const pairsDir = path.join(tmpRoot, 'pairs');
fs.mkdirSync(pairsDir, { recursive: true });

function mkMgr() {
  return new PairDownloadManager(pairsDir, 'fake-license-token');
}

describe('PairDownloadManager._validatePairId', () => {
  test.each([
    ['../etc'],
    ['../../etc'],
    ['../../../etc/passwd'],
    ['..'],
    ['./..'],
    ['/etc/passwd'],
    ['windy-pair-en-es/../../etc'],
    ['windy.pair.en.es'], // dot disallowed (would let . segments slip in)
    ['has space'],
    ['has\nnewline'],
    ['null\0byte'],
    [''],
    ['   '],
    ['a'.repeat(200)], // overlength
    [123],
    [null],
    [undefined],
    [{}],
    [['arr']],
    // Windows path separators — even on Unix, must reject (the same
    // build runs on Windows where these would escape).
    ['..\\..\\etc'],
    ['windy-pair\\..\\..\\etc'],
  ])('rejects %j', (bad) => {
    const mgr = mkMgr();
    expect(() => mgr._validatePairId(bad)).toThrow();
  });

  test.each([
    ['windy-pair-en-es'],
    ['windy_pair_en_es'],
    ['abc123'],
    ['ABC-XYZ-99'],
    ['x'],
  ])('accepts %j', (good) => {
    const mgr = mkMgr();
    expect(() => mgr._validatePairId(good)).not.toThrow();
  });
});

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
});
