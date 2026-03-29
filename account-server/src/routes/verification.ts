/**
 * Verification routes — Identity-level OTP verification (Phase 1)
 *
 * Promotes the chat-onboarding OTP verification (Twilio SMS + SendGrid email)
 * to a shared identity-level service that any product can use.
 *
 * Endpoints:
 *   POST /api/v1/identity/verify/send   — Send 6-digit OTP via SMS or email
 *   POST /api/v1/identity/verify/check  — Validate OTP, mark identity as verified
 *   GET  /api/v1/identity/verify/status — Check verification status
 *
 * Security:
 *   - Rate limited: 5/min, 10/hour per identifier
 *   - Resend cooldown: 60 seconds
 *   - Max 3 attempts per OTP
 *   - 10 minute OTP expiry
 *   - Cryptographically secure OTP generation (crypto.randomInt)
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { getDb } from '../db/schema';
import { logAuditEvent } from '../identity-service';
import {
  VerificationSendSchema,
  VerificationCheckSchema,
} from '@windy-pro/contracts';

const router = Router();

// ─── In-memory OTP store (replace with Redis in production) ──
// Structure: identifier → { code, expiresAt, attempts, sentAt, type }
const otpStore = new Map<string, {
  code: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  type: 'phone' | 'email';
}>();

// Periodic cleanup of expired OTPs (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore) {
    if (now > value.expiresAt) otpStore.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Rate limiters ──

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.body as any)?.identifier || req.ip || 'unknown',
  message: { error: 'Too many verification attempts. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const hourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.body as any)?.identifier || req.ip || 'unknown',
  message: { error: 'Hourly verification limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Helpers ──

function normalizePhone(phone: string, countryCode?: string): { valid: boolean; e164?: string; error?: string } {
  try {
    const { parsePhoneNumberFromString } = require('libphonenumber-js');
    const parsed = parsePhoneNumberFromString(phone, countryCode || 'US');
    if (parsed && parsed.isValid()) {
      return { valid: true, e164: parsed.number };
    }
    return { valid: false, error: 'Invalid phone number' };
  } catch {
    // libphonenumber-js may not be installed — basic E.164 validation
    if (/^\+[1-9]\d{1,14}$/.test(phone)) {
      return { valid: true, e164: phone };
    }
    return { valid: false, error: 'Invalid phone number format (expected E.164)' };
  }
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOTP(): string {
  return String(crypto.randomInt(100000, 999999));
}

async function sendSmsOTP(phone: string, code: string): Promise<{ success: boolean; stub?: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    // SEC-C6: Never log OTP codes or full phone numbers
    console.log(`[verification] SMS OTP sent to ***${phone.slice(-4)} (dev stub)`);
    return { success: true, stub: true };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body: `Your Windy verification code is: ${code}. Valid for 10 minutes.`,
      from: fromNumber,
      to: phone,
    });
    console.log(`[verification] SMS OTP sent to ***${phone.slice(-4)}`);
    return { success: true };
  } catch (err: any) {
    console.error('[verification] Twilio SMS error:', err.message);
    return { success: false, error: 'SMS delivery failed' };
  }
}

async function sendEmailOTP(email: string, code: string): Promise<{ success: boolean; stub?: boolean; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@windypro.com';

  if (!apiKey) {
    const [user, domain] = email.split('@');
    console.log(`[verification] Email OTP sent to ${user[0]}***@${domain} (dev stub)`);
    return { success: true, stub: true };
  }

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(apiKey);
    await sgMail.send({
      to: email,
      from: fromEmail,
      subject: 'Windy — Verification Code',
      text: `Your Windy verification code is: ${code}\n\nThis code is valid for 10 minutes.\n\nIf you didn't request this, please ignore this email.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #1a1a2e; margin-bottom: 8px;">Windy</h2>
          <p style="color: #555; font-size: 16px;">Your verification code is:</p>
          <div style="background: #f0f0f5; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">${code}</span>
          </div>
          <p style="color: #888; font-size: 14px;">This code expires in 10 minutes.</p>
          <p style="color: #aaa; font-size: 12px; margin-top: 32px;">If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    });
    const [u, d] = email.split('@');
    console.log(`[verification] Email OTP sent to ${u[0]}***@${d}`);
    return { success: true };
  } catch (err: any) {
    console.error('[verification] SendGrid error:', err.message);
    return { success: false, error: 'Email delivery failed' };
  }
}

// ─── POST /api/v1/identity/verify/send ──

router.post('/send', authenticateToken, sendLimiter, hourlyLimiter, validate(VerificationSendSchema), async (req: Request, res: Response) => {
  try {
    const { type, identifier, countryCode } = req.body;
    const userId = (req as AuthRequest).user.userId;

    // Normalize identifier
    let normalizedId: string;
    if (type === 'phone') {
      if (identifier.length > 20) {
        return res.status(400).json({ error: 'Phone number must be 20 characters or fewer' });
      }
      const result = normalizePhone(identifier, countryCode);
      if (!result.valid) {
        return res.status(400).json({ error: result.error });
      }
      normalizedId = result.e164!;
    } else {
      if (!validateEmail(identifier)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      normalizedId = identifier.toLowerCase().trim();
    }

    // Check resend cooldown (60 seconds)
    const existing = otpStore.get(normalizedId);
    if (existing?.sentAt) {
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
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      sentAt: Date.now(),
      type,
    });

    // Send OTP
    const sendResult = type === 'phone'
      ? await sendSmsOTP(normalizedId, code)
      : await sendEmailOTP(normalizedId, code);

    if (!sendResult.success) {
      return res.status(500).json({ error: 'Failed to send verification code. Try again.' });
    }

    logAuditEvent('verification_send', userId, {
      type,
      identifierRedacted: type === 'phone' ? `***${normalizedId.slice(-4)}` : `${normalizedId[0]}***@${normalizedId.split('@')[1]}`,
    }, req.ip, req.get('user-agent'));

    res.json({
      success: true,
      type,
      identifier: normalizedId,
      message: `Verification code sent to ${type === 'phone' ? 'your phone' : 'your email'}`,
      expiresInSeconds: 600,
      ...(sendResult.stub ? { _dev: 'OTP logged to console (provider not configured)' } : {}),
    });
  } catch (err: any) {
    console.error('[verification] Send error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── POST /api/v1/identity/verify/check ──

router.post('/check', authenticateToken, validate(VerificationCheckSchema), async (req: Request, res: Response) => {
  try {
    const { identifier, code, type, countryCode } = req.body;
    const userId = (req as AuthRequest).user.userId;

    // Normalize identifier
    let normalizedId: string;
    if (type === 'phone') {
      const result = normalizePhone(identifier, countryCode);
      normalizedId = result.valid ? result.e164! : identifier;
    } else {
      normalizedId = (identifier || '').toLowerCase().trim();
    }

    const stored = otpStore.get(normalizedId);
    if (!stored) {
      return res.status(400).json({ error: 'No verification code found. Request a new one.' });
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(normalizedId);
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    }

    if (stored.attempts >= 3) {
      otpStore.delete(normalizedId);
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    if (stored.code !== code.trim()) {
      stored.attempts++;
      return res.status(400).json({
        error: 'Invalid verification code',
        attemptsRemaining: 3 - stored.attempts,
      });
    }

    // Success — update identity record
    otpStore.delete(normalizedId);
    const db = getDb();

    if (stored.type === 'email') {
      db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
      logAuditEvent('email_verify', userId, {
        identifierRedacted: `${normalizedId[0]}***@${normalizedId.split('@')[1]}`,
      }, req.ip, req.get('user-agent'));
    } else if (stored.type === 'phone') {
      db.prepare("UPDATE users SET phone = ?, phone_verified = 1, updated_at = datetime('now') WHERE id = ?").run(normalizedId, userId);
      logAuditEvent('phone_verify', userId, {
        identifierRedacted: `***${normalizedId.slice(-4)}`,
      }, req.ip, req.get('user-agent'));
    }

    // Generate verification token (for downstream use by chat provisioning, etc.)
    const verificationToken = crypto.randomUUID();

    res.json({
      success: true,
      verified: true,
      verificationToken,
      identifier: normalizedId,
      type: stored.type,
      message: `${stored.type === 'phone' ? 'Phone number' : 'Email'} verified successfully`,
    });
  } catch (err: any) {
    console.error('[verification] Check error:', err);
    res.status(500).json({ error: 'Verification check failed' });
  }
});

// ─── GET /api/v1/identity/verify/status ──

router.get('/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const user = db.prepare(
      'SELECT email, email_verified, phone, phone_verified FROM users WHERE id = ?',
    ).get(userId) as any;

    if (!user) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    res.json({
      email: user.email,
      emailVerified: !!user.email_verified,
      phone: user.phone || null,
      phoneVerified: !!user.phone_verified,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to check verification status' });
  }
});

export default router;
