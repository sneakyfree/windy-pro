/**
 * Windy Chat — Rich Media Sharing (Desktop)
 * K4: Rich Media Sharing (DNA Strand K)
 *
 * Handles photo, video, voice message, and file sharing in the desktop chat.
 * All media flows through the Matrix media repo (MXC URIs) on our Synapse (K1).
 *
 * Features:
 *   K4.1 Photo sharing (capture, process, display, translated captions)
 *   K4.2 Video sharing (transcode, thumbnail, playback)
 *   K4.3 Voice messages (record, waveform, translated voice — KILLER FEATURE)
 *   K4.4 File sharing (upload, download, virus scan)
 *   K4.5 Media gallery (per-conversation, filterable)
 *
 * Matrix event types: m.image, m.video, m.audio, m.file
 */

'use strict';

// ── Constants ──

const MEDIA_LIMITS = {
  photo: {
    maxSize: 20 * 1024 * 1024,        // 20MB
    maxDimension: 4096,                 // px
    thumbnailDimension: 300,            // px
    quality: 0.85,                      // JPEG quality
    supportedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heif', 'image/heic'],
  },
  video: {
    maxSize: 100 * 1024 * 1024,        // 100MB
    maxDuration: 180,                   // 3 minutes
    supportedTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  },
  voice: {
    maxDuration: 300,                   // 5 minutes
    format: 'audio/ogg; codecs=opus',
  },
  file: {
    maxSize: 100 * 1024 * 1024,        // 100MB
  },
};

// File type icons for chat bubble display
const FILE_ICONS = {
  'application/pdf': '📄',
  'application/zip': '📦',
  'application/x-zip-compressed': '📦',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/vnd.ms-excel': '📊',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.ms-powerpoint': '📽️',
  'text/plain': '📃',
  'text/csv': '📊',
  default: '📎',
};

// ── K4.1: Photo Sharing ──

class PhotoHandler {
  /**
   * Process an image file before upload.
   * K4.1.2: Image Processing Pipeline
   *
   * Steps:
   *   1. Validate format and size
   *   2. Strip EXIF metadata (privacy)
   *   3. Resize if needed
   *   4. Generate thumbnail (300px)
   *   5. Compress to JPEG 85%
   */
  static async processImage(file) {
    // Validate
    if (!MEDIA_LIMITS.photo.supportedTypes.includes(file.type)) {
      throw new MediaError(
        `Unsupported image format: ${file.type}. Use JPEG, PNG, or WebP.`,
        'UNSUPPORTED_FORMAT'
      );
    }

    if (file.size > MEDIA_LIMITS.photo.maxSize) {
      throw new MediaError(
        `Image too large (${formatSize(file.size)}). Max ${formatSize(MEDIA_LIMITS.photo.maxSize)}.`,
        'FILE_TOO_LARGE'
      );
    }

    // Load image into canvas for processing
    const img = await loadImage(file);
    const { width, height } = img;

    // Generate full-size processed image (EXIF stripped, compressed)
    const processed = await resizeAndCompress(
      img,
      MEDIA_LIMITS.photo.maxDimension,
      MEDIA_LIMITS.photo.quality
    );

    // Generate thumbnail (300px max dimension)
    const thumbnail = await resizeAndCompress(
      img,
      MEDIA_LIMITS.photo.thumbnailDimension,
      0.7
    );

    return {
      type: 'm.image',
      processed,
      thumbnail,
      info: {
        w: width,
        h: height,
        mimetype: 'image/jpeg',
        size: processed.size,
        thumbnail_info: {
          w: thumbnail.width,
          h: thumbnail.height,
          mimetype: 'image/jpeg',
          size: thumbnail.size,
        },
      },
    };
  }

  /**
   * Handle clipboard paste (Ctrl+V) for images.
   * K4.1.1: Desktop clipboard paste
   */
  static async handlePaste(clipboardEvent) {
    const items = clipboardEvent.clipboardData?.items;
    if (!items) return null;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          return PhotoHandler.processImage(file);
        }
      }
    }
    return null;
  }

  /**
   * Handle drag-and-drop for images.
   * K4.1.1: Desktop drag-and-drop
   */
  static async handleDrop(dropEvent) {
    const files = dropEvent.dataTransfer?.files;
    if (!files || files.length === 0) return null;

    const imageFiles = Array.from(files).filter(f =>
      f.type.startsWith('image/')
    );

    const results = [];
    for (const file of imageFiles) {
      results.push(await PhotoHandler.processImage(file));
    }
    return results;
  }
}

