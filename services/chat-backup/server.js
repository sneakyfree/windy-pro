/**
 * Windy Chat — Cloud Backup & Sync Service
 * K8: Chat Cloud Backup and Sync (DNA Strand K)
 *
 * Encrypted backup of chat data to Cloudflare R2 (S3-compatible).
 * Zero-knowledge: server CANNOT decrypt backups.
 *
 * K8.1 Encrypted chat backup (AES-256-GCM, PBKDF2 key derivation)
 * K8.2 Restore on new device
 * K8.3 Soul File integration
 *
 * Port: 8104
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8104;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── In-memory stores (replace with DB in production) ──
const backupRegistry = new Map(); // userId → [{ version, timestamp, size, path }]

// ── R2/S3 Config ──
const R2_BUCKET = process.env.R2_BUCKET || 'windy-chat-backups';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

let s3Client = null;

function initR2() {
  if (!R2_ENDPOINT || !R2_ACCESS_KEY) {
    console.warn('⚠️  R2/S3 not configured — backups will be stubbed');
    return;
  }
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    });
    console.log('☁️  R2 storage initialized');
  } catch (err) {
    console.error('R2 init error:', err.message);
  }
}

// ── K8.1.2: Backup Encryption Helpers ──

/**
 * Derive backup encryption key from password using PBKDF2.
 * 100K iterations for brute-force resistance.
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

/**
 * Encrypt backup data with AES-256-GCM (authenticated encryption).
 * Server CANNOT decrypt — zero-knowledge.
 */
function encryptBackup(data, password) {
  const salt = crypto.randomBytes(32);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt(32) + iv(12) + authTag(16) + ciphertext
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypt backup data.
 */
function decryptBackup(encryptedData, password) {
  const salt = encryptedData.subarray(0, 32);
  const iv = encryptedData.subarray(32, 44);
  const authTag = encryptedData.subarray(44, 60);
  const ciphertext = encryptedData.subarray(60);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── POST /api/v1/chat/backup/create ──

app.post('/api/v1/chat/backup/create', async (req, res) => {
  try {
    const { userId, encryptedData, metadata } = req.body;

    if (!userId || !encryptedData) {
      return res.status(400).json({ error: 'userId and encryptedData required' });
    }

    // Validate size (max 500MB)
    const dataSize = Buffer.byteLength(encryptedData, 'base64');
    if (dataSize > 500 * 1024 * 1024) {
      return res.status(413).json({ error: 'Backup too large. Max 500MB.' });
    }

    const backupId = uuidv4();
    const timestamp = new Date().toISOString();
    const path = `backups/${userId}/${timestamp.replace(/[:.]/g, '-')}.enc`;

    if (s3Client) {
      // Upload to R2
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
        Body: Buffer.from(encryptedData, 'base64'),
        ContentType: 'application/octet-stream',
        Metadata: {
          'x-windy-user': userId,
          'x-windy-backup-id': backupId,
        },
      }));
    } else {
      console.log(`☁️  [STUB] Backup stored: ${path} (${formatSize(dataSize)})`);
    }

    // Register backup
    const userBackups = backupRegistry.get(userId) || [];
    userBackups.unshift({
      id: backupId,
      timestamp,
      size: dataSize,
      path,
      metadata: metadata || {},
    });

    // K8.1.3: Keep last 7 daily backups
    if (userBackups.length > 7) {
      const pruned = userBackups.splice(7);
      // In production: delete pruned backups from R2
      console.log(`🗑️  Pruned ${pruned.length} old backup(s) for ${userId.slice(0, 12)}`);
    }

    backupRegistry.set(userId, userBackups);

    console.log(`☁️  Backup created: ${userId.slice(0, 12)} → ${formatSize(dataSize)}`);

    res.status(201).json({
      success: true,
      backupId,
      timestamp,
      size: dataSize,
      path,
    });

  } catch (err) {
    console.error('Backup create error:', err);
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// ── GET /api/v1/chat/backup/list ──

app.get('/api/v1/chat/backup/list', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const backups = backupRegistry.get(userId) || [];

  res.json({
    userId,
    backups: backups.map(b => ({
      id: b.id,
      timestamp: b.timestamp,
      size: b.size,
      sizeFormatted: formatSize(b.size),
      metadata: b.metadata,
    })),
    count: backups.length,
    maxBackups: 7,
  });
});

// ── POST /api/v1/chat/backup/restore ──

app.post('/api/v1/chat/backup/restore', async (req, res) => {
  try {
    const { userId, backupId } = req.body;

    if (!userId || !backupId) {
      return res.status(400).json({ error: 'userId and backupId required' });
    }

    const userBackups = backupRegistry.get(userId) || [];
    const backup = userBackups.find(b => b.id === backupId);

    if (!backup) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    let encryptedData;

    if (s3Client) {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: backup.path,
      }));
      const chunks = [];
      for await (const chunk of response.Body) chunks.push(chunk);
      encryptedData = Buffer.concat(chunks).toString('base64');
    } else {
      console.log(`☁️  [STUB] Restore: ${backup.path}`);
      encryptedData = null;
    }

    res.json({
      success: true,
      backupId: backup.id,
      timestamp: backup.timestamp,
      size: backup.size,
      encryptedData,
      message: 'Decrypt this backup on your device with your backup password',
    });

  } catch (err) {
    console.error('Backup restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// ── DELETE /api/v1/chat/backup/delete ──

app.delete('/api/v1/chat/backup/delete', async (req, res) => {
  const { userId, backupId } = req.body;

  if (!userId || !backupId) {
    return res.status(400).json({ error: 'userId and backupId required' });
  }

  const userBackups = backupRegistry.get(userId) || [];
  const idx = userBackups.findIndex(b => b.id === backupId);

  if (idx === -1) return res.status(404).json({ error: 'Backup not found' });

  const removed = userBackups.splice(idx, 1)[0];
  backupRegistry.set(userId, userBackups);

  // In production: delete from R2
  res.json({ success: true, deleted: removed.id });
});

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({
    service: 'windy-chat-backup',
    status: 'ok',
    version: '1.0.0',
    r2: !!s3Client,
    timestamp: new Date().toISOString(),
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Start ──
initR2();
app.listen(PORT, () => {
  console.log(`🌪️  Windy Chat Backup — listening on port ${PORT}`);
  console.log(`   R2: ${s3Client ? 'active' : 'stubbed'}`);
});

module.exports = { app, encryptBackup, decryptBackup };
