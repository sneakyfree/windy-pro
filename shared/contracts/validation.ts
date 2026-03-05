/**
 * @windy-pro/contracts — Zod validation schemas
 *
 * Every API request/response has a corresponding Zod schema.
 * Schemas are used by the server validation middleware to parse
 * and validate incoming requests before they reach route handlers.
 */
import { z } from 'zod';

// ─── Auth Schemas ────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    deviceId: z.string().optional(),
    deviceName: z.string().optional(),
    platform: z.string().optional(),
});

export const LoginRequestSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
    deviceId: z.string().optional(),
    deviceName: z.string().optional(),
    platform: z.string().optional(),
});

export const RefreshRequestSchema = z.object({
    refreshToken: z.string().min(1, 'refreshToken is required'),
    deviceId: z.string().optional(),
});

export const RegisterDeviceRequestSchema = z.object({
    deviceId: z.string().min(1, 'deviceId is required'),
    deviceName: z.string().optional(),
    platform: z.string().optional(),
});

export const RemoveDeviceRequestSchema = z.object({
    deviceId: z.string().min(1, 'deviceId is required'),
});

export const ChangePasswordRequestSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

// ─── Translation Schemas ─────────────────────────────────────

export const TranslateTextRequestSchema = z.object({
    text: z.string().min(1, 'Text is required').max(5000, 'Text too long (max 5000 chars)'),
    // Desktop sends sourceLang/targetLang, mobile sends source/target — accept both
    sourceLang: z.string().min(1).optional(),
    targetLang: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
}).refine(
    (d) => (d.sourceLang || d.source) && (d.targetLang || d.target),
    { message: 'sourceLang/source and targetLang/target are required' }
);

export const FavoriteToggleRequestSchema = z.object({
    translationId: z.string().min(1, 'translationId is required'),
});

// ─── Transcription Schemas ───────────────────────────────────

export const TranscribeRequestSchema = z.object({
    language: z.string().optional().default('en'),
    engine: z.string().optional().default('cloud-standard'),
});

export const BatchTranscribeRequestSchema = z.object({
    language: z.string().optional().default('en'),
    engine: z.string().optional().default('cloud-standard'),
    count: z.coerce.number().optional(),
});

// ─── Recording Schemas ───────────────────────────────────────

export const ChunkUploadRequestSchema = z.object({
    bundle_id: z.string().min(1, 'bundle_id is required'),
    chunk_index: z.coerce.number().int().min(0),
    total_chunks: z.coerce.number().int().min(1),
    data: z.string().optional(),
    file_type: z.string().optional(),
});

export const RecordingUploadBodySchema = z.object({
    bundle_id: z.string().optional(),
    id: z.string().optional(),
    duration_seconds: z.coerce.number().optional(),
    has_video: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
    video_resolution: z.string().optional(),
    camera_source: z.string().optional(),
    transcript_text: z.string().optional(),
    transcript: z.string().optional(),
    transcript_segments: z.string().optional(),
    segments_json: z.string().optional(),
    device_platform: z.string().optional(),
    app_version: z.string().optional(),
    clone_training_ready: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
});

export const RecordingCheckQuerySchema = z.object({
    bundle_id: z.string().min(1, 'bundle_id parameter required'),
});

// ─── Clone Schemas ───────────────────────────────────────────

export const StartTrainingRequestSchema = z.object({
    bundle_ids: z.array(z.string()).min(3, 'At least 3 training-ready bundles required'),
});

// ─── License Schemas ─────────────────────────────────────────

export const LicenseActivateRequestSchema = z.object({
    key: z.string().regex(/^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid license key format. Expected: WP-XXXX-XXXX-XXXX'),
});

// ─── Misc Schemas ────────────────────────────────────────────

export const AnalyticsRequestSchema = z.object({
    event: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
});

export const RtcSignalRequestSchema = z.object({
    type: z.enum(['offer', 'answer', 'ice-candidate', 'switch-camera']),
    token: z.string().min(1, 'Token required'),
    sdp: z.string().optional(),
    candidate: z.unknown().optional(),
});

export const RtcSignalQuerySchema = z.object({
    token: z.string().min(1, 'Token required'),
    type: z.enum(['offer', 'answer']).optional(),
});

// ─── Admin Schemas ───────────────────────────────────────────

export const AdminUsersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    search: z.string().optional().default(''),
});

// ─── OCR Schemas ─────────────────────────────────────────────

export const OcrTranslateBodySchema = z.object({
    targetLanguage: z.string().optional().default('en'),
});

// ─── Speech Translation Schemas ──────────────────────────────

export const SpeechTranslateBodySchema = z.object({
    sourceLang: z.string().min(1).optional(),
    targetLang: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
}).refine(
    (d) => (d.sourceLang || d.source) && (d.targetLang || d.target),
    { message: 'sourceLang/source and targetLang/target are required' }
);

// ─── History Query Schemas ───────────────────────────────────

export const HistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

// ─── Recordings List Query Schema ────────────────────────────

export const RecordingsListQuerySchema = z.object({
    since: z.string().optional().default('1970-01-01T00:00:00Z'),
});

// ─── File Storage Schemas (merged from cloud-storage) ────────

export const FileUploadBodySchema = z.object({
    type: z.enum(['transcript', 'audio', 'video']).optional().default('transcript'),
    sessionDate: z.string().optional(),
    metadata: z.string().optional(),  // JSON string
});

export const FileListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

// ─── Billing Schemas (merged from cloud-storage) ─────────────

export const BillingTransactionsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    status: z.string().optional(),
});

export const RefundRequestSchema = z.object({
    transactionId: z.string().min(1, 'transactionId is required'),
});

// ─── Admin User Management Schemas ───────────────────────────

export const AdminFreezeRequestSchema = z.object({
    frozen: z.boolean().optional().default(true),
});

export const AdminTierRequestSchema = z.object({
    tier: z.enum(['free', 'pro', 'translate', 'translate-pro']).optional(),
    storageLimit: z.number().int().optional(),
});

export const AdminCouponCreateSchema = z.object({
    code: z.string().min(1, 'Coupon code is required'),
    discountPercent: z.number().int().min(1).max(100),
    maxUses: z.number().int().optional().default(999),
    expiresAt: z.string().optional(),
});
