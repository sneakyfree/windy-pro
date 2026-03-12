/**
 * Windy Chat — Rich Media Sharing (Mobile / React Native)
 * K4: Rich Media Sharing (DNA Strand K)
 *
 * Mobile-specific media handling for iOS and Android.
 * Wraps native camera, photo library, and audio APIs.
 *
 * Features:
 *   K4.1 Photo sharing (camera, library, EXIF strip, compress)
 *   K4.2 Video sharing (camera record, transcode, thumbnail)
 *   K4.3 Voice messages (hold-to-record, waveform, translation)
 *   K4.4 File sharing (document picker, download)
 *   K4.5 Media gallery (grid view, filter)
 */

import { createLogger } from './LogService';
const log = createLogger('ChatMedia');

// ── Types ──

export interface MediaLimits {
  photo: { maxSize: number; maxDimension: number; thumbnailDimension: number; quality: number };
  video: { maxSize: number; maxDuration: number };
  voice: { maxDuration: number };
  file: { maxSize: number };
}

export interface ProcessedMedia {
  type: 'm.image' | 'm.video' | 'm.audio' | 'm.file';
  uri: string;
  thumbnailUri?: string;
  info: MediaInfo;
  windy?: WindyMediaMetadata;
}

export interface MediaInfo {
  w?: number;
  h?: number;
  duration?: number;
  mimetype: string;
  size: number;
  thumbnail_info?: {
    w: number;
    h: number;
    mimetype: string;
    size: number;
  };
}

export interface WindyMediaMetadata {
  isVoiceMessage?: boolean;
  waveformData?: number[];
  windy_voice_translated?: boolean;
  src_lang?: string;
  tgt_lang?: string;
}

export interface VoiceTranslationResult {
  translated: boolean;
  original?: { uri: string; text: string; lang: string };
  translation?: { uri: string; text: string; lang: string };
  reason?: string;
}

export interface MediaGalleryItem {
  eventId: string;
  type: string;
  sender: string;
  timestamp: number;
  url: string;
  thumbnailUrl?: string;
  filename?: string;
  size?: number;
  duration?: number;
}

export type MediaFilter = 'all' | 'photos' | 'videos' | 'voice' | 'files';

// ── Constants ──

export const MEDIA_LIMITS: MediaLimits = {
  photo: {
    maxSize: 20 * 1024 * 1024,
    maxDimension: 4096,
    thumbnailDimension: 300,
    quality: 0.85,
  },
  video: {
    maxSize: 100 * 1024 * 1024,
    maxDuration: 180, // 3 minutes
  },
  voice: {
    maxDuration: 300, // 5 minutes
  },
  file: {
    maxSize: 100 * 1024 * 1024,
  },
};

// ── K4.1: Photo Sharing (Mobile) ──

/**
 * Pick a photo from camera or library.
 * Uses react-native-image-picker or expo-image-picker.
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<ProcessedMedia | null> {
  try {
    // In production: use react-native-image-picker
    // import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
    //
    // const options = {
    //   mediaType: 'photo',
    //   maxWidth: MEDIA_LIMITS.photo.maxDimension,
    //   maxHeight: MEDIA_LIMITS.photo.maxDimension,
    //   quality: MEDIA_LIMITS.photo.quality,
    //   includeBase64: false,
    // };
    //
    // const result = source === 'camera'
    //   ? await launchCamera(options)
    //   : await launchImageLibrary(options);

    log.entry('pickPhoto', { source });
    return null;
  } catch (err) {
    log.error('pickPhoto', err);
    return null;
  }
}

/**
 * Process a photo: strip EXIF, resize, generate thumbnail.
 * K4.1.2: Image Processing Pipeline (mobile)
 */
export async function processPhoto(uri: string): Promise<ProcessedMedia> {
  // In production: use react-native-image-manipulator or expo-image-manipulator
  //
  // 1. Strip EXIF: manipulate without preserving metadata
  // 2. Resize: max 4096px
  // 3. Compress: JPEG 85%
  // 4. Thumbnail: 300px max dimension

  return {
    type: 'm.image',
    uri,
    thumbnailUri: uri, // Stub — generate real thumbnail
    info: {
      w: 0,
      h: 0,
      mimetype: 'image/jpeg',
      size: 0,
      thumbnail_info: {
        w: 300,
        h: 300,
        mimetype: 'image/jpeg',
        size: 0,
      },
    },
  };
}

// ── K4.2: Video Sharing (Mobile) ──

/**
 * Record or pick a video.
 * K4.2.1: Video Capture & Selection (mobile)
 */
export async function pickVideo(source: 'camera' | 'library'): Promise<ProcessedMedia | null> {
  try {
    // In production:
    // const options = {
    //   mediaType: 'video',
    //   videoQuality: 'high',
    //   durationLimit: MEDIA_LIMITS.video.maxDuration,
    // };
    //
    // const result = source === 'camera'
    //   ? await launchCamera(options)
    //   : await launchImageLibrary(options);

    log.entry('pickVideo', { source });
    return null;
  } catch (err) {
    log.error('pickVideo', err);
    return null;
  }
}

// ── K4.3: Voice Messages (Mobile) ──

export interface VoiceRecorderState {
  isRecording: boolean;
  isLocked: boolean;
  duration: number;
  waveform: number[];
}

