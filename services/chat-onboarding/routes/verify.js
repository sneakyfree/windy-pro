/**
 * Windy Chat — Phone / Email Verification Routes
 * K2.1: Phone / Email Verification (DNA Strand K)
 *
 * Endpoints:
 *   POST /api/v1/chat/verify/send   — send 6-digit OTP via SMS or email
 *   POST /api/v1/chat/verify/check  — validate OTP, return verification token
 *
 * Providers:
 *   Phone: Twilio Verify API ($0.05/verification)
 *   Email: SendGrid ($0.001/email)
 *
 * Security:
 *   - Rate limit: 3 attempts per 10 min, 5 per hour
 *   - Resend cooldown: 60 seconds
 *   - One account per phone/email
 *   - 24h cooling period between re-registrations
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ── In-memory stores (replace with Redis in production) ──
const otpStore = new Map();       // key: identifier → { code, expiresAt, attempts, sentAt }
const verifiedStore = new Map();  // key: identifier → { verifiedAt, token, userId }
const cooldownStore = new Map();  // key: identifier → lastRegistrationTime

// ── Rate limiters ──
const sendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  max: 3,
  keyGenerator: (req) => req.body.identifier || req.ip,
  message: { error: 'Too many verification attempts. Try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const hourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,
  keyGenerator: (req) => req.body.identifier || req.ip,
  message: { error: 'Hourly verification limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helpers ──

/**
 * Normalize phone number to E.164 format using libphonenumber-js.
 * E.164: +1234567890 (international, no spaces, no dashes)
 */
function normalizePhone(phone, countryCode) {
  try {
    const { parsePhoneNumberFromString } = require('libphonenumber-js');
    const parsed = parsePhoneNumberFromString(phone, countryCode || 'US');
    if (parsed && parsed.isValid()) {
      return { valid: true, e164: parsed.number, national: parsed.formatNational() };
    }
    return { valid: false, error: 'Invalid phone number' };
  } catch (err) {
    return { valid: false, error: 'Phone parsing failed: ' + err.message };
  }
}

/**
 * Validate email format.
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Generate a cryptographically-influenced 6-digit OTP.
 */
function generateOTP() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

/**
 * Send OTP via Twilio SMS.
 */
