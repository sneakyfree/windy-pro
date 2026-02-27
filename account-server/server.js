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
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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
};

// ─── Middleware ───

app.use(cors());
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));
app.use(express.json());

// ─── Auth Middleware ───

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

// Health check
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

// ─── POST /v1/auth/register ───

app.post('/v1/auth/register', async (req, res) => {
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

app.post('/v1/auth/login', async (req, res) => {
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

app.get('/v1/auth/me', authenticateToken, (req, res) => {
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

app.get('/v1/auth/devices', authenticateToken, (req, res) => {
    const devices = getDeviceList(req.user.userId);
    res.json({
        devices,
        count: devices.length,
        limit: MAX_DEVICES,
        remaining: MAX_DEVICES - devices.length
    });
});

// ─── POST /v1/auth/devices/register ───

app.post('/v1/auth/devices/register', authenticateToken, (req, res) => {
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

app.post('/v1/auth/devices/remove', authenticateToken, (req, res) => {
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

app.post('/v1/auth/refresh', (req, res) => {
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

// ─── Error Handler ───

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───

app.listen(PORT, () => {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    console.log('');
    console.log('🔑 Windy Pro Account Server v2.0');
    console.log(`   Port:     http://localhost:${PORT}`);
    console.log(`   Database: ${DB_PATH}`);
    console.log(`   Users:    ${userCount}`);
    console.log(`   Devices:  ${MAX_DEVICES} per account`);
    console.log('');
    console.log('   Endpoints:');
    console.log(`   POST /v1/auth/register          — Create account`);
    console.log(`   POST /v1/auth/login             — Login`);
    console.log(`   GET  /v1/auth/me                — Current user info`);
    console.log(`   GET  /v1/auth/devices           — List devices`);
    console.log(`   POST /v1/auth/devices/register  — Register device (${MAX_DEVICES} max)`);
    console.log(`   POST /v1/auth/devices/remove    — Remove device`);
    console.log(`   POST /v1/auth/refresh           — Refresh token`);
    console.log(`   GET  /health                    — Health check`);
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
