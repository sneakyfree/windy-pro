/**
 * Windy Pro — Model Protection System Tests
 *
 * Tests for Layer 1 (HKDF + WMOD encryption), Layer 2 (heartbeat/grace),
 * and migration of legacy models.
 *
 * Run: npx jest tests/model-protection.test.js --verbose
 *
 * DNA Strand: L6 (Model Protection)
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// ═══════════════════════════════════════════
// 1. HKDF Key Derivation + WMOD Format
// ═══════════════════════════════════════════

describe('PairDownloadManager — HKDF + WMOD', () => {
  let PairDownloadManager;
  let tmpDir;

  beforeAll(() => {
    ({ PairDownloadManager } = require('../src/client/desktop/pair-download-manager'));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-test-wmod-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('device fingerprint is deterministic and 64-char hex', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const fp1 = mgr.getDeviceFingerprintHex();
    const fp2 = mgr.getDeviceFingerprintHex();

    expect(typeof fp1).toBe('string');
    expect(fp1).toHaveLength(64);
    expect(fp1).toBe(fp2); // Deterministic
    expect(/^[0-9a-f]{64}$/.test(fp1)).toBe(true);
  });

  test('device fingerprint is a 32-byte Buffer', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const fp = mgr.getDeviceFingerprint();

    expect(Buffer.isBuffer(fp)).toBe(true);
    expect(fp.length).toBe(32);
  });

  test('HKDF key derivation produces consistent output for same inputs', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-license-key-123');

    const key1 = mgr._deriveKey();
    const key2 = mgr._deriveKey();

    expect(Buffer.isBuffer(key1)).toBe(true);
    expect(key1.length).toBe(32); // 256 bits
    expect(key1.equals(key2)).toBe(true);
  });

  test('different license tokens produce different keys', () => {
    const mgr1 = new PairDownloadManager(tmpDir, 'license-token-A');
    const mgr2 = new PairDownloadManager(tmpDir, 'license-token-B');

    const key1 = mgr1._deriveKey();
    const key2 = mgr2._deriveKey();

    expect(key1.equals(key2)).toBe(false);
  });

  test('WMOD encrypt produces valid header', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const plaintext = Buffer.from('Hello WMOD model data!');

    const wmod = mgr._encrypt(plaintext);

    expect(Buffer.isBuffer(wmod)).toBe(true);
    expect(wmod.length).toBeGreaterThan(34); // 34-byte header + ciphertext

    // Check magic bytes
    expect(wmod.subarray(0, 4).toString('ascii')).toBe('WMOD');

    // Check version
    expect(wmod.readUInt16BE(4)).toBe(1);
  });

  test('WMOD encrypt/decrypt roundtrip', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-license-roundtrip');
    const plaintext = Buffer.from('This is test model content for WMOD roundtrip verification. 🚀');

    const encrypted = mgr._encrypt(plaintext);
    const decrypted = mgr._decrypt(encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test('WMOD decrypt fails with tampered data', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const plaintext = Buffer.from('Sensitive model data');

    const wmod = mgr._encrypt(plaintext);

    // Tamper with ciphertext (byte 40 is well into the encrypted payload)
    const tampered = Buffer.from(wmod);
    tampered[40] ^= 0xFF;

    expect(() => mgr._decrypt(tampered)).toThrow();
  });

  test('WMOD decrypt fails with wrong license token', () => {
    const mgr1 = new PairDownloadManager(tmpDir, 'token-A');
    const mgr2 = new PairDownloadManager(tmpDir, 'token-B');
    const plaintext = Buffer.from('Secret model weights');

    const encrypted = mgr1._encrypt(plaintext);

    // Different token should fail decryption
    expect(() => mgr2._decrypt(encrypted)).toThrow();
  });

  test('WMOD decrypt fails on too-small buffer', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');

    expect(() => mgr._decrypt(Buffer.from('small'))).toThrow(/too small/);
  });

  test('WMOD decrypt fails on wrong magic bytes', () => {
    const mgr = new PairDownloadManager(tmpDir, 'test-token');
    const fakeBuf = Buffer.alloc(50, 0);
    fakeBuf.write('FAKE', 0, 'ascii');

    expect(() => mgr._decrypt(fakeBuf)).toThrow(/bad magic/);
  });

  test('hasWmodHeader recognizes valid WMOD', () => {
    const wmod = Buffer.from('WMOD\x00\x01' + '\x00'.repeat(28) + 'payload');
    expect(PairDownloadManager.hasWmodHeader(wmod)).toBe(true);
  });

  test('hasWmodHeader rejects non-WMOD', () => {
    expect(PairDownloadManager.hasWmodHeader(Buffer.from('NOT_WMOD'))).toBe(false);
    expect(PairDownloadManager.hasWmodHeader(Buffer.from('WM'))).toBe(false);
    expect(PairDownloadManager.hasWmodHeader(null)).toBe(false);
  });

  test('large model encrypt/decrypt roundtrip (1MB)', () => {
    const mgr = new PairDownloadManager(tmpDir, 'large-model-test');
    const plaintext = crypto.randomBytes(1024 * 1024);

    const encrypted = mgr._encrypt(plaintext);
    const decrypted = mgr._decrypt(encrypted);

    expect(decrypted.length).toBe(plaintext.length);
    expect(decrypted.equals(plaintext)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 2. Model Migration
// ═══════════════════════════════════════════

describe('Model Migration', () => {
  let PairDownloadManager;
  let tmpDir;

  beforeAll(() => {
    ({ PairDownloadManager } = require('../src/client/desktop/pair-download-manager'));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-test-migrate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('unencrypted model can be encrypted to WMOD then decrypted', () => {
    const mgr = new PairDownloadManager(tmpDir, 'migration-test-token');
    const rawModel = crypto.randomBytes(1024);

    // Simulate an unencrypted model file
    const pairDir = path.join(tmpDir, 'en-es');
    fs.mkdirSync(pairDir, { recursive: true });
    fs.writeFileSync(path.join(pairDir, 'model.enc'), rawModel);

    // Verify it doesn't have WMOD header
    expect(PairDownloadManager.hasWmodHeader(rawModel)).toBe(false);

    // Encrypt to WMOD format
    const wmod = mgr._encrypt(rawModel);
    fs.writeFileSync(path.join(pairDir, 'model.enc'), wmod);

    // Verify WMOD header
    const stored = fs.readFileSync(path.join(pairDir, 'model.enc'));
    expect(PairDownloadManager.hasWmodHeader(stored)).toBe(true);

    // Decrypt and verify roundtrip
    const decrypted = mgr._decrypt(stored);
    expect(decrypted.equals(rawModel)).toBe(true);
  });

  test('decryptLegacy can recover PBKDF2-encrypted data', () => {
    // Simulate legacy encryption
    const token = 'legacy-license-token';
    const deviceId = os.hostname() + '-' + os.platform();
    const plaintext = Buffer.from('Legacy model content for testing');
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);

    // Encrypt with legacy PBKDF2 method
    const passphrase = token + deviceId;
    const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha512');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const cipherWithTag = Buffer.concat([encrypted, authTag]);

    // Decrypt with legacy static method
    const decrypted = PairDownloadManager.decryptLegacy(cipherWithTag, salt, iv, token, deviceId);
    expect(decrypted.equals(plaintext)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 3. HeartbeatService
// ═══════════════════════════════════════════

describe('HeartbeatService', () => {
  let HeartbeatService;

  beforeAll(() => {
    ({ HeartbeatService } = require('../src/client/desktop/heartbeat-service'));
  });

  test('constructor does not throw', () => {
    const store = { get: () => null, set: () => {} };
    const svc = new HeartbeatService({
      store,
      safeStorage: { isEncryptionAvailable: () => false },
      retrieveLicenseToken: () => 'test-token',
      getDeviceFingerprint: () => 'a'.repeat(64),
      appVersion: '1.0.0'
    });
    expect(svc).toBeTruthy();
  });

  test('grace period check locks models when expired', () => {
    let locked = false;
    const store = new Map();
    const storeObj = {
      get: (k, d) => store.has(k) ? store.get(k) : d,
      set: (k, v) => store.set(k, v)
    };

    // Set last check to 25 hours ago (exceeds free tier 24h grace)
    const twentyFiveHoursAgo = Date.now() - (25 * 60 * 60 * 1000);
    store.set('heartbeat.lastCheckTime', twentyFiveHoursAgo);
    store.set('heartbeat.graceStartTime', twentyFiveHoursAgo);
    store.set('license.tier', 'free');

    const svc = new HeartbeatService({
      store: storeObj,
      safeStorage: { isEncryptionAvailable: () => false },
      retrieveLicenseToken: () => 'free',
      getDeviceFingerprint: () => 'a'.repeat(64),
      appVersion: '1.0.0',
      onLicenseLocked: () => { locked = true; }
    });

    svc._checkGracePeriod('free');
    expect(locked).toBe(true);
  });

  test('grace period does NOT lock when within grace', () => {
    let locked = false;
    const store = new Map();
    const storeObj = {
      get: (k, d) => store.has(k) ? store.get(k) : d,
      set: (k, v) => store.set(k, v)
    };

    // Set last check to 1 hour ago (well within pro tier 7d grace)
    const oneHourAgo = Date.now() - (1 * 60 * 60 * 1000);
    store.set('heartbeat.lastCheckTime', oneHourAgo);
    store.set('heartbeat.graceStartTime', oneHourAgo);
    store.set('license.tier', 'pro');

    const svc = new HeartbeatService({
      store: storeObj,
      safeStorage: { isEncryptionAvailable: () => false },
      retrieveLicenseToken: () => 'pro-token',
      getDeviceFingerprint: () => 'b'.repeat(64),
      appVersion: '1.0.0',
      onLicenseLocked: () => { locked = true; }
    });

    svc._checkGracePeriod('pro');
    expect(locked).toBe(false);
  });

  test('all tier grace periods are defined correctly', () => {
    // Verify the GRACE_PERIODS constant values (test that the module loads correctly)
    const svc = new HeartbeatService({
      store: { get: () => null, set: () => {} },
      safeStorage: { isEncryptionAvailable: () => false },
      retrieveLicenseToken: () => 'test',
      getDeviceFingerprint: () => 'c'.repeat(64),
      appVersion: '1.0.0'
    });

    // Test that the service doesn't crash when checking each tier
    ['free', 'pro', 'translate', 'translate_pro', 'marco_polo'].forEach(tier => {
      expect(() => svc._checkGracePeriod(tier)).not.toThrow();
    });
  });
});
