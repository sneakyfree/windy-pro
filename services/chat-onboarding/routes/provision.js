/**
 * Windy Chat —  Matrix Account Provisioning Routes
 * K2.4: Onboarding Completion (DNA Strand K)
 *
 * Endpoints:
 *   POST /api/v1/chat/provision        — provision Matrix account via Synapse admin API
 *   GET  /api/v1/chat/onboarding/status — check onboarding completion state
 *
 * Flow:
 *   1. User verifies phone/email (K2.1) ✅
 *   2. User sets display name + languages (K2.2) ✅
 *   3. This service provisions a Matrix account on our Synapse (K1)
 *   4. Returns Matrix credentials to the client
 *
 * The Synapse admin API (/_synapse/admin/v1/register) is used with a
 * shared secret to create accounts. Direct Matrix registration is disabled.
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── In-memory onboarding state (replace with DB in production) ──
const onboardingState = new Map();  // windyUserId → { verified, profileSetup, matrixProvisioned, matrixUserId }

// ── Config ──
const SYNAPSE_URL = process.env.SYNAPSE_URL || 'http://localhost:8008';
const SYNAPSE_ADMIN_URL = process.env.SYNAPSE_ADMIN_URL || `${SYNAPSE_URL}/_synapse/admin`;
const SYNAPSE_REGISTRATION_SECRET = process.env.SYNAPSE_REGISTRATION_SECRET || '';
const SYNAPSE_SERVER_NAME = process.env.SYNAPSE_SERVER_NAME || 'chat.windypro.com';

// ── Helpers ──

/**
 * Generate a Matrix-safe localpart from a display name.
 * Matrix localpart: [a-z0-9._=/-]
 */
function displayNameToLocalpart(displayName) {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._/-]/g, '')
    .slice(0, 32);

  if (base.length >= 3) {
    return `windy_${base}`;
  }

  // Fallback: hash-based
  const hash = crypto.createHash('sha256').update(displayName).digest('hex').slice(0, 12);
  return `windy_${hash}`;
}

/**
 * Generate HMAC for Synapse shared-secret registration.
 * See: https://element-hq.github.io/synapse/latest/admin_api/register_api.html
 */
function generateRegistrationMac(nonce, username, password, admin = false) {
  const hmac = crypto.createHmac('sha1', SYNAPSE_REGISTRATION_SECRET);
  hmac.update(nonce);
  hmac.update('\x00');
  hmac.update(username);
  hmac.update('\x00');
  hmac.update(password);
  hmac.update('\x00');
  hmac.update(admin ? 'admin' : 'notadmin');
  return hmac.digest('hex');
}

/**
 * Provision a new Matrix account on our Synapse homeserver.
 *
 * Uses the Synapse admin registration API with shared-secret HMAC:
 *   1. GET /_synapse/admin/v1/register → get nonce
 *   2. POST /_synapse/admin/v1/register → create user with HMAC
 */
