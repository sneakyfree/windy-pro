/**
 * Windy Pro Audio Processor Worklet
 * Replaces deprecated ScriptProcessorNode.
 * Converts Float32 audio samples to Int16 PCM and sends to main thread.
 *
 * RP-05 hardening:
 * - Input validation (skip empty/undefined channels)
 * - Gain normalization (clamp float range)
 * - Sample count tracking for diagnostics
 */
class WindyAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._totalSamples = 0;
    }

    process(inputs) {
        const input = inputs[0]?.[0];
        if (!input || input.length === 0) return true;

        // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            // Clamp to [-1, 1] to prevent overflow from gain stages
            const s = Math.max(-1, Math.min(1, input[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        this._totalSamples += input.length;
        this.port.postMessage(int16.buffer, [int16.buffer]);
        return true;
    }
}

registerProcessor('windy-audio-processor', WindyAudioProcessor);
