/**
 * @windy-pro/contracts — API route type definitions
 *
 * Typed request/response interfaces for all server routes.
 * Also includes the WebSocket transcription protocol from mobile.
 */
import { LicenseTier } from './license';

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════

export interface RegisterRequest {
    name: string;
    email: string;
    password: string;
    deviceId?: string;
    deviceName?: string;
    platform?: string;
}

export interface AuthResponse {
    userId: string;
    name: string;
    email: string;
    tier: LicenseTier;
    token: string;
    refreshToken: string;
    devices: DeviceInfo[];
}

export interface LoginRequest {
    email: string;
    password: string;
    deviceId?: string;
    deviceName?: string;
    platform?: string;
}

export interface MeResponse {
    userId: string;
    name: string;
    email: string;
    tier: LicenseTier;
    createdAt: string;
    devices: DeviceInfo[];
    deviceLimit: number;
}

export interface DeviceInfo {
    id: string;
    name: string;
    platform: string;
    registered_at: string;
    last_seen: string;
}

export interface DevicesListResponse {
    devices: DeviceInfo[];
    count: number;
    limit: number;
    remaining: number;
}

export interface RegisterDeviceRequest {
    deviceId: string;
    deviceName?: string;
    platform?: string;
}

export interface RegisterDeviceResponse {
    message: string;
    devices: DeviceInfo[];
    count: number;
    limit: number;
}

export interface RemoveDeviceRequest {
    deviceId: string;
}

export interface RemoveDeviceResponse {
    message: string;
    devices: DeviceInfo[];
    count: number;
    limit: number;
    remaining: number;
}

export interface RefreshRequest {
    refreshToken: string;
    deviceId?: string;
}

export interface RefreshResponse {
    token: string;
    refreshToken: string;
    tier: LicenseTier;
    userId: string;
    name: string;
}

export interface LogoutResponse {
    success: boolean;
}

export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
}

export interface ChangePasswordResponse {
    success: boolean;
}

export interface BillingResponse {
    email: string;
    tier: LicenseTier;
    createdAt: string;
    stripeCustomerId: string | null;
    payments: unknown[];
}

export interface CreatePortalSessionResponse {
    url: string | null;
    message: string;
}

// ═══════════════════════════════════════════
//  TRANSLATIONS
// ═══════════════════════════════════════════

export interface Language {
    code: string;
    name: string;
}

export interface LanguagesResponse {
    languages: Language[];
}

export interface TranslateTextRequest {
    text: string;
    sourceLang: string;
    targetLang: string;
}

export interface TranslateTextResponse {
    id: string;
    sourceText: string;
    translatedText: string;
    sourceLang: string;
    targetLang: string;
    confidence: number;
    type: 'text' | 'speech';
    engine?: string;
    audioData?: string | null;
}

export interface TranslationHistoryResponse {
    history: TranslationRecord[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
        hasMore: boolean;
    };
}

export interface TranslationRecord {
    id: string;
    user_id: string;
    source_lang: string;
    target_lang: string;
    source_text: string;
    translated_text: string;
    confidence: number;
    type: string;
    created_at: string;
    is_favorite: number;
}

export interface FavoriteToggleRequest {
    translationId: string;
}

export interface FavoriteToggleResponse {
    favorited: boolean;
    translationId: string;
    favoriteId?: string;
}

// ═══════════════════════════════════════════
//  TRANSCRIPTION
// ═══════════════════════════════════════════

export interface TranscribeResponse {
    segments: TranscribeSegment[];
    fullText: string;
    language: string;
    duration: number;
}

export interface TranscribeSegment {
    id: string;
    text: string;
    startTime: number;
    endTime: number;
    confidence: number;
    language: string;
    partial: boolean;
}

export interface BatchTranscribeResponse {
    results: TranscribeBatchItem[];
}

export interface TranscribeBatchItem {
    index: number;
    segments: TranscribeSegment[];
    fullText: string;
    language: string;
    duration: number;
}

// ═══════════════════════════════════════════
//  OCR
// ═══════════════════════════════════════════

export interface OcrTranslateResponse {
    originalText: string;
    translatedText: string;
    language: string;
    confidence: number;
}

// ═══════════════════════════════════════════
//  RECORDINGS
// ═══════════════════════════════════════════

export interface RecordingsListResponse {
    bundles: RecordingBundle[];
    total: number;
    since: string;
}

export interface RecordingBundle {
    id: string;
    bundle_id: string;
    duration_seconds: number;
    has_video: number;
    video_resolution: string | null;
    camera_source: string | null;
    transcript_text: string;
    transcript_segments: string;
    file_size: number;
    device_platform: string;
    device_id: string | null;
    device_name: string | null;
    clone_training_ready: number;
    sync_status: string;
    created_at: string;
    /** Cross-platform alias: transcript_text */
    transcript?: string;
    /** Cross-platform alias: transcript_segments */
    segments_json?: string;
    /** Cross-platform alias: duration_seconds */
    duration?: number;
}

export interface RecordingUploadResponse {
    id: string;
    bundle_id: string;
    file_size: number;
}

export interface ChunkUploadRequest {
    bundle_id: string;
    chunk_index: number;
    total_chunks: number;
    data?: string;
    file_type?: string;
}

export interface ChunkUploadResponse {
    received: boolean;
    chunk_index: number;
    bundle_id: string;
}

export interface BatchUploadResponse {
    uploaded: number;
    errors: string[];
}

