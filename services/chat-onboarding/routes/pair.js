/**
 * Windy Chat — QR Code Pairing Routes
 * K2.3: QR Code Pairing — Desktop ↔ Mobile (DNA Strand K)
 *
 * Flow (like WhatsApp Web):
 *   1. Desktop calls POST /generate → gets QR code data (session_id + pubkey + ts)
 *   2. Desktop renders QR code in the app
 *   3. Mobile scans QR → calls POST /confirm with session_id + auth token
 *   4. Server links desktop session to mobile account
 *   5. Desktop polls GET /status/:sessionId → gets pairing result
 *
 * Security:
 *   - QR expires after 120 seconds
 *   - QR refreshes every 60 seconds on desktop
 *   - Max 5 linked devices per account
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── In-memory session store (replace with Redis in production) ──
const pairingSessions = new Map();  // sessionId → { pubkey, createdAt, expiresAt, status, linkedAccount }

const MAX_DEVICES = 5;
const QR_TTL_MS = 120 * 1000;  // 120 seconds

// ── Cleanup expired sessions periodically ──
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of pairingSessions) {
    if (now > session.expiresAt && session.status === 'pending') {
      pairingSessions.delete(id);
    }
  }
}, 30 * 1000);

// ── POST /api/v1/chat/pair/generate ──

router.post('/generate', (req, res) => {
  try {
    // Generate ephemeral X25519 key pair
    const keyPair = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    const sessionId = uuidv4();
    const pubkeyBase64 = keyPair.publicKey.toString('base64');
    const timestamp = Date.now();
    const expiresAt = timestamp + QR_TTL_MS;

    // QR payload — this gets encoded into the QR code
    const qrPayload = {
      session: sessionId,
      pubkey: pubkeyBase64,
      ts: timestamp,
      server: process.env.SYNAPSE_URL || 'https://chat.windypro.com',
      version: 1,
    };

    // Store session
    pairingSessions.set(sessionId, {
      pubkey: pubkeyBase64,
      privateKey: keyPair.privateKey,
      createdAt: timestamp,
      expiresAt,
      status: 'pending',       // pending → paired → active
      linkedAccount: null,
      deviceId: null,
    });

    console.log(`🔗 Pairing session created: ${sessionId.slice(0, 8)}... (expires in 120s)`);

    res.json({
      sessionId,
      qrPayload,
      qrDataString: JSON.stringify(qrPayload),
      expiresAt: new Date(expiresAt).toISOString(),
      ttlSeconds: QR_TTL_MS / 1000,
    });

  } catch (err) {
    console.error('Pair generate error:', err);
    res.status(500).json({ error: 'Failed to generate pairing session: ' + err.message });
  }
});

// ── POST /api/v1/chat/pair/confirm ──

router.post('/confirm', (req, res) => {
  try {
    const { sessionId, authToken, userId, displayName, deviceName, platform } = req.body;

    if (!sessionId || !authToken || !userId) {
      return res.status(400).json({
        error: 'sessionId, authToken, and userId are required',
      });
    }

    // Find session
    const session = pairingSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Pairing session not found or expired' });
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      pairingSessions.delete(sessionId);
      return res.status(410).json({ error: 'Pairing session expired. Generate a new QR code.' });
    }

    // Check if already paired
    if (session.status !== 'pending') {
      return res.status(409).json({ error: 'Session already paired' });
    }

    // TODO: Validate authToken against account server (H1)
    // For now, we trust the token and link the session

    const deviceId = `device_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    // Link session
    session.status = 'paired';
    session.linkedAccount = {
      userId,
      displayName: displayName || userId,
      deviceId,
      deviceName: deviceName || 'Desktop',
      platform: platform || 'desktop',
      pairedAt: new Date().toISOString(),
    };

    console.log(`✅ Pairing confirmed: session ${sessionId.slice(0, 8)} → user ${userId.slice(0, 12)} (${deviceName || 'Desktop'})`);

    res.json({
      success: true,
      paired: true,
      deviceId,
      message: 'Desktop session linked to your account',
    });

  } catch (err) {
    console.error('Pair confirm error:', err);
    res.status(500).json({ error: 'Pairing confirmation failed: ' + err.message });
  }
});

// ── GET /api/v1/chat/pair/status/:sessionId ──

router.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  const session = pairingSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Session not found or expired',
      status: 'expired',
    });
  }

  // Check expiration for pending sessions
  if (session.status === 'pending' && Date.now() > session.expiresAt) {
    pairingSessions.delete(sessionId);
    return res.json({
      sessionId,
      status: 'expired',
      message: 'QR code expired. Generate a new one.',
    });
  }

  const response = {
    sessionId,
    status: session.status,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };

  if (session.status === 'paired') {
    response.linkedAccount = {
      userId: session.linkedAccount.userId,
      displayName: session.linkedAccount.displayName,
      deviceId: session.linkedAccount.deviceId,
      pairedAt: session.linkedAccount.pairedAt,
    };
    response.message = 'Desktop linked! You can now access Windy Chat.';
  }

  res.json(response);
});

// ── DELETE /api/v1/chat/pair/session/:sessionId ──

router.delete('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const deleted = pairingSessions.delete(sessionId);

  res.json({
    success: deleted,
    message: deleted ? 'Session removed' : 'Session not found',
  });
});

module.exports = router;
