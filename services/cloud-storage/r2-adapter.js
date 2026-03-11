/**
 * Windy Pro — Cloudflare R2 Storage Adapter
 * 
 * S3-compatible wrapper for Cloudflare R2.
 * Drops into the existing cloud-storage service as the backend.
 * All files are stored as encrypted blobs — we never see user data.
 * 
 * Bucket structure:
 *   windypro-storage/
 *   ├── users/{userId}/
 *   │   ├── recordings/{recordingId}.opus
 *   │   ├── transcriptions/{transcriptionId}.json
 *   │   ├── translations/{translationId}.json
 *   │   ├── clone-data/{cloneId}/
 *   │   └── settings.json
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
        ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const path = require('path');

class R2StorageAdapter {
  constructor(config = {}) {
    this.bucket = config.bucket || process.env.R2_BUCKET || 'windypro-storage';
    this.accountId = config.accountId || process.env.R2_ACCOUNT_ID;
    this.accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
    this.endpoint = config.endpoint || process.env.R2_ENDPOINT ||
      `https://${this.accountId}.r2.cloudflarestorage.com`;

    this.client = new S3Client({
      region: 'auto',
      endpoint: this.endpoint,
      forcePathStyle: true,
      requestHandler: undefined, // use defaults
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
      }
    });

    // Set a 10-second timeout on all operations so uploads don't hang
    this.timeout = config.timeout || parseInt(process.env.R2_TIMEOUT_MS) || 10000;

    console.log(`[R2] Initialized — bucket: ${this.bucket}, endpoint: ${this.endpoint}, timeout: ${this.timeout}ms`);
  }

  /**
   * Build the R2 object key for a user file
   * @param {string} userId
   * @param {string} type - recordings, transcriptions, translations, clone-data
   * @param {string} filename
   */
  _buildKey(userId, type, filename) {
    return `users/${userId}/${type}/${filename}`;
  }

  /**
   * Upload a file to R2
   * @param {string} userId
   * @param {string} type - File category (recordings, transcriptions, etc.)
   * @param {string} filename
   * @param {Buffer|Readable} body - File contents
   * @param {Object} metadata - Optional metadata
   * @returns {Promise<{key: string, size: number}>}
   */
  async upload(userId, type, filename, body, metadata = {}) {
    const key = this._buildKey(userId, type, filename);
    const contentLength = Buffer.isBuffer(body) ? body.length : undefined;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: metadata.contentType || 'application/octet-stream',
      Metadata: {
        'windy-user-id': userId,
        'windy-file-type': type,
        'windy-upload-time': new Date().toISOString(),
        ...Object.fromEntries(
          Object.entries(metadata).filter(([k]) => !['contentType'].includes(k))
            .map(([k, v]) => [k, String(v)])
        )
      }
    });

    await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });

    // Get the actual size from R2
    const size = contentLength || await this._getObjectSize(key);

    console.log(`[R2] Uploaded: ${key} (${formatBytes(size)})`);
    return { key, size };
  }

  /**
   * Upload a file from a local path (multer file object)
   */
  async uploadFromMulter(userId, multerFile, type) {
    const fs = require('fs');
    const buffer = fs.readFileSync(multerFile.path);

    const result = await this.upload(userId, type, multerFile.filename, buffer, {
      contentType: multerFile.mimetype,
      originalName: multerFile.originalname
    });

    // Clean up local temp file
    try { fs.unlinkSync(multerFile.path); } catch (_) {}

    return { ...result, size: multerFile.size };
  }

  /**
   * Download a file from R2
   * @param {string} key - Full object key
   * @returns {Promise<{stream: Readable, contentType: string, size: number}>}
   */
  async download(key) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
    return {
      stream: response.Body,
      contentType: response.ContentType,
      size: response.ContentLength,
      metadata: response.Metadata || {}
    };
  }

  /**
   * Delete a file from R2
   */
  async delete(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
    console.log(`[R2] Deleted: ${key}`);
  }

  /**
   * List files for a user
   * @param {string} userId
   * @param {string} [type] - Optional type filter (recordings, transcriptions, etc.)
   * @returns {Promise<Array<{key, size, lastModified}>>}
   */
  async listFiles(userId, type) {
    const prefix = type ? `users/${userId}/${type}/` : `users/${userId}/`;
    const files = [];
    let continuationToken;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken
      });

      const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
      if (response.Contents) {
        for (const obj of response.Contents) {
          files.push({
            key: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified,
            filename: path.basename(obj.Key),
            type: obj.Key.split('/')[2] || 'unknown'
          });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  }

  /**
   * Calculate total storage used by a user
   */
  async getUsage(userId) {
    const files = await this.listFiles(userId);
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const byType = {};

    for (const f of files) {
      byType[f.type] = (byType[f.type] || 0) + (f.size || 0);
    }

    return {
      totalBytes,
      totalHuman: formatBytes(totalBytes),
      fileCount: files.length,
      byType
    };
  }

  /**
   * Delete all files for a user (account deletion)
   */
  async deleteAllForUser(userId) {
    const files = await this.listFiles(userId);
    let deletedCount = 0;

    for (const file of files) {
      try {
        await this.delete(file.key);
        deletedCount++;
      } catch (err) {
        console.error(`[R2] Failed to delete ${file.key}:`, err.message);
      }
    }

    console.log(`[R2] Deleted ${deletedCount}/${files.length} files for user ${userId}`);
    return { deletedCount, totalFiles: files.length };
  }

  /**
   * Get object size from R2
   */
  async _getObjectSize(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
      return response.ContentLength || 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Check if connected to R2
   */
  async healthCheck() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1
      });
      await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
      return { ok: true, bucket: this.bucket, endpoint: this.endpoint };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

module.exports = { R2StorageAdapter, formatBytes };
