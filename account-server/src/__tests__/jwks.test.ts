/**
 * Tests for JWKS — RS256 key management, JWKS document, key rotation.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import jwt from 'jsonwebtoken';
import {
  generateKeyPair,
  generateKeyFiles,
  getJWKSDocument,
  initializeJWKS,
  isRS256Available,
  getSigningKey,
  getVerificationKeys,
  getPublicKeyByKid,
  rotateKeys,
  pruneExpiredKeys,
} from '../jwks';

describe('JWKS Key Management', () => {
  const tmpDir = path.join(os.tmpdir(), `jwks-test-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateKeyPair', () => {
    it('should generate a valid RSA-2048 key pair', () => {
      const key = generateKeyPair();

      expect(key.kid).toBeDefined();
      expect(key.kid.length).toBe(16);
      expect(key.privateKey).toContain('BEGIN PRIVATE KEY');
      expect(key.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(key.createdAt).toBeDefined();
    });

    it('should generate unique key IDs', () => {
      const key1 = generateKeyPair();
      const key2 = generateKeyPair();
      expect(key1.kid).not.toBe(key2.kid);
    });
  });

  describe('generateKeyFiles', () => {
    it('should write key files to disk', () => {
      const outDir = path.join(tmpDir, 'keyfiles');
      const result = generateKeyFiles(outDir);

      expect(fs.existsSync(result.privateKeyPath)).toBe(true);
      expect(fs.existsSync(result.publicKeyPath)).toBe(true);
      expect(result.kid).toBeDefined();

      const privateKey = fs.readFileSync(result.privateKeyPath, 'utf-8');
      expect(privateKey).toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('initializeJWKS with key directory', () => {
    it('should auto-generate keys when directory is empty', () => {
      const keyDir = path.join(tmpDir, 'auto-gen');
      fs.mkdirSync(keyDir, { recursive: true });

      process.env.JWKS_KEY_DIR = keyDir;
      delete process.env.JWT_PRIVATE_KEY_PATH;

      const result = initializeJWKS();
      expect(result).toBe(true);
      expect(isRS256Available()).toBe(true);
      expect(getSigningKey()).not.toBeNull();

      delete process.env.JWKS_KEY_DIR;
    });

    it('should load keys from existing directory', () => {
      const keyDir = path.join(tmpDir, 'existing');
      fs.mkdirSync(keyDir, { recursive: true });

      const key = generateKeyPair();
      fs.writeFileSync(path.join(keyDir, `key-${key.kid}.json`), JSON.stringify(key));

      process.env.JWKS_KEY_DIR = keyDir;
      delete process.env.JWT_PRIVATE_KEY_PATH;

      const result = initializeJWKS();
      expect(result).toBe(true);
      expect(getSigningKey()!.kid).toBe(key.kid);

      delete process.env.JWKS_KEY_DIR;
    });
  });

  describe('initializeJWKS with private key file', () => {
    it('should load from JWT_PRIVATE_KEY_PATH', () => {
      const keyDir = path.join(tmpDir, 'single-key');
      const { privateKeyPath, kid } = generateKeyFiles(keyDir);

      process.env.JWT_PRIVATE_KEY_PATH = privateKeyPath;
      delete process.env.JWKS_KEY_DIR;

      const result = initializeJWKS();
      expect(result).toBe(true);
      expect(getSigningKey()!.kid).toBe(kid);

      delete process.env.JWT_PRIVATE_KEY_PATH;
    });
  });

  describe('HS256 fallback', () => {
    it('should return false when no RS256 config', () => {
      delete process.env.JWT_PRIVATE_KEY_PATH;
      delete process.env.JWKS_KEY_DIR;

      const result = initializeJWKS();
      expect(result).toBe(false);
      expect(isRS256Available()).toBe(false);
      expect(getSigningKey()).toBeNull();
    });
  });

  describe('getJWKSDocument', () => {
    it('should return a valid JWKS document', () => {
      const keyDir = path.join(tmpDir, 'jwks-doc');
      fs.mkdirSync(keyDir, { recursive: true });

      process.env.JWKS_KEY_DIR = keyDir;
      delete process.env.JWT_PRIVATE_KEY_PATH;
      initializeJWKS();

      const doc = getJWKSDocument();
      expect(doc.keys).toBeDefined();
      expect(doc.keys.length).toBeGreaterThan(0);

      const key = doc.keys[0];
      expect(key.kty).toBe('RSA');
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('RS256');
      expect(key.kid).toBeDefined();
      expect(key.n).toBeDefined();
      expect(key.e).toBeDefined();

      delete process.env.JWKS_KEY_DIR;
    });
  });

  describe('RS256 token signing and verification', () => {
    it('should sign and verify tokens with RS256', () => {
      const keyDir = path.join(tmpDir, 'sign-verify');
      fs.mkdirSync(keyDir, { recursive: true });

      process.env.JWKS_KEY_DIR = keyDir;
      delete process.env.JWT_PRIVATE_KEY_PATH;
      initializeJWKS();

      const signingKey = getSigningKey()!;
      expect(signingKey).not.toBeNull();

      // Sign a token
      const token = jwt.sign(
        { userId: 'test-123', email: 'test@example.com', iss: 'windy-identity' },
        signingKey.privateKey,
        { algorithm: 'RS256', expiresIn: '15m', keyid: signingKey.kid },
      );

      // Verify with public key
      const publicKey = getPublicKeyByKid(signingKey.kid)!;
      expect(publicKey).not.toBeNull();

      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as any;
      expect(decoded.userId).toBe('test-123');
      expect(decoded.email).toBe('test@example.com');

      delete process.env.JWKS_KEY_DIR;
    });
  });

  describe('key rotation', () => {
    it('should rotate keys and keep old key in JWKS', () => {
      const keyDir = path.join(tmpDir, 'rotation');
      fs.mkdirSync(keyDir, { recursive: true });

      process.env.JWKS_KEY_DIR = keyDir;
      delete process.env.JWT_PRIVATE_KEY_PATH;
      initializeJWKS();

      const oldKid = getSigningKey()!.kid;

      // Rotate
      const result = rotateKeys(1000); // 1 second grace period
      expect(result).not.toBeNull();
      expect(result!.newKid).not.toBe(oldKid);

      // New active key is different
      expect(getSigningKey()!.kid).toBe(result!.newKid);

      // Old key still in JWKS
      const doc = getJWKSDocument();
      expect(doc.keys.length).toBe(2);
      expect(doc.keys.some(k => k.kid === oldKid)).toBe(true);
      expect(doc.keys.some(k => k.kid === result!.newKid)).toBe(true);

      // Old key still verifiable
      expect(getPublicKeyByKid(oldKid)).not.toBeNull();

      delete process.env.JWKS_KEY_DIR;
    });
  });
});
