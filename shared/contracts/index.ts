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
    CanonicalTier,
    LicenseValidation,
    TierFeatures,
} from './license';
export {
    LICENSE_KEY_REGEX,
    KEY_PREFIX_TIER,
    TIER_FEATURES,
    TIER_MAPPING,
    tierFromKey,
    normalizeProductTier,
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
    // Cloud storage + billing (merged from cloud-storage service)
    FileUploadBodySchema,
    FileListQuerySchema,
    BillingTransactionsQuerySchema,
    RefundRequestSchema,
    AdminFreezeRequestSchema,
    AdminTierRequestSchema,
    AdminCouponCreateSchema,
    // Identity validation schemas (Phase 10.0)
    IdentityUpdateSchema,
    IdentityProvisionSchema,
    IdentityScopeGrantSchema,
    IdentityAuditQuerySchema,
    EternitasWebhookSchema,
    // Password validation (Phase 1 — unified mobile + server standard)
    PasswordSchema,
    // Verification schemas (Phase 1 — promoted from chat-onboarding)
    VerificationSendSchema,
    VerificationCheckSchema,
    // Email verification + password reset (Wave 1 — PR1, PR2)
    VerifyEmailRequestSchema,
    ForgotPasswordRequestSchema,
    ResetPasswordRequestSchema,
    // MFA / TOTP (Wave 1 — PR3)
    MfaVerifySetupRequestSchema,
    MfaDisableRequestSchema,
    // Bot API key schemas (Phase 3)
    BotApiKeyCreateSchema,
    SecretaryConsentSchema,
    // OAuth2 schemas (Phase 5)
    OAuthClientCreateSchema,
    OAuthAuthorizeSchema,
    OAuthTokenSchema,
    DeviceCodeRequestSchema,
    DeviceCodeApproveSchema,
} from './validation';

// Identity types — Unified Windy Identity
export type {
    WindyIdentityId,
    IdentityType,
    WindyProduct,
    ProductAccountStatus,
    PassportStatus,
    WindyIdentity,
    ProductAccount,
    ProvisionProductRequest,
    ProvisionProductResponse,
    IdentityScope,
    IdentityScopeRecord,
    WindyIdentityToken,
    IdentityAuditEvent,
    IdentityAuditEntry,
    EternitasPassport,
    // Webhook payloads (typed per event)
    WebhookPayloadBase,
    WebhookPassportRegistered,
    WebhookPassportRevoked,
    WebhookIdentityCreated,
    WebhookPassportSuspended,
    WebhookPassportVerified,
    EternitasWebhookPayload,
    EternitasWebhookResponse,
    ChatProfile,
    IdentityMeResponse,
    IdentityProvisionRequest,
    IdentityScopeGrantRequest,
    IdentityEternitasWebhookRequest,
    IdentityAuditQuery,
    IdentityAuditResponse,
    // Phase 1: Verification
    VerificationSendRequest,
    VerificationCheckRequest,
    VerificationSendResponse,
    VerificationCheckResponse,
    // Phase 3: Bot API Keys
    BotApiKey,
    BotApiKeyCreateRequest,
    BotApiKeyCreateResponse,
    // Phase 3: Secretary Mode
    SecretaryConsent,
    SecretaryConsentRequest,
    // Phase 3: Hatch Flow
    WindyIdentityCredentials,
    // Phase 5: OAuth2 / SSO
    OAuthClient,
    OAuthAuthorizeRequest,
    OAuthTokenRequest,
    OAuthTokenResponse,
    DeviceCodeRequest,
    DeviceCodeResponse,
    OIDCDiscovery,
    UserInfoResponse,
    JWKSDocument,
    JWKKey,
} from './identity';
export { EcosystemProduct } from './identity';
