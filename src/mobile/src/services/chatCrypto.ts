/**
 * Windy Chat — E2E Encryption Module (Mobile / React Native)
 * K7: E2E Encryption — Production Grade (DNA Strand K)
 *
 * Mobile-specific E2EE using matrix-js-sdk Rust crypto.
 * Handles device verification, key backup, and cross-signing.
 */

// ── Types ──

export interface CryptoStatus {
  cryptoReady: boolean;
  hasKeyBackup: boolean;
  backupVersion: string | null;
  engine: 'rust' | 'olm' | 'none';
}

export interface DeviceInfo {
  deviceId: string;
  displayName: string;
  verified: boolean;
  lastSeen?: number;
}

export interface SASVerification {
  emojis: Array<{ emoji: string; description: string }>;
  decimals: number[];
  confirm: () => Promise<void>;
  cancel: () => void;
}

export interface KeyBackupResult {
  success: boolean;
  version?: string;
  recoveryKey?: string;
  totalKeys?: number;
  imported?: number;
  message: string;
}

// ── Mobile Crypto Manager ──

export class MobileChatCrypto {
  private cryptoReady: boolean = false;
  private backupVersion: string | null = null;
  private client: any;

  constructor(matrixClient: any) {
    this.client = matrixClient;
  }

  /**
   * Initialize crypto — Rust crypto preferred.
   * K7.1: Olm/Megolm Installation
   */
  async initialize(): Promise<boolean> {
    try {
      if (this.client.initRustCrypto) {
        await this.client.initRustCrypto();
        console.log('🔐 Mobile Rust crypto initialized');
      } else if (this.client.initCrypto) {
        await this.client.initCrypto();
        console.log('🔐 Mobile Olm crypto initialized');
      } else {
        console.warn('⚠️  No crypto module available');
        return false;
      }

      this.client.setGlobalErrorOnUnknownDevices(false);
      this.cryptoReady = true;

      // Check for existing backup
      await this.checkKeyBackup();

      return true;
    } catch (err) {
      console.error('Mobile crypto init failed:', err);
      return false;
    }
  }

  /**
   * Enable encryption on a room.
   */
  async enableRoomEncryption(roomId: string): Promise<boolean> {
    if (!this.cryptoReady) return false;

    try {
      await this.client.sendStateEvent(roomId, 'm.room.encryption', {
        algorithm: 'm.megolm.v1.aes-sha2',
      });
      return true;
    } catch (err) {
      console.error('Enable encryption error:', err);
      return false;
    }
  }

  // ── K7.2: Device Verification ──

  /**
   * Start SAS verification with another user.
   */
  async startVerification(userId: string): Promise<string> {
    const request = await this.client.requestVerification(userId);
    return request.channel.transactionId;
  }

  /**
   * Get device list for a user.
   */
  async getDevices(userId: string): Promise<DeviceInfo[]> {
    if (!this.cryptoReady) return [];

    try {
      const devices = await this.client.getStoredDevicesForUser(userId);
      return devices.map((d: any) => ({
        deviceId: d.deviceId,
        displayName: d.getDisplayName() || d.deviceId,
        verified: d.isVerified(),
        lastSeen: d.lastSeen,
      }));
    } catch {
      return [];
    }
  }

  // ── K7.3: Key Backup ──

  /**
   * Create encrypted key backup.
   */
  async createKeyBackup(passphrase?: string): Promise<KeyBackupResult> {
    if (!this.cryptoReady) {
      return { success: false, message: 'Crypto not initialized' };
    }

    try {
      const keyInfo = await this.client.prepareKeyBackupVersion(
        passphrase || null,
        { secureSecretStorage: true },
      );
      const version = await this.client.createKeyBackupVersion(keyInfo);
      await this.client.enableKeyBackup(version);

      this.backupVersion = version.version;

      return {
        success: true,
        version: version.version,
        recoveryKey: keyInfo.recovery_key,
        message: 'Key backup created. Save your recovery key!',
      };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  /**
   * Restore keys from backup.
   */
  async restoreKeyBackup(recoveryKeyOrPassphrase: string): Promise<KeyBackupResult> {
    if (!this.cryptoReady) {
      return { success: false, message: 'Crypto not initialized' };
    }

    try {
      const backupInfo = await this.client.getKeyBackupVersion();
      if (!backupInfo) {
        return { success: false, message: 'No backup found' };
      }

      let result: any;
      try {
        result = await this.client.restoreKeyBackupWithRecoveryKey(
          recoveryKeyOrPassphrase, undefined, undefined, backupInfo,
        );
      } catch {
        result = await this.client.restoreKeyBackupWithPassword(
          recoveryKeyOrPassphrase, undefined, undefined, backupInfo,
        );
      }

      return {
        success: true,
        totalKeys: result.total,
        imported: result.imported,
        message: `Restored ${result.imported} encryption keys`,
      };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  /**
   * Check if key backup exists.
   */
  async checkKeyBackup(): Promise<boolean> {
    try {
      const info = await this.client.getKeyBackupVersion();
      if (info) {
        this.backupVersion = info.version;
        return true;
      }
    } catch {}
    return false;
  }

  // ── K7.4: Cross-Signing ──

  async bootstrapCrossSigning(): Promise<boolean> {
    if (!this.cryptoReady) return false;

    try {
      await this.client.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: async (makeRequest: any) => {
          await makeRequest({});
        },
      });
      return true;
    } catch (err) {
      console.error('Cross-signing error:', err);
      return false;
    }
  }

  getStatus(): CryptoStatus {
    return {
      cryptoReady: this.cryptoReady,
      hasKeyBackup: !!this.backupVersion,
      backupVersion: this.backupVersion,
      engine: this.cryptoReady ? 'rust' : 'none',
    };
  }

  destroy(): void {
    this.cryptoReady = false;
    this.backupVersion = null;
  }
}
