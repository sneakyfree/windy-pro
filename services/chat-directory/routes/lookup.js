/**
 * Windy Chat — Hash-Based Contact Lookup Routes
 * K3.1: Phone Contact Import (DNA Strand K)
 *
 * PRIVACY-FIRST APPROACH (Signal-style):
 *   1. App reads device contacts (with permission)
 *   2. Hash each phone number: SHA256(E.164_number + server_salt)
 *   3. Send ONLY hashes to server (never raw phone numbers)
 *   4. Server compares hashes against registered user hash table
 *   5. Return matches: hash → Windy display name + avatar
 *   6. Raw contacts NEVER leave the device
 *
 * Endpoints:
 *   POST /api/v1/chat/directory/lookup          — batch hash lookup
 *   GET  /api/v1/chat/directory/salt            — current hashing salt
 *   POST /api/v1/chat/directory/register-hash   — register user's hashed identifier
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ── In-memory stores (replace with DB/Redis in production) ──

// Hash directory: hash → { userId, displayName, avatarUrl, registeredAt }
const hashDirectory = new Map();

// Salt management — rotates weekly
let currentSalt = crypto.randomBytes(32).toString('hex');
let saltCreatedAt = Date.now();
const SALT_ROTATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Rate limiters ──
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // 10 requests per minute
  keyGenerator: (req) => req.headers['x-windy-user-id'] || req.ip,
  message: { error: 'Lookup rate limit exceeded. Max 10 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helpers ──

/**
 * Rotate salt if it's older than SALT_ROTATION_MS.
 */
function checkSaltRotation() {
  if (Date.now() - saltCreatedAt > SALT_ROTATION_MS) {
    const previousSalt = currentSalt;
    currentSalt = crypto.randomBytes(32).toString('hex');
    saltCreatedAt = Date.now();
    console.log(`🔑 Salt rotated. Previous salt prefix: ${previousSalt.slice(0, 8)}...`);

    // In production: re-hash all registered identifiers with new salt
    // and keep old salt temporarily for transition period
  }
}

/**
 * Compute SHA256 hash of identifier + salt.
 */
function computeHash(identifier, salt) {
  return crypto
    .createHash('sha256')
    .update(identifier + salt)
    .digest('hex');
}

// ── GET /api/v1/chat/directory/salt ──

router.get('/salt', (_req, res) => {
  checkSaltRotation();

  res.json({
    salt: currentSalt,
    createdAt: new Date(saltCreatedAt).toISOString(),
    rotatesAt: new Date(saltCreatedAt + SALT_ROTATION_MS).toISOString(),
    algorithm: 'SHA256',
    usage: 'hash = SHA256(E.164_phone_number + salt)',
  });
});

// ── POST /api/v1/chat/directory/lookup ──

router.post('/lookup', lookupLimiter, (req, res) => {
  try {
    const { hashes } = req.body;

    if (!hashes || !Array.isArray(hashes)) {
      return res.status(400).json({ error: 'hashes must be an array of SHA256 hex strings' });
    }

    // Enforce max 1000 lookups per request
    if (hashes.length > 1000) {
      return res.status(400).json({
        error: `Max 1000 hashes per request. You sent ${hashes.length}.`,
        limit: 1000,
      });
    }

    // Validate hash format (64 hex chars = SHA256)
    const validHashes = hashes.filter(h =>
      typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)
    );

    if (validHashes.length === 0) {
      return res.status(400).json({
        error: 'No valid SHA256 hashes provided. Expected 64-char hex strings.',
      });
    }

    // Look up matches
    const matches = [];
    for (const hash of validHashes) {
      const entry = hashDirectory.get(hash);
      if (entry) {
        matches.push({
          hash,
          userId: entry.userId,
          displayName: entry.displayName,
          avatarUrl: entry.avatarUrl || null,
        });
      }
    }

    console.log(`🔍 Lookup: ${validHashes.length} hashes → ${matches.length} matches`);

    res.json({
      submitted: validHashes.length,
      matches,
      matchCount: matches.length,
    });

  } catch (err) {
    console.error('Lookup error:', err);
    res.status(500).json({ error: 'Lookup failed: ' + err.message });
  }
});

// ── POST /api/v1/chat/directory/register-hash ──

router.post('/register-hash', (req, res) => {
  try {
    const { userId, displayName, avatarUrl, identifierHash, identifiers } = req.body;

    if (!userId || !displayName) {
      return res.status(400).json({ error: 'userId and displayName are required' });
    }

    let registeredCount = 0;

    // Option 1: Pre-computed hash provided by client
    if (identifierHash) {
      if (typeof identifierHash === 'string' && /^[a-f0-9]{64}$/.test(identifierHash)) {
        hashDirectory.set(identifierHash, {
          userId,
          displayName,
          avatarUrl: avatarUrl || null,
          registeredAt: Date.now(),
        });
        registeredCount = 1;
      }
    }

    // Option 2: Server computes hashes from raw identifiers
    // (used during onboarding when server has the verified phone/email)
    if (identifiers && Array.isArray(identifiers)) {
      checkSaltRotation();
      for (const id of identifiers.slice(0, 5)) { // Max 5 identifiers per user
        const hash = computeHash(id, currentSalt);
        hashDirectory.set(hash, {
          userId,
          displayName,
          avatarUrl: avatarUrl || null,
          registeredAt: Date.now(),
        });
        registeredCount++;
      }
    }

    if (registeredCount === 0) {
      return res.status(400).json({
        error: 'Provide identifierHash (pre-computed) or identifiers array',
      });
    }

    console.log(`📇 Registered ${registeredCount} hash(es) for "${displayName}" (${userId.slice(0, 12)})`);

    res.status(201).json({
      success: true,
      registeredCount,
      message: `${registeredCount} identifier(s) registered in directory`,
    });

  } catch (err) {
    console.error('Register hash error:', err);
    res.status(500).json({ error: 'Hash registration failed: ' + err.message });
  }
});

// ── GET /api/v1/chat/directory/stats ──

router.get('/stats', (_req, res) => {
  res.json({
    totalHashes: hashDirectory.size,
    saltAge: Math.floor((Date.now() - saltCreatedAt) / 1000 / 60 / 60) + ' hours',
    nextRotation: new Date(saltCreatedAt + SALT_ROTATION_MS).toISOString(),
  });
});

module.exports = router;
