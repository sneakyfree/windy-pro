/**
 * Windy Pro v2.0 — Model Download Server
 * 
 * Serves .wpr model files with:
 * - JWT Bearer token authentication
 * - HTTP Range header support (download resume)
 * - Download logging (account ID, device ID, model, timestamp)
 * - Public catalog endpoint
 * - Health check
 * 
 * Usage:
 *   node server.js                    # Start on port 8099
 *   PORT=9000 node server.js          # Custom port
 *   JWT_SECRET=mysecret node server.js # Custom JWT secret
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8099;
// SEC-C4: Never use a hardcoded JWT secret
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  [SEC-C4] JWT_SECRET not set — generated ephemeral secret. Set JWT_SECRET in .env for persistent tokens.');
  return s;
})();
const MODELS_DIR = path.join(__dirname, 'models');
const LOG_FILE = path.join(__dirname, 'downloads.log');

// ─── Model Catalog (mirrors installer-v2/core/models.js) ───

const MODEL_CATALOG = [
    // Core (GPU)
    { id: 'core-spark', family: 'core', name: 'Windy Core Spark', shortName: 'Spark', sizeMB: 75, speed: '32x', quality: 'Basic', tier: 'free' },
    { id: 'core-pulse', family: 'core', name: 'Windy Core Pulse', shortName: 'Pulse', sizeMB: 142, speed: '16x', quality: 'Good', tier: 'plus' },
    { id: 'core-standard', family: 'core', name: 'Windy Core Standard', shortName: 'Standard', sizeMB: 466, speed: '6x', quality: 'Accurate', tier: 'plus' },
    { id: 'core-global', family: 'core', name: 'Windy Core Global', shortName: 'Global', sizeMB: 1500, speed: '2x', quality: 'High', tier: 'pro' },
    { id: 'core-pro', family: 'core', name: 'Windy Core Pro', shortName: 'Pro', sizeMB: 1500, speed: '6x', quality: 'Excellent', tier: 'pro' },
    { id: 'core-turbo', family: 'core', name: 'Windy Core Turbo', shortName: 'Turbo', sizeMB: 1600, speed: '4x', quality: 'Excellent', tier: 'pro' },
    { id: 'core-ultra', family: 'core', name: 'Windy Core Ultra', shortName: 'Ultra', sizeMB: 2900, speed: '1x', quality: 'Maximum', tier: 'promax', badge: '👑 Flagship' },
    // Edge (CPU)
    { id: 'edge-spark', family: 'edge', name: 'Windy Edge Spark', shortName: 'Spark', sizeMB: 42, speed: '32x', quality: 'Basic', tier: 'free', badge: '📱 MoboLoco' },
    { id: 'edge-pulse', family: 'edge', name: 'Windy Edge Pulse', shortName: 'Pulse', sizeMB: 78, speed: '16x', quality: 'Good', tier: 'free' },
    { id: 'edge-standard', family: 'edge', name: 'Windy Edge Standard', shortName: 'Standard', sizeMB: 168, speed: '6x', quality: 'Accurate', tier: 'plus', badge: '⭐ Most Popular' },
    { id: 'edge-global', family: 'edge', name: 'Windy Edge Global', shortName: 'Global', sizeMB: 515, speed: '2x', quality: 'High', tier: 'pro' },
    { id: 'edge-pro', family: 'edge', name: 'Windy Edge Pro', shortName: 'Pro', sizeMB: 515, speed: '4x', quality: 'Excellent', tier: 'pro' },
    // Lingua (Language Specialists)
    { id: 'lingua-es', family: 'lingua', name: 'Windy Lingua Español', shortName: 'Español', sizeMB: 500, speed: '4x', quality: 'Specialist', tier: 'pro' },
    { id: 'lingua-fr', family: 'lingua', name: 'Windy Lingua Français', shortName: 'Français', sizeMB: 500, speed: '4x', quality: 'Specialist', tier: 'pro' },
    { id: 'lingua-hi', family: 'lingua', name: 'Windy Lingua हिन्दी', shortName: 'हिन्दी', sizeMB: 500, speed: '4x', quality: 'Specialist', tier: 'pro' },
];

// Tier access map
const TIER_ACCESS = {
    free: ['core-spark', 'edge-spark', 'edge-pulse'],
    plus: ['core-spark', 'core-pulse', 'core-standard', 'edge-spark', 'edge-pulse', 'edge-standard'],
    pro: MODEL_CATALOG.map(m => m.id),
    promax: MODEL_CATALOG.map(m => m.id),
    lifetime: MODEL_CATALOG.map(m => m.id),
};

// ─── Middleware ───

// SEC-M4: Explicit CORS origin whitelist — no wildcards
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Server-to-server, Electron
    const allowed = [
      'https://windyword.ai',
      'https://windypro.thewindstorm.uk', // legacy — remove after full migration
      /^http:\/\/localhost(:\d+)?$/,
    ];
    if (allowed.some(o => o instanceof RegExp ? o.test(origin) : o === origin)) {
      return callback(null, true);
    }
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));
app.use(express.json());

// ─── Auth Middleware ───

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Authentication required', message: 'Include Authorization: Bearer <token>' });
    }

    try {
        // SEC-H5: Explicit algorithm whitelist
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', message: 'Please re-authenticate' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
}

// ─── Download Logging ───

function logDownload(accountId, deviceId, modelId, action, details = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        accountId,
        deviceId: deviceId || 'unknown',
        modelId,
        action,
        ...details
    };
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(LOG_FILE, line, (err) => {
        if (err) console.error('Failed to write download log:', err.message);
    });
    console.log(`📥 ${action}: ${modelId} | account=${accountId} device=${deviceId || 'n/a'}`);
}

// ─── Routes ───

// Health check (public)
app.get('/health', (req, res) => {
    const modelFiles = fs.existsSync(MODELS_DIR)
        ? fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.wpr')).length
        : 0;

    res.json({
        status: 'ok',
        service: 'windy-pro-model-server',
        version: '2.0.0',
        models: modelFiles,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Model catalog (public)
app.get('/v2/catalog.json', (req, res) => {
    // Check which models actually have files on disk
    const available = MODEL_CATALOG.map(m => {
        const filePath = path.join(MODELS_DIR, `${m.id}.wpr`);
        const exists = fs.existsSync(filePath);
        let fileSize = 0;
        if (exists) {
            fileSize = fs.statSync(filePath).size;
        }
        return {
            ...m,
            available: exists,
            fileSizeBytes: fileSize
        };
    });

    res.json({
        version: '2.0.0',
        generated: new Date().toISOString(),
        models: available,
        totalModels: MODEL_CATALOG.length,
        availableModels: available.filter(m => m.available).length
    });
});

// Model download (authenticated, supports Range)
app.get('/v2/:modelId.wpr', authenticateToken, (req, res) => {
    const modelId = req.params.modelId;
    const model = MODEL_CATALOG.find(m => m.id === modelId);

    if (!model) {
        return res.status(404).json({ error: 'Model not found', modelId });
    }

    // Check tier access
    const userTier = req.user.tier || 'free';
    const allowedModels = TIER_ACCESS[userTier] || TIER_ACCESS.free;
    if (!allowedModels.includes(modelId)) {
        return res.status(403).json({
            error: 'Tier access denied',
            message: `Model ${modelId} requires at least '${model.tier}' tier. Your tier: '${userTier}'.`,
            requiredTier: model.tier,
            currentTier: userTier
        });
    }

    const filePath = path.join(MODELS_DIR, `${modelId}.wpr`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            error: 'Model file not found on server',
            message: 'Run `node generate-test-models.js` to create test model files.',
            modelId
        });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const deviceId = req.headers['x-device-id'] || 'unknown';

    // Parse Range header
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!match) {
            return res.status(416).json({ error: 'Invalid Range header' });
        }

        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize) {
            res.setHeader('Content-Range', `bytes */${fileSize}`);
            return res.status(416).json({ error: 'Range not satisfiable' });
        }

        const chunkSize = end - start + 1;

        logDownload(req.user.accountId || req.user.email, deviceId, modelId, 'download-resume', {
            rangeStart: start,
            rangeEnd: end,
            chunkSize
        });

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${modelId}.wpr"`,
            'X-Model-Id': modelId,
            'X-Model-Name': model.name,
            'X-Model-Family': model.family
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
    } else {
        // Full download
        logDownload(req.user.accountId || req.user.email, deviceId, modelId, 'download-full', {
            fileSize
        });

        res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${modelId}.wpr"`,
            'X-Model-Id': modelId,
            'X-Model-Name': model.name,
            'X-Model-Family': model.family
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    }
});

