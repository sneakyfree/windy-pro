/**
 * @windy-pro/contracts — Session type definitions
 *
 * Mirrors mobile source of truth (windy-pro-mobile/src/types/session.ts).
 * Adds server-only CloudSession type and FIELD_MAP for cross-platform mapping.
 */
import { AudioQuality, MediaCapture, TranscriptSegment } from './recording';

// ─── Mobile-canonical types ──────────────────────────────────

export type SessionSource = 'record' | 'translate' | 'keyboard' | 'overlay' | 'ocr';

export interface GeoLocation {
    lat: number;
    lon: number;
}

/**
 * Full session record — mobile canonical naming.
 */
export interface Session {
    id: string;
    createdAt: string;
    duration: number;
    transcript: string;
    segments: TranscriptSegment[];
    audioFilePath: string | null;
    videoFilePath: string | null;
    quality: AudioQuality;
    engineUsed: string;
    source: SessionSource;
    languages: string[];
    mediaCapture: MediaCapture;
    fileSize: number;
    synced: boolean;
    syncedAt: string | null;
    cloneUsable: boolean;
    tags: string[];
    location: GeoLocation | null;
    deviceModel: string;
}

export interface SessionSummary {
    id: string;
    createdAt: string;
    duration: number;
    previewText: string;
    quality: AudioQuality;
    synced: boolean;
    source: SessionSource;
    mediaCapture: MediaCapture;
}

export interface SessionFilter {
    dateRange: { start: string; end: string } | null;
    source: SessionSource | null;
    minQuality: number | null;
    synced: boolean | null;
    searchQuery: string | null;
}

export interface StorageUsage {
    audioBytes: number;
    videoBytes: number;
    textBytes: number;
    engineBytes: number;
    totalBytes: number;
    sessionCount: number;
}

// ─── Server-only extension ───────────────────────────────────

/**
 * Server-side session record.
 * Extends the mobile Session with server-only fields for multi-user,
 * multi-device sync management.
 */
export interface CloudSession extends Omit<Session, 'audioFilePath' | 'videoFilePath' | 'quality' | 'segments' | 'mediaCapture' | 'location' | 'tags' | 'languages' | 'deviceModel'> {
    /** Server-generated UUID (different from client-side id) */
    serverId: string;
    /** The client-side session ID, used as bundle_id */
    bundleId: string;
    /** Owning user ID */
    userId: string;
    /** Device platform (desktop, ios, android) */
    devicePlatform: string;
    /** Device unique identifier */
    deviceId: string | null;
    /** Device display name */
    deviceName: string | null;
    /** App version that created this */
    appVersion: string;
    /** Server-side sync status */
    syncStatus: SyncStatusValue;
    /** Whether this recording is marked for clone training */
    cloneTrainingReady: boolean;
    /** Whether this recording includes video */
    hasVideo: boolean;
    /** Video resolution string (e.g. "720p") */
    videoResolution: string | null;
    /** Camera source identifier */
    cameraSource: string | null;
    /** Server-side file path */
    filePath: string | null;
    /** Transcript text (server column name mapping) */
    transcriptText: string;
    /** Transcript segments as JSON string */
    transcriptSegments: string;
    /** Languages as JSON string */
    languagesJson: string;
    /** Quality score (0-100) */
    qualityScore: number;
    /** Quality details as JSON string */
    qualityJson: string;
    /** Tags as JSON string */
    tagsJson: string;
    /** GPS latitude */
    latitude: number | null;
    /** GPS longitude */
    longitude: number | null;
    /** Device model */
    deviceModel: string | null;
    /** Audio path on server */
    audioPath: string | null;
    /** Video path on server */
    videoPath: string | null;
    /** Has audio media */
    mediaAudio: boolean;
    /** Has video media */
    mediaVideo: boolean;
}

export type SyncStatusValue = 'pending' | 'uploaded' | 'synced' | 'failed';

// ─── Field Mapping ───────────────────────────────────────────

/**
 * Single source of truth for mobile ↔ server column name translations.
 *
 * Mobile SQLite table "sessions" uses left-side names.
 * Server SQLite table "recordings" uses right-side names.
 *
 * Usage: When receiving data from mobile, map field names using this map.
 * When sending data to mobile, reverse-map using this map.
 */
export const FIELD_MAP = {
    // Mobile field → Server column
    id: 'bundle_id',
    transcript: 'transcript_text',
    segments: 'transcript_segments',
    duration: 'duration_seconds',
    languages: 'languages_json',
    quality: 'quality_json',
    'quality.score': 'quality_score',
    tags: 'tags_json',
    'mediaCapture.audio': 'media_audio',
    'mediaCapture.video': 'media_video',
    'location.lat': 'latitude',
    'location.lon': 'longitude',
    audioFilePath: 'audio_path',
    videoFilePath: 'video_path',
    cloneUsable: 'clone_usable',
    syncedAt: 'synced_at',
    engineUsed: 'engine_used',
    deviceModel: 'device_model',
    fileSize: 'file_size',
    createdAt: 'created_at',
    // Server-only (no mobile equivalent)
    // userId → user_id
    // bundleId → bundle_id
    // devicePlatform → device_platform
    // syncStatus → sync_status
    // cloneTrainingReady → clone_training_ready
    // hasVideo → has_video
    // videoResolution → video_resolution
    // cameraSource → camera_source
    // filePath → file_path
    // appVersion → app_version
    // deviceId → device_id
    // deviceName → device_name
} as const;

/**
 * Reverse map: server column → mobile field name
 */
export const REVERSE_FIELD_MAP = Object.fromEntries(
    Object.entries(FIELD_MAP).map(([k, v]) => [v, k])
) as Record<string, string>;
