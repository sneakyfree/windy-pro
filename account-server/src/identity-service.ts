/**
 * Identity Service — Core logic for Unified Windy Identity
 *
 * Phase 10.0 (Foundation): Provides helpers that the existing auth routes
 * can call to log audit events, provision product accounts, and manage
 * identity scopes without breaking any existing functionality.
 *
 * This is a PURE SERVICE module — no Express routes. Routes use it.
 */
import crypto from 'crypto';
import { getDb } from './db/schema';
import type {
  IdentityAuditEvent,
  WindyProduct,
  ProductAccountStatus,
  IdentityScope,
} from '@windy-pro/contracts';

// ═══════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════

/**
 * Log an identity audit event.
 *
 * Call this from auth routes on login, register, logout, password change,
 * device add/remove, token refresh, etc.
 *
 * @example
 *   logAuditEvent('login', user.userId, { deviceId }, req.ip, req.get('user-agent'));
 */
export function logAuditEvent(
  event: IdentityAuditEvent,
  identityId: string | null,
  details: Record<string, unknown> = {},
  ipAddress?: string,
  userAgent?: string,
): string {
  const db = getDb();
  const id = crypto.randomUUID();

  try {
    db.prepare(`
      INSERT INTO identity_audit_log (id, identity_id, event, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      identityId,
      event,
      JSON.stringify(details),
      ipAddress ?? null,
      userAgent ?? null,
    );
  } catch (err) {
    // Audit logging must never break the primary flow
    console.error('[identity-service] Failed to log audit event:', event, err);
  }

  return id;
}

/**
 * Async variant of logAuditEvent. Writes through the pooled async adapter
 * so it doesn't block the event loop on Postgres. Same swallow-on-error
 * semantics as the sync variant — audit logging must never break the
 * primary flow.
 */
export async function logAuditEventAsync(
  event: IdentityAuditEvent,
  identityId: string | null,
  details: Record<string, unknown> = {},
  ipAddress?: string,
  userAgent?: string,
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();

  try {
    await db.runAsync(
      `INSERT INTO identity_audit_log (id, identity_id, event, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      identityId,
      event,
      JSON.stringify(details),
      ipAddress ?? null,
      userAgent ?? null,
    );
  } catch (err) {
    console.error('[identity-service] Failed to log audit event:', event, err);
  }

  return id;
}

/**
 * Query audit log entries for an identity.
 */
export function getAuditLog(
  identityId: string,
  options: { limit?: number; offset?: number; event?: IdentityAuditEvent } = {},
): { entries: any[]; total: number } {
  const db = getDb();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let whereClause = 'WHERE identity_id = ?';
  const params: any[] = [identityId];

  if (options.event) {
    whereClause += ' AND event = ?';
    params.push(options.event);
  }

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM identity_audit_log ${whereClause}`,
  ).get(...params) as any)?.count ?? 0;

  const entries = db.prepare(
    `SELECT * FROM identity_audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  return { entries, total };
}

// ═══════════════════════════════════════════
//  PRODUCT ACCOUNTS
// ═══════════════════════════════════════════

/**
 * Provision a product account for an identity.
 * Idempotent — if the account already exists, returns it.
 *
 * @example
 *   // On user registration, auto-provision Windy Pro:
 *   provisionProduct(userId, 'windy_pro');
 *
 *   // When user first opens Chat, provision chat:
 *   provisionProduct(userId, 'windy_chat', { matrixUserId: '@windy_abc:chat.windypro.com' });
 */
export function provisionProduct(
  identityId: string,
  product: WindyProduct,
  metadata: Record<string, unknown> = {},
  externalId?: string,
): { id: string; created: boolean } {
  const db = getDb();

  // Check if already exists
  const existing = db.prepare(
    'SELECT id FROM product_accounts WHERE identity_id = ? AND product = ?',
  ).get(identityId, product) as { id: string } | undefined;

  if (existing) {
    return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO product_accounts (id, identity_id, product, external_id, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, identityId, product, externalId ?? null, JSON.stringify(metadata));

  logAuditEvent('product_provision', identityId, { product, externalId });

  return { id, created: true };
}

/**
 * Async variant of provisionProduct. Uses the pooled async adapter so it
 * can participate in a non-blocking hot-path chain.
 */
export async function provisionProductAsync(
  identityId: string,
  product: WindyProduct,
  metadata: Record<string, unknown> = {},
  externalId?: string,
): Promise<{ id: string; created: boolean }> {
  const db = getDb();

  const existing = await db.getAsync<{ id: string }>(
    'SELECT id FROM product_accounts WHERE identity_id = ? AND product = ?',
    identityId,
    product,
  );

  if (existing) {
    return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO product_accounts (id, identity_id, product, external_id, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    identityId,
    product,
    externalId ?? null,
    JSON.stringify(metadata),
  );

  await logAuditEventAsync('product_provision', identityId, { product, externalId });

  return { id, created: true };
}

/**
 * Get all product accounts for an identity.
 */
export function getProductAccounts(identityId: string): any[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM product_accounts WHERE identity_id = ?',
  ).all(identityId);
}

/**
 * Update product account status (e.g., suspend on passport revocation).
 */
export function updateProductStatus(
  identityId: string,
  product: WindyProduct,
  status: ProductAccountStatus,
): boolean {
  const db = getDb();
  const result = db.prepare(
    'UPDATE product_accounts SET status = ? WHERE identity_id = ? AND product = ?',
  ).run(status, identityId, product);

  if (result.changes > 0) {
    logAuditEvent(
      status === 'suspended' ? 'account_freeze' : 'account_unfreeze',
      identityId,
      { product, status },
    );
  }

  return result.changes > 0;
}

// ═══════════════════════════════════════════
//  IDENTITY SCOPES
// ═══════════════════════════════════════════

/**
 * Grant scopes to an identity.
 *
 * @example
 *   grantScopes(userId, ['windy_pro:*'], 'system');  // On registration
 *   grantScopes(userId, ['windy_chat:read', 'windy_chat:write'], 'user_action');
 */
export function grantScopes(
  identityId: string,
  scopes: IdentityScope[],
  grantedBy: string = 'system',
): void {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO identity_scopes (id, identity_id, scope, granted_by)
    VALUES (?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const scope of scopes) {
      stmt.run(crypto.randomUUID(), identityId, scope, grantedBy);
    }
  });
  logAuditEvent('scope_grant', identityId, { scopes, grantedBy });
}

