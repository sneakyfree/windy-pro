/**
 * Cloudflare R2 Storage Adapter (TypeScript)
 *
 * S3-compatible wrapper for Cloudflare R2.
 * Ported from services/cloud-storage/r2-adapter.js.
 *
 * Bucket structure:
 *   windypro-storage/
 *   └── users/{userId}/
 *       ├── recordings/{recordingId}.opus
 *       ├── transcriptions/{transcriptionId}.json
 *       ├── translations/{translationId}.json
 *       ├── clone-data/{cloneId}/
 *       └── settings.json
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs';

export interface R2Config {
    bucket?: string;
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
    timeout?: number;
}

export interface R2UploadResult {
    key: string;
    size: number;
}

export interface R2DownloadResult {
    stream: Readable;
    contentType: string | undefined;
    size: number | undefined;
    metadata: Record<string, string>;
}

export interface R2FileInfo {
    key: string;
    size: number;
    lastModified: Date | undefined;
    filename: string;
    type: string;
}

export interface R2UsageResult {
    totalBytes: number;
    totalHuman: string;
    fileCount: number;
    byType: Record<string, number>;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export class R2StorageAdapter {
    private client: S3Client;
    private bucket: string;
    private timeout: number;
    private endpoint: string;

    constructor(config: R2Config = {}) {
        this.bucket = config.bucket || process.env.R2_BUCKET || 'windypro-storage';
        const accountId = config.accountId || process.env.R2_ACCOUNT_ID || '';
        const accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID || '';
        const secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '';
        this.endpoint = config.endpoint || process.env.R2_ENDPOINT ||
            `https://${accountId}.r2.cloudflarestorage.com`;

        this.client = new S3Client({
            region: 'auto',
            endpoint: this.endpoint,
            forcePathStyle: true,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });

        this.timeout = config.timeout || parseInt(process.env.R2_TIMEOUT_MS || '10000', 10);
        console.log(`[R2] Initialized — bucket: ${this.bucket}, endpoint: ${this.endpoint}, timeout: ${this.timeout}ms`);
    }

    private buildKey(userId: string, type: string, filename: string): string {
        return `users/${userId}/${type}/${filename}`;
    }

    async upload(
        userId: string,
        type: string,
        filename: string,
        body: Buffer | Readable,
        metadata: Record<string, string> = {},
    ): Promise<R2UploadResult> {
        const key = this.buildKey(userId, type, filename);
        const contentLength = Buffer.isBuffer(body) ? body.length : undefined;
        const { contentType, ...rest } = metadata;

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType || 'application/octet-stream',
            Metadata: {
                'windy-user-id': userId,
                'windy-file-type': type,
                'windy-upload-time': new Date().toISOString(),
                ...Object.fromEntries(
                    Object.entries(rest).map(([k, v]) => [k, String(v)]),
                ),
            },
        });

        await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
        const size = contentLength ?? await this.getObjectSize(key);

        console.log(`[R2] Uploaded: ${key} (${formatBytes(size)})`);
        return { key, size };
    }

    async uploadFromMulter(
        userId: string,
        multerFile: Express.Multer.File,
        type: string,
    ): Promise<R2UploadResult> {
        const buffer = fs.readFileSync(multerFile.path);

        const result = await this.upload(userId, type, multerFile.filename, buffer, {
            contentType: multerFile.mimetype,
            originalName: multerFile.originalname,
        });

        try { fs.unlinkSync(multerFile.path); } catch { /* temp cleanup */ }

        return { ...result, size: multerFile.size };
    }

    async download(key: string): Promise<R2DownloadResult> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
        return {
            stream: response.Body as Readable,
            contentType: response.ContentType,
            size: response.ContentLength,
            metadata: (response.Metadata as Record<string, string>) || {},
        };
    }

    async delete(key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
        console.log(`[R2] Deleted: ${key}`);
    }

    async listFiles(userId: string, type?: string): Promise<R2FileInfo[]> {
        const prefix = type ? `users/${userId}/${type}/` : `users/${userId}/`;
        const files: R2FileInfo[] = [];
        let continuationToken: string | undefined;

        do {
            const command = new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                MaxKeys: 1000,
                ContinuationToken: continuationToken,
            });

            const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
            if (response.Contents) {
                for (const obj of response.Contents) {
                    files.push({
                        key: obj.Key!,
                        size: obj.Size || 0,
                        lastModified: obj.LastModified,
                        filename: path.basename(obj.Key!),
                        type: obj.Key!.split('/')[2] || 'unknown',
                    });
                }
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        return files;
    }

    async getUsage(userId: string): Promise<R2UsageResult> {
        const files = await this.listFiles(userId);
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        const byType: Record<string, number> = {};

        for (const f of files) {
            byType[f.type] = (byType[f.type] || 0) + f.size;
        }

        return { totalBytes, totalHuman: formatBytes(totalBytes), fileCount: files.length, byType };
    }

    async deleteAllForUser(userId: string): Promise<{ deletedCount: number; totalFiles: number }> {
        const files = await this.listFiles(userId);
        let deletedCount = 0;

        for (const file of files) {
            try {
                await this.delete(file.key);
                deletedCount++;
            } catch (err: any) {
                console.error(`[R2] Failed to delete ${file.key}:`, err.message);
            }
        }

        console.log(`[R2] Deleted ${deletedCount}/${files.length} files for user ${userId}`);
        return { deletedCount, totalFiles: files.length };
    }

    private async getObjectSize(key: string): Promise<number> {
        try {
            const command = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
            const response = await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
            return response.ContentLength || 0;
        } catch {
            return 0;
        }
    }

    async healthCheck(): Promise<{ ok: boolean; bucket?: string; endpoint?: string; error?: string }> {
        try {
            const command = new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 });
            await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeout) });
            return { ok: true, bucket: this.bucket, endpoint: this.endpoint };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}

/**
 * Returns true if R2 environment variables are configured.
 */
export function isR2Configured(): boolean {
    return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID);
}
