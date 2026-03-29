/**
 * JWKS — RS256 Key Management for Unified Windy Identity
 *
 * Phase 4: Provides RSA-2048 key pair generation, JWKS endpoint support,
 * and key rotation. Falls back to HS256 if no private key is configured.
 *
 * Environment variables:
 *   JWT_PRIVATE_KEY_PATH — path to PEM-encoded RSA private key
 *   JWT_PUBLIC_KEY_PATH  — optional, derived from private key if not set
 *   JWKS_KEY_DIR         — directory for key rotation (stores multiple keys)
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════
//  KEY TYPES
// ═══════════════════════════════════════════

export interface JWK {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;   // modulus (base64url)
  e: string;   // exponent (base64url)
}

export interface JWKSDocument {
  keys: JWK[];
}

interface ManagedKey {
  kid: string;
  privateKey: string;   // PEM
  publicKey: string;     // PEM
  createdAt: string;
  expiresAt?: string;    // Keys remain in JWKS until this time
}

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════

let managedKeys: ManagedKey[] = [];
let activeKid: string | null = null;
let rs256Available = false;

// ═══════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════

/**
 * Initialize RS256 key management. Call once at startup.
 *
 * Returns true if RS256 is available, false if falling back to HS256.
 */
export function initializeJWKS(): boolean {
  const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH;
  const keyDir = process.env.JWKS_KEY_DIR;

  // Strategy 1: Single key file (simple deployment)
  if (privateKeyPath) {
    try {
      const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8');
      const publicKeyPem = derivePublicKey(privateKeyPem);
      const kid = generateKid(publicKeyPem);

      managedKeys = [{
        kid,
        privateKey: privateKeyPem,
        publicKey: publicKeyPem,
        createdAt: new Date().toISOString(),
      }];
      activeKid = kid;
      rs256Available = true;

      console.log(`[jwks] RS256 initialized from ${privateKeyPath} (kid: ${kid.slice(0, 8)}...)`);
      return true;
    } catch (err: any) {
      console.error(`[jwks] Failed to load private key from ${privateKeyPath}:`, err.message);
      rs256Available = false;
      return false;
    }
  }

  // Strategy 2: Key directory (rotation support)
  if (keyDir) {
    try {
      if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true });
      }

      const keyFiles = fs.readdirSync(keyDir)
        .filter(f => f.endsWith('.json'))
        .sort(); // Lexicographic — newest last by convention

      if (keyFiles.length === 0) {
        // Generate initial key pair
        console.log('[jwks] No keys found in key directory, generating initial key pair...');
        const key = generateKeyPair();
        saveKeyToDir(keyDir, key);
        managedKeys = [key];
        activeKid = key.kid;
      } else {
        managedKeys = keyFiles.map(f => {
          const data = JSON.parse(fs.readFileSync(path.join(keyDir, f), 'utf-8'));
          return data as ManagedKey;
        });

        // Filter out expired keys (but keep them in JWKS for token verification)
        const now = new Date();
        const validKeys = managedKeys.filter(k => !k.expiresAt || new Date(k.expiresAt) > now);

        // Active key is the newest valid key
        activeKid = validKeys.length > 0
          ? validKeys[validKeys.length - 1].kid
          : managedKeys[managedKeys.length - 1].kid;
      }

      rs256Available = managedKeys.length > 0;
      console.log(`[jwks] RS256 initialized from ${keyDir} (${managedKeys.length} keys, active: ${activeKid?.slice(0, 8)}...)`);
      return rs256Available;
    } catch (err: any) {
      console.error(`[jwks] Failed to initialize from key directory ${keyDir}:`, err.message);
      rs256Available = false;
      return false;
    }
  }

  // No RS256 configuration — HS256 fallback
  console.log('[jwks] No RS256 key configured — using HS256 fallback');
  rs256Available = false;
  return false;
}

// ═══════════════════════════════════════════
//  KEY ACCESS
// ═══════════════════════════════════════════

/**
 * Check if RS256 signing is available.
 */
export function isRS256Available(): boolean {
  return rs256Available;
}

/**
 * Get the active private key for signing JWTs.
 * Returns null if RS256 is not configured.
 */
export function getSigningKey(): { privateKey: string; kid: string; algorithm: 'RS256' } | null {
  if (!rs256Available || !activeKid) return null;

  const key = managedKeys.find(k => k.kid === activeKid);
  if (!key) return null;

  return {
    privateKey: key.privateKey,
    kid: key.kid,
    algorithm: 'RS256',
  };
}

/**
 * Get all public keys for verification. Includes rotated keys
 * that may still have valid tokens outstanding.
 */
export function getVerificationKeys(): { publicKey: string; kid: string }[] {
  return managedKeys.map(k => ({
    publicKey: k.publicKey,
    kid: k.kid,
  }));
}

/**
 * Get the public key for a specific kid.
 */
