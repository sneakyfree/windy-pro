/**
 * Windy Chat — E2E Encryption Module (Desktop)
 * K7: E2E Encryption — Production Grade (DNA Strand K)
 *
 * K7.1 Olm / Megolm installation (Rust crypto preferred)
 * K7.2 Device verification (SAS emoji, QR code)
 * K7.3 Key backup (SSSS — Secure Secret Storage)
 * K7.4 Cross-signing
 *
 * CURRENT STATE: _initCrypto() in chat-client.js loads @matrix-org/olm
 * but it's not installed → falls back to unencrypted.
 * K7 enables it properly with full crypto init and key backup.
 */

'use strict';

const crypto = require('crypto');
const log = require('../logger')('ChatCrypto');

// ── K7.1: Crypto Initialization ──

class ChatCrypto {
  constructor(matrixClient) {
    this.client = matrixClient;
    this.cryptoReady = false;
    this.backupInfo = null;
    this.verificationRequests = new Map();
  }

  /**
   * Initialize Matrix E2E encryption.
   * K7.1.1: Dependencies — prefer Rust crypto over libolm
   * K7.1.2: Client initialization
   */
  async initialize() {
    // Guard: prevent double initialization (listeners would accumulate)
    if (this.cryptoReady) {
      log.state('initialize', 'already initialized — skipping');
      return true;
    }
    log.entry('initialize');
    try {
      // Prefer Rust crypto (newer, maintained, no external Olm needed)
      if (this.client.initRustCrypto) {
        await this.client.initRustCrypto();
        log.state('initialize', 'Rust crypto initialized');
      } else if (this.client.initCrypto) {
        // Fallback: legacy Olm/Megolm
        const Olm = require('@matrix-org/olm');
        await Olm.init();
        await this.client.initCrypto();
        log.state('initialize', 'Olm crypto initialized');
      } else {
        log.warn('initialize', 'no crypto module available — E2EE disabled');
        return false;
      }

      // K7.1.2: Auto-trust new devices (UX tradeoff — security vs convenience)
      this.client.setGlobalErrorOnUnknownDevices(false);

      this.cryptoReady = true;

      // Try to restore key backup
      await this._restoreKeyBackup();

      log.exit('initialize', { success: true });
      return true;
    } catch (err) {
      log.error('initialize', err);
      this.cryptoReady = false;
      return false;
    }
  }

  /**
   * Enable encryption on a DM room.
   * K7.1.3: Enable DM Encryption
   */
  async enableRoomEncryption(roomId) {
    if (!this.cryptoReady) {
      log.warn('enableRoomEncryption', 'crypto not initialized');
      return false;
    }
    log.entry('enableRoomEncryption', { roomId: roomId?.slice(0, 12) });

    try {
      await this.client.sendStateEvent(roomId, 'm.room.encryption', {
        algorithm: 'm.megolm.v1.aes-sha2',
        rotation_period_ms: 604800000, // 7 days
        rotation_period_msgs: 100,
      });
      log.exit('enableRoomEncryption', { success: true });
      return true;
    } catch (err) {
      log.error('enableRoomEncryption', err);
      return false;
    }
  }

  // ── K7.2: Device Verification ──

  /**
   * Start SAS (emoji) verification with another device.
   * K7.2.1: SAS Verification (7 emoji comparison)
   */
  async startVerification(userId, deviceId) {
    if (!this.cryptoReady) throw new Error('Crypto not initialized');
    log.entry('startVerification', { userId, deviceId });

    try {
      const request = await this.client.requestVerification(userId);
      this.verificationRequests.set(request.channel.transactionId, request);

      request.on('change', () => {
        if (request.phase === 'started') {
          log.state('startVerification', `verification started with ${userId}`);
        }
      });

      log.exit('startVerification', { transactionId: request.channel.transactionId });
      return {
        transactionId: request.channel.transactionId,
        userId,
        deviceId,
        status: 'requested',
      };
    } catch (err) {
      log.error('startVerification', err);
      throw err;
    }
  }

  /**
   * Handle incoming verification request.
   */
  handleIncomingVerification(request) {
    this.verificationRequests.set(request.channel.transactionId, request);

    return {
      transactionId: request.channel.transactionId,
      fromUser: request.otherUserId,
      methods: request.methods,
    };
  }

  /**
   * Accept verification and show SAS emojis.
   */
  async acceptVerification(transactionId) {
    const request = this.verificationRequests.get(transactionId);
    if (!request) throw new Error('Verification request not found');

    const verifier = request.beginKeyVerification('m.sas.v1');

    return new Promise((resolve, reject) => {
      verifier.on('show_sas', (sas) => {
        resolve({
          emojis: sas.emoji,       // Array of 7 { emoji, description }
          decimals: sas.decimal,   // Array of 3 numbers
          confirm: () => verifier.verify(),
          cancel: () => verifier.cancel(),
        });
      });

      verifier.on('cancel', (e) => {
        reject(new Error(`Verification cancelled: ${e.reason}`));
      });

      verifier.verify().catch(reject);
    });
  }

