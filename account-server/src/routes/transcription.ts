/**
 * Transcription routes — real speech-to-text via Groq Whisper / OpenAI Whisper.
 * Falls back to stub if no API keys are configured.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { config } from '../config';
import FormData from 'form-data';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Whisper API helper ──────────────────────────────────────────

interface WhisperSegment {
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
}

interface WhisperResponse {
    text: string;
    segments?: WhisperSegment[];
    language?: string;
    duration?: number;
}

/**
 * Call AWS Cloud STT (Windy Cloud GPU instances) for heavy workloads.
 * Used when: AWS_STT_ENABLED=true AND (user requests cloud engine OR local fails).
 */
async function callAwsSttAPI(
    audioBuffer: Buffer,
    originalName: string,
    language: string,
): Promise<WhisperResponse> {
    const endpoint = config.AWS_STT_ENDPOINT;
    if (!endpoint) throw new Error('AWS_STT_NOT_CONFIGURED');

    const form = new FormData();
    form.append('file', audioBuffer, {
        filename: originalName || 'audio.wav',
        contentType: 'audio/wav',
    });
    form.append('language', language || 'en');
    form.append('response_format', 'verbose_json');

    const response = await fetch(`${endpoint}`, {
        method: 'POST',
        headers: {
            'X-Service-Token': process.env.WINDY_CLOUD_SERVICE_TOKEN || '',
            ...form.getHeaders(),
        },
        body: form.getBuffer(),
        signal: AbortSignal.timeout(120000), // 2min — GPU processing can take longer for large files
    });

    if (!response.ok) {
        const errBody = await response.text();
        console.error(`[Transcription] AWS STT ${response.status}:`, errBody);
        throw new Error(`AWS STT error: ${response.status} — ${errBody.slice(0, 200)}`);
    }

    const result = (await response.json()) as WhisperResponse;
    console.log(`[Transcription] ✅ AWS Cloud STT: "${result.text?.slice(0, 80)}..." (${result.segments?.length || 0} segments)`);
    return result;
}

async function callWhisperAPI(
    audioBuffer: Buffer,
    originalName: string,
    language: string,
): Promise<WhisperResponse> {
    const groqKey = config.GROQ_API_KEY;
    const openaiKey = config.OPENAI_API_KEY;

    if (!groqKey && !openaiKey) {
        throw new Error('NO_API_KEY');
    }

    const isGroq = !!groqKey;
    const apiUrl = isGroq
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';
    const apiKey = groqKey || openaiKey;
    const model = isGroq ? 'whisper-large-v3' : 'whisper-1';

    // Build multipart form data
    const form = new FormData();
    form.append('file', audioBuffer, {
        filename: originalName || 'audio.wav',
        contentType: 'audio/wav',
    });
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    if (language && language !== 'auto') {
        form.append('language', language);
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...form.getHeaders(),
        },
        body: form.getBuffer(),
        signal: AbortSignal.timeout(30000), // 30s — audio files can be large
    });

    if (!response.ok) {
        const errBody = await response.text();
        console.error(`[Transcription] Whisper API ${response.status}:`, errBody);
        throw new Error(`Whisper API error: ${response.status} — ${errBody.slice(0, 200)}`);
    }

    const result = (await response.json()) as WhisperResponse;
    console.log(`[Transcription] ✅ ${isGroq ? 'Groq' : 'OpenAI'} Whisper: "${result.text?.slice(0, 80)}..." (${result.segments?.length || 0} segments)`);
    return result;
}

/**
 * Resolve which STT engine to use based on config and user request.
 * Priority: explicit cloud request → AWS failover on local failure → Groq/OpenAI → stub
 */
async function resolveAndTranscribe(
    audioBuffer: Buffer,
    originalName: string,
    language: string,
    requestedEngine: string,
): Promise<{ result: WhisperResponse; engine: string }> {
    // User explicitly requests cloud GPU transcription
    if (requestedEngine === 'cloud-gpu' && config.AWS_STT_ENABLED) {
        const result = await callAwsSttAPI(audioBuffer, originalName, language);
        return { result, engine: 'aws-cloud-stt' };
    }

    // Try local (Groq/OpenAI) first
    try {
        const result = await callWhisperAPI(audioBuffer, originalName, language);
        return { result, engine: config.GROQ_API_KEY ? 'groq-whisper' : 'openai-whisper' };
    } catch (localErr: any) {
        // If local fails and AWS is enabled, failover to cloud GPU
        if (config.AWS_STT_ENABLED && config.AWS_STT_ENDPOINT && localErr.message !== 'NO_API_KEY') {
            console.warn(`[Transcription] Local engine failed (${localErr.message}), failing over to AWS Cloud STT`);
            try {
                const result = await callAwsSttAPI(audioBuffer, originalName, language);
                return { result, engine: 'aws-cloud-stt-failover' };
            } catch (awsErr: any) {
                console.error(`[Transcription] AWS failover also failed:`, awsErr.message);
            }
        }
        throw localErr;
    }
}

