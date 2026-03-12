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

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ── Routes ──
app.use('/api/v1/chat/directory', lookupRoutes);
app.use('/api/v1/chat/directory', searchRoutes);

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({
    service: 'windy-chat-directory',
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

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
