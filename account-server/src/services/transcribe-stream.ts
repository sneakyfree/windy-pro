/**
 * AWS Transcribe Streaming integration for the /ws/transcribe WebSocket.
 *
 * ADR-009 §"M1 — Wire protocol proof". Replaces the prior placeholder
 * handler that returned fake `[Transcription chunk N]` strings with real
 * Amazon Transcribe Streaming. The SPA already captures 16-bit PCM at
 * 16 kHz mono via Web Audio API + ScriptProcessor (see
 * `src/client/web/src/pages/Transcribe.jsx:130-156`), which is exactly
 * what Transcribe Streaming expects with `MediaEncoding: 'pcm'` and
 * `MediaSampleRateHertz: 16000` — so no transcoding step is needed
 * server-side.
 *
 * Wire protocol (unchanged from prior placeholder, so the SPA needs no
 * message-shape changes):
 *   client → server (text JSON):
 *     {type:'auth',  token: <JWT>}
 *     {type:'config', language?: 'en' | 'es' | …}
 *     {type:'stop'}
 *   client → server (binary): Int16Array PCM chunks @16kHz mono
 *   server → client (text JSON):
 *     {type:'ack', authenticated: bool}
 *     {type:'state', state: 'listening'}
 *     {type:'transcript', text, is_partial, confidence, startTime, endTime, language}
 *     {type:'error', message}
 *
 * Auth + audio-format are unchanged. The only behavioural change is the
 * `transcript` events now carry real AWS-Transcribe output instead of
 * placeholders.
 */
import http from 'http';
import WebSocket from 'ws';
import {
    TranscribeStreamingClient,
    StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import { config } from '../config';
import { verifyToken } from '../middleware/auth';

// Map ISO-639-1 codes the SPA sends to AWS Transcribe Streaming language
// codes. Default to en-US. Expand as we validate quality per language —
// the V1 list intentionally mirrors the same five-ish languages the
// translate route already supports.
function awsLanguageCode(spaLang: string): string {
    const normalized = (spaLang || 'en').toLowerCase().split('-')[0];
    const map: Record<string, string> = {
        en: 'en-US',
        es: 'es-US',
        fr: 'fr-FR',
        de: 'de-DE',
        it: 'it-IT',
        pt: 'pt-BR',
        ja: 'ja-JP',
        ko: 'ko-KR',
        zh: 'zh-CN',
        ar: 'ar-SA',
        ru: 'ru-RU',
        // Hungarian, Polish — not currently supported by Transcribe Streaming.
        // For those, the SPA falls back to upload-mode transcription.
    };
    return map[normalized] || 'en-US';
}

interface PerConnectionState {
    authenticated: boolean;
    language: string;
    chunkCount: number;
    audioQueue: Uint8Array[];
    /** Resolve next audio chunk to the AsyncIterable that AWS consumes. */
    resolveNextChunk: ((value: undefined) => void) | null;
    /** Stream-end flag — set when client sends `stop` or disconnects. */
    closed: boolean;
    awsAbort: AbortController;
}

function createState(): PerConnectionState {
    return {
        authenticated: false,
        language: 'en',
        chunkCount: 0,
        audioQueue: [],
        resolveNextChunk: null,
        closed: false,
        awsAbort: new AbortController(),
    };
}

/** AsyncIterable bridge from the client's incoming audio chunks → AWS. */
async function* audioStreamFromState(state: PerConnectionState) {
    while (!state.closed) {
        if (state.audioQueue.length > 0) {
            const chunk = state.audioQueue.shift()!;
            yield { AudioEvent: { AudioChunk: chunk } };
        } else {
            await new Promise<undefined>((resolve) => {
                state.resolveNextChunk = resolve;
            });
        }
    }
}

/**
 * Mount the AWS-backed /ws/transcribe handler on the given http.Server.
 * Replaces the inline placeholder previously living in server.ts.
 */
export function setupTranscribeStreamWS(server: http.Server): void {
    const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

    // Construct the AWS client lazily — if AWS_REGION isn't set we still
    // accept WS connections but warn loudly. Lets local dev keep working
    // without AWS credentials configured.
    const awsRegion = process.env.AWS_REGION || 'us-east-1';
    const awsConfigured = !!(
        process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_PROFILE ||
        process.env.AWS_ROLE_ARN
    );

    if (!awsConfigured) {
        console.warn(
            '[transcribe-stream] ⚠️  No AWS credentials detected ' +
            '(AWS_ACCESS_KEY_ID / AWS_PROFILE / AWS_ROLE_ARN). ' +
            '/ws/transcribe will accept connections but Transcribe ' +
            'Streaming calls will fail — set credentials before testing.',
        );
    } else {
        console.log(`[transcribe-stream] AWS Transcribe Streaming wired (region=${awsRegion})`);
    }

    wss.on('connection', (ws: WebSocket) => {
        const state = createState();

        console.log('[transcribe-stream] client connected');
        ws.send(JSON.stringify({ type: 'ack' }));

        // SEC-H1: 10s auth timeout — close if no `auth` message lands.
        const authTimeout = setTimeout(() => {
            if (!state.authenticated) {
                ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
                ws.close(4001, 'Authentication timeout');
            }
        }, 10000);

        ws.on('message', async (data: Buffer | ArrayBuffer | string) => {
            // Binary audio chunk — feed to the AWS stream.
            if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
                if (!state.authenticated) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Authentication required before sending audio' }));
                    return;
                }
                state.chunkCount++;
                const chunk = Buffer.isBuffer(data) ? new Uint8Array(data) : new Uint8Array(data);
                state.audioQueue.push(chunk);
                if (state.resolveNextChunk) {
                    const r = state.resolveNextChunk;
                    state.resolveNextChunk = null;
                    r(undefined);
                }
                return;
            }

            // Text message (control plane).
            try {
                const msg = JSON.parse(data.toString());

                switch (msg.type) {
                    case 'auth':
                        // Use the production verifyToken helper (RS256 first
                        // via JWKS, then HS256 fallback). Prior HS256-only
                        // verification silently rejected RS256 tokens from
                        // production-signed JWTs — surfaced 2026-05-19 as the
                        // /transcribe "Authentication failed" red dot.
                        if (msg.token) {
                            try {
                                verifyToken(msg.token);
                                state.authenticated = true;
                                clearTimeout(authTimeout);
                            } catch {
                                state.authenticated = false;
                            }
                        }
                        ws.send(JSON.stringify({ type: 'ack', authenticated: state.authenticated }));
                        break;

                    case 'config':
                        if (!state.authenticated) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
                            return;
                        }
                        state.language = msg.language || state.language;
                        ws.send(JSON.stringify({ type: 'state', state: 'listening' }));
                        console.log(`[transcribe-stream] config: language=${state.language} (AWS=${awsLanguageCode(state.language)})`);

                        // Kick off the AWS Transcribe Streaming session
                        // exactly once per connection, on first config msg.
                        startTranscribeSession(ws, state, awsRegion).catch((err: any) => {
                            console.error('[transcribe-stream] AWS session failed:', err?.message || err);
                            ws.send(JSON.stringify({ type: 'error', message: 'Transcription service unavailable' }));
                            try { ws.close(); } catch { /* already closed */ }
                        });
                        break;

                    case 'stop':
                        state.closed = true;
                        if (state.resolveNextChunk) {
                            const r = state.resolveNextChunk;
                            state.resolveNextChunk = null;
                            r(undefined);
                        }
                        state.awsAbort.abort();
                        console.log(`[transcribe-stream] stopped after ${state.chunkCount} chunks`);
                        ws.close();
                        break;

                    default:
                        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
                }
            } catch {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            }
        });

        ws.on('close', () => {
            clearTimeout(authTimeout);
            state.closed = true;
            state.awsAbort.abort();
            if (state.resolveNextChunk) {
                const r = state.resolveNextChunk;
                state.resolveNextChunk = null;
                r(undefined);
            }
            console.log(`[transcribe-stream] client disconnected after ${state.chunkCount} chunks`);
        });

        ws.on('error', (err: any) => {
            console.warn('[transcribe-stream] ws error:', err?.message || err);
        });
    });
}