// ── K4.2: Video Sharing ──

class VideoHandler {
  /**
   * Process a video file before upload.
   * K4.2.2: Video Processing
   */
  static async processVideo(file) {
    if (!MEDIA_LIMITS.video.supportedTypes.includes(file.type)) {
      throw new MediaError(
        `Unsupported video format. Use MP4, WebM, or MOV.`,
        'UNSUPPORTED_FORMAT'
      );
    }

    if (file.size > MEDIA_LIMITS.video.maxSize) {
      throw new MediaError(
        `Video too large (${formatSize(file.size)}). Max ${formatSize(MEDIA_LIMITS.video.maxSize)}.`,
        'FILE_TOO_LARGE'
      );
    }

    // Get video metadata (duration, dimensions)
    const metadata = await getVideoMetadata(file);

    if (metadata.duration > MEDIA_LIMITS.video.maxDuration) {
      throw new MediaError(
        `Video too long (${formatDuration(metadata.duration)}). Max ${formatDuration(MEDIA_LIMITS.video.maxDuration)}.`,
        'DURATION_EXCEEDED'
      );
    }

    // Generate thumbnail from middle frame
    const thumbnail = await generateVideoThumbnail(file, metadata.duration / 2);

    return {
      type: 'm.video',
      file,
      thumbnail,
      info: {
        w: metadata.width,
        h: metadata.height,
        duration: Math.round(metadata.duration * 1000), // ms
        mimetype: file.type,
        size: file.size,
        thumbnail_info: {
          w: thumbnail.width,
          h: thumbnail.height,
          mimetype: 'image/jpeg',
          size: thumbnail.size,
        },
      },
    };
  }
}

// ── K4.3: Voice Messages ──

class VoiceHandler {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.startTime = null;
    this.analyser = null;
    this.audioContext = null;
    this.isRecording = false;
    this.isLocked = false;
  }

  /**
   * Start voice recording.
   * K4.3.1: Hold-to-record with waveform visualization
   */
  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });

      // Set up analyser for waveform visualization
      const audioContext = new AudioContext();
      this.audioContext = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      // Create MediaRecorder (Opus codec)
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 64000,
      });

      this.audioChunks = [];
      this.startTime = Date.now();
      this.isRecording = true;

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.start(100); // Collect data every 100ms

      return { success: true, analyser: this.analyser };

    } catch (err) {
      throw new MediaError(
        'Microphone access denied. Grant permission in Settings.',
        'MIC_DENIED'
      );
    }
  }

  /**
   * Stop recording and return the voice message.
   */
  async stopRecording() {
    if (!this.mediaRecorder || !this.isRecording) {
      return null;
    }

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        const duration = (Date.now() - this.startTime) / 1000;
        const blob = new Blob(this.audioChunks, { type: 'audio/ogg; codecs=opus' });

        // Generate waveform data for display
        const waveform = await generateWaveformData(blob);

        // Stop all tracks and close audio context
        this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
        if (this.audioContext) {
          this.audioContext.close().catch(() => {});
          this.audioContext = null;
        }
        this.isRecording = false;

        resolve({
          type: 'm.audio',
          blob,
          waveform,
          info: {
            duration: Math.round(duration * 1000), // ms
            mimetype: 'audio/ogg; codecs=opus',
            size: blob.size,
          },
          // Windy-specific metadata for voice translation (K4.3.3)
          windy: {
            isVoiceMessage: true,
            waveformData: waveform,
          },
        });
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording (slide-left gesture).
   * K4.3.1: Slide left to cancel
   */
  cancelRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.audioChunks = [];
      if (this.audioContext) {
        this.audioContext.close().catch(() => {});
        this.audioContext = null;
      }
    }
  }

  /**
   * Lock recording (hands-free mode).
   * K4.3.1: Lock button
   */
  lockRecording() {
    this.isLocked = true;
  }

  /**
   * Get current recording duration.
   */
  getDuration() {
    if (!this.startTime || !this.isRecording) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Get waveform data for live visualization.
   */
  getWaveformSnapshot() {
    if (!this.analyser) return [];
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return Array.from(data);
  }
}

