/**
 * Windy Pro v2.0 — Account & Authentication Server (TypeScript)
 *
 * Express.js server with SQLite storage, bcrypt passwords, JWT auth.
 * Enforces 5-device limit per account.
 */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { getDb, closeDb } from './db/schema';
import authRoutes from './routes/auth';
import translationRoutes, { historyHandler, favoritesHandler } from './routes/translations';
import recordingRoutes from './routes/recordings';
import transcriptionRoutes from './routes/transcription';
import cloneRoutes from './routes/clone';
import adminRoutes from './routes/admin';
import downloadRoutes from './routes/downloads';
import miscRoutes from './routes/misc';
import { authenticateToken } from './middleware/auth';

const app = express();

// ─── Middleware ───────────────────────────────────────────────

app.use(cors());
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));
app.use(express.json());

// ─── Mount Routes ────────────────────────────────────────────

// Auth
app.use('/api/v1/auth', authRoutes);
// Also mount at /v1/auth for backward compat with test-api.sh
app.use('/v1/auth', authRoutes);

// Translations
app.use('/api/v1/translate', translationRoutes);
// User history/favorites (different prefix but related to translations)
app.get('/api/v1/user/history', authenticateToken, historyHandler);
app.post('/api/v1/user/favorites', authenticateToken, favoritesHandler);

// Recordings
app.use('/api/v1/recordings', recordingRoutes);

// Transcription
app.use('/api/v1/transcribe', transcriptionRoutes);

// Clone/Training
app.use('/api/v1/clone', cloneRoutes);

// Admin
app.use('/api/v1/admin', adminRoutes);

// Downloads
app.use('/download', downloadRoutes);

// Misc routes (health, analytics, updates, license, rtc, ocr)
app.use('/', miscRoutes);

// ─── Error Handler ───────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── HTTP + WebSocket Server ─────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

wss.on('connection', (ws: WebSocket) => {
    let authenticated = false;
    let wsConfig = { language: 'en', engine: 'cloud-standard' };
    let chunkCount = 0;

    console.log('🎙️  WS transcribe: client connected');

    ws.send(JSON.stringify({ type: 'ack' }));

    ws.on('message', (data: Buffer | ArrayBuffer | string) => {
        // Binary audio chunk
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
            chunkCount++;
            if (chunkCount % 10 === 0) {
                ws.send(JSON.stringify({
                    type: 'transcript',
                    text: `[Transcription chunk ${chunkCount}]`,
                    partial: true,
                    confidence: 0.92,
                    startTime: (chunkCount - 10) * 0.1,
                    endTime: chunkCount * 0.1,
                    language: wsConfig.language,
                }));
            }
            return;
        }

        // Text message (JSON)
        try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
                case 'auth':
                    if (msg.token) {
                        try {
                            jwt.verify(msg.token, config.JWT_SECRET);
                            authenticated = true;
                        } catch {
                            authenticated = false;
                        }
                    }
                    ws.send(JSON.stringify({ type: 'ack', authenticated }));
                    break;

                case 'config':
                    wsConfig.language = msg.language || wsConfig.language;
                    wsConfig.engine = msg.engine || wsConfig.engine;
                    ws.send(JSON.stringify({ type: 'state', state: 'listening' }));
                    console.log(`🎙️  WS config: language=${wsConfig.language}, engine=${wsConfig.engine}`);
                    break;

                case 'stop':
                    ws.send(JSON.stringify({
                        type: 'transcript',
                        text: `[Final transcription — ${chunkCount} audio chunks processed]`,
                        partial: false,
                        confidence: 0.95,
                        startTime: 0,
                        endTime: chunkCount * 0.1,
                        language: wsConfig.language,
                    }));
                    console.log(`🎙️  WS transcribe: stopped after ${chunkCount} chunks`);
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
        console.log(`🎙️  WS transcribe: client disconnected (${chunkCount} chunks)`);
    });
});

// ─── Start ───────────────────────────────────────────────────

// Ensure DB is initialized
const db = getDb();

server.listen(config.PORT, () => {
    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;

    console.log('');
    console.log('🔑 Windy Pro Account Server v2.0 (TypeScript)');
    console.log(`   Port:     http://localhost:${config.PORT}`);
    console.log(`   Database: ${config.DB_PATH}`);
    console.log(`   Users:    ${userCount}`);
    console.log(`   Devices:  ${config.MAX_DEVICES} per account`);
    console.log('');
    console.log('   Endpoints:');
    console.log('   POST /v1/auth/register              — Create account');
    console.log('   POST /v1/auth/login                 — Login');
    console.log('   POST /v1/auth/logout                — Logout');
    console.log('   GET  /v1/auth/me                    — Current user info');
    console.log('   GET  /v1/auth/devices               — List devices');
    console.log(`   POST /v1/auth/devices/register      — Register device (${config.MAX_DEVICES} max)`);
    console.log('   POST /v1/auth/devices/remove        — Remove device');
    console.log('   POST /v1/auth/refresh               — Refresh token');
    console.log('   POST /api/v1/translate/speech        — Speech translation');
    console.log('   POST /api/v1/translate/text          — Text translation (AI)');
    console.log('   GET  /api/v1/translate/languages     — Supported languages');
    console.log('   POST /api/v1/transcribe              — Audio transcription');
    console.log('   POST /api/v1/transcribe/batch        — Batch transcription');
    console.log('   WS   /ws/transcribe                  — Real-time transcription');
    console.log('   POST /api/v1/ocr/translate           — OCR + translate');
    console.log('   GET  /api/v1/recordings              — List recordings');
    console.log('   GET  /api/v1/recordings/:id          — Get recording');
    console.log('   DEL  /api/v1/recordings/:id          — Delete recording');
    console.log('   POST /api/v1/recordings/upload       — Upload recording');
    console.log('   POST /api/v1/recordings/upload/chunk — Chunked upload');
    console.log('   POST /api/v1/recordings/upload/batch — Batch upload');
    console.log('   POST /api/v1/recordings/sync         — Sync recordings');
    console.log('   GET  /api/v1/recordings/check        — Check bundle exists');
    console.log('   GET  /api/v1/user/history            — Translation history');
    console.log('   POST /api/v1/user/favorites          — Toggle favorite');
    console.log('   POST /api/v1/analytics               — Log event (no auth)');
    console.log('   GET  /api/v1/updates/check           — Check for updates');
    console.log('   POST /api/v1/license/activate        — Activate license');
    console.log('   GET  /api/v1/admin/users             — Admin: list users');
    console.log('   GET  /api/v1/admin/stats             — Admin: server stats');
    console.log('   GET  /api/v1/admin/revenue           — Admin: revenue');
    console.log('   GET  /api/v1/clone/training-data     — Clone: training bundles');
    console.log('   POST /api/v1/clone/start-training    — Clone: start training');
    console.log('   GET  /download/latest/:platform      — Download latest release');
    console.log('   GET  /download/verify                — Download verification');
    console.log('   GET  /download/version               — Current version');
    console.log('   GET  /health                         — Health check');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    closeDb();
    process.exit(0);
});
process.on('SIGTERM', () => {
    closeDb();
    process.exit(0);
});

export { app, server };