export interface RecordingCheckResponse {
    exists: boolean;
    bundle_id: string;
}

export interface RecordingSyncRequest {
    bundles: SyncBundle[];
}

export interface SyncBundle {
    bundle_id?: string;
    id?: string;
    created_at?: string;
    duration_seconds?: number;
    duration?: number;
    transcript_text?: string;
    transcript?: string | { text?: string; segments?: unknown[] };
    transcript_segments?: string;
    segments_json?: string;
    source?: string;
    languages?: string[];
    languages_json?: string;
    media_audio?: number;
    media_video?: number;
    audio?: { size_bytes?: number };
    video?: { size_bytes?: number; resolution?: string; camera?: string };
    file_size?: number;
    clone_training_ready?: number;
    clone_usable?: number;
    tags?: string[];
    tags_json?: string;
    device?: {
        platform?: string;
        device_id?: string;
        device_name?: string;
        model?: string;
        app_version?: string;
    };
    device_platform?: string;
    device_id?: string;
    device_name?: string;
    device_model?: string;
    app_version?: string;
    has_video?: number;
    video_resolution?: string;
    camera_source?: string;
}

export interface RecordingSyncResponse {
    synced: number;
    skipped: number;
    errors: string[];
}

export interface RecordingDeleteResponse {
    deleted: boolean;
    id: string;
}

// ═══════════════════════════════════════════
//  CLONE
// ═══════════════════════════════════════════

export interface TrainingDataResponse {
    bundles: RecordingBundle[];
    total: number;
}

export interface StartTrainingRequest {
    bundle_ids: string[];
    model_name?: string;
    voice_description?: string;
}

export interface StartTrainingResponse {
    jobId: string;
    status: 'queued' | 'submitted' | 'export_ready';
    bundle_count: number;
    estimated_time?: string;
    message: string;
    model_name?: string;
}

// ═══════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════

export interface AdminUsersResponse {
    users: AdminUser[];
    total: number;
    page: number;
    limit: number;
}

export interface AdminUser {
    id: string;
    name: string;
    email: string;
    tier: string;
    role: string;
    created_at: string;
    recording_count: number;
}

export interface AdminStatsResponse {
    totalUsers: number;
    totalRecordings: number;
    totalTranslations: number;
    serverStatus: string;
    uptime: string;
    dbSize: string;
    memoryUsage: string;
    apiLatency: string;
    dailyTranslations: number[];
}

export interface AdminRevenueResponse {
    total: number;
    mrr: number;
    planCounts: Record<string, number>;
}

// ═══════════════════════════════════════════
//  LICENSE
// ═══════════════════════════════════════════

export interface LicenseActivateRequest {
    key: string;
}

export interface LicenseActivateResponse {
    success: boolean;
    tier: LicenseTier;
    key: string;
    activatedAt: string;
}

// ═══════════════════════════════════════════
//  MISC
// ═══════════════════════════════════════════

export interface HealthResponse {
    status: string;
    service: string;
    version: string;
    users: number;
    devices: number;
    maxDevicesPerAccount: number;
    timestamp: string;
}

export interface AnalyticsRequest {
    event?: string;
    properties?: Record<string, unknown>;
}

export interface AnalyticsResponse {
    received: boolean;
}

export interface UpdateCheckResponse {
    version: string;
    url: string;
    releaseNotes: string;
    required: boolean;
}

export interface RtcSignalRequest {
    type: 'offer' | 'answer' | 'ice-candidate' | 'switch-camera';
    token: string;
    sdp?: string;
    candidate?: unknown;
}

export interface RtcSignalResponse {
    success: boolean;
}

// ═══════════════════════════════════════════
//  DOWNLOADS
// ═══════════════════════════════════════════

export interface DownloadVerifyResponse {
    version: string;
    published_at: string;
    release_url: string;
    assets: Record<string, DownloadAsset>;
    cache_age_seconds: number;
}

export interface DownloadAsset {
    name: string;
    size_bytes: number;
    download_url: string;
    direct_url: string;
    updated_at: string;
    download_count: number;
}

export interface DownloadVersionResponse {
    version: string;
    published_at: string;
}

// ═══════════════════════════════════════════
//  WebSocket Transcription Protocol
// ═══════════════════════════════════════════

export interface CloudTranscribeAuthMessage {
    type: 'auth';
    token: string;
}

export interface CloudTranscribeConfigMessage {
    type: 'config';
    language: string;
    engine: string;
}

export interface CloudTranscribeStopMessage {
    type: 'stop';
}

export type CloudTranscribeMessage =
    | CloudTranscribeAuthMessage
    | CloudTranscribeConfigMessage
    | CloudTranscribeStopMessage;

export interface CloudTranscriptResponse {
    type: 'transcript';
    text: string;
    partial: boolean;
    confidence: number;
    startTime: number;
    endTime: number;
    language: string;
}

export interface CloudStateResponse {
    type: 'state';
    state: 'listening' | 'processing';
    previous?: string;
}

export interface CloudErrorResponse {
    type: 'error';
    message: string;
    code?: string;
}

export interface CloudAckResponse {
    type: 'ack';
    action: string;
    success?: boolean;
    authenticated?: boolean;
}

export type CloudTranscribeResponse =
    | CloudTranscriptResponse
    | CloudStateResponse
    | CloudErrorResponse
    | CloudAckResponse;

// ═══════════════════════════════════════════
//  API Error
// ═══════════════════════════════════════════

export interface ApiError {
    error: string;
    code?: string;
    message?: string;
}
