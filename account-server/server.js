/**
 * Windy Pro v2.0 — Account & Authentication Server
 * 
 * Express.js server with SQLite storage, bcrypt passwords, JWT auth.
 * Enforces 5-device limit per account.
 * 
 * Endpoints:
 *   POST /v1/auth/register          — Create account
 *   POST /v1/auth/login             — Login
 *   GET  /v1/auth/me                — Current user info
 *   GET  /v1/auth/devices           — List devices
 *   POST /v1/auth/devices/register  — Register new device (5 max)
 *   POST /v1/auth/devices/remove    — Remove a device
 *   POST /v1/auth/refresh           — Refresh JWT token
 *   GET  /health                    — Health check
 * 
 * Usage:
 *   node server.js                       # Port 8098
 *   PORT=9000 node server.js             # Custom port
 *   JWT_SECRET=secret node server.js     # Custom JWT secret
 */

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 8098;
const JWT_SECRET = process.env.JWT_SECRET || 'windy-pro-account-dev-secret-2024';
const JWT_EXPIRY = '24h';
const REFRESH_EXPIRY = '30d';
const MAX_DEVICES = 5;
const BCRYPT_ROUNDS = 10;
const DB_PATH = path.join(__dirname, 'accounts.db');

// ─── Database Setup ───

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Migrations: add columns if they don't exist
`);

try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (e) { /* column exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT"); } catch (e) { /* column exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown',
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS translations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.85,
    type TEXT NOT NULL DEFAULT 'text',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    translation_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE,
    UNIQUE(user_id, translation_id)
  );
`);

// ─── Prepared Statements ───

const stmts = {
    findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findUserById: db.prepare('SELECT id, email, name, tier, created_at, updated_at FROM users WHERE id = ?'),
    createUser: db.prepare('INSERT INTO users (id, email, name, password_hash, tier) VALUES (?, ?, ?, ?, ?)'),
    updateUserSeen: db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?"),

    getDevices: db.prepare('SELECT id, name, platform, registered_at, last_seen FROM devices WHERE user_id = ?'),
    findDevice: db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?'),
    countDevices: db.prepare('SELECT COUNT(*) as count FROM devices WHERE user_id = ?'),
    addDevice: db.prepare("INSERT OR REPLACE INTO devices (id, user_id, name, platform, last_seen) VALUES (?, ?, ?, ?, datetime('now'))"),
    removeDevice: db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?'),
    touchDevice: db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ? AND user_id = ?"),

    saveRefreshToken: db.prepare('INSERT INTO refresh_tokens (token, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)'),
    findRefreshToken: db.prepare('SELECT * FROM refresh_tokens WHERE token = ?'),
    deleteRefreshToken: db.prepare('DELETE FROM refresh_tokens WHERE token = ?'),
    deleteUserRefreshTokens: db.prepare('DELETE FROM refresh_tokens WHERE user_id = ? AND device_id = ?'),
    cleanExpiredTokens: db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')"),

    // Translation statements
    insertTranslation: db.prepare('INSERT INTO translations (id, user_id, source_lang, target_lang, source_text, translated_text, confidence, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getTranslationHistory: db.prepare('SELECT t.*, CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite FROM translations t LEFT JOIN favorites f ON t.id = f.translation_id AND f.user_id = t.user_id WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?'),
    countTranslations: db.prepare('SELECT COUNT(*) as count FROM translations WHERE user_id = ?'),
    insertFavorite: db.prepare('INSERT OR IGNORE INTO favorites (id, user_id, translation_id) VALUES (?, ?, ?)'),
    removeFavorite: db.prepare('DELETE FROM favorites WHERE user_id = ? AND translation_id = ?'),
    findTranslation: db.prepare('SELECT * FROM translations WHERE id = ? AND user_id = ?'),
};

// ─── Middleware ───

app.use(cors());
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));
app.use(express.json());

// ─── Auth Middleware ───

/**
 * Authenticate a request using JWT Bearer token.
 * Extracts token from Authorization header, verifies signature,
 * and attaches user info to req.user.
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next
 * @returns {void} Sets req.user = { userId, email, role, tier }
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
}

/**
 * Optional auth middleware — sets req.user if valid token present, otherwise continues.
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        try {
            req.user = jwt.verify(token, JWT_SECRET);
        } catch (_) { /* ignore invalid tokens */ }
    }
    next();
}

// ─── Token Helpers ───

function generateTokens(user, deviceId) {
    const accessToken = jwt.sign(
        { userId: user.id, email: user.email, tier: user.tier, accountId: user.id },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );

    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Clean old refresh tokens for this device
    stmts.deleteUserRefreshTokens.run(user.id, deviceId || '');
    stmts.saveRefreshToken.run(refreshToken, user.id, deviceId || '', expiresAt);

    return { token: accessToken, refreshToken };
}

function getDeviceList(userId) {
    return stmts.getDevices.all(userId);
}

// ─── Routes ───

/**
 * @route GET /health
 * @description System health check. Returns server status, user/device counts.
 * @access Public
 * @returns {{ status: string, service: string, version: string, users: number, devices: number }}
 */
app.get('/health', (req, res) => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const deviceCount = db.prepare('SELECT COUNT(*) as count FROM devices').get().count;

    res.json({
        status: 'ok',
        service: 'windy-pro-account-server',
        version: '2.0.0',
        users: userCount,
        devices: deviceCount,
        maxDevicesPerAccount: MAX_DEVICES,
        timestamp: new Date().toISOString()
    });
});

/**
 * @route POST /api/v1/auth/register
 * @description Create a new user account. Returns JWT token on success.
 * @access Public
 * @param {string} req.body.name - Display name
 * @param {string} req.body.email - Email address (unique)
 * @param {string} req.body.password - Password (min 8 chars, hashed with bcrypt)
 * @param {string} [req.body.deviceId] - Optional device ID to auto-register
 * @param {string} [req.body.deviceName] - Optional device name
 * @param {string} [req.body.platform] - Optional platform (desktop/ios/android)
 * @returns {{ token: string, user: object }} JWT token and user profile
 */
