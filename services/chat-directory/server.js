/**
 * Windy Chat — Contact Discovery Service
 * K3: Contact Discovery (DNA Strand K)
 *
 * This service handles finding and connecting with other Windy Chat users:
 *   1. Privacy-first hash-based contact lookup (K3.1)
 *   2. Search by name / email / phone (K3.2)
 *   3. Invite non-users via SMS/email (K3.2.2)
 *
 * Port: 8102
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const lookupRoutes = require('./routes/lookup');
const searchRoutes = require('./routes/search');

const app = express();
const PORT = process.env.PORT || 8102;

// ── CORS — explicit origin whitelist ──
const ALLOWED_ORIGINS = [
  'https://windypro.thewindstorm.uk',
  'https://chat.windypro.com',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    // SEC-M3: Only allow localhost in non-production environments
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// ── Auth middleware — Bearer token validation ──
// SEC-H9: Fail hard if CHAT_API_TOKEN is not set — don't accept empty string
const CHAT_API_TOKEN = process.env.CHAT_API_TOKEN;
if (!CHAT_API_TOKEN || CHAT_API_TOKEN.trim().length === 0) {
  console.error('❌ CHAT_API_TOKEN is required. Set it in your .env file.');
  process.exit(1);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  if (!CHAT_API_TOKEN || token !== CHAT_API_TOKEN) {
    return res.status(401).json({ error: 'Invalid API token' });
  }
  next();
}

// ── Global rate limiter ──
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ── Health check (no auth required) ──
app.get('/health', (_req, res) => {
  res.json({
    service: 'windy-chat-directory',
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Auth-protected routes ──
app.use('/api/v1/chat/directory', authMiddleware, lookupRoutes);
app.use('/api/v1/chat/directory', authMiddleware, searchRoutes);

// ── 404 fallback ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ──
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`🌪️  Windy Chat Directory — listening on port ${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Lookup:  http://localhost:${PORT}/api/v1/chat/directory/lookup`);
  console.log(`   Search:  http://localhost:${PORT}/api/v1/chat/directory/search`);
});

module.exports = app;
