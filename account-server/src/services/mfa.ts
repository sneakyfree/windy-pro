/**
 * MFA / TOTP service — secret generation, AES-256-GCM at-rest encryption,
 * TOTP verification, backup codes.
 *
 * Storage layout (mfa_secrets table):
 *   - totp_secret_encrypted: AES-256-GCM ciphertext of the base32 secret
 *   - totp_secret_iv:       12-byte IV (hex)
 *   - totp_secret_tag:      16-byte GCM auth tag (hex)
 *   - backup_codes_hash:    JSON array of bcrypt hashes (empty string = consumed)
 *   - enabled_at:           NULL until verify-setup confirms; ISO timestamp once active
 *
 * Encryption key:
 *   MFA_ENCRYPTION_KEY env var (32 bytes hex = 64 chars). If unset, we derive
 *   a key from JWT_SECRET via SHA-256 and warn loudly. Production MUST set
 *   MFA_ENCRYPTION_KEY explicitly so rotating JWT_SECRET doesn't invalidate
 *   every user's MFA secret.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';

// speakeasy defaults: 6-digit codes, 30s step, SHA-1 — matches Google
// Authenticator / Authy / 1Password / standard RFC 6238.
const TOTP_WINDOW = 1; // accept prior + current + next 30s window — covers ±30s clock skew

const KEY_WARNED = { value: false };

function getEncryptionKey(): Buffer {
  const explicit = process.env.MFA_ENCRYPTION_KEY;
  if (explicit && /^[0-9a-fA-F]{64}$/.test(explicit)) {
    return Buffer.from(explicit, 'hex');
  }
  // Wave 7 P1-1: hard-fail in production. The derived-from-JWT_SECRET
  // fallback is fine for dev/test but catastrophic in prod — rotating
  // JWT_SECRET would brick every enrolled user's MFA because their
  // TOTP secrets are encrypted under a key tied to the old JWT_SECRET.
  // A warn alone is not enough: operators miss warnings, and by the time
  // anyone notices, the only recovery is mass MFA re-enrollment.
  if (process.env.NODE_ENV === 'production') {
    if (explicit) {
      throw new Error(
        '❌ MFA_ENCRYPTION_KEY is set but not a valid 32-byte hex string (64 chars). ' +
        'Generate with: openssl rand -hex 32',
      );
    }
    throw new Error(
      '❌ MFA_ENCRYPTION_KEY is required in production. ' +
      'Without it, MFA secrets would be encrypted with a key derived from JWT_SECRET, ' +
      'which means rotating JWT_SECRET bricks every enrolled user. ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  // Dev/test fallback — logged once per process so noisy startup is bounded.
  if (!KEY_WARNED.value && process.env.NODE_ENV !== 'test') {
    console.warn('[mfa] MFA_ENCRYPTION_KEY unset — deriving from JWT_SECRET. Set MFA_ENCRYPTION_KEY in production (32-byte hex).');
    KEY_WARNED.value = true;
  }
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || 'dev-secret').digest();
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ct.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptSecret(enc: EncryptedSecret): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(enc.iv, 'hex');
  const tag = Buffer.from(enc.tag, 'hex');
  const ct = Buffer.from(enc.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// ─── TOTP ─────────────────────────────────────────────────────

export function generateTotpSecret(): string {
  // 20 bytes = 160 bits, base32-encoded — matches RFC 6238 recommendation
  // and is the size Google Authenticator / Authy expect.
  return speakeasy.generateSecret({ length: 20 }).base32;
}

export function buildOtpauthUri(args: {
  secret: string;
  accountLabel: string;     // typically the user's email
  issuer?: string;
}): string {
  const issuer = args.issuer || 'Windy';
  return speakeasy.otpauthURL({
    secret: args.secret,
    label: `${issuer}:${args.accountLabel}`,
    issuer,
    encoding: 'base32',
  });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  // Strip whitespace; some authenticators include a space in the middle.
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: normalized,
      window: TOTP_WINDOW,
    });
  } catch {
    return false;
  }
}

/**
 * Test helper: generate the current TOTP code for a base32 secret.
 * Used in PR3 tests to simulate an authenticator app without real time wait.
 */
export function generateTotpCodeForTest(secret: string): string {
  return speakeasy.totp({ secret, encoding: 'base32' });
}

// ─── Backup codes ─────────────────────────────────────────────

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit 0/O/1/I to reduce read errors

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    const bytes = crypto.randomBytes(8);
    for (const b of bytes) raw += BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length];
    // Format as XXXX-XXXX for readability
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c.toUpperCase(), 8)));
}

/**
 * Verify a candidate backup code against the stored hash array. Returns the
 * INDEX of the matching code (so the caller can mark it consumed by setting
 * the slot to ''), or -1 if no match.
 */
export async function consumeBackupCode(
  candidate: string,
  hashes: string[],
): Promise<number> {
  const normalized = candidate.replace(/\s+/g, '').toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (!hashes[i]) continue; // already consumed
    if (await bcrypt.compare(normalized, hashes[i])) return i;
  }
  return -1;
}