/**
 * Async variant of grantScopes. Runs the INSERTs inside a real atomic
 * transactionAsync — previously the sync Postgres path was only
 * pseudo-transactional because BEGIN/COMMIT landed in separate
 * subprocesses.
 */
export async function grantScopesAsync(
  identityId: string,
  scopes: IdentityScope[],
  grantedBy: string = 'system',
): Promise<void> {
  const db = getDb();

  await db.transactionAsync(async (tx) => {
    for (const scope of scopes) {
      await tx.run(
        `INSERT OR IGNORE INTO identity_scopes (id, identity_id, scope, granted_by)
         VALUES (?, ?, ?, ?)`,
        crypto.randomUUID(),
        identityId,
        scope,
        grantedBy,
      );
    }
  });
  await logAuditEventAsync('scope_grant', identityId, { scopes, grantedBy });
}

/**
 * Get all scopes for an identity.
 */
export function getScopes(identityId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT scope FROM identity_scopes WHERE identity_id = ?',
  ).all(identityId) as { scope: string }[];

  return rows.map(r => r.scope);
}

/**
 * Revoke a scope from an identity.
 */
export function revokeScope(identityId: string, scope: IdentityScope): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM identity_scopes WHERE identity_id = ? AND scope = ?',
  ).run(identityId, scope);

  if (result.changes > 0) {
    logAuditEvent('scope_revoke', identityId, { scope });
  }

  return result.changes > 0;
}

/**
 * Check if an identity has a required scope.
 * Supports wildcard matching:
 *   - 'windy_pro:*' matches 'windy_pro:read', 'windy_pro:write', etc.
 *   - 'admin:*' matches everything (superuser)
 */
export function hasScope(identityScopes: string[], requiredScope: string): boolean {
  // Admin wildcard
  if (identityScopes.includes('admin:*')) return true;

  // Direct match
  if (identityScopes.includes(requiredScope)) return true;

  // Product wildcard: 'windy_pro:*' matches 'windy_pro:read'
  const [product] = requiredScope.split(':');
  if (identityScopes.includes(`${product}:*`)) return true;

  return false;
}

/**
 * Check if an identity has ALL required scopes.
 */
export function hasAllScopes(identityScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every(s => hasScope(identityScopes, s));
}

// ═══════════════════════════════════════════
//  BACKFILL — Run once to seed existing users
// ═══════════════════════════════════════════

/**
 * Backfill product_accounts and identity_scopes for existing users.
 *
 * This should be called once during the migration. It's idempotent —
 * safe to call multiple times.
 */
