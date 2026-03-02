/**
 * Windy Pro — Opus Codec Integration (A4.3)
 * 
 * Handles Opus audio decoding/encoding for cloud transcription.
 * Opus is the preferred codec for WebSocket audio streaming due to
 * its low latency and excellent compression.
 * 
 * Uses opusscript (pure JS) with fallback to raw PCM.
 */

class OpusCodec {
    constructor() {
        this.encoder = null;
        this.decoder = null;
        this.sampleRate = 16000;
        this.channels = 1;
        this.frameSize = 960; // 60ms at 16kHz
        this.available = false;

        try {
            const OpusScript = require('opusscript');
            this.encoder = new OpusScript(this.sampleRate, this.channels, OpusScript.Application.VOIP);
            this.decoder = new OpusScript(this.sampleRate, this.channels, OpusScript.Application.VOIP);
            this.available = true;
        } catch {
            console.warn('[OpusCodec] opusscript not available — using raw PCM fallback');
        }
    }

    /**
     * Encode PCM audio to Opus
     * @param {Buffer} pcmData - 16-bit PCM audio buffer
     * @returns {Buffer} Opus-encoded frame
     */
    encode(pcmData) {
        if (!this.available || !this.encoder) return pcmData;
        try {
            return Buffer.from(this.encoder.encode(pcmData, this.frameSize));
        } catch (err) {
            console.warn('[OpusCodec] Encode error:', err.message);
            return pcmData;
        }
    }

    /**
     * Decode Opus audio to PCM
     * @param {Buffer} opusData - Opus-encoded audio
     * @returns {Buffer} 16-bit PCM audio buffer
     */
    decode(opusData) {
        if (!this.available || !this.decoder) return opusData;
        try {
            return Buffer.from(this.decoder.decode(opusData));
        } catch (err) {
            console.warn('[OpusCodec] Decode error:', err.message);
            return opusData;
        }
    }

    /**
     * Get compression ratio info
     */
    getStats(pcmSize, opusSize) {
        const ratio = pcmSize > 0 ? (opusSize / pcmSize * 100).toFixed(1) : 0;
        return {
            pcmBytes: pcmSize,
            opusBytes: opusSize,
            compressionRatio: `${ratio}%`,
            bandwidthSaved: `${(100 - ratio).toFixed(1)}%`
        };
    }
}

module.exports = { OpusCodec };
