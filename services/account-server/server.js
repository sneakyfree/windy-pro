/**
 * Windy Pro — Account Server
 *
 * Express.js server providing user authentication, profile management,
 * device tracking, and JWT token lifecycle.
 *
 * Endpoints:
 *   POST   /api/v1/auth/register   — Create account
 *   POST   /api/v1/auth/login      — Sign in (returns JWT)
 *   POST   /api/v1/auth/refresh    — Refresh expired JWT
 *   POST   /api/v1/auth/logout     — Invalidate token
 *   GET    /api/v1/auth/me         — Get profile
 *   PATCH  /api/v1/auth/me         — Update profile
 *   PUT    /api/v1/auth/password   — Change password
 *   DELETE /api/v1/auth/me         — Delete account (GDPR)
 *   POST   /api/v1/auth/devices    — Register device
 *   GET    /api/v1/auth/devices    — List devices
 *   DELETE /api/v1/auth/devices/:id — Revoke device
 *   GET    /health                 — Health check
 */

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Media storage directory
const MEDIA_PATH = process.env.MEDIA_PATH || path.join(__dirname, 'media');
fs.mkdirSync(MEDIA_PATH, { recursive: true });

const app = express();
const PORT = process.env.PORT || 8098;
const JWT_SECRET = process.env.JWT_SECRET || 'windy-pro-dev-secret-change-in-production';
const JWT_EXPIRY_HOURS = 168; // 7 days
const REFRESH_EXPIRY_DAYS = 30;
const MAX_DEVICES = 5;
const BCRYPT_ROUNDS = 12;

// ═══════════════════════════════════════════════
// Database Setup
// ═══════════════════════════════════════════════
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'accounts.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    device_hash TEXT,
    platform TEXT,
    last_seen TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS token_blacklist (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    transcript TEXT DEFAULT '',
    word_count INTEGER DEFAULT 0,
    duration_seconds REAL DEFAULT 0,
    engine TEXT DEFAULT 'local',
    mode TEXT DEFAULT 'batch',
    has_audio INTEGER DEFAULT 0,
    has_video INTEGER DEFAULT 0,
    audio_path TEXT,
    video_path TEXT,
    recorded_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_recordings_user ON recordings(user_id, recorded_at DESC);
`);

// ═══════════════════════════════════════════════
// JWT Helpers (zero-dependency)
// ═══════════════════════════════════════════════
function base64url(str) {
    return Buffer.from(str).toString('base64url');
}

function createJWT(payload, expiresInHours = JWT_EXPIRY_HOURS) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const body = base64url(JSON.stringify({
        ...payload,
        iat: now,
        exp: now + expiresInHours * 3600
    }));
    const signature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${header}.${body}`)
        .digest('base64url');
    return `${header}.${body}.${signature}`;
}

