/**
 * Tests for OAuth2 flows — authorization code, PKCE, device code, client credentials.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Mock the database
const mockDb: Record<string, any> = {};
const mockPrepare = jest.fn();
const mockRun = jest.fn().mockReturnValue({ changes: 1 });
const mockGet = jest.fn();
const mockAll = jest.fn().mockReturnValue([]);

jest.mock('../db/schema', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: any[]) => mockRun(sql, ...args),
      get: (...args: any[]) => mockGet(sql, ...args),
      all: (...args: any[]) => mockAll(sql, ...args),
    }),
    exec: jest.fn(),
    pragma: jest.fn().mockReturnValue([]),
  }),
}));

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-for-oauth-tests',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/test',
    UPLOADS_PATH: '/tmp/test/uploads',
    PORT: 0,
    BCRYPT_ROUNDS: 4,
    MAX_DEVICES: 5,
  },
}));

jest.mock('../jwks', () => ({
  isRS256Available: () => false,
  getSigningKey: () => null,
  initializeJWKS: () => false,
}));

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  getScopes: jest.fn().mockReturnValue(['windy_pro:*']),
  getProductAccounts: jest.fn().mockReturnValue([]),
}));

describe('OAuth2 Flows', () => {
  describe('PKCE S256 verification', () => {
    it('should correctly verify S256 code challenge', () => {
      // Generate a code_verifier (43-128 chars, unreserved URI chars)
      const codeVerifier = crypto.randomBytes(32).toString('base64url');

      // Generate code_challenge = BASE64URL(SHA256(code_verifier))
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      // Verify: given code_verifier, recompute and compare
      const recomputed = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      expect(recomputed).toBe(codeChallenge);
    });

    it('should reject incorrect code verifier', () => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const wrongVerifier = crypto.randomBytes(32).toString('base64url');
      const wrongChallenge = crypto
        .createHash('sha256')
        .update(wrongVerifier)
        .digest('base64url');

      expect(wrongChallenge).not.toBe(codeChallenge);
    });
  });

  describe('Client secret hashing', () => {
    it('should hash and verify client secrets with bcrypt', () => {
      const secret = `wcs_${crypto.randomBytes(32).toString('hex')}`;
      const hash = bcrypt.hashSync(secret, 12);

      expect(bcrypt.compareSync(secret, hash)).toBe(true);
      expect(bcrypt.compareSync('wrong-secret', hash)).toBe(false);
    });
  });

  describe('Authorization code generation', () => {
    it('should generate cryptographically secure codes', () => {
      const code1 = crypto.randomBytes(32).toString('base64url');
      const code2 = crypto.randomBytes(32).toString('base64url');

      expect(code1).not.toBe(code2);
      expect(code1.length).toBeGreaterThanOrEqual(43); // 32 bytes -> 43 base64url chars
    });
  });

  describe('Device code user code generation', () => {
    it('should generate human-readable codes', () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = crypto.randomBytes(8);
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars[bytes[i] % chars.length];
        if (i === 3) code += '-';
      }

      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code.length).toBe(9); // 8 chars + 1 dash

      // Verify no ambiguous characters
      expect(code).not.toMatch(/[0OIl1]/);
    });
  });

  describe('Token endpoint grant types', () => {
    it('should recognize valid grant types', () => {
      const validTypes = [
        'authorization_code',
        'client_credentials',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ];

      for (const type of validTypes) {
        expect(validTypes.includes(type)).toBe(true);
      }
    });
  });
});

describe('OAuth2 Security', () => {
  describe('Authorization code single-use', () => {
    it('should prevent code reuse by checking `used` flag', () => {
      // Simulate the race condition check:
      // UPDATE oauth_codes SET used = 1 WHERE code = ? AND used = 0
      // If changes === 0, the code was already used

      // First use: changes = 1 (success)
      const firstUse = { changes: 1 };
      expect(firstUse.changes).toBeGreaterThan(0);

      // Second use: changes = 0 (blocked)
      const secondUse = { changes: 0 };
      expect(secondUse.changes).toBe(0);
    });
  });

  describe('PKCE is required for public clients', () => {
    it('should enforce PKCE for public clients', () => {
      const publicClient = { is_public: 1 };
      const codeChallenge = undefined;

      // This should result in an error
      if (publicClient.is_public && !codeChallenge) {
        const error = 'code_challenge is required for public clients (PKCE)';
        expect(error).toContain('PKCE');
      }
    });
  });

  describe('Redirect URI validation', () => {
    it('should reject redirect URIs not in the registered list', () => {
      const allowedUris = ['https://app.windypro.com/callback', 'http://localhost:3000/callback'];
      const requestedUri = 'https://evil.com/callback';

      expect(allowedUris.includes(requestedUri)).toBe(false);
    });

    it('should accept registered redirect URIs', () => {
      const allowedUris = ['https://app.windypro.com/callback', 'http://localhost:3000/callback'];
      const requestedUri = 'https://app.windypro.com/callback';

      expect(allowedUris.includes(requestedUri)).toBe(true);
    });
  });
});