// ─── Dev: Generate a test JWT token ───

app.get('/dev/token', (req, res) => {
    const tier = req.query.tier || 'pro';
    const email = req.query.email || 'dev@windypro.local';
    const token = jwt.sign(
        { accountId: 'dev-001', email, tier, name: 'Dev User', iat: Math.floor(Date.now() / 1000) },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    res.json({ token, tier, email, expiresIn: '24h', note: 'Dev-only endpoint. Do not use in production.' });
});

// ─── Error handler ───

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    // SEC-H7: Don't expose internal error details
    res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───

app.listen(PORT, () => {
    const modelCount = fs.existsSync(MODELS_DIR)
        ? fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.wpr')).length
        : 0;

    console.log('');
    console.log('🌪️  Windy Pro Model Server v2.0');
    console.log(`   Port:    http://localhost:${PORT}`);
    console.log(`   Models:  ${MODELS_DIR} (${modelCount} files)`);
    console.log(`   Log:     ${LOG_FILE}`);
    console.log('');
    console.log('   Endpoints:');
    console.log(`   GET /health              — Health check`);
    console.log(`   GET /v2/catalog.json     — Model catalog (public)`);
    console.log(`   GET /v2/:modelId.wpr     — Download model (auth required)`);
    console.log(`   GET /dev/token?tier=pro  — Generate dev JWT token`);
    console.log('');

    if (modelCount === 0) {
        console.log('   ⚠️  No model files found! Run:');
        console.log('      node generate-test-models.js');
        console.log('');
    }
});

module.exports = app;
