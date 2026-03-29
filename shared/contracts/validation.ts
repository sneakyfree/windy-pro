/**
 * @windy-pro/contracts — Zod validation schemas
 *
 * Every API request/response has a corresponding Zod schema.
 * Schemas are used by the server validation middleware to parse
 * and validate incoming requests before they reach route handlers.
 */
import { z } from 'zod';

// ─── Auth Schemas ────────────────────────────────────────────

/**
 * Password must match the mobile app's enforced standard:
 *   - At least 8 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *
 * Unified server + mobile validation — SEC-P1.
 */
export const PasswordSchema = z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit');

export const RegisterRequestSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    password: PasswordSchema,
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
    newPassword: PasswordSchema,
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

// ─── Identity Schemas (Phase 10.0) ───────────────────────────

export const IdentityUpdateSchema = z.object({
    displayName: z.string().min(2).max(64).optional(),
    preferredLang: z.string().min(2).max(10).optional(),
    avatarUrl: z.string().url().optional(),
    phone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format').optional(),
});

export const IdentityProvisionSchema = z.object({
    product: z.enum(['windy_pro', 'windy_chat', 'windy_mail', 'windy_fly', 'windy_word', 'windy_traveler', 'windy_clone', 'windy_cloud']),
    metadata: z.record(z.unknown()).optional(),
});

export const IdentityScopeGrantSchema = z.object({
    identityId: z.string().uuid('identityId must be a valid UUID'),
    scopes: z.array(z.string().regex(/^[a-z_]+:[a-z_*]+$/, 'Scope format: product:permission')).min(1),
});

export const IdentityAuditQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    event: z.string().optional(),
    identityId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});

export const EternitasWebhookSchema = z.object({
    event: z.enum(['passport.registered', 'passport.revoked', 'passport.suspended', 'passport.verified', 'identity.created', 'trust_updated']),
    passportNumber: z.string().regex(/^ET-[A-Z0-9]{5}$/, 'Passport format: ET-XXXXX'),
    agentName: z.string().min(1).optional(),
    operatorEmail: z.string().email().optional(),
    timestamp: z.string(),
    signature: z.string().min(1, 'Webhook signature required'),
    payload: z.record(z.unknown()).optional(),
    trustScore: z.number().min(0).max(1).optional(),
});

// ─── Verification Schemas (Phase 1 — Promoted from chat-onboarding) ──

export const VerificationSendSchema = z.object({
    type: z.enum(['phone', 'email']),
    identifier: z.string().min(1).max(255),
    countryCode: z.string().max(5).optional(),
});

export const VerificationCheckSchema = z.object({
    type: z.enum(['phone', 'email']).optional(),
    identifier: z.string().min(1).max(255),
    code: z.string().min(1).max(10),
    countryCode: z.string().max(5).optional(),
});

// ─── Bot API Key Schemas (Phase 3) ──

export const BotApiKeyCreateSchema = z.object({
    identityId: z.string().uuid('identityId must be a valid UUID'),
    scopes: z.array(z.string().regex(/^[a-z_]+:[a-z_*]+$/, 'Scope format: product:permission')).min(1),
    label: z.string().min(1).max(100).optional(),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export const SecretaryConsentSchema = z.object({
    botIdentityId: z.string().uuid('botIdentityId must be a valid UUID'),
    consent: z.boolean(),
});

// ─── OAuth2 Schemas (Phase 5 — "Sign in with Windy") ──

export const OAuthClientCreateSchema = z.object({
    name: z.string().min(1).max(100),
    redirectUris: z.array(z.string().url()).min(1),
    allowedScopes: z.array(z.string()).optional(),
    isFirstParty: z.boolean().optional(),
    isPublic: z.boolean().optional(),
});

export const OAuthAuthorizeSchema = z.object({
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    response_type: z.literal('code'),
    scope: z.string().optional(),
    state: z.string().optional(),
    code_challenge: z.string().min(43).max(128).optional(), // S256 produces 43 base64url chars
    code_challenge_method: z.literal('S256').optional(),
});

export const OAuthTokenSchema = z.object({
    grant_type: z.enum([
        'authorization_code',
        'client_credentials',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
    ]),
    code: z.string().optional(),
    redirect_uri: z.string().optional(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    code_verifier: z.string().min(43).max(128).optional(),
    refresh_token: z.string().optional(),
    device_code: z.string().optional(),
    scope: z.string().optional(),
});

export const DeviceCodeRequestSchema = z.object({
    client_id: z.string().min(1),
    scope: z.string().optional(),
});

export const DeviceCodeApproveSchema = z.object({
    user_code: z.string().min(1),
    approved: z.boolean(),
});