async function provisionMatrixAccount(localpart, displayName) {
  // Step 1: Get nonce
  const nonceRes = await fetch(`${SYNAPSE_ADMIN_URL}/v1/register`, {
    method: 'GET',
  });

  if (!nonceRes.ok) {
    throw new Error(`Synapse nonce request failed: ${nonceRes.status} ${nonceRes.statusText}`);
  }

  const { nonce } = await nonceRes.json();

  // Generate a random password (user logs in via Windy auth, not Matrix password)
  const password = crypto.randomBytes(32).toString('hex');

  // Generate HMAC
  const mac = generateRegistrationMac(nonce, localpart, password, false);

  // Step 2: Register
  const regRes = await fetch(`${SYNAPSE_ADMIN_URL}/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce,
      username: localpart,
      password,
      displayname: displayName,
      admin: false,
      mac,
    }),
  });

  if (!regRes.ok) {
    const errBody = await regRes.text();
    throw new Error(`Synapse registration failed: ${regRes.status} — ${errBody}`);
  }

  const result = await regRes.json();

  return {
    matrixUserId: result.user_id || `@${localpart}:${SYNAPSE_SERVER_NAME}`,
    accessToken: result.access_token,
    deviceId: result.device_id,
    homeServer: SYNAPSE_SERVER_NAME,
  };
}

// ── POST /api/v1/chat/provision ──

router.post('/', async (req, res) => {
  try {
    const { chatUserId, displayName, verificationToken } = req.body;

    if (!chatUserId || !displayName) {
      return res.status(400).json({
        error: 'chatUserId and displayName are required',
        hint: 'Complete profile setup (K2.2) first',
      });
    }

    if (!verificationToken) {
      return res.status(401).json({
        error: 'Verification required',
        hint: 'Complete phone/email verification (K2.1) first',
      });
    }

    // Generate Matrix localpart from display name
    const localpart = displayNameToLocalpart(displayName);
    const matrixUserId = `@${localpart}:${SYNAPSE_SERVER_NAME}`;

    let matrixCredentials;

    if (SYNAPSE_REGISTRATION_SECRET) {
      // Production: provision via Synapse admin API
      try {
        matrixCredentials = await provisionMatrixAccount(localpart, displayName);
      } catch (err) {
        console.error('Matrix provisioning failed:', err.message);
        return res.status(502).json({
          error: 'Failed to provision Matrix account',
          detail: err.message,
          hint: 'Is the Synapse homeserver running? Check deploy/synapse/',
        });
      }
    } else {
      // Dev mode: stub credentials
      console.warn('⚠️  SYNAPSE_REGISTRATION_SECRET not set — returning stub credentials');
      matrixCredentials = {
        matrixUserId,
        accessToken: `dev_token_${uuidv4()}`,
        deviceId: `dev_device_${uuidv4().slice(0, 8)}`,
        homeServer: SYNAPSE_SERVER_NAME,
        _dev: 'Stub credentials (Synapse not configured)',
      };
    }

    // Update onboarding state
    onboardingState.set(chatUserId, {
      verified: true,
      profileSetup: true,
      matrixProvisioned: true,
      matrixUserId: matrixCredentials.matrixUserId,
      provisionedAt: new Date().toISOString(),
    });

    console.log(`🏠 Matrix account provisioned: ${displayName} → ${matrixCredentials.matrixUserId}`);

    res.status(201).json({
      success: true,
      matrix: matrixCredentials,
      onboarding: {
        complete: true,
        steps: {
          verified: true,
          profileSetup: true,
          matrixProvisioned: true,
        },
      },
      message: `Welcome to Windy Chat, ${displayName}! Your account is ready.`,
    });

  } catch (err) {
    console.error('Provision error:', err);
    res.status(500).json({ error: 'Account provisioning failed: ' + err.message });
  }
});

// ── GET /api/v1/chat/onboarding/status ──

router.get('/onboarding/status', (req, res) => {
  const { chatUserId } = req.query;

  if (!chatUserId) {
    return res.status(400).json({ error: 'chatUserId query param required' });
  }

  const state = onboardingState.get(chatUserId);

  if (!state) {
    return res.json({
      chatUserId,
      complete: false,
      steps: {
        verified: false,
        profileSetup: false,
        matrixProvisioned: false,
      },
      nextStep: 'verify',
      message: 'Start by verifying your phone or email',
    });
  }

  const nextStep = !state.verified ? 'verify'
    : !state.profileSetup ? 'profile'
    : !state.matrixProvisioned ? 'provision'
    : null;

  res.json({
    chatUserId,
    complete: state.matrixProvisioned,
    matrixUserId: state.matrixUserId || null,
    steps: {
      verified: state.verified,
      profileSetup: state.profileSetup,
      matrixProvisioned: state.matrixProvisioned,
    },
    nextStep,
    provisionedAt: state.provisionedAt || null,
  });
});

module.exports = router;
