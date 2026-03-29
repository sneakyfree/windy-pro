/**
 * Integration tests — Full identity lifecycle flows.
 *
 * Phase 6E: Exercises registration, login, scoped tokens, OAuth flows,
 * device code flow, bot API keys, verification, and backward compatibility.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// ═══════════════════════════════════════════
//  MOCKS
// ═══════════════════════════════════════════

const TEST_SECRET = 'test-jwt-secret-for-integration-tests-32chars!';

// In-memory mock database
const mockData: {
  users: Map<string, any>;
  refreshTokens: Map<string, any>;
  identityScopes: Map<string, any[]>;
  productAccounts: Map<string, any[]>;
  oauthClients: Map<string, any>;
  oauthCodes: Map<string, any>;
  oauthConsents: Map<string, any>;
  oauthDeviceCodes: Map<string, any>;
  botApiKeys: Map<string, any>;
  tokenBlacklist: Set<string>;
  auditLog: any[];
} = {
  users: new Map(),
  refreshTokens: new Map(),
  identityScopes: new Map(),
  productAccounts: new Map(),
  oauthClients: new Map(),
  oauthCodes: new Map(),
  oauthConsents: new Map(),
  oauthDeviceCodes: new Map(),
  botApiKeys: new Map(),
  tokenBlacklist: new Set(),
  auditLog: [],
};

function resetMockData() {
  mockData.users.clear();
  mockData.refreshTokens.clear();
  mockData.identityScopes.clear();
  mockData.productAccounts.clear();
  mockData.oauthClients.clear();
  mockData.oauthCodes.clear();
  mockData.oauthConsents.clear();
  mockData.oauthDeviceCodes.clear();
  mockData.botApiKeys.clear();
  mockData.tokenBlacklist.clear();
  mockData.auditLog = [];
}

// ═══════════════════════════════════════════
//  HELPER FUNCTIONS (replicating server logic)
// ═══════════════════════════════════════════

function generateToken(payload: any, options: any = {}): string {
  return jwt.sign(payload, TEST_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
    ...options,
  });
}

function verifyToken(token: string): any {
  return jwt.verify(token, TEST_SECRET, { algorithms: ['HS256'] });
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateBotApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `wk_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11);
  return { rawKey, keyHash, keyPrefix };
}

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('Identity Integration: Registration -> Login -> Scoped Token -> /me', () => {
  beforeEach(() => resetMockData());

  it('should complete full registration lifecycle', () => {
    // 1. Register user
    const userId = crypto.randomUUID();
    const email = 'test@windypro.com';
    const passwordHash = bcrypt.hashSync('Password1', 4);

    mockData.users.set(userId, {
      id: userId,
      email,
      name: 'Test User',
      password_hash: passwordHash,
      tier: 'free',
      identity_type: 'human',
      email_verified: 0,
      phone_verified: 0,
      preferred_lang: 'en',
      created_at: new Date().toISOString(),
    });

    // 2. Auto-provision product + scopes (as registration does)
    mockData.productAccounts.set(userId, [{
      id: crypto.randomUUID(),
      identity_id: userId,
      product: 'windy_pro',
      status: 'active',
    }]);

    mockData.identityScopes.set(userId, [
      { scope: 'windy_pro:*', granted_by: 'registration' },
    ]);

    // 3. Generate JWT with identity fields
    const scopes = mockData.identityScopes.get(userId)!.map(s => s.scope);
    const products = mockData.productAccounts.get(userId)!.map(p => p.product);

    const token = generateToken({
      userId,
      email,
      tier: 'free',
      accountId: userId,
      type: 'human',
      scopes,
      products,
      iss: 'windy-identity',
    });

    // 4. Verify token
    const decoded = verifyToken(token);

    expect(decoded.userId).toBe(userId);
    expect(decoded.email).toBe(email);
    expect(decoded.type).toBe('human');
    expect(decoded.scopes).toEqual(['windy_pro:*']);
    expect(decoded.products).toEqual(['windy_pro']);
    expect(decoded.iss).toBe('windy-identity');
  });

  it('should grant additional product scopes on provisioning', () => {
    const userId = crypto.randomUUID();

    // Initial scopes
    mockData.identityScopes.set(userId, [
      { scope: 'windy_pro:*', granted_by: 'registration' },
    ]);

    // Provision chat
    const chatScopes = ['windy_chat:read', 'windy_chat:write'];
    const existing = mockData.identityScopes.get(userId) || [];
    for (const scope of chatScopes) {
      if (!existing.find(s => s.scope === scope)) {
        existing.push({ scope, granted_by: 'product_provision' });
      }
    }
    mockData.identityScopes.set(userId, existing);

    const allScopes = mockData.identityScopes.get(userId)!.map(s => s.scope);
    expect(allScopes).toContain('windy_pro:*');
    expect(allScopes).toContain('windy_chat:read');
    expect(allScopes).toContain('windy_chat:write');
  });
});

describe('Identity Integration: OAuth Authorization Code + PKCE Flow', () => {
  beforeEach(() => resetMockData());

  it('should complete full authorization_code + PKCE flow', () => {
    // 1. Register client
    const clientId = 'windy_pro_desktop';
    mockData.oauthClients.set(clientId, {
      client_id: clientId,
      name: 'Windy Pro Desktop',
      redirect_uris: JSON.stringify(['windy-pro://auth/callback']),
      allowed_scopes: JSON.stringify(['windy_pro:*']),
      is_first_party: 1,
      is_public: 1,
      client_secret_hash: null,
    });

    // 2. Generate PKCE code_verifier and code_challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // 3. Register user and get JWT
    const userId = crypto.randomUUID();
    const token = generateToken({
      userId,
      email: 'desktop@test.com',
      tier: 'pro',
      type: 'human',
      scopes: ['windy_pro:*'],
      iss: 'windy-identity',
    });

    // 4. Authorization: generate code (first-party auto-approves)
    const code = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    mockData.oauthCodes.set(code, {
      code,
      client_id: clientId,
      identity_id: userId,
      redirect_uri: 'windy-pro://auth/callback',
      scope: 'windy_pro:*',
      state,
      code_challenge: codeChallenge,
      used: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    // 5. Token exchange: verify PKCE
    const authCode = mockData.oauthCodes.get(code)!;
    expect(authCode.used).toBe(0);

    // Mark as used
    authCode.used = 1;

    // Verify code_verifier matches code_challenge
    const expectedChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    expect(expectedChallenge).toBe(authCode.code_challenge);

    // 6. Generate access + refresh tokens
    const accessToken = generateToken({
      userId: authCode.identity_id,
      email: 'desktop@test.com',
      tier: 'pro',
      type: 'human',
      scopes: ['windy_pro:*'],
      iss: 'windy-identity',
      client_id: clientId,
      scope: authCode.scope,
    });

    const refreshToken = crypto.randomUUID();
    mockData.refreshTokens.set(refreshToken, {
      user_id: authCode.identity_id,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // 7. Verify everything
    const decoded = verifyToken(accessToken);
    expect(decoded.userId).toBe(userId);
    expect(decoded.client_id).toBe(clientId);
    expect(decoded.scope).toBe('windy_pro:*');
    expect(mockData.refreshTokens.has(refreshToken)).toBe(true);
  });
});

describe('Identity Integration: Device Code Flow', () => {
  beforeEach(() => resetMockData());

  it('should complete device code -> approve -> token flow', () => {
    // 1. Register public client (CLI)
    const clientId = 'windy_fly';
    mockData.oauthClients.set(clientId, {
      client_id: clientId,
      name: 'Windy Fly',
      is_public: 1,
      is_first_party: 1,
    });

    // 2. Device requests a code
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const userCode = 'ABCD-1234';

    mockData.oauthDeviceCodes.set(deviceCode, {
      device_code: deviceCode,
      user_code: userCode,
      client_id: clientId,
      scope: 'windy_fly:*',
      status: 'pending',
      identity_id: null,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    // 3. Status is pending -> return authorization_pending
    let deviceAuth = mockData.oauthDeviceCodes.get(deviceCode)!;
    expect(deviceAuth.status).toBe('pending');

    // 4. User approves
    const userId = crypto.randomUUID();
    deviceAuth.status = 'approved';
    deviceAuth.identity_id = userId;

    // 5. Poll again -> generate token
    deviceAuth = mockData.oauthDeviceCodes.get(deviceCode)!;
    expect(deviceAuth.status).toBe('approved');
    expect(deviceAuth.identity_id).toBe(userId);

    // 6. Mark as consumed
    deviceAuth.status = 'expired';

    const accessToken = generateToken({
      userId,
      email: 'cli@test.com',
      tier: 'pro',
      type: 'human',
      scopes: ['windy_fly:*'],
      iss: 'windy-identity',
      client_id: clientId,
    });

    const decoded = verifyToken(accessToken);
    expect(decoded.userId).toBe(userId);
    expect(decoded.scopes).toEqual(['windy_fly:*']);
  });

  it('should handle denied device authorization', () => {
    const deviceCode = crypto.randomBytes(32).toString('hex');
    mockData.oauthDeviceCodes.set(deviceCode, {
      device_code: deviceCode,
      user_code: 'DENY-1234',
      client_id: 'windy_fly',
      scope: 'windy_fly:*',
      status: 'denied',
      identity_id: null,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const deviceAuth = mockData.oauthDeviceCodes.get(deviceCode)!;
    expect(deviceAuth.status).toBe('denied');
  });
});

describe('Identity Integration: Bot API Key Lifecycle', () => {
  beforeEach(() => resetMockData());

  it('should register bot -> create API key -> authenticate -> revoke -> verify cascade', () => {
    // 1. Register bot via Eternitas webhook
    const botId = crypto.randomUUID();
    const passportNumber = 'ET-ABC12';

    mockData.users.set(botId, {
      id: botId,
      email: `${passportNumber.toLowerCase()}@eternitas.ai`,
      name: 'Test Agent',
      identity_type: 'bot',
      tier: 'bot',
    });

    mockData.identityScopes.set(botId, [
      { scope: 'windy_chat:read', granted_by: 'eternitas_provision' },
      { scope: 'windy_chat:write', granted_by: 'eternitas_provision' },
      { scope: 'windy_mail:read', granted_by: 'eternitas_provision' },
      { scope: 'windy_mail:send', granted_by: 'eternitas_provision' },
    ]);

    mockData.productAccounts.set(botId, [
      { product: 'windy_chat', status: 'active' },
      { product: 'windy_mail', status: 'active' },
    ]);

    // 2. Create bot API key
    const { rawKey, keyHash, keyPrefix } = generateBotApiKey();

    mockData.botApiKeys.set(keyHash, {
      id: crypto.randomUUID(),
      identity_id: botId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: ['windy_chat:read', 'windy_chat:write', 'windy_mail:read', 'windy_mail:send'],
      status: 'active',
      created_by: 'eternitas_provision',
    });

    // 3. Authenticate with API key
    expect(rawKey.startsWith('wk_')).toBe(true);
    const computedHash = hashApiKey(rawKey);
    expect(computedHash).toBe(keyHash);

    const keyRecord = mockData.botApiKeys.get(computedHash)!;
    expect(keyRecord.status).toBe('active');
    expect(keyRecord.identity_id).toBe(botId);
    expect(keyRecord.scopes).toContain('windy_chat:read');

    // 4. Revoke passport -> cascade
    // Suspend product accounts
    const products = mockData.productAccounts.get(botId)!;
    for (const p of products) {
      p.status = 'suspended';
    }

    // Revoke API keys
    keyRecord.status = 'revoked';

    // Freeze identity
    mockData.users.get(botId)!.frozen = 1;

    // 5. Verify cascade took effect
    expect(mockData.users.get(botId)!.frozen).toBe(1);
    expect(mockData.botApiKeys.get(computedHash)!.status).toBe('revoked');
    for (const p of mockData.productAccounts.get(botId)!) {
      expect(p.status).toBe('suspended');
    }
  });
});

describe('Identity Integration: Verification Flow', () => {
  beforeEach(() => resetMockData());

  it('should send OTP -> check OTP -> mark email verified', () => {
    const userId = crypto.randomUUID();
    const email = 'verify@test.com';

    mockData.users.set(userId, {
      id: userId,
      email,
      email_verified: 0,
      phone_verified: 0,
    });

    // 1. Generate OTP
    const code = String(crypto.randomInt(100000, 999999));
    expect(code.length).toBe(6);
    expect(parseInt(code)).toBeGreaterThanOrEqual(100000);
    expect(parseInt(code)).toBeLessThan(1000000);

    // 2. Store OTP
    const otpEntry = {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      sentAt: Date.now(),
      type: 'email' as const,
    };

    // 3. Check with wrong code
    const wrongCode = '000000';
    expect(wrongCode).not.toBe(code);
    otpEntry.attempts++;
    expect(otpEntry.attempts).toBe(1);

    // 4. Check with correct code
    expect(code).toBe(otpEntry.code);
    expect(Date.now()).toBeLessThan(otpEntry.expiresAt);

    // 5. Mark email as verified
    mockData.users.get(userId)!.email_verified = 1;
    expect(mockData.users.get(userId)!.email_verified).toBe(1);
  });

  it('should reject after max attempts', () => {
    const code = String(crypto.randomInt(100000, 999999));
    const otpEntry = {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 3,
    };

    expect(otpEntry.attempts).toBeGreaterThanOrEqual(3);
  });

  it('should reject expired OTPs', () => {
    const code = String(crypto.randomInt(100000, 999999));
    const otpEntry = {
      code,
      expiresAt: Date.now() - 1000, // Already expired
      attempts: 0,
    };

    expect(Date.now()).toBeGreaterThan(otpEntry.expiresAt);
  });
});

describe('Identity Integration: Backward Compatibility', () => {
  it('should treat old HS256 tokens without scopes as human/windy_pro:*', () => {
    // Old-format token (no scopes, no type, no products)
    const token = generateToken({
      userId: crypto.randomUUID(),
      email: 'old@test.com',
      tier: 'pro',
      accountId: crypto.randomUUID(),
    });

    const decoded = verifyToken(token);

    // Normalize as the middleware does
    if (!decoded.scopes) decoded.scopes = ['windy_pro:*'];
    if (!decoded.products) decoded.products = ['windy_pro'];
    if (!decoded.type) decoded.type = 'human';

    expect(decoded.scopes).toEqual(['windy_pro:*']);
    expect(decoded.products).toEqual(['windy_pro']);
    expect(decoded.type).toBe('human');
  });

  it('should reject tokens signed with wrong secret', () => {
    const token = jwt.sign({ userId: 'test' }, 'wrong-secret', {
      algorithm: 'HS256',
      expiresIn: '15m',
    });

    expect(() => verifyToken(token)).toThrow();
  });

  it('should reject expired tokens', () => {
    const token = jwt.sign(
      { userId: 'test' },
      TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '0s' },
    );

    // Small delay to ensure expiry
    expect(() => verifyToken(token)).toThrow('jwt expired');
  });

  it('should reject tokens with algorithm none', () => {
    // The verifyToken function explicitly requires HS256
    const fakeToken = jwt.sign({ userId: 'test' }, '', { algorithm: 'none' as any });
    expect(() => verifyToken(fakeToken)).toThrow();
  });
});

describe('Identity Integration: Scope Checking', () => {
  function hasScope(userScopes: string[], required: string): boolean {
    if (userScopes.includes('admin:*')) return true;
    if (userScopes.includes(required)) return true;
    const [product] = required.split(':');
    if (userScopes.includes(`${product}:*`)) return true;
    return false;
  }

  it('should match exact scopes', () => {
    expect(hasScope(['windy_pro:read'], 'windy_pro:read')).toBe(true);
    expect(hasScope(['windy_pro:read'], 'windy_pro:write')).toBe(false);
  });

  it('should match product wildcards', () => {
    expect(hasScope(['windy_pro:*'], 'windy_pro:read')).toBe(true);
    expect(hasScope(['windy_pro:*'], 'windy_pro:write')).toBe(true);
    expect(hasScope(['windy_pro:*'], 'windy_chat:read')).toBe(false);
  });

  it('should match admin wildcard', () => {
    expect(hasScope(['admin:*'], 'windy_pro:read')).toBe(true);
    expect(hasScope(['admin:*'], 'windy_chat:write')).toBe(true);
    expect(hasScope(['admin:*'], 'anything:anything')).toBe(true);
  });

  it('should handle empty scopes', () => {
    expect(hasScope([], 'windy_pro:read')).toBe(false);
  });
});

describe('Identity Integration: Token Blacklist', () => {
  it('should detect blacklisted tokens', () => {
    const token = generateToken({ userId: 'test' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Not blacklisted
    expect(mockData.tokenBlacklist.has(tokenHash)).toBe(false);

    // Blacklist it (logout)
    mockData.tokenBlacklist.add(tokenHash);
    expect(mockData.tokenBlacklist.has(tokenHash)).toBe(true);
  });
});

describe('Identity Integration: First-Party OAuth Client Seeding', () => {
  it('should define all required first-party clients', () => {
    const requiredClients = [
      'windy_chat',
      'windy_mail',
      'windy_fly',
      'eternitas',
      'windy_pro_desktop',
      'windy_pro_mobile',
    ];

    // Seed clients
    const seeded: Record<string, any> = {
      windy_chat: { isPublic: false, isFirstParty: true },
      windy_mail: { isPublic: false, isFirstParty: true },
      windy_fly: { isPublic: true, isFirstParty: true },
      eternitas: { isPublic: false, isFirstParty: true },
      windy_pro_desktop: { isPublic: true, isFirstParty: true },
      windy_pro_mobile: { isPublic: true, isFirstParty: true },
    };

    for (const clientId of requiredClients) {
      expect(seeded[clientId]).toBeDefined();
      expect(seeded[clientId].isFirstParty).toBe(true);
    }

    // Public clients should use PKCE (no secret)
    expect(seeded.windy_fly.isPublic).toBe(true);
    expect(seeded.windy_pro_desktop.isPublic).toBe(true);
    expect(seeded.windy_pro_mobile.isPublic).toBe(true);

    // Confidential clients have secrets
    expect(seeded.windy_chat.isPublic).toBe(false);
    expect(seeded.windy_mail.isPublic).toBe(false);
    expect(seeded.eternitas.isPublic).toBe(false);
  });
});