function verifyJWT(token) {
    try {
        const [header, body, signature] = token.split('.');
        const expectedSig = crypto
            .createHmac('sha256', JWT_SECRET)
            .update(`${header}.${body}`)
            .digest('base64url');
        if (signature !== expectedSig) return null;

        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

        // Check blacklist
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const blacklisted = db.prepare('SELECT 1 FROM token_blacklist WHERE token_hash = ?').get(hash);
        if (blacklisted) return null;

        return payload;
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limit login/register
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 15,
    message: { error: 'Too many attempts. Try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Auth middleware
function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = verifyJWT(auth.slice(7));
    if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = payload;
    req.token = auth.slice(7);
    next();
}

// ═══════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════
app.get('/health', (req, res) => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    res.json({ status: 'ok', service: 'account-server', users: userCount, uptime: process.uptime() });
});

// ═══════════════════════════════════════════════
// Auth Endpoints
// ═══════════════════════════════════════════════

// POST /api/v1/auth/register
app.post('/api/v1/auth/register', authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        // Check existing
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        const id = uuidv4();
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
            .run(id, email.toLowerCase(), name.trim(), passwordHash);

        const user = { id, email: email.toLowerCase(), name: name.trim() };
        const token = createJWT({ sub: id, email: user.email, name: user.name });

        res.status(201).json({ token, user });
    } catch (err) {
        console.error('[Register]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/v1/auth/login
app.post('/api/v1/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = createJWT({ sub: user.id, email: user.email, name: user.name });

        // Create refresh token
        const refreshToken = crypto.randomBytes(64).toString('hex');
        const refreshExpiry = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 86400000).toISOString();
        db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
            .run(refreshToken, user.id, refreshExpiry);

        res.json({
            token,
            refreshToken,
            user: { id: user.id, email: user.email, name: user.name }
        });
    } catch (err) {
        console.error('[Login]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/v1/auth/refresh
app.post('/api/v1/auth/refresh', (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const row = db.prepare(
            "SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')"
        ).get(refreshToken);

        if (!row) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Rotate: delete old, create new
        db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
        const newRefresh = crypto.randomBytes(64).toString('hex');
        const newExpiry = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 86400000).toISOString();
        db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
            .run(newRefresh, user.id, newExpiry);

        const token = createJWT({ sub: user.id, email: user.email, name: user.name });

        res.json({
            token,
            refreshToken: newRefresh,
            user: { id: user.id, email: user.email, name: user.name }
        });
    } catch (err) {
        console.error('[Refresh]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/v1/auth/logout
app.post('/api/v1/auth/logout', authenticate, (req, res) => {
    try {
        // Blacklist current token
        const hash = crypto.createHash('sha256').update(req.token).digest('hex');
        const payload = verifyJWT(req.token);
        const expiresAt = payload ? new Date(payload.exp * 1000).toISOString() : new Date(Date.now() + 86400000).toISOString();
        db.prepare('INSERT OR IGNORE INTO token_blacklist (token_hash, expires_at) VALUES (?, ?)')
            .run(hash, expiresAt);

        // Delete user's refresh tokens
        db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.sub);

        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        console.error('[Logout]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/auth/me
app.get('/api/v1/auth/me', authenticate, (req, res) => {
    const user = db.prepare('SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?')
        .get(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
});

// PATCH /api/v1/auth/me
app.patch('/api/v1/auth/me', authenticate, (req, res) => {
    try {
        const { name, email } = req.body;
        const updates = [];
        const params = [];

        if (name) { updates.push('name = ?'); params.push(name.trim()); }
        if (email) {
            const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
                .get(email.toLowerCase(), req.user.sub);
            if (existing) return res.status(409).json({ error: 'Email already in use' });
            updates.push('email = ?'); params.push(email.toLowerCase());
        }

        if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

        updates.push("updated_at = datetime('now')");
        params.push(req.user.sub);

        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        const user = db.prepare('SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?')
            .get(req.user.sub);
        res.json({ user });
    } catch (err) {
        console.error('[UpdateProfile]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/v1/auth/password
app.put('/api/v1/auth/password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password required' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.sub);
        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
            .run(newHash, req.user.sub);

        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        console.error('[ChangePassword]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/v1/auth/me (GDPR account deletion)
app.delete('/api/v1/auth/me', authenticate, (req, res) => {
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(req.user.sub);
        res.json({ message: 'Account deleted permanently' });
    } catch (err) {
        console.error('[DeleteAccount]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ═══════════════════════════════════════════════
// Device Management
// ═══════════════════════════════════════════════

// POST /api/v1/auth/devices
app.post('/api/v1/auth/devices', authenticate, (req, res) => {
    try {
        const { deviceName, deviceHash, platform } = req.body;
        if (!deviceName) return res.status(400).json({ error: 'Device name required' });

        // Check device limit
        const count = db.prepare('SELECT COUNT(*) as count FROM devices WHERE user_id = ?')
            .get(req.user.sub).count;
        if (count >= MAX_DEVICES) {
            return res.status(403).json({
                error: `Device limit reached (${MAX_DEVICES}). Remove a device first.`,
                devices: db.prepare('SELECT id, device_name, platform, last_seen FROM devices WHERE user_id = ? ORDER BY last_seen DESC')
                    .all(req.user.sub)
            });
        }

        // Check if device already registered
        if (deviceHash) {
            const existing = db.prepare('SELECT id FROM devices WHERE user_id = ? AND device_hash = ?')
                .get(req.user.sub, deviceHash);
            if (existing) {
                db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(existing.id);
                return res.json({ message: 'Device already registered', deviceId: existing.id });
            }
        }

        const id = uuidv4();
        db.prepare('INSERT INTO devices (id, user_id, device_name, device_hash, platform) VALUES (?, ?, ?, ?, ?)')
            .run(id, req.user.sub, deviceName, deviceHash || null, platform || null);

        res.status(201).json({ deviceId: id, message: 'Device registered' });
    } catch (err) {
        console.error('[RegisterDevice]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/auth/devices
app.get('/api/v1/auth/devices', authenticate, (req, res) => {
    const devices = db.prepare(
        'SELECT id, device_name, platform, last_seen, created_at FROM devices WHERE user_id = ? ORDER BY last_seen DESC'
    ).all(req.user.sub);
    res.json({ devices, limit: MAX_DEVICES });
});

// DELETE /api/v1/auth/devices/:id
app.delete('/api/v1/auth/devices/:id', authenticate, (req, res) => {
    const result = db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.user.sub);
    if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
    res.json({ message: 'Device removed' });
});

// ═══════════════════════════════════════════════
// Recording Endpoints (H2)
// ═══════════════════════════════════════════════
const RECORDINGS_PER_PAGE = 50;

// GET /api/v1/recordings — list all (paginated, searchable)
app.get('/api/v1/recordings', authenticate, (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const search = req.query.search || '';
        const from = req.query.from || '';
        const to = req.query.to || '';
        const offset = (page - 1) * RECORDINGS_PER_PAGE;

        let where = 'WHERE user_id = ?';
        const params = [req.user.sub];

        if (search) {
            where += ' AND transcript LIKE ?';
            params.push(`%${search}%`);
        }
        if (from) {
            where += ' AND recorded_at >= ?';
            params.push(from);
        }
        if (to) {
            where += ' AND recorded_at <= ?';
            params.push(to);
        }

        const total = db.prepare(`SELECT COUNT(*) as count FROM recordings ${where}`).get(...params).count;
        const recordings = db.prepare(
            `SELECT id, word_count, duration_seconds, engine, mode, has_audio, has_video, recorded_at, created_at,
       SUBSTR(transcript, 1, 200) as preview
       FROM recordings ${where} ORDER BY recorded_at DESC LIMIT ? OFFSET ?`
        ).all(...params, RECORDINGS_PER_PAGE, offset);

        res.json({
            recordings,
            pagination: { page, perPage: RECORDINGS_PER_PAGE, total, totalPages: Math.ceil(total / RECORDINGS_PER_PAGE) }
        });
    } catch (err) {
        console.error('[ListRecordings]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/recordings/stats
app.get('/api/v1/recordings/stats', authenticate, (req, res) => {
    try {
        const stats = db.prepare(
            `SELECT COUNT(*) as totalRecordings, 
       COALESCE(SUM(word_count), 0) as totalWords, 
       COALESCE(SUM(duration_seconds), 0) as totalSeconds,
       COALESCE(SUM(has_audio), 0) as audioCount,
       COALESCE(SUM(has_video), 0) as videoCount
       FROM recordings WHERE user_id = ?`
        ).get(req.user.sub);
        stats.totalHours = Math.round(stats.totalSeconds / 3600 * 10) / 10;
        res.json({ stats });
    } catch (err) {
        console.error('[RecordingStats]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/recordings/:id
app.get('/api/v1/recordings/:id', authenticate, (req, res) => {
    const rec = db.prepare('SELECT * FROM recordings WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.sub);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    res.json({ recording: rec });
});

// POST /api/v1/recordings — create (from desktop sync)
app.post('/api/v1/recordings', authenticate, (req, res) => {
    try {
        const { transcript, wordCount, durationSeconds, engine, mode, recordedAt } = req.body;
        if (!transcript && !recordedAt) {
            return res.status(400).json({ error: 'transcript or recordedAt required' });
        }

        const id = uuidv4();
        const wc = wordCount || (transcript ? transcript.trim().split(/\s+/).filter(Boolean).length : 0);

        db.prepare(
            `INSERT INTO recordings (id, user_id, transcript, word_count, duration_seconds, engine, mode, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, req.user.sub, transcript || '', wc, durationSeconds || 0, engine || 'local', mode || 'batch', recordedAt || new Date().toISOString());

        res.status(201).json({ id, message: 'Recording saved' });
    } catch (err) {
        console.error('[CreateRecording]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/v1/recordings/:id — update transcript
app.patch('/api/v1/recordings/:id', authenticate, (req, res) => {
    try {
        const { transcript } = req.body;
        if (transcript === undefined) return res.status(400).json({ error: 'transcript required' });

        const wc = transcript.trim().split(/\s+/).filter(Boolean).length;
        const result = db.prepare(
            "UPDATE recordings SET transcript = ?, word_count = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
        ).run(transcript, wc, req.params.id, req.user.sub);

        if (result.changes === 0) return res.status(404).json({ error: 'Recording not found' });
        res.json({ message: 'Transcript updated', wordCount: wc });
    } catch (err) {
        console.error('[UpdateRecording]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/v1/recordings/:id
app.delete('/api/v1/recordings/:id', authenticate, (req, res) => {
    try {
        const rec = db.prepare('SELECT audio_path, video_path FROM recordings WHERE id = ? AND user_id = ?')
            .get(req.params.id, req.user.sub);
        if (!rec) return res.status(404).json({ error: 'Recording not found' });

        // Delete media files
        [rec.audio_path, rec.video_path].forEach(p => {
            if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) { } }
        });

        db.prepare('DELETE FROM recordings WHERE id = ? AND user_id = ?').run(req.params.id, req.user.sub);
        res.json({ message: 'Recording deleted' });
    } catch (err) {
        console.error('[DeleteRecording]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/v1/recordings/bulk — delete multiple
app.delete('/api/v1/recordings/bulk', authenticate, (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array required' });
        }

        const placeholders = ids.map(() => '?').join(',');
        const recs = db.prepare(
            `SELECT audio_path, video_path FROM recordings WHERE id IN (${placeholders}) AND user_id = ?`
        ).all(...ids, req.user.sub);

        recs.forEach(rec => {
            [rec.audio_path, rec.video_path].forEach(p => {
                if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (_) { } }
            });
        });

        const result = db.prepare(
            `DELETE FROM recordings WHERE id IN (${placeholders}) AND user_id = ?`
        ).run(...ids, req.user.sub);

        res.json({ message: `${result.changes} recordings deleted` });
    } catch (err) {
        console.error('[BulkDelete]', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/v1/recordings/:id/audio — stream audio
app.get('/api/v1/recordings/:id/audio', authenticate, (req, res) => {
    const rec = db.prepare('SELECT audio_path FROM recordings WHERE id = ? AND user_id = ? AND has_audio = 1')
        .get(req.params.id, req.user.sub);
    if (!rec || !rec.audio_path || !fs.existsSync(rec.audio_path)) {
        return res.status(404).json({ error: 'Audio not found' });
    }
    const stat = fs.statSync(rec.audio_path);
    const ext = path.extname(rec.audio_path).toLowerCase();
    const mimeTypes = { '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Support Range headers for seeking
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType
        });
        fs.createReadStream(rec.audio_path, { start, end }).pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
        fs.createReadStream(rec.audio_path).pipe(res);
    }
});

// GET /api/v1/recordings/:id/video — stream video
app.get('/api/v1/recordings/:id/video', authenticate, (req, res) => {
    const rec = db.prepare('SELECT video_path FROM recordings WHERE id = ? AND user_id = ? AND has_video = 1')
        .get(req.params.id, req.user.sub);
    if (!rec || !rec.video_path || !fs.existsSync(rec.video_path)) {
        return res.status(404).json({ error: 'Video not found' });
    }
    const stat = fs.statSync(rec.video_path);
    const ext = path.extname(rec.video_path).toLowerCase();
    const mimeTypes = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.ogg': 'video/ogg' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType
        });
        fs.createReadStream(rec.video_path, { start, end }).pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
        fs.createReadStream(rec.video_path).pipe(res);
    }
});

// ═══════════════════════════════════════════════
// Cleanup expired blacklisted tokens (daily)
// ═══════════════════════════════════════════════
setInterval(() => {
    try {
        db.prepare("DELETE FROM token_blacklist WHERE expires_at < datetime('now')").run();
        db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')").run();
    } catch (_) { }
}, 86400000); // 24h

// ═══════════════════════════════════════════════
// Analytics (H8 — Privacy-First Event Tracking)
// ═══════════════════════════════════════════════

// Create analytics table if needed
db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        props TEXT DEFAULT '{}',
        session_id TEXT,
        path TEXT,
        screen_width INTEGER,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// POST /api/v1/analytics — batch event ingestion (no auth required)
app.post('/api/v1/analytics', (req, res) => {
    try {
        const { events = [] } = req.body;
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'No events' });
        }
        // Cap batch size
        const batch = events.slice(0, 50);
        const insert = db.prepare(`
            INSERT INTO analytics_events (event, props, session_id, path, screen_width, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((items) => {
            for (const e of items) {
                insert.run(
                    e.event || 'unknown',
                    JSON.stringify(e.props || {}),
                    e.sessionId || '',
                    e.path || '',
                    e.screenWidth || 0,
                    e.userAgent || ''
                );
            }
        });
        insertMany(batch);
        res.json({ ok: true, count: batch.length });
    } catch (err) {
        res.status(500).json({ error: 'Analytics error' });
    }
});

// GET /api/v1/analytics/stats — aggregated overview (admin only)
app.get('/api/v1/analytics/stats', authenticateToken, (req, res) => {
    try {
        const stats = {
            total_events: db.prepare('SELECT COUNT(*) as c FROM analytics_events').get().c,
            unique_sessions: db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM analytics_events').get().c,
            events_today: db.prepare("SELECT COUNT(*) as c FROM analytics_events WHERE created_at >= date('now')").get().c,
            top_pages: db.prepare(`
                SELECT path, COUNT(*) as views
                FROM analytics_events WHERE event = 'page_view'
                GROUP BY path ORDER BY views DESC LIMIT 10
            `).all(),
            top_events: db.prepare(`
                SELECT event, COUNT(*) as count
                FROM analytics_events
                GROUP BY event ORDER BY count DESC LIMIT 10
            `).all()
        };
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Stats error' });
    }
});

// ═══════════════════════════════════════════════
// Payments (Ghost Feature 1 — Stripe)
// ═══════════════════════════════════════════════
try {
    const paymentsRouter = require('./routes/payments');
    app.use('/api/v1/payments', paymentsRouter);
    app.use('/api/v1/license', paymentsRouter);
    console.log('💳 Stripe payments route loaded');
} catch (err) {
    console.warn('⚠️  Payments route not loaded (stripe package may not be installed):', err.message);
}

// ═══════════════════════════════════════════════
// Admin Dashboard (Ghost Feature 2)
// ═══════════════════════════════════════════════
app.get('/api/v1/admin/dashboard', authenticateToken, (req, res) => {
    try {
        const users = db.prepare('SELECT COUNT(*) as total FROM users').get();
        const usersToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= date('now')").get();
        const devices = db.prepare('SELECT COUNT(*) as total FROM devices').get();
        const recordings = db.prepare('SELECT COUNT(*) as total FROM recordings').get() || { total: 0 };

        let analyticsTotal = { total: 0, sessions: 0 };
        try {
            analyticsTotal = {
                total: db.prepare('SELECT COUNT(*) as c FROM analytics_events').get()?.c || 0,
                sessions: db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM analytics_events').get()?.c || 0
            };
        } catch { /* analytics table may not exist yet */ }

        const recentUsers = db.prepare(`
            SELECT id, email, name, created_at FROM users
            ORDER BY created_at DESC LIMIT 10
        `).all();

        res.json({
            overview: {
                totalUsers: users.total,
                newUsersToday: usersToday.c,
                totalDevices: devices.total,
                totalRecordings: recordings.total,
                analyticsEvents: analyticsTotal.total,
                uniqueSessions: analyticsTotal.sessions,
            },
            recentUsers,
            serverUptime: Math.round(process.uptime()),
            serverVersion: '1.4.0'
        });
    } catch (err) {
        res.status(500).json({ error: 'Dashboard error' });
    }
});

// ═══════════════════════════════════════════════
// Update Check Endpoint (for Auto-Updater)
// ═══════════════════════════════════════════════
app.get('/api/v1/updates/check', (req, res) => {
    const currentVersion = req.query.v || '0.0.0';
    const latestVersion = '1.4.0'; // Update this with each release

    const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
    const [rMaj, rMin, rPat] = parse(latestVersion);
    const [cMaj, cMin, cPat] = parse(currentVersion);
    const available = rMaj > cMaj || (rMaj === cMaj && rMin > cMin) || (rMaj === cMaj && rMin === cMin && rPat > cPat);

    res.json({
        available,
        version: latestVersion,
        releaseNotes: 'Translation strand, i18n system, sync hardening, analytics, and bug fixes.',
        downloadUrl: available ? 'https://windypro.thewindstorm.uk/download' : null
    });
});

// ═══════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`🔐 Windy Pro Account Server running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Database: ${DB_PATH}`);
});

module.exports = app;