// ─── POST /api/v1/transcribe ─────────────────────────────────

router.post('/', authenticateToken, upload.single('audio'), async (req: Request, res: Response) => {
    try {
        const language = req.body.language || 'en';
        const engine = req.body.engine || 'cloud-standard';
        const file = req.file;

        if (!file || file.size === 0) {
            res.status(400).json({ error: 'No audio file provided. Send as multipart field "audio".' });
            return;
        }

        console.log(`🎤 Transcribe: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB) language=${language} engine=${engine}`);

        // Try real transcription (local → AWS failover → stub)
        try {
            const { result, engine: resolvedEngine } = await resolveAndTranscribe(file.buffer, file.originalname, language, engine);

            // Map Whisper segments to our format
            const segments = (result.segments || []).map((seg, i) => ({
                id: uuidv4(),
                text: seg.text.trim(),
                startTime: seg.start,
                endTime: seg.end,
                confidence: Math.max(0, Math.min(1, 1 + (seg.avg_logprob || -0.3))),
                language: result.language || language,
                partial: false,
            }));

            // If no segments returned, create one from fullText
            if (segments.length === 0 && result.text) {
                segments.push({
                    id: uuidv4(),
                    text: result.text.trim(),
                    startTime: 0,
                    endTime: result.duration || 5.0,
                    confidence: 0.9,
                    language: result.language || language,
                    partial: false,
                });
            }

            res.json({
                segments,
                fullText: result.text?.trim() || segments.map(s => s.text).join(' '),
                language: result.language || language,
                duration: result.duration || (segments.length > 0 ? segments[segments.length - 1].endTime : 0),
                engine: resolvedEngine,
            });
            return;
        } catch (whisperErr: any) {
            if (whisperErr.message === 'NO_API_KEY') {
                console.warn('[Transcription] No API key configured — falling back to stub');
            } else {
                console.error('[Transcription] All transcription engines failed:', whisperErr.message);
                // Still fall through to stub so the user gets something
            }
        }

        // Fallback: stub response (when no API key)
        const segments = [{
            id: uuidv4(),
            text: '[No transcription API key configured — set GROQ_API_KEY or OPENAI_API_KEY on server]',
            startTime: 0,
            endTime: 5.0,
            confidence: 0,
            language,
            partial: false,
        }];

        res.json({
            segments,
            fullText: segments.map(s => s.text).join(' '),
            language,
            duration: 5.0,
            engine: 'stub',
        });
    } catch (err: any) {
        console.error('Transcribe error:', err);
        res.status(500).json({ error: 'Transcription failed' });
    }
});

// ─── POST /api/v1/transcribe/batch ───────────────────────────

router.post('/batch', authenticateToken, upload.array('audio', 20), async (req: Request, res: Response) => {
    try {
        const language = req.body.language || 'en';
        const engine = req.body.engine || 'cloud-standard';
        const files = (req.files || []) as Express.Multer.File[];

        if (files.length === 0) {
            res.status(400).json({ error: 'No audio files provided.' });
            return;
        }

        console.log(`🎤 Batch transcribe: ${files.length} files, language=${language}`);

        const results = await Promise.all(files.map(async (file, i) => {
            try {
                const result = await callWhisperAPI(file.buffer, file.originalname, language);
                const segments = (result.segments || []).map(seg => ({
                    id: uuidv4(),
                    text: seg.text.trim(),
                    startTime: seg.start,
                    endTime: seg.end,
                    confidence: Math.max(0, Math.min(1, 1 + (seg.avg_logprob || -0.3))),
                    language: result.language || language,
                    partial: false,
                }));

                if (segments.length === 0 && result.text) {
                    segments.push({
                        id: uuidv4(),
                        text: result.text.trim(),
                        startTime: 0,
                        endTime: result.duration || 5.0,
                        confidence: 0.9,
                        language: result.language || language,
                        partial: false,
                    });
                }

                return {
                    index: i,
                    segments,
                    fullText: result.text?.trim() || '',
                    language: result.language || language,
                    duration: result.duration || 0,
                };
            } catch (err: any) {
                return {
                    index: i,
                    segments: [],
                    fullText: `[Transcription failed: ${err.message}]`,
                    language,
                    duration: 0,
                    error: err.message,
                };
            }
        }));

        res.json({ results });
    } catch (err: any) {
        console.error('Batch transcribe error:', err);
        res.status(500).json({ error: 'Batch transcription failed' });
    }
});

export default router;