// ── K4.3.3: Voice Message Translation (KILLER FEATURE) ──

class VoiceTranslator {
  /**
   * Translate a voice message before sending.
   *
   * Flow:
   *   1. STT: voice → text (in sender's language)
   *   2. Translate: text → translated text
   *   3. TTS: translated text → audio (in recipient's language)
   *   4. Attach both original + translated audio to message
   *
   * ALL processing happens LOCAL on sender's device.
   */
  static async translateVoiceMessage(audioBlob, srcLang, tgtLang, translateFn) {
    // Step 1: Speech-to-text (local Whisper)
    const transcript = await performSTT(audioBlob, srcLang);
    if (!transcript || !transcript.text) {
      return { translated: false, reason: 'STT failed — sending original only' };
    }

    // Step 2: Translate text (local engine)
    const translatedText = await translateFn(transcript.text, srcLang, tgtLang);
    if (!translatedText) {
      return { translated: false, reason: 'Translation failed — sending original only' };
    }

    // Step 3: Text-to-speech (Piper/Coqui local TTS)
    const translatedAudio = await performTTS(translatedText, tgtLang);

    return {
      translated: true,
      original: {
        audio: audioBlob,
        text: transcript.text,
        lang: srcLang,
      },
      translation: {
        audio: translatedAudio,
        text: translatedText,
        lang: tgtLang,
      },
      metadata: {
        windy_voice_translated: true,
        src_lang: srcLang,
        tgt_lang: tgtLang,
      },
    };
  }
}

// ── K4.4: File Sharing ──

class FileHandler {
  /**
   * Process a file for upload.
   * K4.4.1: File Upload
   */
  static async processFile(file) {
    if (file.size > MEDIA_LIMITS.file.maxSize) {
      throw new MediaError(
        `File too large (${formatSize(file.size)}). Max ${formatSize(MEDIA_LIMITS.file.maxSize)}.`,
        'FILE_TOO_LARGE'
      );
    }

    const icon = FILE_ICONS[file.type] || FILE_ICONS.default;

    return {
      type: 'm.file',
      file,
      icon,
      info: {
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
      },
      body: file.name,
    };
  }
}

// ── K4.5: Media Gallery ──

class MediaGallery {
  /**
   * Build the media gallery for a conversation.
   * K4.5: Per-conversation media gallery
   */
  static buildGallery(events, filter = 'all') {
    const mediaTypes = {
      photos: ['m.image'],
      videos: ['m.video'],
      voice: ['m.audio'],
      files: ['m.file'],
    };

    const allowedTypes = filter === 'all'
      ? Object.values(mediaTypes).flat()
      : mediaTypes[filter] || [];

    const items = events
      .filter(e => allowedTypes.includes(e.type))
      .map(e => ({
        eventId: e.event_id,
        type: e.type,
        sender: e.sender,
        timestamp: e.origin_server_ts,
        url: e.content?.url,
        thumbnailUrl: e.content?.info?.thumbnail_url,
        filename: e.content?.body,
        size: e.content?.info?.size,
        duration: e.content?.info?.duration,
        info: e.content?.info,
      }))
      .sort((a, b) => b.timestamp - a.timestamp); // Newest first

    return {
      items,
      count: items.length,
      filter,
      filters: ['all', 'photos', 'videos', 'voice', 'files'],
    };
  }
}

// ── Media Upload Manager ──

