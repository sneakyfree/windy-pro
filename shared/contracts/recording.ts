/**
 * @windy-pro/contracts — Recording-related type definitions
 *
 * Mirrors mobile source of truth (windy-pro-mobile/src/types/recording.ts).
 * All types use mobile naming conventions as canonical.
 */

/**
 * Current state of the recording engine.
 */
export type RecordingState = 'idle' | 'recording' | 'processing' | 'error';

/**
 * Configuration for audio recording sessions.
 */
export interface RecordingConfig {
    sampleRate: number;
    channels: 1;
    encoding: 'wav';
    meteringEnabled: boolean;
    maxDuration: number;
}

/**
 * A single segment of transcribed text within a session.
 */
export interface TranscriptSegment {
    id: string;
    text: string;
    startTime: number;
    endTime: number;
    confidence: number;
    isPartial: boolean;
    speakerId: string | null;
    language: string;
}

/**
 * Audio quality assessment result.
 */
export interface AudioQuality {
    score: number;
    label: QualityLabel;
    snrDb: number;
    speechRatio: number;
    hasClipping: boolean;
    sampleRate: number;
}

/**
 * Quality classification labels.
 */
export type QualityLabel = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * Flags indicating which media types are being captured.
 */
export interface MediaCapture {
    audio: boolean;
    video: boolean;
    text: boolean;
}

/**
 * Result returned after stopping a recording.
 */
export interface RecordingResult {
    sessionId: string;
    uri: string;
    duration: number;
    fileSize: number;
}