export function getPublicKeyByKid(kid: string): string | null {
  const key = managedKeys.find(k => k.kid === kid);
  return key?.publicKey ?? null;
}

// ═══════════════════════════════════════════
//  JWKS DOCUMENT
// ═══════════════════════════════════════════

/**
 * Build the JWKS document for /.well-known/jwks.json
 */
export function getJWKSDocument(): JWKSDocument {
  const keys: JWK[] = managedKeys.map(k => pemToJWK(k.publicKey, k.kid));
  return { keys };
}

// ═══════════════════════════════════════════
//  KEY ROTATION
// ═══════════════════════════════════════════

/**
 * Rotate keys: generate a new key pair and mark the old one for expiry.
 * Old keys remain in JWKS for `gracePeriodMs` (default: 30 minutes)
 * to allow outstanding tokens to be verified.
 *
 * Only works with JWKS_KEY_DIR strategy.
 */
export function rotateKeys(gracePeriodMs: number = 30 * 60 * 1000): { newKid: string } | null {
  const keyDir = process.env.JWKS_KEY_DIR;
  if (!keyDir) {
    console.warn('[jwks] Key rotation requires JWKS_KEY_DIR');
    return null;
  }

  // Mark current active key for expiry
  const currentKey = managedKeys.find(k => k.kid === activeKid);
  if (currentKey) {
    currentKey.expiresAt = new Date(Date.now() + gracePeriodMs).toISOString();
    // Persist expiry
    const filename = `key-${currentKey.kid}.json`;
    const filePath = path.join(keyDir, filename);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(currentKey, null, 2));
    }
  }

  // Generate new key
  const newKey = generateKeyPair();
  saveKeyToDir(keyDir, newKey);
  managedKeys.push(newKey);
  activeKid = newKey.kid;

  console.log(`[jwks] Key rotated. New active kid: ${newKey.kid.slice(0, 8)}... (${managedKeys.length} total keys)`);

  return { newKid: newKey.kid };
}

/**
 * Prune expired keys from the managed set and from disk.
 * Call periodically to clean up old keys.
 */
export function pruneExpiredKeys(): number {
  const keyDir = process.env.JWKS_KEY_DIR;
  const now = new Date();
  let pruned = 0;

  managedKeys = managedKeys.filter(k => {
    if (k.expiresAt && new Date(k.expiresAt) < now && k.kid !== activeKid) {
      // Remove from disk
      if (keyDir) {
        const filename = `key-${k.kid}.json`;
        const filePath = path.join(keyDir, filename);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
      pruned++;
      return false;
    }
    return true;
  });

  if (pruned > 0) {
    console.log(`[jwks] Pruned ${pruned} expired key(s)`);
  }

  return pruned;
}

// ═══════════════════════════════════════════
//  KEY GENERATION UTILITIES
// ═══════════════════════════════════════════

/**
 * Generate an RSA-2048 key pair.
 */
export function generateKeyPair(): ManagedKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const kid = generateKid(publicKey);

  return {
    kid,
    privateKey,
    publicKey,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate a standalone key pair and write to files.
 * Useful as a CLI script for initial key setup.
 */
export function generateKeyFiles(outputDir: string): { privateKeyPath: string; publicKeyPath: string; kid: string } {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const keyPair = generateKeyPair();
  const privateKeyPath = path.join(outputDir, 'jwt-private.pem');
  const publicKeyPath = path.join(outputDir, 'jwt-public.pem');

  fs.writeFileSync(privateKeyPath, keyPair.privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, keyPair.publicKey, { mode: 0o644 });

  console.log(`[jwks] Generated RSA-2048 key pair:`);
  console.log(`       Private: ${privateKeyPath} (mode 0600)`);
  console.log(`       Public:  ${publicKeyPath} (mode 0644)`);
  console.log(`       KID:     ${keyPair.kid}`);

  return { privateKeyPath, publicKeyPath, kid: keyPair.kid };
}

// ═══════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════

function derivePublicKey(privateKeyPem: string): string {
  const keyObject = crypto.createPublicKey(privateKeyPem);
  return keyObject.export({ type: 'spki', format: 'pem' }) as string;
}

function generateKid(publicKeyPem: string): string {
  // kid = first 16 chars of SHA-256 of the public key DER
  const keyObject = crypto.createPublicKey(publicKeyPem);
  const der = keyObject.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

function saveKeyToDir(keyDir: string, key: ManagedKey): void {
  const filename = `key-${key.kid}.json`;
  const filePath = path.join(keyDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(key, null, 2), { mode: 0o600 });
}

/**
 * Convert a PEM public key to JWK format.
 */
function pemToJWK(publicKeyPem: string, kid: string): JWK {
  const keyObject = crypto.createPublicKey(publicKeyPem);
  const jwk = keyObject.export({ format: 'jwk' }) as any;

  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid,
    n: jwk.n,
    e: jwk.e,
  };
}