  /**
   * Get list of devices for a user.
   * K7.2.3: Verification UI
   */
  async getDeviceList(userId) {
    if (!this.cryptoReady) return [];

    try {
      const devices = await this.client.getStoredDevicesForUser(userId);
      return devices.map(d => ({
        deviceId: d.deviceId,
        displayName: d.getDisplayName() || d.deviceId,
        verified: d.isVerified(),
        lastSeen: d.lastSeen,
        keys: d.keys,
      }));
    } catch (err) {
      log.error('getDeviceList', err);
      return [];
    }
  }

  // ── K7.3: Key Backup (SSSS) ──

  /**
   * Create an encrypted key backup.
   * K7.3.1: Backup Creation
   */
  async createKeyBackup(passphrase) {
    if (!this.cryptoReady) throw new Error('Crypto not initialized');

    try {
      // Generate recovery key or derive from passphrase
      let keyInfo;
      if (passphrase) {
        keyInfo = await this.client.prepareKeyBackupVersion(passphrase, { secureSecretStorage: true });
      } else {
        keyInfo = await this.client.prepareKeyBackupVersion(null, { secureSecretStorage: true });
      }

      const backupVersion = await this.client.createKeyBackupVersion(keyInfo);

      // Enable automatic key backup
      await this.client.enableKeyBackup(backupVersion);

      this.backupInfo = {
        version: backupVersion.version,
        recoveryKey: keyInfo.recovery_key,
        createdAt: new Date().toISOString(),
      };

      log.exit('createKeyBackup', { version: backupVersion.version });

      return {
        success: true,
        version: backupVersion.version,
        recoveryKey: keyInfo.recovery_key,
        message: 'Save your recovery key — you will need it on a new device!',
      };
    } catch (err) {
      log.error('createKeyBackup', err);
      throw err;
    }
  }

  /**
   * Restore keys from backup.
   * K7.3.2: Backup Restore
   */
  async restoreKeyBackup(recoveryKeyOrPassphrase) {
    if (!this.cryptoReady) throw new Error('Crypto not initialized');

    try {
      const backupInfo = await this.client.getKeyBackupVersion();
      if (!backupInfo) {
        return { success: false, message: 'No key backup found on server' };
      }

      let result;
      // Try as recovery key first, then as passphrase
      try {
        result = await this.client.restoreKeyBackupWithRecoveryKey(
          recoveryKeyOrPassphrase,
          undefined, undefined,
          backupInfo,
        );
      } catch {
        result = await this.client.restoreKeyBackupWithPassword(
          recoveryKeyOrPassphrase,
          undefined, undefined,
          backupInfo,
        );
      }

      log.exit('restoreKeyBackup', { totalKeys: result.total, imported: result.imported });

      return {
        success: true,
        totalKeys: result.total,
        imported: result.imported,
        message: `Restored ${result.imported} encryption keys`,
      };
    } catch (err) {
      log.error('restoreKeyBackup', err);
      return { success: false, message: err.message };
    }
  }

  /**
   * Try to auto-restore backup on startup.
   */
  async _restoreKeyBackup() {
    try {
      const backupInfo = await this.client.getKeyBackupVersion();
      if (backupInfo) {
        this.backupInfo = { version: backupInfo.version, hasBackup: true };
        log.state('_restoreKeyBackup', `backup found (version: ${backupInfo.version})`);
      }
    } catch {
      // No backup — that's OK
    }
  }

  // ── K7.4: Cross-Signing ──

  /**
   * Bootstrap cross-signing keys.
   */
  async bootstrapCrossSigning(authCallback) {
    if (!this.cryptoReady) throw new Error('Crypto not initialized');

    try {
      await this.client.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: authCallback || (async (makeRequest) => {
          // In production: prompt user for password to authorize key upload
          await makeRequest({});
        }),
      });

      log.exit('bootstrapCrossSigning', { success: true });
      return true;
    } catch (err) {
      log.error('bootstrapCrossSigning', err);
      return false;
    }
  }

  /**
   * Check if E2EE is fully set up.
   */
  getStatus() {
    return {
      cryptoReady: this.cryptoReady,
      hasKeyBackup: !!(this.backupInfo?.hasBackup || this.backupInfo?.version),
      backupVersion: this.backupInfo?.version || null,
      engine: this.cryptoReady ? 'rust' : 'none',
    };
  }

  /**
   * Cleanup.
   */
  destroy() {
    log.entry('destroy');
    // Clean up any event listeners on pending verification requests
    for (const [, request] of this.verificationRequests) {
      try { request.removeAllListeners?.(); } catch { /* best-effort */ }
    }
    this.verificationRequests.clear();
    this.cryptoReady = false;
    this.backupInfo = null;
    log.exit('destroy');
  }
}

// ── Exports ──

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChatCrypto };
}