/**
 * Mobile voice recorder.
 * K4.3.1: Hold-to-record, slide-to-cancel, lock mode
 */
export class MobileVoiceRecorder {
  private state: VoiceRecorderState = {
    isRecording: false,
    isLocked: false,
    duration: 0,
    waveform: [],
  };

  private startTime: number = 0;
  private durationInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start recording a voice message.
   */
  async start(): Promise<boolean> {
    try {
      // In production: use expo-av or react-native-audio-recorder-player
      //
      // const { Audio } = require('expo-av');
      // const recording = new Audio.Recording();
      // await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      // await recording.startAsync();

      this.state.isRecording = true;
      this.startTime = Date.now();

      // Track duration
      this.durationInterval = setInterval(() => {
        this.state.duration = (Date.now() - this.startTime) / 1000;

        // Auto-stop at max duration
        if (this.state.duration >= MEDIA_LIMITS.voice.maxDuration) {
          this.stop();
        }
      }, 100);

      log.exit('VoiceRecorder.start', { recording: true });
      return true;
    } catch (err) {
      log.error('VoiceRecorder.start', err);
      return false;
    }
  }

  /**
   * Stop recording and return the voice message.
   */
  async stop(): Promise<ProcessedMedia | null> {
    if (!this.state.isRecording) return null;

    this.state.isRecording = false;
    if (this.durationInterval) clearInterval(this.durationInterval);

    // In production: stop the expo-av recording and get the URI
    const duration = (Date.now() - this.startTime) / 1000;

    log.exit('VoiceRecorder.stop', { duration: duration.toFixed(1) });

    return {
      type: 'm.audio',
      uri: '', // Stub — real file URI from recorder
      info: {
        duration: Math.round(duration * 1000),
        mimetype: 'audio/ogg; codecs=opus',
        size: 0,
      },
      windy: {
        isVoiceMessage: true,
        waveformData: this.state.waveform,
      },
    };
  }

  /**
   * Cancel recording (slide-left gesture).
   */
  cancel(): void {
    this.state.isRecording = false;
    this.state.isLocked = false;
    if (this.durationInterval) clearInterval(this.durationInterval);
    log.state('VoiceRecorder.cancel', 'recording cancelled');
  }

  /**
   * Lock recording (hands-free mode).
   */
  lock(): void {
    this.state.isLocked = true;
  }

  getState(): VoiceRecorderState {
    return { ...this.state };
  }
}

// ── K4.3.3: Voice Translation (Mobile) ──

/**
 * Translate a voice message before sending.
 * All processing LOCAL on sender's device.
 */
export async function translateVoiceMessage(
  audioUri: string,
  srcLang: string,
  tgtLang: string,
  translateFn: (text: string, src: string, tgt: string) => Promise<string>,
): Promise<VoiceTranslationResult> {
  try {
    // Step 1: STT (local Whisper)
    // const transcript = await localWhisperSTT(audioUri, srcLang);
    const transcript = { text: '' }; // Stub

    if (!transcript.text) {
      return { translated: false, reason: 'STT failed' };
    }

    // Step 2: Translate
    const translatedText = await translateFn(transcript.text, srcLang, tgtLang);

    // Step 3: TTS (local Piper/Coqui)
    // const translatedAudioUri = await localTTS(translatedText, tgtLang);
    const translatedAudioUri = ''; // Stub

    return {
      translated: true,
      original: { uri: audioUri, text: transcript.text, lang: srcLang },
      translation: { uri: translatedAudioUri, text: translatedText, lang: tgtLang },
    };
  } catch (err) {
    log.error('translateVoiceMessage', err);
    return { translated: false, reason: String(err) };
  }
}

// ── K4.4: File Sharing (Mobile) ──

/**
 * Pick a file using the document picker.
 */
export async function pickFile(): Promise<ProcessedMedia | null> {
  try {
    // In production: use expo-document-picker or react-native-document-picker
    //
    // const result = await DocumentPicker.getDocumentAsync({
    //   type: '*/*',
    //   copyToCacheDirectory: true,
    // });

    log.entry('pickFile');
    return null;
  } catch (err) {
    log.error('pickFile', err);
    return null;
  }
}

// ── K4.5: Media Gallery ──

/**
 * Build the media gallery for a conversation.
 */
export function buildMediaGallery(
  events: Array<{ event_id: string; type: string; sender: string; origin_server_ts: number; content: any }>,
  filter: MediaFilter = 'all',
): { items: MediaGalleryItem[]; count: number; filter: MediaFilter } {
  const typeMap: Record<string, string[]> = {
    photos: ['m.image'],
    videos: ['m.video'],
    voice: ['m.audio'],
    files: ['m.file'],
  };

  const allowedTypes = filter === 'all'
    ? Object.values(typeMap).flat()
    : typeMap[filter] || [];

  const items: MediaGalleryItem[] = events
    .filter(e => allowedTypes.includes(e.type))
    .map(e => ({
      eventId: e.event_id,
      type: e.type,
      sender: e.sender,
      timestamp: e.origin_server_ts,
      url: e.content?.url || '',
      thumbnailUrl: e.content?.info?.thumbnail_url,
      filename: e.content?.body,
      size: e.content?.info?.size,
      duration: e.content?.info?.duration,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  return { items, count: items.length, filter };
}

// ── Utility ──

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
