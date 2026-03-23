/**
 * Windy Pro — Marketplace & Download Manager Smoke Tests
 *
 * Tests the pair catalog, bundles, download manager, and marketplace panel.
 * Run: npx jest tests/test_marketplace.js --verbose
 *
 * DNA Strand: L (hardening)
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// ═══════════════════════════════════════════
// 1. Pair Catalog (pair-catalog.json)
// ═══════════════════════════════════════════

describe('pair-catalog.json', () => {
  let catalog;

  beforeAll(() => {
    catalog = require('../shared/pair-catalog.json');
  });

  test('loads and has exactly 50 entries', () => {
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog).toHaveLength(50);
  });

  test('every entry has required fields: id, source, target, quality, price', () => {
    for (const entry of catalog) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);

      expect(typeof entry.source).toBe('string');
      expect(entry.source.length).toBeGreaterThan(0);

      expect(typeof entry.target).toBe('string');
      expect(entry.target.length).toBeGreaterThan(0);

      expect(typeof entry.quality).toBe('number');
      expect(entry.quality).toBeGreaterThanOrEqual(1);
      expect(entry.quality).toBeLessThanOrEqual(5);

      expect(typeof entry.price).toBe('number');
      expect(entry.price).toBeGreaterThan(0);
    }
  });

  test('all IDs are unique', () => {
    const ids = catalog.map(e => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ═══════════════════════════════════════════
// 2. Pair Bundles (pair-bundles.json)
// ═══════════════════════════════════════════

describe('pair-bundles.json', () => {
  let bundles;

  beforeAll(() => {
    bundles = require('../shared/pair-bundles.json');
  });

  test('loads and has exactly 7 entries (6 regional packs + Marco Polo)', () => {
    expect(Array.isArray(bundles)).toBe(true);
    expect(bundles).toHaveLength(7);
  });

  test('bundles have correct prices ($49, $49, $59, $69, $79, $129, $399)', () => {
    const prices = bundles.map(b => b.price).sort((a, b) => a - b);
    expect(prices).toEqual([49, 49, 59, 69, 79, 129, 399]);
  });

  test('every bundle has required fields', () => {
    for (const bundle of bundles) {
      expect(typeof bundle.id).toBe('string');
      expect(typeof bundle.name).toBe('string');
      expect(typeof bundle.price).toBe('number');
      expect(typeof bundle.pairCount).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════
// 3. PairDownloadManager
// ═══════════════════════════════════════════

describe('PairDownloadManager', () => {
  let PairDownloadManager;
  let tmpDir;

  beforeAll(() => {
    ({ PairDownloadManager } = require('../src/client/desktop/pair-download-manager'));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-test-pairs-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('constructor does not throw', () => {
    expect(() => {
      new PairDownloadManager(tmpDir, 'test-license-token');
    }).not.toThrow();
  });

  test('getDownloadedPairs() returns empty array on fresh install', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const pairs = mgr.getDownloadedPairs();
    expect(Array.isArray(pairs)).toBe(true);
    expect(pairs).toHaveLength(0);
  });

  test('getStorageInfo() returns object with usedBytes and availableBytes', async () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const info = await mgr.getStorageInfo();

    expect(typeof info).toBe('object');
    expect(typeof info.usedBytes).toBe('number');
    expect(typeof info.availableBytes).toBe('number');
    expect(info.usedBytes).toBe(0); // No pairs downloaded
    expect(Array.isArray(info.pairs)).toBe(true);
    expect(info.pairs).toHaveLength(0);
  });

  test('downloadPair() with invalid pairId returns error gracefully', async () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');

    // Pass null catalog — pairInfo will be undefined
    const result = await mgr.downloadPair('nonexistent-pair-xyz', { pairs: {} });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/unknown|invalid|not found/i);
  });

  test('downloadPair() with empty pairId returns error gracefully', async () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const result = await mgr.downloadPair('', { pairs: {} });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('encryption key derivation produces consistent output for same inputs', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-license-key-123');

    // HKDF _deriveKey() uses device fingerprint as salt (no explicit salt arg)
    const key1 = mgr._deriveKey();
    const key2 = mgr._deriveKey();

    expect(Buffer.isBuffer(key1)).toBe(true);
    expect(key1.length).toBe(32); // 256 bits
    expect(key1.equals(key2)).toBe(true);

    // Different license token → different key
    const mgr2 = new PairDownloadManager(tmpDir, 'different-license-key');
    const key3 = mgr2._deriveKey();
    expect(key1.equals(key3)).toBe(false);
  });

  test('encrypt/decrypt roundtrip produces original data', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-license-roundtrip');
    const plaintext = Buffer.from('Hello, this is a test model file content!');

    // WMOD _encrypt() handles IV internally
    const encrypted = mgr._encrypt(plaintext);
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(encrypted.length).toBeGreaterThan(plaintext.length); // WMOD header (34 bytes) + ciphertext

    // WMOD _decrypt() reads IV/authTag from header
    const decrypted = mgr._decrypt(encrypted);
    expect(decrypted.equals(plaintext)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 4. MarketplacePanel (renderer / browser context)
// ═══════════════════════════════════════════

describe('MarketplacePanel', () => {
  test('can be instantiated with mock app object', () => {
    // MarketplacePanel runs in browser context — we need to set up minimal DOM globals
    const { JSDOM } = (() => {
      try { return require('jsdom'); } catch { return { JSDOM: null }; }
    })();

    if (!JSDOM) {
      // If jsdom is not installed, verify the file at least parses
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'client', 'desktop', 'renderer', 'marketplace.js'),
        'utf-8'
      );
      expect(typeof src).toBe('string');
      expect(src.length).toBeGreaterThan(100);
      expect(src).toContain('class MarketplacePanel');

      // Evaluate the class in a mock browser context
      const mockDocument = {
        createElement: (tag) => ({
          className: '', id: '', innerHTML: '', textContent: '',
          style: {}, dataset: {},
          classList: { add() {}, remove() {}, contains() { return false; } },
          appendChild() {}, querySelector() { return null; },
          querySelectorAll() { return []; },
          addEventListener() {},
        }),
        body: {
          appendChild() {},
        },
        getElementById() { return null; },
        addEventListener() {},
      };

      const mockWindow = { windyAPI: {} };
      const mockLocalStorage = { getItem: () => null, setItem: () => {} };

      // Use Function constructor to evaluate in controlled scope
      const fn = new Function(
        'document', 'window', 'localStorage', 'console',
        src + '\n; return MarketplacePanel;'
      );
      const MarketplacePanel = fn(mockDocument, mockWindow, mockLocalStorage, console);

      const panel = new MarketplacePanel({ settings: {} });
      expect(panel).toBeTruthy();
      expect(panel.catalog).toEqual([]);
      expect(panel.bundles).toEqual([]);
      expect(panel.downloadedPairs).toEqual([]);
      return;
    }

    // Full jsdom path
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const { window } = dom;
    global.document = window.document;
    global.window = window;
    global.localStorage = { getItem: () => null, setItem: () => {} };
    window.windyAPI = {};

    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'client', 'desktop', 'renderer', 'marketplace.js'),
      'utf-8'
    );
    const fn = new Function('document', 'window', 'localStorage', src + '\n; return MarketplacePanel;');
    const MarketplacePanel = fn(window.document, window, global.localStorage);

    const panel = new MarketplacePanel({ settings: {} });
    expect(panel).toBeTruthy();
    expect(panel.catalog).toEqual([]);
    expect(panel.bundles).toEqual([]);

    // Clean up
    delete global.document;
    delete global.window;
    delete global.localStorage;
  });
});