app.post('/api/v1/auth/register', async (req, res) => {
    try {
        const { name, email, password, deviceId, deviceName, platform } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        if (!email.includes('@')) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        // Check existing
        const existing = stmts.findUserByEmail.get(email.toLowerCase());
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        // Create user
        const userId = uuidv4();
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        stmts.createUser.run(userId, email.toLowerCase(), name, passwordHash, 'free');

        // Register device if provided
        if (deviceId) {
            stmts.addDevice.run(deviceId, userId, deviceName || 'Unknown Device', platform || 'unknown');
        }

        // Generate tokens
        const user = { id: userId, email: email.toLowerCase(), tier: 'free' };
        const tokens = generateTokens(user, deviceId);
        const devices = getDeviceList(userId);

        console.log(`✅ Registered: ${email} (${userId.slice(0, 8)}...)`);

        res.status(201).json({
            userId,
            name,
            email: email.toLowerCase(),
            tier: 'free',
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            devices
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed: ' + err.message });
    }
});

// ─── POST /v1/auth/login ───

/**
 * @route POST /api/v1/auth/login
 * @description Authenticate user and return JWT token.
 * @access Public
 * @param {string} req.body.email - Email address
 * @param {string} req.body.password - Password
 * @returns {{ token: string, user: object }} JWT token and user profile
 */
app.post('/api/v1/auth/login', async (req, res) => {
    try {
        const { email, password, deviceId, deviceName, platform } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = stmts.findUserByEmail.get(email.toLowerCase());
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Auto-register device if provided and not at limit
        if (deviceId) {
            const existingDevice = stmts.findDevice.get(deviceId, user.id);
            if (existingDevice) {
                stmts.touchDevice.run(deviceId, user.id);
            } else {
                const deviceCount = stmts.countDevices.get(user.id).count;
                if (deviceCount < MAX_DEVICES) {
                    stmts.addDevice.run(deviceId, user.id, deviceName || 'Unknown Device', platform || 'unknown');
                }
                // If at limit, don't fail login — just don't register new device
            }
        }

        stmts.updateUserSeen.run(user.id);

        const tokens = generateTokens(user, deviceId);
        const devices = getDeviceList(user.id);

        console.log(`🔓 Login: ${email} (${user.id.slice(0, 8)}...)`);

        res.json({
            userId: user.id,
            name: user.name,
            email: user.email,
            tier: user.tier,
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            devices
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed: ' + err.message });
    }
});

// ─── GET /v1/auth/me ───

app.get('/api/v1/auth/me', authenticateToken, (req, res) => {
    const user = stmts.findUserById.get(req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const devices = getDeviceList(user.id);

    res.json({
        userId: user.id,
        name: user.name,
        email: user.email,
        tier: user.tier,
        createdAt: user.created_at,
        devices,
        deviceLimit: MAX_DEVICES
    });
});

// ─── GET /v1/auth/devices ───

app.get('/api/v1/auth/devices', authenticateToken, (req, res) => {
    const devices = getDeviceList(req.user.userId);
    res.json({
        devices,
        count: devices.length,
        limit: MAX_DEVICES,
        remaining: MAX_DEVICES - devices.length
    });
});

// ─── POST /v1/auth/devices/register ───

app.post('/api/v1/auth/devices/register', authenticateToken, (req, res) => {
    const { deviceId, deviceName, platform } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
    }

    // Check if already registered
    const existing = stmts.findDevice.get(deviceId, req.user.userId);
    if (existing) {
        stmts.touchDevice.run(deviceId, req.user.userId);
        const devices = getDeviceList(req.user.userId);
        return res.json({ message: 'Device already registered', devices });
    }

    // Check limit
    const count = stmts.countDevices.get(req.user.userId).count;
    if (count >= MAX_DEVICES) {
        const devices = getDeviceList(req.user.userId);
        return res.status(403).json({
            error: 'Device limit reached',
            message: `You've reached the ${MAX_DEVICES}-device limit. Remove a device to add this one.`,
            devices,
            count,
            limit: MAX_DEVICES
        });
    }

    stmts.addDevice.run(deviceId, req.user.userId, deviceName || 'Unknown Device', platform || 'unknown');
    const devices = getDeviceList(req.user.userId);

    console.log(`📱 Device registered: ${deviceName || deviceId.slice(0, 8)} for user ${req.user.userId.slice(0, 8)}`);

    res.status(201).json({
        message: 'Device registered',
        devices,
        count: devices.length,
        limit: MAX_DEVICES
    });
});

// ─── POST /v1/auth/devices/remove ───

app.post('/api/v1/auth/devices/remove', authenticateToken, (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
    }

    const existing = stmts.findDevice.get(deviceId, req.user.userId);
    if (!existing) {
        return res.status(404).json({ error: 'Device not found on this account' });
    }

    stmts.removeDevice.run(deviceId, req.user.userId);
    const devices = getDeviceList(req.user.userId);

    console.log(`🗑️  Device removed: ${deviceId.slice(0, 8)} from user ${req.user.userId.slice(0, 8)}`);

    res.json({
        message: 'Device removed',
        devices,
        count: devices.length,
        limit: MAX_DEVICES,
        remaining: MAX_DEVICES - devices.length
    });
});

// ─── POST /v1/auth/refresh ───

app.post('/api/v1/auth/refresh', (req, res) => {
    const { refreshToken, deviceId } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
    }

    // Clean expired tokens periodically
    stmts.cleanExpiredTokens.run();

    const stored = stmts.findRefreshToken.get(refreshToken);
    if (!stored) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Check expiry
    if (new Date(stored.expires_at) < new Date()) {
        stmts.deleteRefreshToken.run(refreshToken);
        return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = stmts.findUserById.get(stored.user_id);
    if (!user) {
        stmts.deleteRefreshToken.run(refreshToken);
        return res.status(401).json({ error: 'User not found' });
    }

    // Delete old refresh token
    stmts.deleteRefreshToken.run(refreshToken);

    // Generate new tokens
    const tokens = generateTokens(user, deviceId || stored.device_id);

    // Touch device if present
    if (deviceId) {
        stmts.touchDevice.run(deviceId, user.id);
    }

    console.log(`🔄 Token refresh: ${user.email}`);

    res.json({
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        tier: user.tier,
        userId: user.id,
        name: user.name
    });
});

// ─── Translation API Routes ───

const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'ar', name: 'Arabic' },
    { code: 'ru', name: 'Russian' },
    { code: 'pl', name: 'Polish' }
];

// POST /api/v1/translate/speech — Accept audio blob + source/target lang, return translation
app.post('/api/v1/translate/speech', authenticateToken, upload.single('audio'), (req, res) => {
    try {
        const { sourceLang, targetLang } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'Audio file is required' });
        }
        if (!sourceLang || !targetLang) {
            return res.status(400).json({ error: 'sourceLang and targetLang are required' });
        }

        // Stub translation — in production this would call a real translation engine
        const detectedText = `[Detected speech in ${sourceLang}]`;
        const translatedText = `[Translation to ${targetLang}]`;
        const confidence = 0.82 + Math.random() * 0.15;
        const translationId = uuidv4();

        stmts.insertTranslation.run(
            translationId, req.user.userId,
            sourceLang, targetLang,
            detectedText, translatedText,
            Math.round(confidence * 100) / 100, 'speech'
        );

        console.log(`🗣️  Speech translation: ${sourceLang}→${targetLang} for user ${req.user.userId.slice(0, 8)}`);

        res.json({
            id: translationId,
            sourceText: detectedText,
            translatedText,
            sourceLang,
            targetLang,
            confidence: Math.round(confidence * 100) / 100,
            type: 'speech',
            audioData: null // Base64 audio would go here from a real TTS engine
        });
    } catch (err) {
        console.error('Speech translation error:', err);
        res.status(500).json({ error: 'Speech translation failed: ' + err.message });
    }
});

// POST /api/v1/translate/text — Accept JSON {text, sourceLang, targetLang}
/**
 * @route POST /api/v1/translate/text
 * @description Translate text between languages using AI backend (Groq/OpenAI).
 * Falls back to stub if no API key configured.
 * @access Authenticated
 * @param {string} req.body.text - Text to translate (max 5000 chars)
 * @param {string} req.body.source - Source language code (ISO 639-1)
 * @param {string} req.body.target - Target language code
 * @returns {{ translation: string, source: string, target: string }}
 */
app.post('/api/v1/translate/text', authenticateToken, async (req, res) => {
    try {
        const { text, sourceLang, targetLang } = req.body;

        if (!text || !sourceLang || !targetLang) {
            return res.status(400).json({ error: 'text, sourceLang, and targetLang are required' });
        }

        let translatedText;
        let engine = 'stub';
        const langName = (code) => (SUPPORTED_LANGUAGES.find(l => l.code === code) || { name: code }).name;

        // Try real translation via Groq or OpenAI
        const groqKey = process.env.GROQ_API_KEY;
        const openaiKey = process.env.OPENAI_API_KEY;

        if (groqKey || openaiKey) {
            try {
                const isGroq = !!groqKey;
                const apiUrl = isGroq
                    ? 'https://api.groq.com/openai/v1/chat/completions'
                    : 'https://api.openai.com/v1/chat/completions';
                const apiKey = groqKey || openaiKey;
                const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

                const prompt = `Translate the following text from ${langName(sourceLang)} to ${langName(targetLang)}. Return ONLY the translated text, nothing else.\n\n${text}`;

                const apiRes = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: 2048
                    })
                });

                if (apiRes.ok) {
                    const data = await apiRes.json();
                    translatedText = data.choices?.[0]?.message?.content?.trim();
                    engine = isGroq ? 'groq' : 'openai';
                    console.log(`📝 AI Translation (${engine}): ${sourceLang}→${targetLang}`);
                } else {
                    console.warn(`⚠️  AI translation API returned ${apiRes.status}, falling back to stub`);
                }
            } catch (aiErr) {
                console.warn('⚠️  AI translation failed, falling back to stub:', aiErr.message);
            }
        }

        // Fallback to stub if no AI translation available
        if (!translatedText) {
            translatedText = `[${targetLang}] ${text}`;
        }

        const confidence = engine !== 'stub' ? 0.92 + Math.random() * 0.06 : 0.88 + Math.random() * 0.10;
        const translationId = uuidv4();

        stmts.insertTranslation.run(
            translationId, req.user.userId,
            sourceLang, targetLang,
            text, translatedText,
            Math.round(confidence * 100) / 100, 'text'
        );

        console.log(`📝 Text translation: ${sourceLang}→${targetLang} for user ${req.user.userId.slice(0, 8)} (engine: ${engine})`);

        res.json({
            id: translationId,
            sourceText: text,
            translatedText,
            sourceLang,
            targetLang,
            confidence: Math.round(confidence * 100) / 100,
            type: 'text',
            engine
        });
    } catch (err) {
        console.error('Text translation error:', err);
        res.status(500).json({ error: 'Text translation failed: ' + err.message });
    }
});