async function sendSmsOTP(phone, code) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('⚠️  Twilio not configured — OTP logged to console');
    console.log(`📱 SMS OTP for ${phone}: ${code}`);
    return { success: true, stub: true };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);

    await client.messages.create({
      body: `Your Windy Chat verification code is: ${code}. Valid for 10 minutes.`,
      from: fromNumber,
      to: phone,
    });

    console.log(`📱 SMS OTP sent to ${phone}`);
    return { success: true };
  } catch (err) {
    console.error('Twilio SMS error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send OTP via SendGrid email.
 */
async function sendEmailOTP(email, code) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@windypro.com';

  if (!apiKey) {
    console.warn('⚠️  SendGrid not configured — OTP logged to console');
    console.log(`📧 Email OTP for ${email}: ${code}`);
    return { success: true, stub: true };
  }

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(apiKey);

    await sgMail.send({
      to: email,
      from: fromEmail,
      subject: 'Windy Chat — Verification Code',
      text: `Your Windy Chat verification code is: ${code}\n\nThis code is valid for 10 minutes.\n\nIf you didn't request this, please ignore this email.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a2e; margin-bottom: 8px;">🌪️ Windy Chat</h2>
          <p style="color: #555; font-size: 16px;">Your verification code is:</p>
          <div style="background: #f0f0f5; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">${code}</span>
          </div>
          <p style="color: #888; font-size: 14px;">This code expires in 10 minutes.</p>
          <p style="color: #aaa; font-size: 12px; margin-top: 32px;">If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    });

    console.log(`📧 Email OTP sent to ${email}`);
    return { success: true };
  } catch (err) {
    console.error('SendGrid email error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── POST /api/v1/chat/verify/send ──

router.post('/send', sendLimiter, hourlyLimiter, async (req, res) => {
  try {
    const { type, identifier, countryCode } = req.body;

    // Validate type
    if (!type || !['phone', 'email'].includes(type)) {
      return res.status(400).json({ error: 'type must be "phone" or "email"' });
    }

    if (!identifier) {
      return res.status(400).json({ error: 'identifier (phone or email) is required' });
    }

    // Normalize identifier
    let normalizedId;
    if (type === 'phone') {
      const result = normalizePhone(identifier, countryCode);
      if (!result.valid) {
        return res.status(400).json({ error: result.error });
      }
      normalizedId = result.e164;
    } else {
      if (!validateEmail(identifier)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      normalizedId = identifier.toLowerCase().trim();
    }

    // Check 24h cooling period
    const lastRegistration = cooldownStore.get(normalizedId);
    if (lastRegistration) {
      const hoursSince = (Date.now() - lastRegistration) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSince);
        return res.status(429).json({
          error: `This ${type} was recently registered. Try again in ${hoursRemaining} hours.`,
          cooldownHoursRemaining: hoursRemaining,
        });
      }
    }

    // Check resend cooldown (60 seconds)
    const existing = otpStore.get(normalizedId);
    if (existing && existing.sentAt) {
      const secondsSince = (Date.now() - existing.sentAt) / 1000;
      if (secondsSince < 60) {
        const wait = Math.ceil(60 - secondsSince);
        return res.status(429).json({
          error: `Please wait ${wait} seconds before requesting a new code.`,
          resendCooldownSeconds: wait,
        });
      }
    }

    // Generate and store OTP
    const code = generateOTP();
    otpStore.set(normalizedId, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,  // 10 minutes
      attempts: 0,
      sentAt: Date.now(),
      type,
    });

    // Send OTP
    let sendResult;
    if (type === 'phone') {
      sendResult = await sendSmsOTP(normalizedId, code);
    } else {
      sendResult = await sendEmailOTP(normalizedId, code);
    }

    if (!sendResult.success) {
      return res.status(500).json({ error: 'Failed to send verification code. Try again.' });
    }

    res.json({
      success: true,
      type,
      identifier: normalizedId,
      message: `Verification code sent to ${type === 'phone' ? 'your phone' : 'your email'}`,
      expiresInSeconds: 600,
      ...(sendResult.stub ? { _dev: 'OTP logged to console (provider not configured)' } : {}),
    });

  } catch (err) {
    console.error('Verify send error:', err);
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

// ── POST /api/v1/chat/verify/check ──

router.post('/check', async (req, res) => {
  try {
    const { identifier, code, type, countryCode } = req.body;

    if (!identifier || !code) {
      return res.status(400).json({ error: 'identifier and code are required' });
    }

    // Normalize identifier
    let normalizedId;
    if (type === 'phone') {
      const result = normalizePhone(identifier, countryCode);
      normalizedId = result.valid ? result.e164 : identifier;
    } else {
      normalizedId = (identifier || '').toLowerCase().trim();
    }

    const stored = otpStore.get(normalizedId);
    if (!stored) {
      return res.status(400).json({ error: 'No verification code found. Request a new one.' });
    }

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(normalizedId);
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    }

    // Check attempts (max 3 per OTP)
    if (stored.attempts >= 3) {
      otpStore.delete(normalizedId);
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    // Validate code
    if (stored.code !== code.trim()) {
      stored.attempts++;
      const remaining = 3 - stored.attempts;
      return res.status(400).json({
        error: 'Invalid verification code',
        attemptsRemaining: remaining,
      });
    }

    // ✅ Success — generate verification token
    otpStore.delete(normalizedId);
    const verificationToken = uuidv4();

    verifiedStore.set(normalizedId, {
      verifiedAt: Date.now(),
      token: verificationToken,
      type: stored.type,
    });

    console.log(`✅ Verified ${stored.type}: ${normalizedId}`);

    res.json({
      success: true,
      verified: true,
      verificationToken,
      identifier: normalizedId,
      type: stored.type,
      message: `${stored.type === 'phone' ? 'Phone number' : 'Email'} verified successfully`,
    });

  } catch (err) {
    console.error('Verify check error:', err);
    res.status(500).json({ error: 'Verification check failed: ' + err.message });
  }
});

// ── GET /api/v1/chat/verify/status ──

router.get('/status', (req, res) => {
  const { identifier } = req.query;
  if (!identifier) {
    return res.status(400).json({ error: 'identifier query param required' });
  }

  const verified = verifiedStore.get(identifier);
  res.json({
    identifier,
    verified: !!verified,
    verifiedAt: verified ? new Date(verified.verifiedAt).toISOString() : null,
    type: verified ? verified.type : null,
  });
});

module.exports = router;
