/**
 * Windy Chat — Onboarding Service
 * K2: WhatsApp-Style Onboarding (DNA Strand K)
 *
 * This service handles the complete chat onboarding flow:
 *   1. Phone/email verification (K2.1)
 *   2. Display name + language setup (K2.2)
 *   3. QR code pairing for desktop ↔ mobile (K2.3)
 *   4. Matrix account provisioning via K1 Synapse (K2.4)
 *
 * Port: 8101
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const verifyRoutes = require('./routes/verify');
const profileRoutes = require('./routes/profile');
const pairRoutes = require('./routes/pair');
const provisionRoutes = require('./routes/provision');

const app = express();
const PORT = process.env.PORT || 8101;

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ── Routes ──
app.use('/api/v1/chat/verify', verifyRoutes);
app.use('/api/v1/chat/profile', profileRoutes);
app.use('/api/v1/chat/pair', pairRoutes);
app.use('/api/v1/chat/provision', provisionRoutes);

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({
    service: 'windy-chat-onboarding',
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
  console.log(`🌪️  Windy Chat Onboarding — listening on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Verify: http://localhost:${PORT}/api/v1/chat/verify/send`);
  console.log(`   Profile: http://localhost:${PORT}/api/v1/chat/profile/setup`);
  console.log(`   Pair: http://localhost:${PORT}/api/v1/chat/pair/generate`);
});

module.exports = app;