// GET /api/v1/translate/languages — Return supported languages
app.get('/api/v1/translate/languages', authenticateToken, (req, res) => {
    res.json({ languages: SUPPORTED_LANGUAGES });
});

// GET /api/v1/user/history — Paginated translation history
app.get('/api/v1/user/history', authenticateToken, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;

        const history = stmts.getTranslationHistory.all(req.user.userId, limit, offset);
        const total = stmts.countTranslations.get(req.user.userId).count;

        res.json({
            history,
            pagination: { limit, offset, total, hasMore: offset + limit < total }
        });
    } catch (err) {
        console.error('History error:', err);
        res.status(500).json({ error: 'Failed to fetch history: ' + err.message });
    }
});

// POST /api/v1/user/favorites — Toggle favorite on a translation
app.post('/api/v1/user/favorites', authenticateToken, (req, res) => {
    try {
        const { translationId } = req.body;

        if (!translationId) {
            return res.status(400).json({ error: 'translationId is required' });
        }

        const translation = stmts.findTranslation.get(translationId, req.user.userId);
        if (!translation) {
            return res.status(404).json({ error: 'Translation not found' });
        }

        const favoriteId = uuidv4();
        const result = stmts.insertFavorite.run(favoriteId, req.user.userId, translationId);

        if (result.changes === 0) {
            // Already favorited — remove it (toggle behavior)
            stmts.removeFavorite.run(req.user.userId, translationId);
            console.log(`💔 Unfavorited: ${translationId.slice(0, 8)} by ${req.user.userId.slice(0, 8)}`);
            return res.json({ favorited: false, translationId });
        }

        console.log(`⭐ Favorited: ${translationId.slice(0, 8)} by ${req.user.userId.slice(0, 8)}`);
        res.json({ favorited: true, translationId, favoriteId });
    } catch (err) {
        console.error('Favorite error:', err);
        res.status(500).json({ error: 'Failed to save favorite: ' + err.message });
    }
});

// ═══════════════════════════════════════════
//  TRANSCRIPTION ENDPOINTS
// ═══════════════════════════════════════════

// POST /api/v1/transcribe — Single audio file transcription (stub)
app.post('/api/v1/transcribe', optionalAuth, upload.single('audio'), (req, res) => {
    try {
        const language = req.body.language || 'en';
        const engine = req.body.engine || 'cloud-standard';
        const duration = 0; // In production, detect from audio file

        const segments = [{
            id: uuidv4(),
            text: '[Transcription stub — connect a real STT engine]',
            startTime: 0,
            endTime: duration || 5.0,
            confidence: 0.95,
            language,
            partial: false
        }];

        console.log(`🎤 Transcribe: language=${language} engine=${engine}`);

        res.json({
            segments,
            fullText: segments.map(s => s.text).join(' '),
            language,
            duration: duration || 5.0
        });
    } catch (err) {
        console.error('Transcribe error:', err);
        res.status(500).json({ error: 'Transcription failed: ' + err.message });
    }
});

// POST /api/v1/transcribe/batch — Batch audio transcription (stub)
app.post('/api/v1/transcribe/batch', optionalAuth, upload.array('audio', 20), (req, res) => {
    try {
        const language = req.body.language || 'en';
        const engine = req.body.engine || 'cloud-standard';
        const files = req.files || [];
        const count = files.length || parseInt(req.body.count) || 1;

        const results = Array.from({ length: count }, (_, i) => ({
            index: i,
            segments: [{
                id: uuidv4(),
                text: `[Batch transcription stub — item ${i + 1}]`,
                startTime: 0,
                endTime: 5.0,
                confidence: 0.95,
                language,
                partial: false
            }],
            fullText: `[Batch transcription stub — item ${i + 1}]`,
            language,
            duration: 5.0
        }));

        console.log(`🎤 Batch transcribe: ${count} items, language=${language}`);

        res.json({ results });
    } catch (err) {
        console.error('Batch transcribe error:', err);
        res.status(500).json({ error: 'Batch transcription failed: ' + err.message });
    }
});

// ═══════════════════════════════════════════
//  OCR / IMAGE TRANSLATION
// ═══════════════════════════════════════════

// POST /api/v1/ocr/translate — OCR + translate an image (stub)
app.post('/api/v1/ocr/translate', optionalAuth, upload.single('image'), (req, res) => {
    try {
        const targetLanguage = req.body.targetLanguage || 'en';

        console.log(`📷 OCR translate: target=${targetLanguage}`);

        res.json({
            originalText: '[OCR stub — connect a real OCR engine]',
            translatedText: `[${targetLanguage}] [OCR stub — connect a real OCR engine]`,
            language: targetLanguage,
            confidence: 0.85
        });
    } catch (err) {
        console.error('OCR translate error:', err);
        res.status(500).json({ error: 'OCR translation failed: ' + err.message });
    }
});

// ═══════════════════════════════════════════
//  RECORDINGS — ADDITIONAL CRUD
// ═══════════════════════════════════════════