async function startTranscribeSession(
    ws: WebSocket,
    state: PerConnectionState,
    region: string,
): Promise<void> {
    const client = new TranscribeStreamingClient({ region });

    const command = new StartStreamTranscriptionCommand({
        LanguageCode: awsLanguageCode(state.language) as any,
        MediaSampleRateHertz: 16000,
        MediaEncoding: 'pcm',
        AudioStream: audioStreamFromState(state),
    });

    const response = await client.send(command, { abortSignal: state.awsAbort.signal });

    if (!response.TranscriptResultStream) {
        ws.send(JSON.stringify({ type: 'error', message: 'AWS returned no transcript stream' }));
        return;
    }

    for await (const event of response.TranscriptResultStream) {
        if (state.closed) break;
        if (!event.TranscriptEvent) continue;
        const results = event.TranscriptEvent.Transcript?.Results || [];
        for (const result of results) {
            const alt = result.Alternatives?.[0];
            if (!alt) continue;
            // AWS Transcribe Streaming reports per-item confidence (on
            // Items[].Confidence) but no top-level Alternative.Confidence,
            // so we average across items when available, otherwise fall
            // back to 0.9 for the SPA's confidence display.
            const items = alt.Items || [];
            const itemConfidences = items
                .map(i => (typeof i.Confidence === 'number' ? i.Confidence : null))
                .filter((c): c is number => c !== null);
            const avgConfidence = itemConfidences.length > 0
                ? itemConfidences.reduce((a, b) => a + b, 0) / itemConfidences.length
                : 0.9;
            ws.send(JSON.stringify({
                type: 'transcript',
                text: alt.Transcript || '',
                is_partial: !!result.IsPartial,
                confidence: avgConfidence,
                startTime: result.StartTime ?? 0,
                endTime: result.EndTime ?? 0,
                language: state.language,
            }));
        }
    }
}
