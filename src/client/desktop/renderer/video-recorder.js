/**
 * Windy Pro — Video Recording Pipeline (Ghost Feature 5)
 * 
 * Captures screen + audio for video recordings.
 * Uses Electron's desktopCapturer API for screen capture
 * and MediaRecorder for encoding.
 * 
 * Output: WebM (VP9 + Opus) or MP4 (via FFmpeg post-processing)
 */

class VideoRecorder {
    constructor(options = {}) {
        this.mediaRecorder = null;
        this.chunks = [];
        this.stream = null;
        this.isRecording = false;
        this.startTime = null;
        this.outputFormat = options.format || 'webm';
        this.maxDurationMs = options.maxDuration || 30 * 60 * 1000; // 30 min default
        this._onData = options.onData || null;
        this._onStop = options.onStop || null;
        this._timer = null;
    }

    /**
     * Start recording screen + audio
     * @param {object} options - { sourceId, audio, width, height }
     */
    async start(options = {}) {
        if (this.isRecording) return;

        try {
            // Get screen stream using Electron's desktopCapturer
            const constraints = {
                audio: options.audio !== false ? {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        ...(options.sourceId ? { chromeMediaSourceId: options.sourceId } : {})
                    }
                } : false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        ...(options.sourceId ? { chromeMediaSourceId: options.sourceId } : {}),
                        maxWidth: options.width || 1920,
                        maxHeight: options.height || 1080,
                        maxFrameRate: options.fps || 30
                    }
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.chunks = [];

            // Setup MediaRecorder
            const mimeType = this.outputFormat === 'webm'
                ? 'video/webm;codecs=vp9,opus'
                : 'video/webm;codecs=vp8,opus';

            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
                videoBitsPerSecond: options.bitrate || 2500000 // 2.5 Mbps
            });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                    if (this._onData) this._onData(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.chunks, { type: 'video/webm' });
                this.isRecording = false;
                this._cleanup();

                if (this._onStop) {
                    this._onStop({
                        blob,
                        duration: Date.now() - this.startTime,
                        size: blob.size,
                        format: 'webm'
                    });
                }
            };

            // Start recording with 1s timeslice for streaming
            this.mediaRecorder.start(1000);
            this.startTime = Date.now();
            this.isRecording = true;

            // Auto-stop at max duration
            this._timer = setTimeout(() => this.stop(), this.maxDurationMs);

            console.log('[VideoRecorder] Recording started');
            return true;
        } catch (err) {
            console.error('[VideoRecorder] Failed to start:', err);
            this._cleanup();
            return false;
        }
    }

    /**
     * Get available screen sources for selection
     */
    async getSources() {
        try {
            const { desktopCapturer } = require('electron');
            const sources = await desktopCapturer.getSources({
                types: ['window', 'screen'],
                thumbnailSize: { width: 320, height: 180 }
            });
            return sources.map(s => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail.toDataURL()
            }));
        } catch {
            return [];
        }
    }

    /**
     * Stop recording and return the blob
     */
    stop() {
        if (!this.isRecording || !this.mediaRecorder) return;

        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }

        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }

        console.log('[VideoRecorder] Recording stopped');
    }

    /**
     * Get recording duration in seconds
     */
    getDuration() {
        if (!this.startTime) return 0;
        return Math.round((Date.now() - this.startTime) / 1000);
    }

    /**
     * Save blob to file
     */
    async saveToFile(blob, filePath) {
        const buffer = await blob.arrayBuffer();
        const fs = require('fs');
        fs.writeFileSync(filePath, Buffer.from(buffer));
        console.log(`[VideoRecorder] Saved to ${filePath} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    }

    _cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }
}

// Export for both Electron and module contexts
if (typeof module !== 'undefined') module.exports = { VideoRecorder };
if (typeof window !== 'undefined') window.VideoRecorder = VideoRecorder;