class MediaUploader {
  /**
   * Upload media to the Matrix media repo.
   * Returns MXC URI for embedding in messages.
   */
  static async upload(matrixClient, blob, filename, onProgress) {
    const uploadId = crypto.randomUUID();

    try {
      const result = await matrixClient.uploadContent(blob, {
        name: filename,
        type: blob.type,
        progressHandler: (progress) => {
          if (onProgress) {
            onProgress({
              uploadId,
              loaded: progress.loaded,
              total: progress.total,
              percent: Math.round((progress.loaded / progress.total) * 100),
            });
          }
        },
      });

      return {
        uploadId,
        mxcUri: result.content_uri,
        success: true,
      };

    } catch (err) {
      console.error('Upload failed:', err);
      return {
        uploadId,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Send a media message to a Matrix room.
   */
  static async sendMediaMessage(matrixClient, roomId, mediaResult, caption) {
    const content = {
      msgtype: mediaResult.type,
      body: caption || mediaResult.body || 'media',
      url: mediaResult.mxcUri,
      info: mediaResult.info,
    };

    // Add thumbnail if available
    if (mediaResult.thumbnail?.mxcUri) {
      content.info.thumbnail_url = mediaResult.thumbnail.mxcUri;
      content.info.thumbnail_info = mediaResult.info.thumbnail_info;
    }

    // Add translated caption (K4.1.4)
    if (caption && mediaResult.translatedCaption) {
      content['m.relates_to'] = undefined; // Not a reply
      content.windy_caption = {
        original: caption,
        translated: mediaResult.translatedCaption,
        src_lang: mediaResult.srcLang,
        tgt_lang: mediaResult.tgtLang,
      };
    }

    // Voice message metadata (K4.3)
    if (mediaResult.windy) {
      content.windy = mediaResult.windy;
      content['org.matrix.msc1767.audio'] = {
        duration: mediaResult.info.duration,
        waveform: mediaResult.windy.waveformData?.slice(0, 64),
      };
    }

    await matrixClient.sendEvent(roomId, 'm.room.message', content);
  }
}

// ── Utility Functions ──

/**
 * Custom error class for media operations.
 */
class MediaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

/**
 * Load an image file into an HTMLImageElement.
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new MediaError('Failed to load image', 'LOAD_FAILED'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Resize and compress an image using canvas.
 * Strips EXIF by re-drawing to canvas (K4.1.2 privacy).
 */
function resizeAndCompress(img, maxDimension, quality) {
  return new Promise((resolve) => {
    let { width, height } = img;

    // Scale down if needed
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    canvas.toBlob(
      (blob) => resolve({ blob, width, height, size: blob.size }),
      'image/jpeg',
      quality
    );
  });
}

/**
 * Get video metadata (duration, dimensions).
 */
function getVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => reject(new MediaError('Failed to load video', 'LOAD_FAILED'));
    video.src = URL.createObjectURL(file);
  });
}

/**
 * Generate a thumbnail from a video at a specific time.
 */
function generateVideoThumbnail(file, seekTime) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.currentTime = seekTime;

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(video.src);
          resolve({ blob, width: canvas.width, height: canvas.height, size: blob.size });
        },
        'image/jpeg',
        0.7
      );
    };

    video.onerror = () => reject(new MediaError('Thumbnail generation failed', 'THUMB_FAILED'));
    video.src = URL.createObjectURL(file);
  });
}

/**
 * Generate waveform data from an audio blob.
 */
async function generateWaveformData(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new OfflineAudioContext(1, 44100, 44100);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);

    // Sample down to 64 points for waveform display
    const samples = 64;
    const blockSize = Math.floor(channelData.length / samples);
    const waveform = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[i * blockSize + j]);
      }
      waveform.push(Math.round((sum / blockSize) * 255));
    }

    return waveform;
  } catch {
    return new Array(64).fill(128); // Fallback: flat waveform
  }
}

/**
 * Perform speech-to-text (stub — connects to local Whisper engine).
 */
async function performSTT(audioBlob, language) {
  // In production: send to local Whisper server or use Web Worker
  console.log(`🎤 STT: ${formatSize(audioBlob.size)} audio in ${language}`);
  return { text: null }; // Stub — implement with local Whisper
}

/**
 * Perform text-to-speech (stub — connects to local Piper/Coqui TTS).
 */
async function performTTS(text, language) {
  // In production: send to local Piper TTS server
  console.log(`🔊 TTS: "${text.slice(0, 50)}..." in ${language}`);
  return null; // Stub — implement with local TTS engine
}

/**
 * Format bytes to human-readable size.
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format seconds to MM:SS display.
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Exports ──

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PhotoHandler,
    VideoHandler,
    VoiceHandler,
    VoiceTranslator,
    FileHandler,
    MediaGallery,
    MediaUploader,
    MediaError,
    MEDIA_LIMITS,
  };
}