export function backfillExistingUsers(): { usersProcessed: number; accountsCreated: number } {
  const db = getDb();

  const users = db.prepare(
    'SELECT id, tier FROM users',
  ).all() as { id: string; tier: string }[];

  let accountsCreated = 0;

  for (const user of users) {
    // Provision Windy Pro product account
    const { created } = provisionProduct(user.id, 'windy_pro', {
      tier: user.tier,
      migratedFromLegacy: true,
    });

    if (created) {
      accountsCreated++;

      // Grant default scopes based on tier
      const defaultScopes: IdentityScope[] = ['windy_pro:*'];
      if (user.tier !== 'free') {
        defaultScopes.push('windy_pro:premium');
      }
      grantScopes(user.id, defaultScopes, 'migration_backfill');
    }
  }

  return { usersProcessed: users.length, accountsCreated };
}

// ═══════════════════════════════════════════
//  ETERNITAS WEBHOOK
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
//  CHAT PROFILES (Phase 2)
// ═══════════════════════════════════════════

/**
 * Create or update a chat profile for an identity.
 * Links the Matrix account to the Windy identity.
 */
export function upsertChatProfile(
  identityId: string,
  data: {
    chatUserId?: string;
    matrixUserId?: string;
    matrixAccessToken?: string;
    matrixDeviceId?: string;
    displayName?: string;
    languages?: string[];
    primaryLanguage?: string;
    onboardingComplete?: boolean;
  },
): void {
  const db = getDb();

  const existing = db.prepare(
    'SELECT identity_id FROM chat_profiles WHERE identity_id = ?',
  ).get(identityId) as any;

  if (existing) {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.chatUserId !== undefined) { updates.push('chat_user_id = ?'); params.push(data.chatUserId); }
    if (data.matrixUserId !== undefined) { updates.push('matrix_user_id = ?'); params.push(data.matrixUserId); }
    if (data.matrixAccessToken !== undefined) { updates.push('matrix_access_token = ?'); params.push(data.matrixAccessToken); }
    if (data.matrixDeviceId !== undefined) { updates.push('matrix_device_id = ?'); params.push(data.matrixDeviceId); }
    if (data.displayName !== undefined) { updates.push('display_name = ?'); params.push(data.displayName); }
    if (data.languages !== undefined) { updates.push('languages = ?'); params.push(JSON.stringify(data.languages)); }
    if (data.primaryLanguage !== undefined) { updates.push('primary_language = ?'); params.push(data.primaryLanguage); }
    if (data.onboardingComplete !== undefined) { updates.push('onboarding_complete = ?'); params.push(data.onboardingComplete ? 1 : 0); }

    if (updates.length > 0) {
      params.push(identityId);
      db.prepare(`UPDATE chat_profiles SET ${updates.join(', ')} WHERE identity_id = ?`).run(...params);
    }
  } else {
    db.prepare(`
      INSERT INTO chat_profiles (identity_id, chat_user_id, matrix_user_id, matrix_access_token, matrix_device_id, display_name, languages, primary_language, onboarding_complete)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identityId,
      data.chatUserId ?? null,
      data.matrixUserId ?? null,
      data.matrixAccessToken ?? null,
      data.matrixDeviceId ?? null,
      data.displayName ?? null,
      JSON.stringify(data.languages ?? ['en']),
      data.primaryLanguage ?? 'en',
      data.onboardingComplete ? 1 : 0,
    );
  }
}

/**
 * Get chat profile for an identity.
 */
export function getChatProfile(identityId: string): any | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_profiles WHERE identity_id = ?').get(identityId) as any;
}

// ═══════════════════════════════════════════
//  BOT API KEYS (Phase 3)
// ═══════════════════════════════════════════

/**
 * Generate a bot API key.
 * Returns the raw key ONCE — only the hash is stored.
 */
export function createBotApiKey(
  identityId: string,
  scopes: string[],
  createdBy: string,
  options: { label?: string; expiresInDays?: number } = {},
): { apiKey: string; keyPrefix: string; id: string; expiresAt?: string } {
  const db = getDb();

  // Generate a secure random API key: wk_ prefix + 48 random hex chars
  const rawKey = `wk_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11); // "wk_xxxxxxxx"
  const id = crypto.randomUUID();

  let expiresAt: string | undefined;
  if (options.expiresInDays) {
    expiresAt = new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  }

  db.prepare(`
    INSERT INTO bot_api_keys (id, identity_id, key_hash, key_prefix, label, scopes, status, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, identityId, keyHash, keyPrefix, options.label ?? null, JSON.stringify(scopes), expiresAt ?? null, createdBy);

  logAuditEvent('api_key_create', identityId, { keyPrefix, scopes, label: options.label, createdBy });

  return { apiKey: rawKey, keyPrefix, id, expiresAt };
}

/**
 * Validate a bot API key. Returns the identity and scopes if valid.
 */
export function validateBotApiKey(apiKey: string): { valid: boolean; identityId?: string; scopes?: string[]; identityType?: string } {
  const db = getDb();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const key = db.prepare(
    "SELECT * FROM bot_api_keys WHERE key_hash = ? AND status = 'active'",
  ).get(keyHash) as any;

  if (!key) return { valid: false };

  // Check expiry
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return { valid: false };
  }

  // Update last_used_at
  db.prepare("UPDATE bot_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(key.id);

  // Get identity type
  const identity = db.prepare('SELECT identity_type FROM users WHERE id = ?').get(key.identity_id) as any;

  return {
    valid: true,
    identityId: key.identity_id,
    scopes: JSON.parse(key.scopes),
    identityType: identity?.identity_type || 'bot',
  };
}

/**
 * Revoke a bot API key.
 */
export function revokeBotApiKey(keyId: string, revokedBy: string): boolean {
  const db = getDb();
  const key = db.prepare('SELECT identity_id FROM bot_api_keys WHERE id = ?').get(keyId) as any;
  if (!key) return false;

  db.prepare("UPDATE bot_api_keys SET status = 'revoked' WHERE id = ?").run(keyId);
  logAuditEvent('api_key_revoke', key.identity_id, { keyId, revokedBy });
  return true;
}

// ═══════════════════════════════════════════
//  SECRETARY MODE CONSENT (Phase 3)
// ═══════════════════════════════════════════

/**
 * Grant secretary mode consent — explicit OAuth-style permission for a bot
 * to send email as the human owner.
 */
export function grantSecretaryConsent(ownerIdentityId: string, botIdentityId: string): string {
  const db = getDb();
  const id = crypto.randomUUID();

  // Revoke any existing consent first (only one active consent per bot per owner)
  db.prepare(
    "UPDATE secretary_consents SET active = 0, revoked_at = datetime('now') WHERE owner_identity_id = ? AND bot_identity_id = ? AND active = 1",
  ).run(ownerIdentityId, botIdentityId);

  db.prepare(`
    INSERT INTO secretary_consents (id, owner_identity_id, bot_identity_id, active)
    VALUES (?, ?, ?, 1)
  `).run(id, ownerIdentityId, botIdentityId);

  // Grant the mail:secretary scope to the bot
  grantScopes(botIdentityId, ['windy_mail:secretary'], `secretary_consent:${ownerIdentityId}`);

  logAuditEvent('secretary_consent_granted', ownerIdentityId, {
    botIdentityId,
    consentId: id,
  });

  return id;
}

/**
 * Revoke secretary mode consent.
 */
export function revokeSecretaryConsent(ownerIdentityId: string, botIdentityId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE secretary_consents SET active = 0, revoked_at = datetime('now') WHERE owner_identity_id = ? AND bot_identity_id = ? AND active = 1",
  ).run(ownerIdentityId, botIdentityId);

  if (result.changes > 0) {
    // Revoke the mail:secretary scope
    revokeScope(botIdentityId, 'windy_mail:secretary');
    logAuditEvent('secretary_consent_revoked', ownerIdentityId, { botIdentityId });
    return true;
  }
  return false;
}

/**
 * Check if a bot has active secretary consent from an owner.
 */
export function hasSecretaryConsent(ownerIdentityId: string, botIdentityId: string): boolean {
  const db = getDb();
  const consent = db.prepare(
    'SELECT 1 FROM secretary_consents WHERE owner_identity_id = ? AND bot_identity_id = ? AND active = 1',
  ).get(ownerIdentityId, botIdentityId);
  return !!consent;
}

// ═══════════════════════════════════════════
//  REVOCATION CASCADE (Phase 3)
// ═══════════════════════════════════════════

/**
 * Execute a full revocation cascade when an Eternitas passport is revoked.
 * Suspends all product accounts and marks for email kill, phone return, chat suspension.
 */
export function executeRevocationCascade(identityId: string, passportNumber: string): { affected: string[] } {
  const db = getDb();
  const affected: string[] = [];

  // 1. Suspend all product accounts
  const products = db.prepare(
    "SELECT product FROM product_accounts WHERE identity_id = ? AND status = 'active'",
  ).all(identityId) as { product: string }[];

  for (const p of products) {
    updateProductStatus(identityId, p.product as any, 'suspended');
    affected.push(`product:${p.product}:suspended`);
  }

  // 2. Freeze the identity
  db.prepare('UPDATE users SET frozen = 1 WHERE id = ?').run(identityId);
  affected.push('identity:frozen');

  // 3. Revoke all bot API keys
  const apiKeys = db.prepare(
    "SELECT id FROM bot_api_keys WHERE identity_id = ? AND status = 'active'",
  ).all(identityId) as { id: string }[];

  for (const key of apiKeys) {
    revokeBotApiKey(key.id, 'revocation_cascade');
    affected.push(`api_key:${key.id}:revoked`);
  }

  // 4. Revoke all secretary consents where this bot was the delegate
  db.prepare(
    "UPDATE secretary_consents SET active = 0, revoked_at = datetime('now') WHERE bot_identity_id = ? AND active = 1",
  ).run(identityId);
  affected.push('secretary_consents:revoked');

  // 5. Log the cascade
  logAuditEvent('revocation_cascade', identityId, {
    passportNumber,
    affected,
    reason: 'eternitas_passport_revoked',
  });

  return { affected };
}

/**
 * Process an Eternitas webhook event.
 *
 * - passport.registered → Create bot identity + auto-provision Chat + Mail
 * - passport.revoked → Suspend all product accounts
 * - passport.suspended → Suspend all product accounts
 * - passport.verified → Update last_verified_at
 */
export function processEternitasEvent(
  event: string,
  passportNumber: string,
  agentName: string,
  operatorEmail?: string,
): { success: boolean; identityId?: string; productsProvisioned?: WindyProduct[] } {
  const db = getDb();

  switch (event) {
    case 'passport.registered': {
      // Create bot identity
      const identityId = crypto.randomUUID();
      const email = `${passportNumber.toLowerCase()}@eternitas.ai`;

      db.prepare(`
        INSERT INTO users (id, email, name, password_hash, tier, identity_type, passport_id, display_name)
        VALUES (?, ?, ?, ?, 'bot', 'bot', ?, ?)
      `).run(identityId, email, agentName, 'eternitas-managed', passportNumber, agentName);

      // Link operator if we find them
      let operatorId: string | null = null;
      if (operatorEmail) {
        const operator = db.prepare('SELECT id FROM users WHERE email = ?').get(operatorEmail) as { id: string } | undefined;
        operatorId = operator?.id ?? null;
      }

      // Create passport record
      db.prepare(`
        INSERT INTO eternitas_passports (id, identity_id, passport_number, operator_identity_id, birth_certificate)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        identityId,
        passportNumber,
        operatorId,
        JSON.stringify({ agentName, registeredVia: 'webhook' }),
      );

      // Auto-provision Chat and Mail
      const productsProvisioned: WindyProduct[] = [];
      provisionProduct(identityId, 'windy_chat', { botAgent: true });
      productsProvisioned.push('windy_chat');
      provisionProduct(identityId, 'windy_mail', { botAgent: true });
      productsProvisioned.push('windy_mail');

      grantScopes(identityId, [
        'windy_chat:read',
        'windy_chat:write',
        'windy_mail:read',
        'windy_mail:send',
      ], 'eternitas_provision');

      logAuditEvent('passport_register', identityId, {
        passportNumber,
        agentName,
        operatorEmail,
        productsProvisioned,
      });

      return { success: true, identityId, productsProvisioned };
    }

    case 'passport.revoked':
    case 'passport.suspended': {
      // Find identity by passport number
      const passport = db.prepare(
        'SELECT identity_id FROM eternitas_passports WHERE passport_number = ?',
      ).get(passportNumber) as { identity_id: string } | undefined;

      if (!passport) {
        return { success: false };
      }

      const newStatus = event === 'passport.revoked' ? 'revoked' : 'suspended';

      // Update passport status
      db.prepare(
        'UPDATE eternitas_passports SET status = ? WHERE passport_number = ?',
      ).run(newStatus, passportNumber);

      if (event === 'passport.revoked') {
        // Full revocation cascade — suspends all products, freezes identity,
        // revokes API keys, revokes secretary consents
        executeRevocationCascade(passport.identity_id, passportNumber);
      } else {
        // Suspension only — suspend product accounts but don't cascade fully
        db.prepare(
          'UPDATE product_accounts SET status = ? WHERE identity_id = ?',
        ).run('suspended', passport.identity_id);

        db.prepare(
          'UPDATE users SET frozen = 1 WHERE id = ?',
        ).run(passport.identity_id);
      }

      logAuditEvent(
        event === 'passport.revoked' ? 'passport_revoke' : 'passport_suspend',
        passport.identity_id,
        { passportNumber, reason: event },
      );

      return { success: true, identityId: passport.identity_id };
    }

    case 'passport.verified': {
      db.prepare(
        "UPDATE eternitas_passports SET last_verified_at = datetime('now') WHERE passport_number = ?",
      ).run(passportNumber);
      return { success: true };
    }

    default:
      return { success: false };
  }
}
