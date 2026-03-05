/**
 * @windy-pro/contracts — Barrel export
 *
 * Re-exports all types, interfaces, constants, and Zod schemas
 * for use by server, desktop, mobile, and web clients.
 */

// Recording types (mobile canonical)
export type {
    RecordingState,
    RecordingConfig,
    TranscriptSegment,
    AudioQuality,
    QualityLabel,
    MediaCapture,
    RecordingResult,
} from './recording';

// Session types
export type {
    Session,
    SessionSource,
    GeoLocation,
    SessionSummary,
    SessionFilter,
    StorageUsage,
    CloudSession,
    SyncStatusValue,
} from './session';
export { FIELD_MAP, REVERSE_FIELD_MAP } from './session';

// License types
export type {
    LicenseTier,
    LicenseValidation,
    TierFeatures,
} from './license';
export {
    LICENSE_KEY_REGEX,
    KEY_PREFIX_TIER,
    TIER_FEATURES,
    tierFromKey,
} from './license';

// API types — Auth
export type {
    RegisterRequest,
    AuthResponse,
    LoginRequest,
    MeResponse,
    DeviceInfo,
    DevicesListResponse,
    RegisterDeviceRequest,
    RegisterDeviceResponse,
    RemoveDeviceRequest,
    RemoveDeviceResponse,
    RefreshRequest,
    RefreshResponse,
    LogoutResponse,
    ChangePasswordRequest,
    ChangePasswordResponse,
    BillingResponse,
    CreatePortalSessionResponse,
} from './api';

// API types — Translations
export type {
    Language,
    LanguagesResponse,
    TranslateTextRequest,
    TranslateTextResponse,
    TranslationHistoryResponse,
    TranslationRecord,
    FavoriteToggleRequest,
    FavoriteToggleResponse,
} from './api';

// API types — Transcription
export type {
    TranscribeResponse,
    TranscribeSegment,
    BatchTranscribeResponse,
    TranscribeBatchItem,
} from './api';

// API types — OCR
export type { OcrTranslateResponse } from './api';

// API types — Recordings
export type {
    RecordingsListResponse,
    RecordingBundle,
    RecordingUploadResponse,
    ChunkUploadRequest,
    ChunkUploadResponse,
    BatchUploadResponse,
    RecordingCheckResponse,
    RecordingSyncRequest,
    SyncBundle,
    RecordingSyncResponse,
    RecordingDeleteResponse,
} from './api';

// API types — Clone
export type {
    TrainingDataResponse,
    StartTrainingRequest,
    StartTrainingResponse,
} from './api';

// API types — Admin
export type {
    AdminUsersResponse,
    AdminUser,
    AdminStatsResponse,
    AdminRevenueResponse,
} from './api';

// API types — License
export type {
    LicenseActivateRequest,
    LicenseActivateResponse,
} from './api';

// API types — Misc
export type {
    HealthResponse,
    AnalyticsRequest,
    AnalyticsResponse,
    UpdateCheckResponse,
    RtcSignalRequest,
    RtcSignalResponse,
} from './api';

// API types — Downloads
export type {
    DownloadVerifyResponse,
    DownloadAsset,
    DownloadVersionResponse,
} from './api';

// API types — WebSocket
export type {
    CloudTranscribeAuthMessage,
    CloudTranscribeConfigMessage,
    CloudTranscribeStopMessage,
    CloudTranscribeMessage,
    CloudTranscriptResponse,
    CloudStateResponse,
    CloudErrorResponse,
    CloudAckResponse,
    CloudTranscribeResponse,
    ApiError,
} from './api';

// Zod validation schemas
export {
    RegisterRequestSchema,
    LoginRequestSchema,
    RefreshRequestSchema,
    RegisterDeviceRequestSchema,
    RemoveDeviceRequestSchema,
    ChangePasswordRequestSchema,
    TranslateTextRequestSchema,
    FavoriteToggleRequestSchema,
    TranscribeRequestSchema,
    BatchTranscribeRequestSchema,
    ChunkUploadRequestSchema,
    RecordingUploadBodySchema,
    RecordingCheckQuerySchema,
    StartTrainingRequestSchema,
    LicenseActivateRequestSchema,
    AnalyticsRequestSchema,
    RtcSignalRequestSchema,
    RtcSignalQuerySchema,
    AdminUsersQuerySchema,
    OcrTranslateBodySchema,
    SpeechTranslateBodySchema,
    HistoryQuerySchema,
    RecordingsListQuerySchema,
} from './validation';