// GET /api/v1/recordings — Alias for /api/v1/recordings/list
app.get('/api/v1/recordings', authenticateToken, (req, res) => {
    try {
        const since = req.query.since || '1970-01-01T00:00:00Z';
        const recordings = db.prepare(
            `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
                    camera_source, transcript_text, transcript_segments, file_size,
                    device_platform, device_id, device_name, clone_training_ready,
                    sync_status, created_at
             FROM recordings
             WHERE user_id = ? AND created_at > ?
             ORDER BY created_at DESC
             LIMIT 100`
        ).all(req.user.userId, since);

        const mapped = recordings.map(r => ({
            ...r,
            transcript: r.transcript_text,
            segments_json: r.transcript_segments,
            duration: r.duration_seconds
        }));

        res.json({ bundles: mapped, total: mapped.length, since });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/v1/recordings/:id — Single recording metadata (no video)

// ─── /recordings/stats — MUST be before /:id to avoid route shadowing ───
app.get('/api/v1/recordings/stats', authenticateToken, (req, res) => {
    try {
        const userId = req.user.userId;
        const row = db.prepare(`
            SELECT
                COUNT(*) as totalRecordings,
                COALESCE(SUM(word_count), 0) as totalWords,
                ROUND(COALESCE(SUM(duration_seconds), 0) / 3600.0, 2) as totalHours,
                COALESCE(SUM(CASE WHEN has_audio = 1 THEN 1 ELSE 0 END), 0) as audioCount,
                COALESCE(SUM(CASE WHEN has_video = 1 THEN 1 ELSE 0 END), 0) as videoCount
            FROM recordings WHERE user_id = ?
        `).get(userId);
        res.json({ stats: {
            totalRecordings: row.totalRecordings,
            totalWords: row.totalWords,
            totalHours: row.totalHours,
            audioCount: row.audioCount,
            videoCount: row.videoCount
        }});
    } catch (err) {
        console.error('[GET /recordings/stats]', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/v1/recordings/:id', authenticateToken, (req, res) => {
    try {
        const recording = db.prepare(
            `SELECT id, bundle_id, created_at, duration_seconds, transcript_text,
                    source, device_platform, app_version, has_video
             FROM recordings WHERE id = ? AND user_id = ?`
        ).get(req.params.id, req.user.userId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        res.json(recording);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/v1/recordings/:id — Delete recording by id
app.delete('/api/v1/recordings/:id', authenticateToken, (req, res) => {
    try {
        const recording = db.prepare(
            'SELECT id, file_path FROM recordings WHERE id = ? AND user_id = ?'
        ).get(req.params.id, req.user.userId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        // Delete file if it exists
        if (recording.file_path && fs.existsSync(recording.file_path)) {
            try { fs.unlinkSync(recording.file_path); } catch (_) { /* best effort */ }
        }

        db.prepare('DELETE FROM recordings WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.user.userId);

        console.log(`🗑️  Recording deleted: ${req.params.id.slice(0, 8)}`);
        res.json({ deleted: true, id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// In-memory chunk store for chunked uploads
const chunkStore = new Map(); // bundle_id -> { chunks: Map<index, data>, total, file_type }

// POST /api/v1/recordings/upload/chunk — Upload a single chunk
app.post('/api/v1/recordings/upload/chunk', authenticateToken, (req, res) => {
    try {
        const { bundle_id, chunk_index, total_chunks, data, file_type } = req.body;

        if (!bundle_id || chunk_index === undefined || !total_chunks) {
            return res.status(400).json({ error: 'bundle_id, chunk_index, and total_chunks are required' });
        }

        if (!chunkStore.has(bundle_id)) {
            chunkStore.set(bundle_id, { chunks: new Map(), total: total_chunks, file_type: file_type || 'audio/webm' });
        }

        const entry = chunkStore.get(bundle_id);
        entry.chunks.set(chunk_index, data || '');

        console.log(`📦 Chunk ${chunk_index + 1}/${total_chunks} for bundle ${bundle_id.slice(0, 8)}`);

        // Auto-cleanup completed bundles after 5 minutes
        if (entry.chunks.size >= entry.total) {
            setTimeout(() => chunkStore.delete(bundle_id), 5 * 60 * 1000);
        }

        res.json({ received: true, chunk_index, bundle_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/v1/recordings/upload/batch — Batch upload recording metadata
app.post('/api/v1/recordings/upload/batch', authenticateToken, (req, res) => {
    try {
        const recordings = req.body;
        if (!Array.isArray(recordings)) {
            return res.status(400).json({ error: 'Request body must be a JSON array of recording objects' });
        }

        let uploaded = 0;
        const errors = [];

        for (const r of recordings) {
            try {
                const id = uuidv4();
                const bundleId = r.bundle_id || r.id || uuidv4();
                const transcriptText = r.transcript_text || r.transcript || '';
                const transcriptSegments = r.transcript_segments || r.segments_json || '[]';

                db.prepare(`INSERT INTO recordings
                    (id, user_id, bundle_id, created_at, duration_seconds,
                     transcript_text, transcript_segments, source, device_platform,
                     app_version, has_video, file_size, sync_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`
                ).run(
                    id, req.user.userId, bundleId,
                    r.created_at || new Date().toISOString(),
                    r.duration_seconds || r.duration || 0,
                    transcriptText, transcriptSegments,
                    r.source || 'record',
                    r.device_platform || 'unknown',
                    r.app_version || '2.0.0',
                    r.has_video ? 1 : 0,
                    r.file_size || 0
                );
                uploaded++;
            } catch (itemErr) {
                errors.push(`${r.bundle_id || 'unknown'}: ${itemErr.message}`);
            }
        }

        console.log(`📦 Batch upload: ${uploaded} recordings, ${errors.length} errors`);
        res.json({ uploaded, errors });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
//  AUTH — LOGOUT
// ═══════════════════════════════════════════

// POST /api/v1/auth/logout — Invalidate all refresh tokens for user
app.post('/api/v1/auth/logout', authenticateToken, (req, res) => {
    try {
        db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.userId);
        console.log(`🔒 Logout: user ${req.user.userId.slice(0, 8)}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
//  ANALYTICS (no auth)
// ═══════════════════════════════════════════

// POST /api/v1/analytics — Log analytics event
app.post('/api/v1/analytics', (req, res) => {
    const { event, properties } = req.body || {};
    console.log(`📊 Analytics: ${event || 'unknown'}`, properties ? JSON.stringify(properties).slice(0, 200) : '');
    res.json({ received: true });
});

// ═══════════════════════════════════════════
//  UPDATE CHECK (no auth)
// ═══════════════════════════════════════════

// GET /api/v1/updates/check — Check for app updates
app.get('/api/v1/updates/check', (req, res) => {
    res.json({
        version: '0.6.0',
        url: 'https://windypro.thewindstorm.uk/download/latest/linux',
        releaseNotes: 'Bug fixes and performance improvements',
        required: false
    });
});

// ─── Billing Endpoints ───

app.get('/api/v1/auth/billing', authenticateToken, (req, res) => {
    try {
        const user = db.prepare('SELECT email, tier, created_at, stripe_customer_id FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            email: user.email,
            tier: user.tier || 'free',
            createdAt: user.created_at,
            stripeCustomerId: user.stripe_customer_id || null,
            payments: [] // Stub — would come from Stripe API
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/auth/create-portal-session', authenticateToken, (req, res) => {
    // Stub — would create a Stripe Customer Portal session
    res.json({ url: null, message: 'Stripe portal not configured. Set STRIPE_SECRET_KEY in environment.' });
});

app.post('/api/v1/auth/change-password', authenticateToken, (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const bcrypt = require('bcryptjs');
        if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const newHash = bcrypt.hashSync(newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.userId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/v1/license/activate — Activate a license key for the authenticated user
app.post('/api/v1/license/activate', authenticateToken, (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'License key is required' });

        // Validate key format: WP-XXXX-XXXX-XXXX
        if (!/^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
            return res.status(400).json({ error: 'Invalid license key format. Expected: WP-XXXX-XXXX-XXXX' });
        }

        // Determine tier from key prefix
        let tier = 'pro';
        if (key.startsWith('WP-T')) tier = 'translate';
        else if (key.startsWith('WP-U')) tier = 'translate_pro';

        // Ensure columns exist (migration-safe)
        try { db.prepare('ALTER TABLE users ADD COLUMN license_key TEXT').run(); } catch (_) { /* already exists */ }
        try { db.prepare('ALTER TABLE users ADD COLUMN license_tier TEXT DEFAULT \'free\'').run(); } catch (_) { /* already exists */ }

        // Store license on user record
        db.prepare('UPDATE users SET license_key = ?, license_tier = ? WHERE id = ?')
            .run(key, tier, req.user.userId);

        console.log(`🔑 License activated: ${tier} for user ${req.user.userId.slice(0, 8)} (key: ${key.slice(0, 7)}...)`);

        res.json({
            success: true,
            tier,
            key: key.slice(0, 7) + '...',
            activatedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error('License activation error:', err);
        res.status(500).json({ error: 'License activation failed: ' + err.message });
    }
});

// ─── Admin Endpoints ───

function adminOnly(req, res, next) {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

app.get('/api/v1/admin/users', authenticateToken, adminOnly, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let users, total;
        if (search) {
            const like = `%${search}%`;
            users = db.prepare('SELECT id, name, email, tier, role, created_at FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(like, like, limit, offset);
            total = db.prepare('SELECT COUNT(*) as count FROM users WHERE name LIKE ? OR email LIKE ?').get(like, like).count;
        } else {
            users = db.prepare('SELECT id, name, email, tier, role, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
            total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        }

        // Add recording counts
        const stmtCount = db.prepare('SELECT COUNT(*) as count FROM recordings WHERE user_id = ?');
        users = users.map(u => ({ ...u, recording_count: stmtCount.get(u.id)?.count || 0 }));

        res.json({ users, total, page, limit });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/v1/admin/stats', authenticateToken, adminOnly, (req, res) => {
    try {
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const totalRecordings = db.prepare('SELECT COUNT(*) as count FROM recordings').get().count;
        let totalTranslations = 0;
        try {
            totalTranslations = db.prepare('SELECT COUNT(*) as count FROM translations').get().count;
        } catch { /* table may not exist */ }

        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        res.json({
            totalUsers,
            totalRecordings,
            totalTranslations,
            serverStatus: 'OK',
            uptime: `${hours}h ${minutes}m`,
            dbSize: '~' + Math.round(require('fs').statSync(DB_PATH).size / 1024) + ' KB',
            memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
            apiLatency: '<5ms',
            dailyTranslations: [12, 8, 15, 22, 18, 25, 31] // Stub
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/v1/admin/revenue', authenticateToken, adminOnly, (req, res) => {
    try {
        const planCounts = {};
        for (const tier of ['free', 'pro', 'translate', 'translate_pro']) {
            planCounts[tier] = db.prepare('SELECT COUNT(*) as count FROM users WHERE tier = ?').get(tier)?.count || 0;
        }
        // Free users have no tier set
        planCounts.free += db.prepare("SELECT COUNT(*) as count FROM users WHERE tier IS NULL OR tier = ''").get().count;

        res.json({
            total: (planCounts.pro * 4900) + (planCounts.translate * 7900) + (planCounts.translate_pro * 14900),
            mrr: planCounts.translate * 799, // Monthly translate plans
            planCounts
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
//  VIDEO RECORDING & CLONE TRAINING
// ═══════════════════════════════════════════

// Large file upload for video bundles (500MB limit)
const videoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'uploads', 'bundles');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || '.webm';
            cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
        }
    }),
    limits: { fileSize: 500 * 1024 * 1024 }
});

// Create recordings table — canonical cross-platform schema
db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bundle_id TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        duration_seconds REAL NOT NULL DEFAULT 0,
        transcript_text TEXT NOT NULL DEFAULT '',
        transcript_segments TEXT NOT NULL DEFAULT '[]',
        audio_path TEXT,
        video_path TEXT,
        quality_score INTEGER NOT NULL DEFAULT 0,
        quality_json TEXT NOT NULL DEFAULT '{}',
        engine_used TEXT NOT NULL DEFAULT 'cloud-standard',
        source TEXT NOT NULL DEFAULT 'record',
        languages_json TEXT NOT NULL DEFAULT '["en"]',
        media_audio INTEGER NOT NULL DEFAULT 1,
        media_video INTEGER NOT NULL DEFAULT 0,
        file_path TEXT,
        file_size INTEGER NOT NULL DEFAULT 0,
        synced INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT,
        clone_usable INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        latitude REAL,
        longitude REAL,
        device_model TEXT,
        device_platform TEXT DEFAULT 'desktop',
        device_id TEXT,
        device_name TEXT,
        app_version TEXT,
        has_video INTEGER DEFAULT 0,
        video_resolution TEXT,
        camera_source TEXT,
        sync_status TEXT DEFAULT 'pending',
        clone_training_ready INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_recordings_user ON recordings(user_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_training ON recordings(clone_training_ready);
    CREATE INDEX IF NOT EXISTS idx_recordings_synced ON recordings(synced);
    CREATE INDEX IF NOT EXISTS idx_recordings_bundle ON recordings(bundle_id);
`);

// Create sync_queue table — canonical cross-platform schema
db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
        session_id TEXT PRIMARY KEY,
        queued_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT
    );
`);

// ─── CROSS-PLATFORM FIELD MAPPING ───
// Mobile (Android/iOS) uses: transcript, segments_json, table "sessions"
// Server (Desktop) uses: transcript_text, transcript_segments, table "recordings"
// All handlers must accept both naming conventions and map accordingly.
// Mobile → Server: transcript → transcript_text, segments_json → transcript_segments, id → bundle_id
// Server → Mobile: transcript_text → transcript, transcript_segments → segments_json

// ─── POST /api/v1/recordings/upload — Upload recording bundle ───
/**
 * @route POST /api/v1/recordings/upload
 * @description Upload a recording bundle (video/audio + metadata). Max 500MB.
 * @access Authenticated
 * @param {File} req.file - Media file (WebM, MP4)
 * @param {string} req.body.bundle_id - Client-generated UUID
 * @param {number} req.body.duration_seconds - Recording duration
 * @param {boolean} req.body.has_video - Whether bundle includes video
 * @param {string} req.body.transcript_text - Full transcript
 * @param {boolean} req.body.clone_training_ready - Marked for training
 * @returns {{ id: string, bundle_id: string, file_size: number }}
 */
app.post('/api/v1/recordings/upload', authenticateToken, videoUpload.single('media'), (req, res) => {
    try {
        const { duration_seconds, has_video, video_resolution, camera_source,
            device_platform, app_version, clone_training_ready } = req.body;

        // Cross-platform field mapping: accept both mobile and desktop field names
        const bundleId = req.body.bundle_id || req.body.id || crypto.randomUUID();
        const transcriptText = req.body.transcript_text || req.body.transcript || null;
        const transcriptSegments = req.body.transcript_segments || req.body.segments_json || null;

        const id = crypto.randomUUID();
        const filePath = req.file ? req.file.path : null;
        const fileSize = req.file ? req.file.size : 0;

        db.prepare(`INSERT INTO recordings
            (id, user_id, bundle_id, duration_seconds, has_video, video_resolution, camera_source,
             transcript_text, transcript_segments, file_path, file_size, device_platform, app_version,
             sync_status, clone_training_ready)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)`).run(
            id, req.user.userId, bundleId, parseInt(duration_seconds) || 0,
            has_video === 'true' || has_video === true ? 1 : 0,
            video_resolution || null, camera_source || null,
            transcriptText, transcriptSegments,
            filePath, fileSize, device_platform || 'desktop', app_version || '2.0',
            clone_training_ready === 'true' || clone_training_ready === true ? 1 : 0
        );

        res.status(201).json({ id, bundle_id: bundleId, file_size: fileSize });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/v1/recordings/:id/video — Stream video with range request support ───
app.get('/api/v1/recordings/:id/video', authenticateToken, (req, res) => {
    try {
        const recording = db.prepare('SELECT file_path, file_size FROM recordings WHERE id = ? AND user_id = ?')
            .get(req.params.id, req.user.userId);

        if (!recording || !recording.file_path || !fs.existsSync(recording.file_path)) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const stat = fs.statSync(recording.file_path);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/webm',
            });
            fs.createReadStream(recording.file_path, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/webm',
            });
            fs.createReadStream(recording.file_path).pipe(res);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── WebRTC Signaling (in-memory store) ───
const rtcSessions = new Map(); // token -> { offer, answer, candidates }

/**
 * @route POST /api/v1/rtc/signal
 * @description WebRTC signaling relay. Stores offer/answer/ICE candidates.
 * @access Public (token-based session isolation)
 * @param {string} req.body.type - Signal type: offer|answer|ice-candidate|switch-camera
 * @param {string} req.body.token - Session token
 * @param {string} [req.body.sdp] - SDP for offer/answer
 * @param {object} [req.body.candidate] - ICE candidate
 * @returns {{ success: boolean }}
 */
app.post('/api/v1/rtc/signal', (req, res) => {
    const { type, token, sdp, candidate } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    if (!rtcSessions.has(token)) {
        rtcSessions.set(token, { offer: null, answer: null, candidates: [] });
    }
    const session = rtcSessions.get(token);

    if (type === 'offer') {
        session.offer = sdp;
        res.json({ success: true });
    } else if (type === 'answer') {
        session.answer = sdp;
        res.json({ success: true });
    } else if (type === 'ice-candidate') {
        session.candidates.push(candidate);
        res.json({ success: true });
    } else if (type === 'switch-camera') {
        session.switchCamera = true;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Unknown signal type' });
    }
});

app.get('/api/v1/rtc/signal', (req, res) => {
    const { token, type } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const session = rtcSessions.get(token);
    if (!session) return res.json({});

    if (type === 'offer') return res.json({ sdp: session.offer });
    if (type === 'answer') return res.json({ sdp: session.answer, candidates: session.candidates });
    return res.json(session);
});

// ─── GET /api/v1/clone/training-data — List training-ready bundles ───
app.get('/api/v1/clone/training-data', authenticateToken, (req, res) => {
    try {
        const bundles = db.prepare(
            `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
                    camera_source, transcript_text, file_size, device_platform,
                    clone_training_ready, created_at
             FROM recordings WHERE user_id = ? AND clone_training_ready = 1
             ORDER BY created_at DESC`
        ).all(req.user.userId);
        res.json({ bundles, total: bundles.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/v1/clone/start-training — Start clone training job ───
app.post('/api/v1/clone/start-training', authenticateToken, (req, res) => {
    try {
        const { bundle_ids } = req.body;
        if (!bundle_ids || !Array.isArray(bundle_ids) || bundle_ids.length < 3) {
            return res.status(400).json({ error: 'At least 3 training-ready bundles required' });
        }

        // Validate bundles belong to user and are training-ready
        const placeholders = bundle_ids.map(() => '?').join(',');
        const count = db.prepare(
            `SELECT COUNT(*) as count FROM recordings
             WHERE bundle_id IN (${placeholders}) AND user_id = ? AND clone_training_ready = 1`
        ).get(...bundle_ids, req.user.userId).count;

        if (count < bundle_ids.length) {
            return res.status(400).json({ error: 'Some bundles are not valid or training-ready' });
        }

        const jobId = crypto.randomUUID();
        // Stub: in production, this would queue a training job
        res.json({
            jobId,
            status: 'queued',
            bundle_count: bundle_ids.length,
            estimated_time: `${Math.ceil(bundle_ids.length * 15)} minutes`,
            message: 'Clone training job queued successfully'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Add missing columns (safe for existing tables) ───
const canonicalColumns = [
    'device_id TEXT', 'device_name TEXT', 'source TEXT DEFAULT \'record\'',
    'languages_json TEXT DEFAULT \'["en"]\'', 'media_audio INTEGER DEFAULT 1',
    'media_video INTEGER DEFAULT 0', 'quality_score INTEGER DEFAULT 0',
    'quality_json TEXT DEFAULT \'{}\'', 'engine_used TEXT DEFAULT \'cloud-standard\'',
    'synced INTEGER DEFAULT 0', 'synced_at TEXT', 'clone_usable INTEGER DEFAULT 0',
    'tags_json TEXT DEFAULT \'[]\'', 'latitude REAL', 'longitude REAL',
    'device_model TEXT', 'audio_path TEXT', 'video_path TEXT'
];
for (const col of canonicalColumns) {
    try { db.exec(`ALTER TABLE recordings ADD COLUMN ${col}`); } catch { /* column exists */ }
}

// ─── GET /api/v1/recordings/check — Check if bundle exists ───
/**
 * @route GET /api/v1/recordings/check
 * @description Check if a specific bundle exists on the cloud.
 * @access Authenticated
 * @param {string} req.query.bundle_id - Bundle ID to check
 * @returns {{ exists: boolean, bundle_id: string }}
 */
app.get('/api/v1/recordings/check', authenticateToken, (req, res) => {
    try {
        const { bundle_id } = req.query;
        if (!bundle_id) return res.status(400).json({ error: 'bundle_id parameter required' });
        const row = db.prepare('SELECT id FROM recordings WHERE bundle_id = ? AND user_id = ?').get(bundle_id, req.user.userId);
        res.json({ exists: !!row, bundle_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/v1/recordings/sync — Legacy sync endpoint ───
/**
 * @route POST /api/v1/recordings/sync
 * @description Legacy sync endpoint for bulk metadata sync.
 * @access Authenticated
 * @param {Array} req.body.bundles - Array of bundle metadata objects
 * @returns {{ synced: number, skipped: number, errors: string[] }}
 */
app.post('/api/v1/recordings/sync', authenticateToken, (req, res) => {
    try {
        const { bundles } = req.body;
        if (!bundles || !Array.isArray(bundles)) return res.status(400).json({ error: 'bundles array required' });
        let synced = 0, skipped = 0;
        const errors = [];
        for (const b of bundles) {
            try {
                // Cross-platform field mapping: accept both mobile and desktop field names
                const bundleId = b.bundle_id || b.id;
                const transcriptText = b.transcript?.text || b.transcript_text || b.transcript || '';
                const transcriptSegments = b.transcript?.segments
                    ? JSON.stringify(b.transcript.segments)
                    : (b.transcript_segments || b.segments_json || '[]');

                const exists = db.prepare('SELECT id FROM recordings WHERE bundle_id = ? AND user_id = ?').get(bundleId, req.user.userId);
                if (exists) { skipped++; continue; }
                db.prepare(`INSERT INTO recordings (id, user_id, bundle_id, created_at, duration_seconds,
                    transcript_text, transcript_segments, source, languages_json, media_audio, media_video,
                    file_size, synced, synced_at, clone_usable, clone_training_ready, tags_json,
                    device_platform, device_id, device_name, device_model, app_version,
                    has_video, video_resolution, camera_source, sync_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`
                ).run(
                    crypto.randomUUID(), req.user.userId, bundleId, b.created_at, b.duration_seconds || b.duration || 0,
                    transcriptText, transcriptSegments,
                    b.source || 'record', JSON.stringify(b.languages || b.languages_json || ['en']),
                    b.audio ? 1 : (b.media_audio || 0), b.video ? 1 : (b.media_video || 0),
                    (b.audio?.size_bytes || 0) + (b.video?.size_bytes || 0) + (b.file_size || 0),
                    new Date().toISOString(),
                    b.clone_training_ready || b.clone_usable ? 1 : 0,
                    b.clone_training_ready || b.clone_usable ? 1 : 0,
                    JSON.stringify(b.tags || b.tags_json || []),
                    b.device?.platform || b.device_platform || 'desktop',
                    b.device?.device_id || b.device_id || null,
                    b.device?.device_name || b.device_name || null,
                    b.device?.model || b.device_model || null,
                    b.device?.app_version || b.app_version || '2.0.0',
                    b.video ? 1 : (b.has_video || b.media_video || 0),
                    b.video?.resolution || b.video_resolution || null,
                    b.video?.camera || b.camera_source || null
                );
                synced++;
            } catch (err) {
                errors.push(`${b.bundle_id}: ${err.message}`);
            }
        }
        res.json({ synced, skipped, errors });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/v1/recordings/list — List bundles since timestamp ───
/**
 * @route GET /api/v1/recordings/list
 * @description List recordings since a given timestamp. Used by auto-sync.
 * @access Authenticated
 * @param {string} req.query.since - ISO 8601 timestamp (default: epoch)
 * @returns {{ bundles: object[], total: number, since: string }}
 */
app.get('/api/v1/recordings/list', authenticateToken, (req, res) => {
    try {
        const since = req.query.since || '1970-01-01T00:00:00Z';
        const recordings = db.prepare(
            `SELECT id, bundle_id, duration_seconds, has_video, video_resolution,
                    camera_source, transcript_text, transcript_segments, file_size,
                    device_platform, device_id, device_name, clone_training_ready,
                    sync_status, created_at
             FROM recordings
             WHERE user_id = ? AND created_at > ?
             ORDER BY created_at DESC
             LIMIT 100`
        ).all(req.user.userId, since);

        // Cross-platform field mapping: return both naming conventions
        // so mobile (transcript, segments_json) and desktop (transcript_text, transcript_segments) both work
        const mapped = recordings.map(r => ({
            ...r,
            transcript: r.transcript_text,
            segments_json: r.transcript_segments,
            duration: r.duration_seconds
        }));

        res.json({ bundles: mapped, total: mapped.length, since });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════
// CACHE-PROOF DOWNLOAD SYSTEM
// Fetches latest release from GitHub API, redirects to asset URL
// with cache-busting query param. Caches GitHub API for 5 minutes.
// ═══════════════════════════════════════════════════════════════════

const GITHUB_REPO = 'sneakyfree/windy-pro';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
let _ghReleaseCache = null;
let _ghReleaseCacheTime = 0;
const GH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Platform → asset name pattern mapping
const PLATFORM_PATTERNS = {
    'macos': /\.dmg$/i,
    'windows': /\.exe$/i,
    'linux-appimage': /\.AppImage$/i,
    'linux-deb': /\.deb$/i,
    'linux-install.sh': /install-windy-pro\.sh$/i,
};

async function getLatestGitHubRelease() {
    const now = Date.now();
    if (_ghReleaseCache && (now - _ghReleaseCacheTime) < GH_CACHE_TTL) {
        return _ghReleaseCache;
    }
    try {
        const response = await fetch(GITHUB_API_URL, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'WindyPro-Server/2.0'
            }
        });
        if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
        _ghReleaseCache = await response.json();
        _ghReleaseCacheTime = now;
        return _ghReleaseCache;
    } catch (err) {
        console.error('[Download] GitHub API error:', err.message);
        if (_ghReleaseCache) return _ghReleaseCache; // Return stale cache
        throw err;
    }
}

/**
 * @route GET /download/latest/:platform
 * @description Cache-proof download redirect. Fetches latest GitHub release,
 * finds the correct asset for the platform, and returns a 302 redirect
 * with cache-busting query param.
 * @access Public
 * @param {string} platform - One of: macos, windows, linux-appimage, linux-deb, linux-install.sh
 */
app.get('/download/latest/:platform', async (req, res) => {
    const platform = req.params.platform;
    const pattern = PLATFORM_PATTERNS[platform];

    if (!pattern) {
        return res.status(400).json({
            error: `Unknown platform: ${platform}`,
            available: Object.keys(PLATFORM_PATTERNS)
        });
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const release = await getLatestGitHubRelease();
        const asset = release.assets.find(a => pattern.test(a.name));

        if (!asset) {
            return res.status(404).json({
                error: `No ${platform} asset found in release ${release.tag_name}`,
                available_assets: release.assets.map(a => a.name)
            });
        }

        // 302 redirect with cache-busting timestamp
        const cacheBuster = `?v=${Date.now()}`;
        const downloadUrl = asset.browser_download_url + cacheBuster;

        console.log(`[Download] ${platform} → ${asset.name} (${release.tag_name})`);
        return res.redirect(302, downloadUrl);
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch latest release', details: err.message });
    }
});

/**
 * @route GET /download/verify
 * @description Returns JSON with all current versions, asset sizes, and download URLs.
 * Used by installers for self-verification.
 * @access Public
 */
app.get('/download/verify', async (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');

    try {
        const release = await getLatestGitHubRelease();
        const assets = {};

        for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
            const asset = release.assets.find(a => pattern.test(a.name));
            if (asset) {
                assets[platform] = {
                    name: asset.name,
                    size_bytes: asset.size,
                    download_url: `/download/latest/${platform}`,
                    direct_url: asset.browser_download_url,
                    updated_at: asset.updated_at,
                    download_count: asset.download_count
                };
            }
        }

        res.json({
            version: release.tag_name,
            published_at: release.published_at,
            release_url: release.html_url,
            assets,
            cache_age_seconds: Math.round((Date.now() - _ghReleaseCacheTime) / 1000)
        });
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch release info', details: err.message });
    }
});

/**
 * @route GET /download/version
 * @description Returns just the latest version string. Used by download page
 * to dynamically display current version.
 * @access Public
 */
app.get('/download/version', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Access-Control-Allow-Origin', '*');

    try {
        const release = await getLatestGitHubRelease();
        res.json({ version: release.tag_name, published_at: release.published_at });
    } catch (err) {
        res.status(502).json({ error: 'Failed to fetch version', version: 'v0.6.0' });
    }
});


app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───

const server = http.createServer(app);

// ═══════════════════════════════════════════
//  WebSocket /ws/transcribe — Real-time transcription
// ═══════════════════════════════════════════

const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });

wss.on('connection', (ws) => {
    let authenticated = false;
    let config = { language: 'en', engine: 'cloud-standard' };
    let chunkCount = 0;

    console.log('🎙️  WS transcribe: client connected');

    ws.send(JSON.stringify({ type: 'ack' }));

    ws.on('message', (data) => {
        // Binary audio chunk
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
            chunkCount++;
            // In production, feed to a real STT engine
            // For now, send periodic stub transcripts
            if (chunkCount % 10 === 0) {
                ws.send(JSON.stringify({
                    type: 'transcript',
                    text: `[Transcription chunk ${chunkCount}]`,
                    partial: true,
                    confidence: 0.92,
                    startTime: (chunkCount - 10) * 0.1,
                    endTime: chunkCount * 0.1,
                    language: config.language
                }));
            }
            return;
        }

        // Text message (JSON)
        try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
                case 'auth':
                    // Verify JWT token if provided
                    if (msg.token) {
                        try {
                            jwt.verify(msg.token, JWT_SECRET);
                            authenticated = true;
                        } catch (_) {
                            authenticated = false;
                        }
                    }
                    ws.send(JSON.stringify({ type: 'ack', authenticated }));
                    break;

                case 'config':
                    config.language = msg.language || config.language;
                    config.engine = msg.engine || config.engine;
                    ws.send(JSON.stringify({ type: 'state', state: 'listening' }));
                    console.log(`🎙️  WS config: language=${config.language}, engine=${config.engine}`);
                    break;

                case 'stop':
                    // Send final transcript
                    ws.send(JSON.stringify({
                        type: 'transcript',
                        text: `[Final transcription — ${chunkCount} audio chunks processed]`,
                        partial: false,
                        confidence: 0.95,
                        startTime: 0,
                        endTime: chunkCount * 0.1,
                        language: config.language
                    }));
                    console.log(`🎙️  WS transcribe: stopped after ${chunkCount} chunks`);
                    ws.close();
                    break;

                default:
                    ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
            }
        } catch (parseErr) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
    });

    ws.on('close', () => {
        console.log(`🎙️  WS transcribe: client disconnected (${chunkCount} chunks)`);
    });
});


// ─── BOMB-PROOF SCHEMA ADDITIONS (04 Mar 2026) ───────────────────────────────

/**
 * @route POST /api/v1/recordings
 * @description Create a recording from JSON (transcript-only, no file upload).
 * Used by desktop sync.js to batch-upload transcripts without media.
 * @access Private (requires auth)
 */
app.post('/api/v1/recordings', authenticateToken, (req, res) => {
    const { transcript, wordCount, durationSeconds, engine, mode, recordedAt } = req.body;
    if (!transcript && transcript !== '') {
        return res.status(400).json({ error: 'transcript field required' });
    }
    try {
        const stmt = db.prepare(`
            INSERT INTO recordings
                (user_id, transcript, word_count, duration_seconds, engine, mode, recorded_at, synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `);
        const result = stmt.run(
            req.user.userId,
            transcript || '',
            wordCount || 0,
            durationSeconds || 0,
            engine || 'local',
            mode || 'batch',
            recordedAt || new Date().toISOString()
        );
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('[POST /api/v1/recordings]', err.message);
        res.status(500).json({ error: 'Database error', detail: err.message });
    }
});

/**
 * @route GET /api/v1/recordings/stats
 * @description Aggregate stats for the authenticated user's recordings.
 * Used by web Dashboard, Soul File, Vault pages, and desktop sync.js.
 * @access Private
 */
app.get('/api/v1/recordings/stats', authenticateToken, (req, res) => {
    try {
        const userId = req.user.userId;
        const row = db.prepare(`
            SELECT
                COUNT(*) as totalRecordings,
                COALESCE(SUM(word_count), 0) as totalWords,
                ROUND(COALESCE(SUM(duration_seconds), 0) / 3600.0, 2) as totalHours,
                COALESCE(SUM(CASE WHEN has_audio = 1 THEN 1 ELSE 0 END), 0) as audioCount,
                COALESCE(SUM(CASE WHEN has_video = 1 THEN 1 ELSE 0 END), 0) as videoCount
            FROM recordings
            WHERE user_id = ?
        `).get(userId);

        res.json({
            stats: {
                totalRecordings: row.totalRecordings,
                totalWords: row.totalWords,
                totalHours: row.totalHours,
                audioCount: row.audioCount,
                videoCount: row.videoCount
            }
        });
    } catch (err) {
        console.error('[GET /api/v1/recordings/stats]', err.message);
        res.status(500).json({ error: 'Database error', detail: err.message });
    }
});

/**
 * @route POST /translate
 * @description Alias for /api/v1/translate/text. Used by the web app translate page
 * (compiled bundle calls /translate directly). Forwards to the same handler.
 * @access Public (rate-limited by IP)
 */
app.post('/translate', optionalAuth, async (req, res) => {
    const { text, sourceLang, targetLang } = req.body;
    if (!text || !targetLang) {
        return res.status(400).json({ error: 'text and targetLang required' });
    }
    try {
        const Groq = require('groq-sdk');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
        const completion = await groq.chat.completions.create({
            model: 'llama3-8b-8192',
            messages: [
                {
                    role: 'system',
                    content: `You are a translator. Translate the user's text from ${sourceLang || 'auto'} to ${targetLang}. Return ONLY the translated text, nothing else.`
                },
                { role: 'user', content: text }
            ],
            max_tokens: 2048
        });
        const translated = completion.choices[0]?.message?.content?.trim() || text;
        res.json({ translated, sourceLang: sourceLang || 'auto', targetLang, cached: false });
    } catch (err) {
        console.error('[POST /translate]', err.message);
        // Fallback: return placeholder if Groq fails
        res.json({ translated: `[${targetLang}] ${text}`, sourceLang, targetLang, cached: false, error: 'translation service unavailable' });
    }
});

/**
 * @route GET /api/voice-clone/status/:jobId
 * @description Voice clone job status stub. Used by mobile clone-bundle viewer.
 * @access Public
 */
app.get('/api/voice-clone/status/:jobId', optionalAuth, (req, res) => {
    res.json({
        jobId: req.params.jobId,
        status: 'queued',
        progress: 0,
        message: 'Voice cloning pipeline not yet active'
    });
});

/**
 * @route POST /api/register-push-token
 * @description Register a mobile push notification token. Stub implementation.
 * @access Private (optional auth)
 */
app.post('/api/register-push-token', optionalAuth, (req, res) => {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    // TODO: Persist push tokens when push notification service is implemented
    console.log('[Push] Registered token for platform:', platform || 'unknown');
    res.json({ success: true, message: 'Push token registered' });
});

/**
 * @route POST /api/stripe/checkout
 * @description Create a Stripe checkout session for license purchase.
 * Used by mobile license.ts getPurchaseUrl().
 * @access Public
 */
app.post('/api/stripe/checkout', async (req, res) => {
    const { deviceId, tier } = req.body;
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
        const prices = {
            pro: process.env.STRIPE_PRICE_PRO || 'price_pro',
            translate: process.env.STRIPE_PRICE_TRANSLATE || 'price_translate',
            translate_pro: process.env.STRIPE_PRICE_TRANSLATE_PRO || 'price_translate_pro'
        };
        const priceId = prices[tier] || prices.pro;
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `https://windypro.thewindstorm.uk/auth?success=1&device=${encodeURIComponent(deviceId || '')}`,
            cancel_url: 'https://windypro.thewindstorm.uk/#pricing',
            metadata: { deviceId: deviceId || '', tier: tier || 'pro' }
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('[Stripe checkout]', err.message);
        res.status(200).json({ url: `https://windypro.thewindstorm.uk/#pricing?device=${encodeURIComponent(deviceId || '')}` });
    }
});

/**
 * @route POST /api/v1/license/validate
 * @description License validation alias (mobile license.ts uses this path).
 * Routes to the same logic as /api/v1/license/activate.
 * @access Private (authenticateToken)
 */
app.post('/api/v1/license/validate', authenticateToken, (req, res) => {
    const { key, deviceId } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    try {
        const license = db.prepare('SELECT * FROM license_keys WHERE key = ? AND active = 1').get(key);
        if (!license) {
            return res.status(404).json({ valid: false, tier: 'free', error: 'License key not found' });
        }
        res.json({
            valid: true,
            tier: license.tier || 'pro',
            features: [],
            expiresAt: license.expires_at || null
        });
    } catch (err) {
        // license_keys table may not exist yet - return valid free tier
        res.json({ valid: false, tier: 'free', error: 'License system not initialized' });
    }
});

// ─── END BOMB-PROOF ADDITIONS ─────────────────────────────────────────────────
server.listen(PORT, () => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    console.log('');
    console.log('🔑 Windy Pro Account Server v2.0');
    console.log(`   Port:     http://localhost:${PORT}`);
    console.log(`   Database: ${DB_PATH}`);
    console.log(`   Users:    ${userCount}`);
    console.log(`   Devices:  ${MAX_DEVICES} per account`);
    console.log('');
    console.log('   Endpoints:');
    console.log(`   POST /v1/auth/register              — Create account`);
    console.log(`   POST /v1/auth/login                 — Login`);
    console.log(`   POST /v1/auth/logout                — Logout`);
    console.log(`   GET  /v1/auth/me                    — Current user info`);
    console.log(`   GET  /v1/auth/devices               — List devices`);
    console.log(`   POST /v1/auth/devices/register      — Register device (${MAX_DEVICES} max)`);
    console.log(`   POST /v1/auth/devices/remove        — Remove device`);
    console.log(`   POST /v1/auth/refresh               — Refresh token`);
    console.log(`   POST /api/v1/translate/speech        — Speech translation`);
    console.log(`   POST /api/v1/translate/text          — Text translation (AI)`);
    console.log(`   GET  /api/v1/translate/languages     — Supported languages`);
    console.log(`   POST /api/v1/transcribe              — Audio transcription`);
    console.log(`   POST /api/v1/transcribe/batch        — Batch transcription`);
    console.log(`   WS   /ws/transcribe                  — Real-time transcription`);
    console.log(`   POST /api/v1/ocr/translate           — OCR + translate`);
    console.log(`   GET  /api/v1/recordings              — List recordings`);
    console.log(`   GET  /api/v1/recordings/:id          — Get recording`);
    console.log(`   DEL  /api/v1/recordings/:id          — Delete recording`);
    console.log(`   POST /api/v1/recordings/upload/chunk — Chunked upload`);
    console.log(`   POST /api/v1/recordings/upload/batch — Batch upload`);
    console.log(`   GET  /api/v1/user/history            — Translation history`);
    console.log(`   POST /api/v1/user/favorites          — Toggle favorite`);
    console.log(`   POST /api/v1/analytics               — Log event (no auth)`);
    console.log(`   GET  /api/v1/updates/check           — Check for updates`);
    console.log(`   GET  /health                        — Health check`);
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});
