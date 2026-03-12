/**
 * Windy Chat — Display Name & Profile Setup Routes
 * K2.2: Display Name Setup (DNA Strand K)
 *
 * Endpoints:
 *   GET  /api/v1/chat/profile/check-name  — check display name availability
 *   POST /api/v1/chat/profile/setup       — set display name, languages, avatar
 *
 * Name rules:
 *   - Min 2, max 64 characters
 *   - Unicode allowed (international names)
 *   - Profanity filter (basic word list)
 *   - Unique across Windy Chat network
 *   - Suggests alternatives if taken
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { checkProfanity } = require('../lib/profanity');

const router = express.Router();

// ── In-memory display name registry (replace with DB in production) ──
const displayNameRegistry = new Map();  // name (lowercase) → { userId, displayName, languages, avatarUrl, createdAt }
const userProfiles = new Map();         // userId → profile

// ── Supported languages (subset — matches Windy Pro language list) ──
const SUPPORTED_LANGUAGES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko',
  'ar', 'hi', 'bn', 'tr', 'vi', 'th', 'pl', 'nl', 'sv', 'da',
  'no', 'fi', 'cs', 'el', 'he', 'id', 'ms', 'ro', 'hu', 'uk',
  'sk', 'bg', 'hr', 'sr', 'sl', 'et', 'lv', 'lt', 'fil', 'sw',
]);

// ── Helpers ──

/**
 * Validate display name.
 * Returns { valid, error? } or { valid, suggestions? } if taken.
 */
function validateDisplayName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Display name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Display name must be at least 2 characters' };
  }

  if (trimmed.length > 64) {
    return { valid: false, error: 'Display name must be 64 characters or fewer' };
  }

  // Check for profanity
  if (checkProfanity(trimmed)) {
    return { valid: false, error: 'This display name is not allowed. Please choose another.' };
  }

  // Check uniqueness
  const normalized = trimmed.toLowerCase();
  if (displayNameRegistry.has(normalized)) {
    const suggestions = generateAlternatives(trimmed);
    return {
      valid: false,
      error: 'This display name is already taken',
      taken: true,
      suggestions,
    };
  }

  return { valid: true, displayName: trimmed };
}

/**
 * Generate alternative name suggestions when a name is taken.
 * K2.2.1: Suggest alternatives like "Grant W", "Grant Whitmer 2"
 */
function generateAlternatives(name) {
  const suggestions = [];
  const parts = name.trim().split(/\s+/);

  // "Grant W" — first name + last initial
  if (parts.length >= 2) {
    const abbrev = parts[0] + ' ' + parts[parts.length - 1][0] + '.';
    if (!displayNameRegistry.has(abbrev.toLowerCase())) {
      suggestions.push(abbrev);
    }
  }

  // "Grant Whitmer 2", "Grant Whitmer 3"
  for (let i = 2; i <= 5; i++) {
    const numbered = `${name} ${i}`;
    if (!displayNameRegistry.has(numbered.toLowerCase())) {
      suggestions.push(numbered);
      if (suggestions.length >= 3) break;
    }
  }

  // Underscore variant: "grant_whitmer"
  const underscored = name.toLowerCase().replace(/\s+/g, '_');
  if (!displayNameRegistry.has(underscored)) {
    suggestions.push(underscored);
  }

  return suggestions.slice(0, 3);
}

// ── GET /api/v1/chat/profile/check-name ──

router.get('/check-name', (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'name query parameter is required' });
  }

  const result = validateDisplayName(name);

  res.json({
    name,
    available: result.valid,
    error: result.error || null,
    suggestions: result.suggestions || [],
  });
});

// ── POST /api/v1/chat/profile/setup ──

router.post('/setup', async (req, res) => {
  try {
    const { verificationToken, displayName, languages, avatarUrl } = req.body;

    // Require verification token (from K2.1 verify/check)
    if (!verificationToken) {
      return res.status(401).json({
        error: 'Verification required. Complete phone/email verification first.',
        step: 'verify',
      });
    }

    // Validate display name
    const nameResult = validateDisplayName(displayName);
    if (!nameResult.valid) {
      return res.status(400).json({
        error: nameResult.error,
        suggestions: nameResult.suggestions || [],
        field: 'displayName',
      });
    }

    // Validate languages
    const primaryLanguage = languages && languages.length > 0 ? languages[0] : 'en';
    const validLanguages = (languages || ['en']).filter(l => SUPPORTED_LANGUAGES.has(l));
    if (validLanguages.length === 0) {
      return res.status(400).json({
        error: 'At least one valid language is required',
        supportedLanguages: [...SUPPORTED_LANGUAGES].sort(),
        field: 'languages',
      });
    }

    // Create profile
    const chatUserId = `windy_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const profile = {
      chatUserId,
      displayName: nameResult.displayName,
      languages: validLanguages,
      primaryLanguage,
      avatarUrl: avatarUrl || null,
      createdAt: now,
      onboardingComplete: false,
    };

    // Register display name
    displayNameRegistry.set(nameResult.displayName.toLowerCase(), {
      userId: chatUserId,
      displayName: nameResult.displayName,
      languages: validLanguages,
      avatarUrl: avatarUrl || null,
      createdAt: now,
    });

    // Store profile
    userProfiles.set(chatUserId, profile);

    console.log(`👤 Profile created: "${nameResult.displayName}" (${chatUserId}), languages: [${validLanguages.join(', ')}]`);

    res.status(201).json({
      success: true,
      profile,
      message: 'Profile created successfully',
      nextStep: 'provision',  // Next: provision Matrix account (K2.4)
    });

  } catch (err) {
    console.error('Profile setup error:', err);
    res.status(500).json({ error: 'Profile setup failed: ' + err.message });
  }
});

// ── GET /api/v1/chat/profile/:userId ──

router.get('/:userId', (req, res) => {
  const { userId } = req.params;
  const profile = userProfiles.get(userId);

  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  res.json({ profile });
});

module.exports = router;
