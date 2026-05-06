/**
 * Identity routes — Unified Windy Identity API endpoints.
 *
 * Phase 10.0: Foundation endpoints for identity management,
 * product provisioning, scope queries, audit log, and Eternitas webhook.
 *
 * All endpoints are additive — they don't modify existing auth behavior.
 * Existing /api/v1/auth/* routes continue to work unchanged.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { makeRateLimiter } from '../services/rate-limiter';
import { config } from '../config';
import { getDb } from '../db/schema';
import { authenticateToken, adminOnly, AuthRequest } from '../middleware/auth';
import {
  logAuditEvent,
  getAuditLog,
  getProductAccounts,
  provisionProduct,
  updateProductStatus,
  getScopes,
  grantScopes,
  revokeScope,
  hasScope,
  processEternitasEvent,
  backfillExistingUsers,
  upsertChatProfile,
  getChatProfile,
  createBotApiKey,
  validateBotApiKey,
  revokeBotApiKey,
  grantSecretaryConsent,
  revokeSecretaryConsent,
  hasSecretaryConsent,
} from '../identity-service';
import { normalizeProductTier } from '@windy-pro/contracts';
import { provisionAgent, cascadeRevocation } from '../services/ecosystem-provisioner';
import { trackEvent } from '../services/analytics';

const router = Router();

// ─── GET /api/v1/identity/me — Extended identity info ────────

router.get('/me', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const user = db.prepare(`
      SELECT id, email, name, tier, identity_type, phone, display_name,
             avatar_url, email_verified, phone_verified, passport_id,
             preferred_lang, last_login_at, windy_identity_id, created_at, updated_at,
             storage_used, storage_limit
      FROM users WHERE id = ?
    `).get(userId) as any;

    if (!user) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    const products = getProductAccounts(userId);
    const scopes = getScopes(userId);

    // Check for chat profile
    const chatProfile = db.prepare(
      'SELECT * FROM chat_profiles WHERE identity_id = ?',
    ).get(userId) as any | undefined;

    // Check for Eternitas passport
    const passport = db.prepare(
      'SELECT * FROM eternitas_passports WHERE identity_id = ?',
    ).get(userId) as any | undefined;

    res.json({
      identity: {
        id: user.id,
        windyIdentityId: user.windy_identity_id,
        email: user.email,
        name: user.name,
        tier: user.tier,
        identityType: user.identity_type || 'human',
        phone: user.phone,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: !!user.email_verified,
        phoneVerified: !!user.phone_verified,
        passportId: user.passport_id,
        preferredLang: user.preferred_lang || 'en',
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        // Storage surfaced so the install wizard's Complete screen can show
        // the user's provisioned cloud quota without a second round-trip.
        storageUsed: user.storage_used ?? 0,
        storageLimit: user.storage_limit ?? 0,
      },
      products,
      scopes,
      chatProfile: chatProfile || undefined,
      passport: passport || undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch identity' });
  }
});

// ─── PATCH /api/v1/identity/me — Update identity fields ──────

router.patch('/me', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();
    const { displayName, preferredLang, avatarUrl, phone } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (displayName !== undefined) {
      updates.push('display_name = ?');
      params.push(displayName);
    }
    if (preferredLang !== undefined) {
      updates.push('preferred_lang = ?');
      params.push(preferredLang);
    }
    if (avatarUrl !== undefined) {
      updates.push('avatar_url = ?');
      params.push(avatarUrl);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(userId);

    db.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    ).run(...params);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update identity' });
  }
});

// ─── GET /api/v1/identity/products — List product accounts ───

router.get('/products', authenticateToken, (req: Request, res: Response) => {
  const products = getProductAccounts((req as AuthRequest).user.userId);
  res.json({ products });
});

// ─── POST /api/v1/identity/products/provision ────────────────

router.post('/products/provision', authenticateToken, (req: Request, res: Response) => {
  try {
    const { product, metadata } = req.body;

    if (!product || !['windy_pro', 'windy_chat', 'windy_mail', 'windy_fly', 'eternitas'].includes(product)) {
      return res.status(400).json({ error: 'Invalid product. Must be one of: windy_pro, windy_chat, windy_mail, windy_fly, eternitas' });
    }

    const result = provisionProduct(
      (req as AuthRequest).user.userId,
      product,
      metadata,
    );

    res.status(result.created ? 201 : 200).json({
      account: { id: result.id },
      provisioned: result.created,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Provisioning failed' });
  }
});

// ─── GET /api/v1/identity/scopes — List identity scopes ──────

router.get('/scopes', authenticateToken, (req: Request, res: Response) => {
  const scopes = getScopes((req as AuthRequest).user.userId);
  res.json({ scopes });
});

// ─── POST /api/v1/identity/scopes/grant — Admin-only ─────────

router.post('/scopes/grant', authenticateToken, adminOnly, (req: Request, res: Response) => {
  try {
    const { identityId, scopes } = req.body;

    if (!identityId || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'identityId and scopes[] are required' });
    }

    grantScopes(identityId, scopes, `admin:${(req as AuthRequest).user.userId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to grant scopes' });
  }
});

// ─── DELETE /api/v1/identity/scopes/:scope — Admin-only ──────

router.delete('/scopes/:scope', authenticateToken, adminOnly, (req: Request, res: Response) => {
  const identityId = req.query.identityId as string | undefined;
  if (!identityId || typeof identityId !== 'string') {
    return res.status(400).json({ error: 'identityId query parameter required' });
  }

  const result = revokeScope(identityId, req.params.scope as string);
  res.json({ revoked: result });
});

// ─── GET /api/v1/identity/audit — Audit log (admin or self) ──

router.get('/audit', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const targetId = (req.query.identityId as string) || userId;

    // Non-admins can only view their own audit log
    if (targetId !== userId) {
      const db = getDb();
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required to view other users\' audit logs' });
      }
    }

    const result = getAuditLog(targetId, {
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
      event: req.query.event as any,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ─── POST /api/v1/identity/eternitas/webhook ─────────────────

// Bot-specific rate limit: stricter than humans
const botWebhookLimiter = makeRateLimiter('bot-webhook', {
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many webhook requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/eternitas/webhook', botWebhookLimiter, (req: Request, res: Response) => {
  try {
    const { event, passportNumber, agentName, operatorEmail, timestamp, signature, trustScore } = req.body;

    // P0 fix: signature verification is REQUIRED regardless of NODE_ENV.
    // The old code skipped verification when ETERNITAS_WEBHOOK_SECRET was
    // unset in non-production — which meant anyone on the network could
    // forge passport.revoked events. No env-dependent short-circuits.
    const webhookSecret = process.env.ETERNITAS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(503).json({
        error: 'ETERNITAS_WEBHOOK_SECRET not configured on this server',
        code: 'webhook_secret_not_configured',
      });
    }
    if (typeof signature !== 'string' || !signature) {
      return res.status(401).json({ error: 'Missing webhook signature' });
    }
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${event}:${passportNumber}:${timestamp}`)
      .digest('hex');
    // Constant-time compare — prevents timing-attack signature discovery.
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    // Replay protection: reject events older than 5 minutes.
    if (typeof timestamp === 'number' || typeof timestamp === 'string') {
      const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
      const ageSeconds = Math.abs(Date.now() / 1000 - ts);
      if (Number.isFinite(ageSeconds) && ageSeconds > 300) {
        return res.status(401).json({ error: 'Webhook timestamp outside accepted window (±5 min)' });
      }
    }

    // Basic validation
    if (!event || !passportNumber) {
      return res.status(400).json({ error: 'event and passportNumber are required' });
    }
    // P1-6: field-level validation so a signature-verified but malformed
    // payload can't crash downstream handlers (e.g. `passport.registered`
    // with a NULL agentName previously hit an INSERT that violates
    // users.name NOT NULL and bubbled a 500).
    if (typeof event !== 'string' || typeof passportNumber !== 'string') {
      return res.status(400).json({ error: 'event and passportNumber must be strings' });
    }
    if (!/^ET-[A-Z0-9]{4,32}$/i.test(passportNumber)) {
      return res.status(400).json({ error: 'passportNumber must match ET-XXXX format' });
    }
    if (event === 'passport.registered') {
      if (typeof agentName !== 'string' || !agentName.trim()) {
        return res.status(400).json({ error: 'agentName is required for passport.registered' });
      }
      if (operatorEmail !== undefined && typeof operatorEmail !== 'string') {
        return res.status(400).json({ error: 'operatorEmail must be a string when provided' });
      }
    }
    if (event === 'trust_updated') {
      if (typeof trustScore !== 'number' || !(trustScore >= 0 && trustScore <= 1)) {
        return res.status(400).json({ error: 'trustScore must be a number between 0 and 1' });
      }
    }

    // Handle trust_updated event separately
    if (event === 'trust_updated') {
      const db = getDb();
      if (typeof trustScore === 'number' && trustScore >= 0 && trustScore <= 1) {
        db.prepare(
          'UPDATE eternitas_passports SET trust_score = ? WHERE passport_number = ?',
        ).run(trustScore, passportNumber);

        const passport = db.prepare(
          'SELECT identity_id FROM eternitas_passports WHERE passport_number = ?',
        ).get(passportNumber) as { identity_id: string } | undefined;

        if (passport) {
          logAuditEvent('trust_updated', passport.identity_id, { passportNumber, trustScore });
        }
      }
      return res.json({ received: true });
    }

    // Handle revocation events — cascade suspend across all products
    if (event === 'passport.revoked' || event === 'passport.suspended') {
      cascadeRevocation(passportNumber);
      logAuditEvent('passport_revoke', '', { event, passportNumber });
      return res.json({ received: true, action: 'cascade_revocation' });
    }

    const result = processEternitasEvent(event, passportNumber, agentName, operatorEmail);

    // Phase 3: On registration, also generate API key for the bot
    let apiCredentials: any = undefined;
    if (event === 'passport.registered' && result.success && result.identityId) {
      const keyResult = createBotApiKey(
        result.identityId,
        ['windy_chat:read', 'windy_chat:write', 'windy_mail:read', 'windy_mail:send'],
        'eternitas_provision',
        { label: `Hatch key for ${agentName || passportNumber}` },
      );
      apiCredentials = {
        apiKey: keyResult.apiKey,
        keyPrefix: keyResult.keyPrefix,
      };
    }

    res.status(result.success ? 200 : 404).json({
      received: true,
      identityId: result.identityId,
      productsProvisioned: result.productsProvisioned,
      apiCredentials,
    });
  } catch (err: any) {
    console.error('[identity] Eternitas webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─── POST /api/v1/identity/backfill — One-time migration (admin) ──

router.post('/backfill', authenticateToken, adminOnly, (_req: Request, res: Response) => {
  try {
    const result = backfillExistingUsers();
    res.json({
      success: true,
      usersProcessed: result.usersProcessed,
      accountsCreated: result.accountsCreated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Backfill failed' });
  }
});

// ─── Phase 2: Chat Profile Endpoints ──────────────────────────

// POST /api/v1/identity/chat/provision — Lazy Matrix provisioning
router.post('/chat/provision', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    // Check if already provisioned
    const existingProfile = getChatProfile(userId);
    if (existingProfile?.matrix_user_id && existingProfile?.onboarding_complete) {
      return res.json({
        success: true,
        alreadyProvisioned: true,
        matrix: {
          matrixUserId: existingProfile.matrix_user_id,
          homeServer: process.env.SYNAPSE_SERVER_NAME || 'chat.windychat.ai',
          // Don't return the access token — it's stored but not re-issued
        },
      });
    }

    const user = db.prepare('SELECT name, display_name FROM users WHERE id = ?').get(userId) as any;
    if (!user) return res.status(404).json({ error: 'Identity not found' });

    const displayName = req.body.displayName || user.display_name || user.name;
    const SYNAPSE_URL = process.env.SYNAPSE_URL || 'http://localhost:8008';
    const SYNAPSE_ADMIN_URL = process.env.SYNAPSE_ADMIN_URL || `${SYNAPSE_URL}/_synapse/admin`;
    const SYNAPSE_REGISTRATION_SECRET = process.env.SYNAPSE_REGISTRATION_SECRET || '';
    const SYNAPSE_SERVER_NAME = process.env.SYNAPSE_SERVER_NAME || 'chat.windychat.ai';

    // Generate localpart
    const base = displayName.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9._/-]/g, '').slice(0, 32);
    const localpart = base.length >= 3 ? `windy_${base}` : `windy_${crypto.createHash('sha256').update(displayName).digest('hex').slice(0, 12)}`;

    let matrixCredentials: { matrixUserId: string; accessToken: string; deviceId: string; homeServer: string };

    if (SYNAPSE_REGISTRATION_SECRET) {
      // Production: provision via Synapse admin API
      try {
        const nonceRes = await fetch(`${SYNAPSE_ADMIN_URL}/v1/register`, { method: 'GET', signal: AbortSignal.timeout(10000) });
        if (!nonceRes.ok) throw new Error(`Synapse nonce request failed: ${nonceRes.status}`);
        const { nonce } = await nonceRes.json() as any;

        const password = crypto.randomBytes(32).toString('hex');
        const hmac = crypto.createHmac('sha1', SYNAPSE_REGISTRATION_SECRET);
        hmac.update(nonce + '\x00' + localpart + '\x00' + password + '\x00' + 'notadmin');
        const mac = hmac.digest('hex');

        const regRes = await fetch(`${SYNAPSE_ADMIN_URL}/v1/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce, username: localpart, password, displayname: displayName, admin: false, mac }),
          signal: AbortSignal.timeout(10000),
        });

        if (!regRes.ok) throw new Error(`Synapse registration failed: ${regRes.status}`);
        const result = await regRes.json() as any;

        matrixCredentials = {
          matrixUserId: result.user_id || `@${localpart}:${SYNAPSE_SERVER_NAME}`,
          accessToken: result.access_token,
          deviceId: result.device_id,
          homeServer: SYNAPSE_SERVER_NAME,
        };
      } catch (err: any) {
        console.error('[identity] Matrix provisioning failed:', err.message);
        return res.status(502).json({
          error: 'Failed to provision Matrix account',
          hint: 'Is the Synapse homeserver running?',
        });
      }
    } else if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_CHAT_STUB === 'true') {
      // Dev-only stub — explicitly opted in via ALLOW_CHAT_STUB=true AND non-production
      // NODE_ENV. Previously this branch ran any time SYNAPSE_REGISTRATION_SECRET was
      // unset, which silently masked real outages with fake credentials.
      console.warn('[identity] ALLOW_CHAT_STUB=true — returning dev-stub chat credentials (NOT for production)');
      matrixCredentials = {
        matrixUserId: `@${localpart}:${SYNAPSE_SERVER_NAME}`,
        accessToken: `dev_token_${crypto.randomUUID()}`,
        deviceId: `dev_device_${crypto.randomUUID().slice(0, 8)}`,
        homeServer: SYNAPSE_SERVER_NAME,
      };
    } else {
      console.error('[identity] SYNAPSE_REGISTRATION_SECRET not configured; refusing to stub chat provisioning');
      return res.status(503).json({
        error: 'Chat provisioning unavailable',
        hint: 'SYNAPSE_REGISTRATION_SECRET must be set. For local dev, also set NODE_ENV!=production and ALLOW_CHAT_STUB=true.',
      });
    }

    // Update chat profile
    upsertChatProfile(userId, {
      matrixUserId: matrixCredentials.matrixUserId,
      matrixAccessToken: matrixCredentials.accessToken,
      matrixDeviceId: matrixCredentials.deviceId,
      displayName,
      onboardingComplete: true,
    });

    // Update product account to active
    db.prepare(
      "UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'windy_chat'",
    ).run(matrixCredentials.matrixUserId, userId);

    logAuditEvent('product_provision', userId, {
      product: 'windy_chat',
      matrixUserId: matrixCredentials.matrixUserId,
      lazyProvisioned: true,
    });

    // Return credentials in a format the mobile app can consume
    // Mobile stores: windy_matrix_token, windy_matrix_user, windy_matrix_server, windy_matrix_device
    res.status(201).json({
      success: true,
      creator_name: displayName,
      matrix: {
        matrixUserId: matrixCredentials.matrixUserId,
        accessToken: matrixCredentials.accessToken,
        deviceId: matrixCredentials.deviceId,
        homeServer: matrixCredentials.homeServer,
      },
      // SecureStore-compatible key mapping for mobile
      secureStoreKeys: {
        windy_matrix_token: matrixCredentials.accessToken,
        windy_matrix_user: matrixCredentials.matrixUserId,
        windy_matrix_server: matrixCredentials.homeServer,
        windy_matrix_device: matrixCredentials.deviceId,
      },
    });
  } catch (err: any) {
    console.error('[identity] Chat provision error:', err);
    res.status(500).json({ error: 'Chat provisioning failed' });
  }
});

// ─── POST /api/v1/identity/mail/provision — Provision Windy Mail inbox ──────
router.post('/mail/provision', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const user = db.prepare('SELECT email, name, display_name, windy_identity_id FROM users WHERE id = ?').get(userId) as any;
    if (!user) return res.status(404).json({ error: 'Identity not found' });

    const { display_name: displayName, email_prefix: emailPrefix } = req.body;
    const finalDisplayName = displayName || user.display_name || user.name;
    const finalPrefix = emailPrefix || user.email.split('@')[0];

    // Check if already provisioned
    const existing = db.prepare(
      "SELECT external_id FROM product_accounts WHERE identity_id = ? AND product = 'windy_mail' AND status = 'active'",
    ).get(userId) as any;

    if (existing?.external_id) {
      return res.json({
        mail_address: existing.external_id,
        mail_provisioned: true,
        already_provisioned: true,
      });
    }

    // Ensure product account row exists
    provisionProduct(userId, 'windy_mail', { source: 'mail/provision' });

    const WINDY_MAIL_URL = config.WINDY_MAIL_URL;
    try {
      const mailRes = await fetch(`${WINDY_MAIL_URL}/api/v1/provision/human`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Token': process.env.WINDYMAIL_SERVICE_TOKEN || '',
        },
        body: JSON.stringify({
          windy_identity_id: user.windy_identity_id || userId,
          display_name: finalDisplayName,
          email_prefix: finalPrefix,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!mailRes.ok) {
        const errBody = await mailRes.text().catch(() => '');
        return res.status(502).json({
          mail_provisioned: false,
          error: 'service unavailable',
          detail: `Mail service returned ${mailRes.status}`,
        });
      }

      const mailData = await mailRes.json() as any;
      const mailAddress = mailData.mail_address || mailData.emailAddress || `${finalPrefix}@windymail.ai`;

      // Update product account
      db.prepare(
        "UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'windy_mail'",
      ).run(mailAddress, userId);

      logAuditEvent('product_provision', userId, {
        product: 'windy_mail',
        mailAddress,
      });

      res.status(201).json({
        mail_address: mailAddress,
        mail_provisioned: true,
      });
    } catch (err: any) {
      res.status(502).json({
        mail_provisioned: false,
        error: 'service unavailable',
        detail: err.message,
      });
    }
  } catch (err: any) {
    console.error('[identity] Mail provision error:', err);
    res.status(500).json({ error: 'Mail provisioning failed' });
  }
});

// ─── POST /api/v1/identity/agent/provision — Provision agent via Eternitas ──
router.post('/agent/provision', authenticateToken, async (req: Request, res: Response) => {
  try {
    const requestingUser = (req as AuthRequest).user;
    const db = getDb();
    const { windy_identity_id, agent_name, owner_email } = req.body;

    if (!agent_name) {
      return res.status(400).json({ error: 'agent_name is required' });
    }

    const ownerEmail = owner_email || requestingUser.email;

    // Resolve or create bot identity. The legacy fallback used `bot-${uuid}`
    // here, but Postgres `users.windy_identity_id` is a UUID column and rejects
    // any non-UUID-shaped string with `invalid input syntax for type uuid`.
    // The "bot" tag is already carried on the INSERT below as
    // `identity_type='bot'`, so the prefix was decorative — load-bearing only
    // against the SQLite-only earlier schema. Plain UUID works in both.
    const identityId = windy_identity_id || crypto.randomUUID();
    let botUser = db.prepare('SELECT id FROM users WHERE windy_identity_id = ?').get(identityId) as any;

    if (!botUser) {
      const botId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO users (id, email, name, display_name, tier, identity_type, windy_identity_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'free', 'bot', ?, datetime('now'), datetime('now'))`,
      ).run(botId, `${agent_name.toLowerCase().replace(/\s+/g, '-')}@bot.windypro.com`, agent_name, agent_name, identityId);
      botUser = { id: botId };
    }

    // Ensure product account rows exist
    provisionProduct(botUser.id, 'eternitas', { source: 'agent/provision' });
    provisionProduct(botUser.id, 'windy_chat', { source: 'agent/provision' });

    // Full agent provision: Eternitas passport → Chat Matrix account + DM room
    const result = await provisionAgent(botUser.id, agent_name, requestingUser.userId, ownerEmail);

    if (result.eternitas === 'failed' && result.chat === 'failed') {
      return res.status(502).json({
        error: 'Agent provisioning failed — both Eternitas and Chat unavailable',
        eternitas: result.eternitas,
        chat: result.chat,
      });
    }

    trackEvent('agent_hatched', botUser.id, { agentName: agent_name });

    res.status(201).json({
      passport_number: result.passport_number,
      eternitas_provisioned: result.eternitas === 'ok',
      chat_provisioned: result.chat === 'ok',
      matrix_user_id: result.matrix_user_id,
      dm_room_id: result.dm_room_id,
      identity_id: botUser.id,
      windy_identity_id: identityId,
      // If anything is pending, the retry worker will handle it
      pending: result.eternitas === 'pending' || result.chat === 'pending',
    });
  } catch (err: any) {
    console.error('[identity] Agent provision error:', err);
    res.status(500).json({ error: 'Agent provisioning failed' });
  }
});

// GET /api/v1/identity/chat/profile — Get chat profile
router.get('/chat/profile', authenticateToken, (req: Request, res: Response) => {
  const profile = getChatProfile((req as AuthRequest).user.userId);
  if (!profile) {
    return res.json({ profile: null, provisioned: false });
  }
  // Never expose the Matrix access token in a GET
  const { matrix_access_token, ...safeProfile } = profile;
  res.json({ profile: safeProfile, provisioned: !!profile.onboarding_complete });
});

// ─── Phase 3: Bot API Key Endpoints ───────────────────────────

// Bot-specific auth rate limiter
const botAuthLimiter = makeRateLimiter('bot-auth', {
  windowMs: 60 * 1000,
  max: 3, // Stricter than human: 3/min vs 5/min
  message: { error: 'Too many bot auth attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/v1/identity/api-keys — Create a bot API key (admin or operator)
router.post('/api-keys', authenticateToken, (req: Request, res: Response) => {
  try {
    const { identityId, scopes, label, expiresInDays } = req.body;
    const creatorId = (req as AuthRequest).user.userId;

    if (!identityId || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'identityId and scopes[] are required' });
    }

    // Verify the target identity is a bot
    const db = getDb();
    const target = db.prepare('SELECT identity_type FROM users WHERE id = ?').get(identityId) as any;
    if (!target) return res.status(404).json({ error: 'Identity not found' });
    if (target.identity_type !== 'bot') {
      return res.status(400).json({ error: 'API keys can only be created for bot identities' });
    }

    // Verify the creator is the operator or an admin
    const creator = db.prepare('SELECT role FROM users WHERE id = ?').get(creatorId) as any;
    const passport = db.prepare('SELECT operator_identity_id FROM eternitas_passports WHERE identity_id = ?').get(identityId) as any;

    const isAdmin = creator?.role === 'admin';
    const isOperator = passport?.operator_identity_id === creatorId;

    if (!isAdmin && !isOperator) {
      return res.status(403).json({ error: 'Only the bot operator or an admin can create API keys' });
    }

    const result = createBotApiKey(identityId, scopes, creatorId, { label, expiresInDays });

    res.status(201).json({
      apiKey: result.apiKey,
      keyPrefix: result.keyPrefix,
      id: result.id,
      scopes,
      expiresAt: result.expiresAt,
      warning: 'Store this API key securely. It will not be shown again.',
    });
  } catch (err: any) {
    console.error('[identity] API key creation error:', err);
    res.status(500).json({ error: 'API key creation failed' });
  }
});

// DELETE /api/v1/identity/api-keys/:keyId — Revoke an API key
router.delete('/api-keys/:keyId', authenticateToken, (req: Request, res: Response) => {
  const result = revokeBotApiKey(req.params.keyId as string, (req as AuthRequest).user.userId);
  res.json({ revoked: result });
});

// GET /api/v1/identity/api-keys — List API keys for a bot (metadata only, no raw keys)
router.get('/api-keys', authenticateToken, (req: Request, res: Response) => {
  try {
    const identityId = (req.query.identityId as string) || (req as AuthRequest).user.userId;
    const db = getDb();

    const keys = db.prepare(
      'SELECT id, identity_id, key_prefix, label, scopes, status, created_at, expires_at, last_used_at, created_by FROM bot_api_keys WHERE identity_id = ?',
    ).all(identityId);

    res.json({ keys });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// ─── Phase 3: Secretary Mode Consent ──────────────────────────

// POST /api/v1/identity/secretary/consent — Grant or revoke secretary consent
router.post('/secretary/consent', authenticateToken, (req: Request, res: Response) => {
  try {
    const { botIdentityId, consent } = req.body;
    const ownerId = (req as AuthRequest).user.userId;

    if (!botIdentityId) {
      return res.status(400).json({ error: 'botIdentityId is required' });
    }

    // Verify the bot exists and is a bot
    const db = getDb();
    const bot = db.prepare('SELECT identity_type FROM users WHERE id = ?').get(botIdentityId) as any;
    if (!bot) return res.status(404).json({ error: 'Bot identity not found' });
    if (bot.identity_type !== 'bot') {
      return res.status(400).json({ error: 'Secretary consent can only be granted to bot identities' });
    }

    if (consent) {
      const consentId = grantSecretaryConsent(ownerId, botIdentityId);
      res.json({ success: true, consentId, message: 'Secretary mode consent granted' });
    } else {
      const revoked = revokeSecretaryConsent(ownerId, botIdentityId);
      res.json({ success: revoked, message: revoked ? 'Secretary mode consent revoked' : 'No active consent found' });
    }
  } catch (err: any) {
    console.error('[identity] Secretary consent error:', err);
    res.status(500).json({ error: 'Consent operation failed' });
  }
});

// GET /api/v1/identity/secretary/status — Check secretary consent status
router.get('/secretary/status', authenticateToken, (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user.userId;
  const db = getDb();

  // Check if the authenticated user is a human — secretary consent only applies to bots
  const user = db.prepare('SELECT identity_type FROM users WHERE id = ?').get(userId) as any;
  if (!user) {
    return res.status(404).json({ error: 'Identity not found' });
  }

  if (user.identity_type !== 'bot') {
    return res.json({
      consented: false,
      identity_type: user.identity_type || 'human',
      message: 'Secretary consent is only applicable to bot identities',
    });
  }

  const botIdentityId = req.query.botIdentityId as string;
  if (!botIdentityId) {
    return res.status(400).json({ error: 'botIdentityId query param required' });
  }

  const ownerId = userId;
  const hasConsent = hasSecretaryConsent(ownerId, botIdentityId);

  res.json({ botIdentityId, hasConsent });
});

// ─── Phase 3: Hatch Flow Credential Output ───────────────────

// POST /api/v1/identity/hatch/credentials — Generate structured credentials for agent hatch
// This endpoint is called after Eternitas registration to build the full credential set
router.post('/hatch/credentials', authenticateToken, adminOnly, (req: Request, res: Response) => {
  try {
    const { identityId } = req.body;
    if (!identityId) return res.status(400).json({ error: 'identityId is required' });

    const db = getDb();
    const identity = db.prepare('SELECT * FROM users WHERE id = ?').get(identityId) as any;
    if (!identity) return res.status(404).json({ error: 'Identity not found' });
    if (identity.identity_type !== 'bot') return res.status(400).json({ error: 'Only bot identities can receive hatch credentials' });

    const passport = db.prepare('SELECT * FROM eternitas_passports WHERE identity_id = ?').get(identityId) as any;
    if (!passport) return res.status(400).json({ error: 'No Eternitas passport found for this identity' });

    const chatProfile = getChatProfile(identityId);
    const products = getProductAccounts(identityId);
    const scopes = getScopes(identityId);

    // Generate a fresh API key for the hatch
    const keyResult = createBotApiKey(
      identityId,
      scopes.length > 0 ? scopes : ['windy_chat:read', 'windy_chat:write', 'windy_mail:read', 'windy_mail:send'],
      (req as AuthRequest).user.userId,
      { label: `Hatch credentials for ${passport.passport_number}` },
    );

    // Build the structured credential output (mode 0o600 file)
    const credentials = {
      version: 1,
      identityId,
      passportNumber: passport.passport_number,
      identityType: 'bot',
      apiKey: keyResult.apiKey,
      scopes: scopes.length > 0 ? scopes : keyResult.apiKey ? ['windy_chat:read', 'windy_chat:write', 'windy_mail:read', 'windy_mail:send'] : [],
      products: {
        ...(chatProfile?.matrix_user_id ? {
          windyChat: {
            matrixUserId: chatProfile.matrix_user_id,
            accessToken: chatProfile.matrix_access_token,
            deviceId: chatProfile.matrix_device_id,
            homeServer: process.env.SYNAPSE_SERVER_NAME || 'chat.windychat.ai',
          },
        } : {}),
        ...(products.find((p: any) => p.product === 'windy_mail') ? {
          windyMail: {
            emailAddress: `${passport.passport_number.toLowerCase()}@windymail.ai`,
          },
        } : {}),
      },
      operatorIdentityId: passport.operator_identity_id,
      createdAt: new Date().toISOString(),
    };

    res.json({
      credentials,
      filePath: 'data/.windy_identity.json',
      fileMode: '0o600',
      instructions: 'Write this JSON to data/.windy_identity.json with mode 0o600. The agent should read credentials from this file instead of .env manual editing.',
    });
  } catch (err: any) {
    console.error('[identity] Hatch credentials error:', err);
    res.status(500).json({ error: 'Failed to generate hatch credentials' });
  }
});

// ─── GET /api/v1/identity/resolve/:windyIdentityId — Cross-product identity resolution ───
// The "Google Account dashboard" equivalent: given a universal identity ID,
// return everything linked to that person across the Windy ecosystem.

router.get('/resolve/:windyIdentityId', authenticateToken, (req: Request, res: Response) => {
  try {
    const { windyIdentityId } = req.params;
    const db = getDb();
    const requestingUser = (req as AuthRequest).user;

    // Look up by windy_identity_id first, then fall back to user id
    const fields = `id, windy_identity_id, email, name, tier, identity_type,
              phone, display_name, avatar_url, email_verified, phone_verified,
              passport_id, preferred_lang, last_login_at, created_at`;
    let user = db.prepare(
      `SELECT ${fields} FROM users WHERE windy_identity_id = ?`,
    ).get(windyIdentityId) as any;

    if (!user) {
      user = db.prepare(
        `SELECT ${fields} FROM users WHERE id = ?`,
      ).get(windyIdentityId) as any;
    }

    if (!user) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    // Authorization: only the identity owner or an admin can resolve
    const isAdmin = requestingUser.role === 'admin' || (requestingUser.scopes || []).some(
      (s: string) => s === 'admin:*',
    );
    if (user.id !== requestingUser.userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only resolve your own identity' });
    }

    // Fetch all linked product accounts
    const products = db.prepare(
      `SELECT id, product, status, external_id, metadata, provisioned_at
       FROM product_accounts WHERE identity_id = ? ORDER BY product`,
    ).all(user.id) as any[];

    // Fetch scopes
    const scopes = db.prepare(
      'SELECT scope, granted_at FROM identity_scopes WHERE identity_id = ?',
    ).all(user.id) as any[];

    // Fetch chat profile if exists
    const chatProfile = db.prepare(
      `SELECT chat_user_id, matrix_user_id, display_name, primary_language, onboarding_complete
       FROM chat_profiles WHERE identity_id = ?`,
    ).get(user.id) as any | undefined;

    // Fetch Eternitas passport if exists
    const passport = db.prepare(
      `SELECT passport_number, status, trust_score, registered_at
       FROM eternitas_passports WHERE identity_id = ?`,
    ).get(user.id) as any | undefined;

    // Build the product detail map
    const productDetails = products.map((p: any) => {
      const detail: Record<string, any> = {
        product: p.product,
        status: p.status,
        externalId: p.external_id,
        provisionedAt: p.provisioned_at,
      };

      // Merge in product-specific metadata
      try {
        const meta = JSON.parse(p.metadata || '{}');
        if (Object.keys(meta).length > 0) detail.metadata = meta;
      } catch { /* ignore invalid JSON */ }

      // Enrich with chat profile data
      if (p.product === 'windy_chat' && chatProfile) {
        detail.chatUserId = chatProfile.chat_user_id;
        detail.matrixUserId = chatProfile.matrix_user_id;
        detail.displayName = chatProfile.display_name;
        detail.onboardingComplete = !!chatProfile.onboarding_complete;
      }

      // Enrich with mail address for bots
      if (p.product === 'windy_mail' && passport) {
        detail.emailAddress = `${passport.passport_number.toLowerCase()}@windymail.ai`;
      }

      return detail;
    });

    res.json({
      windyIdentityId: user.windy_identity_id,
      identity: {
        name: user.name,
        email: user.email,
        tier: user.tier,
        identityType: user.identity_type || 'human',
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: !!user.email_verified,
        phoneVerified: !!user.phone_verified,
        preferredLang: user.preferred_lang || 'en',
        createdAt: user.created_at,
      },
      products: productDetails,
      scopes: scopes.map((s: any) => s.scope),
      passport: passport ? {
        passportNumber: passport.passport_number,
        status: passport.status,
        trustScore: passport.trust_score,
        registeredAt: passport.registered_at,
      } : null,
    });
  } catch (err: any) {
    console.error('[identity] Resolve error:', err);
    res.status(500).json({ error: 'Failed to resolve identity' });
  }
});

// ─── POST /api/v1/identity/provision-all — Provision pending products via webhooks ───
// Fires provisioning webhooks to external services (Windy Chat, Windy Mail)
// so they can create accounts for this identity in their own systems.

router.post('/provision-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { windyIdentityId } = req.body;
    const requestingUser = (req as AuthRequest).user;
    const db = getDb();

    // Resolve identity
    const identityIdSource = windyIdentityId || requestingUser.userId;
    let user: any;

    if (windyIdentityId) {
      user = db.prepare('SELECT id, windy_identity_id, name, email, display_name, tier FROM users WHERE windy_identity_id = ?')
        .get(windyIdentityId);
    } else {
      user = db.prepare('SELECT id, windy_identity_id, name, email, display_name, tier FROM users WHERE id = ?')
        .get(requestingUser.userId);
    }

    if (!user) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    // Authorization: only self or admin
    const isAdmin = requestingUser.role === 'admin' || (requestingUser.scopes || []).some(
      (s: string) => s === 'admin:*',
    );
    if (user.id !== requestingUser.userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only provision your own identity' });
    }

    const results: Record<string, { status: string; externalId?: string; error?: string }> = {};

    // Ensure product account rows exist (idempotent)
    provisionProduct(user.id, 'windy_chat', { source: 'provision-all' });
    provisionProduct(user.id, 'windy_mail', { source: 'provision-all' });

    const webhookPayload = {
      windyIdentityId: user.windy_identity_id,
      internalId: user.id,
      email: user.email,
      name: user.name,
      displayName: user.display_name || user.name,
      tier: user.tier,
      timestamp: new Date().toISOString(),
    };

    // Fire webhook to Windy Chat
    const chatWebhookUrl = config.WINDY_CHAT_WEBHOOK_URL;
    if (chatWebhookUrl) {
      try {
        const chatRes = await fetch(chatWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...webhookPayload, product: 'windy_chat' }),
          signal: AbortSignal.timeout(10000),
        });

        if (chatRes.ok) {
          const chatData = await chatRes.json() as any;
          const externalId = chatData.externalId || chatData.matrixUserId || chatData.chatUserId;

          // Update product account to active with external ID
          db.prepare(
            "UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'windy_chat'",
          ).run(externalId || null, user.id);

          results.windy_chat = { status: 'active', externalId };
        } else {
          results.windy_chat = { status: 'webhook_failed', error: `HTTP ${chatRes.status}` };
        }
      } catch (err: any) {
        results.windy_chat = { status: 'webhook_error', error: err.message };
      }
    } else {
      // No webhook configured — leave as pending
      results.windy_chat = { status: 'pending', error: 'WINDY_CHAT_WEBHOOK_URL not configured' };
    }

    // Fire webhook to Windy Mail
    const mailWebhookUrl = config.WINDY_MAIL_WEBHOOK_URL;
    if (mailWebhookUrl) {
      try {
        const mailRes = await fetch(mailWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...webhookPayload, product: 'windy_mail' }),
          signal: AbortSignal.timeout(10000),
        });

        if (mailRes.ok) {
          const mailData = await mailRes.json() as any;
          const externalId = mailData.externalId || mailData.emailAddress;

          db.prepare(
            "UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'windy_mail'",
          ).run(externalId || null, user.id);

          results.windy_mail = { status: 'active', externalId };
        } else {
          results.windy_mail = { status: 'webhook_failed', error: `HTTP ${mailRes.status}` };
        }
      } catch (err: any) {
        results.windy_mail = { status: 'webhook_error', error: err.message };
      }
    } else {
      results.windy_mail = { status: 'pending', error: 'WINDY_MAIL_WEBHOOK_URL not configured' };
    }

    // Fire webhook/provision to Windy Cloud (storage allocation)
    provisionProduct(user.id, 'windy_cloud', { source: 'provision-all' });
    const cloudUrl = config.WINDY_CLOUD_URL;
    try {
      // Cloud is internal — just ensure storage allocation exists
      db.prepare('UPDATE users SET storage_limit = ? WHERE id = ? AND (storage_limit IS NULL OR storage_limit = 0)')
        .run(500 * 1024 * 1024, user.id);
      db.prepare(
        "UPDATE product_accounts SET status = 'active' WHERE identity_id = ? AND product = 'windy_cloud'",
      ).run(user.id);
      results.windy_cloud = { status: 'active' };
    } catch (err: any) {
      results.windy_cloud = { status: 'provision_error', error: err.message };
    }

    logAuditEvent('product_provision', user.id, {
      action: 'provision-all',
      results,
    }, req.ip, req.get('user-agent'));

    // Return the full current product state
    const allProducts = getProductAccounts(user.id);

    res.json({
      windyIdentityId: user.windy_identity_id,
      provisioned: results,
      products: allProducts,
    });
  } catch (err: any) {
    console.error('[identity] Provision-all error:', err);
    res.status(500).json({ error: 'Failed to provision products' });
  }
});

// ─── POST /api/v1/identity/ecosystem/provision-all — One call provisions everything ───
// Alias that orchestrates chat + mail + cloud in parallel
router.post('/ecosystem/provision-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const user = db.prepare(
      'SELECT id, windy_identity_id, name, email, display_name, tier FROM users WHERE id = ?',
    ).get(userId) as any;

    if (!user) return res.status(404).json({ error: 'Identity not found' });

    const displayName = req.body.display_name || user.display_name || user.name;
    const email = req.body.email || user.email;
    const windyIdentityId = req.body.windy_identity_id || user.windy_identity_id || userId;

    trackEvent('ecosystem_provisioned', userId);

    // Ensure product account rows exist (idempotent)
    provisionProduct(userId, 'windy_chat', { source: 'ecosystem/provision-all' });
    provisionProduct(userId, 'windy_mail', { source: 'ecosystem/provision-all' });
    provisionProduct(userId, 'windy_cloud', { source: 'ecosystem/provision-all' });

    // Orchestrate all three in parallel
    const [chatResult, mailResult, cloudResult] = await Promise.allSettled([
      // Chat provisioning
      (async () => {
        const chatUrl = config.WINDY_CHAT_URL;
        const chatRes = await fetch(`${chatUrl}/api/v1/onboarding/unified-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windy_identity_id: windyIdentityId, display_name: displayName, email }),
          signal: AbortSignal.timeout(10000),
        });
        if (!chatRes.ok) throw new Error(`HTTP ${chatRes.status}`);
        const data = await chatRes.json() as any;
        const externalId = data.matrix_user_id || data.matrixUserId || data.externalId;
        db.prepare("UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'windy_chat'")
          .run(externalId, userId);
        return { provisioned: true, matrix_user_id: externalId };
      })(),

      // Mail provisioning
      (async () => {
        const mailUrl = config.WINDY_MAIL_URL;
        const prefix = email.split('@')[0];
        const mailRes = await fetch(`${mailUrl}/api/v1/provision/human`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Service-Token': process.env.WINDYMAIL_SERVICE_TOKEN || '' },
          body: JSON.stringify({ windy_identity_id: windyIdentityId, display_name: displayName, email_prefix: prefix }),
          signal: AbortSignal.timeout(10000),
        });
        if (!mailRes.ok) throw new Error(`HTTP ${mailRes.status}`);
        const data = await mailRes.json() as any;
        const mailAddr = data.mail_address || data.emailAddress || `${prefix}@windymail.ai`;
        db.prepare("UPDATE product_accounts SET status = 'active', external_id = ? WHERE identity_id = ? AND product = 'windy_mail'")
          .run(mailAddr, userId);
        return { provisioned: true, mail_address: mailAddr };
      })(),

      // Cloud provisioning (local — storage allocation)
      (async () => {
        db.prepare('UPDATE users SET storage_limit = ? WHERE id = ? AND (storage_limit IS NULL OR storage_limit = 0)')
          .run(500 * 1024 * 1024, userId);
        db.prepare("UPDATE product_accounts SET status = 'active' WHERE identity_id = ? AND product = 'windy_cloud'")
          .run(userId);
        return { provisioned: true, storage_limit: 500 * 1024 * 1024 };
      })(),
    ]);

    const buildResult = (settled: PromiseSettledResult<any>) => {
      if (settled.status === 'fulfilled') return settled.value;
      return { provisioned: false, error: 'service unavailable', detail: settled.reason?.message };
    };

    const results = {
      windy_chat: buildResult(chatResult),
      windy_mail: buildResult(mailResult),
      windy_cloud: buildResult(cloudResult),
    };

    logAuditEvent('product_provision', userId, {
      action: 'ecosystem/provision-all',
      results,
    }, req.ip, req.get('user-agent'));

    res.json({
      windy_identity_id: windyIdentityId,
      provisioned: results,
      products: getProductAccounts(userId),
    });
  } catch (err: any) {
    console.error('[identity] ecosystem/provision-all error:', err);
    res.status(500).json({ error: 'Failed to provision ecosystem' });
  }
});

// ─── GET /api/v1/identity/ecosystem-status ──────────────────
// Returns the user's provisioning status across all Windy ecosystem products.

router.get('/ecosystem-status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = (req as AuthRequest).user.userId;

    const products = db.prepare(
      'SELECT product, status, external_id, metadata FROM product_accounts WHERE identity_id = ?',
    ).all(userId) as { product: string; status: string; external_id: string; metadata: string }[];

    const user = db.prepare(
      'SELECT email, name, display_name, tier, storage_used, storage_limit, windy_identity_id FROM users WHERE id = ?',
    ).get(userId) as { email: string; name: string; display_name: string; tier: string; storage_used: number; storage_limit: number; windy_identity_id: string } | undefined;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const findProduct = (name: string) => products.find(p => p.product === name);
    const creatorName = user.display_name || user.name;

    // Check real health of each external service in parallel
    const checkHealth = async (url: string): Promise<'ok' | 'down'> => {
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
        return res.ok ? 'ok' : 'down';
      } catch {
        return 'down';
      }
    };

    const [chatHealth, mailHealth, eternitasHealth] = await Promise.allSettled([
      checkHealth(config.WINDY_CHAT_URL),
      checkHealth(config.WINDY_MAIL_URL),
      checkHealth(config.ETERNITAS_URL),
    ]);

    const healthOf = (settled: PromiseSettledResult<'ok' | 'down'>) =>
      settled.status === 'fulfilled' ? settled.value : 'down';

    const chatProduct = findProduct('windy_chat');
    const mailProduct = findProduct('windy_mail');
    const eternitasProduct = findProduct('eternitas');

    // Fetch Eternitas passport if provisioned (include trust_score)
    const passport = db.prepare(
      'SELECT passport_number, trust_score FROM eternitas_passports WHERE identity_id = ?',
    ).get(userId) as { passport_number: string; trust_score: number | null } | undefined;

    res.json({
      windy_identity_id: user.windy_identity_id || userId,
      email: user.email,
      creator_name: creatorName,
      tier: user.tier,
      products: {
        windy_word: { status: 'active', tier: user.tier },
        windy_chat: {
          provisioned: chatProduct?.status === 'active',
          health: healthOf(chatHealth),
          ...(chatProduct?.external_id ? { matrix_user_id: chatProduct.external_id } : {}),
          ...(chatProduct ? { status: chatProduct.status } : { status: 'not_provisioned' }),
        },
        windy_mail: {
          provisioned: mailProduct?.status === 'active',
          health: healthOf(mailHealth),
          ...(mailProduct?.external_id ? { address: mailProduct.external_id } : {}),
          ...(mailProduct ? { status: mailProduct.status } : { status: 'not_provisioned' }),
        },
        windy_cloud: {
          provisioned: true,
          health: 'ok', // Cloud is local to account-server
          status: 'active',
          usage: `${Math.round((user.storage_used || 0) / 1024 / 1024)}MB / ${Math.round((user.storage_limit || 500 * 1024 * 1024) / 1024 / 1024)}MB`,
          storage_used: user.storage_used || 0,
          storage_limit: user.storage_limit || 500 * 1024 * 1024,
        },
        eternitas: {
          provisioned: eternitasProduct?.status === 'active',
          health: healthOf(eternitasHealth),
          ...(passport ? {
            passport: passport.passport_number,
            trust_score: passport.trust_score != null ? Math.round(passport.trust_score * 100) : null,
          } : {}),
          ...(eternitasProduct ? { status: eternitasProduct.status } : { status: 'not_provisioned' }),
        },
        windy_fly: (() => {
          const flyProduct = findProduct('windy_fly');
          if (!flyProduct) return { status: 'not_provisioned', provisioned: false };
          // Parse metadata for agent details (set by provisionAgent)
          let meta: any = {};
          try { meta = JSON.parse(flyProduct.metadata || '{}'); } catch {}
          return {
            status: flyProduct.status,
            provisioned: flyProduct.status === 'active',
            matrix_user_id: flyProduct.external_id || meta.matrix_user_id,
            agent_name: meta.agent_name,
            passport_number: meta.passport_number,
            room_id: meta.dm_room_id,
          };
        })(),
        windy_clone: { status: 'available', provisioned: false, progress: 0 },
        windy_traveler: { status: user.tier !== 'free' ? 'active' : 'upgrade_required', provisioned: user.tier !== 'free' },
      },
    });
  } catch (err: any) {
    console.error('[identity] ecosystem-status error:', err);
    res.status(500).json({ error: 'Failed to fetch ecosystem status' });
  }
});

// ─── GET /api/v1/identity/validate-token ────────────────────
// Cross-product token validation: Mail, Chat, and Agent call this to verify
// a JWT and get the full identity without rolling their own JWT verification.

router.get('/validate-token', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user.userId;
    const db = getDb();

    const user = db.prepare(
      'SELECT id, email, name, tier, identity_type, windy_identity_id, display_name, avatar_url FROM users WHERE id = ?',
    ).get(userId) as any;

    if (!user) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    const products = getProductAccounts(userId);
    const scopes = getScopes(userId);
    const canonicalTier = normalizeProductTier(user.tier || 'free');

    res.json({
      valid: true,
      windy_identity_id: user.windy_identity_id || user.id,
      email: user.email,
      name: user.display_name || user.name,
      tier: user.tier || 'free',
      canonical_tier: canonicalTier,
      type: user.identity_type || 'human',
      scopes,
      products: products.map((p: any) => ({
        product: p.product,
        status: p.status,
        external_id: p.external_id,
      })),
    });
  } catch (err: any) {
    console.error('[identity] validate-token error:', err);
    res.status(500).json({ error: 'Token validation failed' });
  }
});

// ─── POST /api/v1/identity/webhooks/eternitas — Platform-level webhook receiver ───
// This receives platform-level events from Eternitas after registration.
// Different from /eternitas/webhook which handles individual passport events.

router.post('/webhooks/eternitas', (req: Request, res: Response) => {
  try {
    const { event, passport_number, timestamp, data } = req.body;

    // P0 fix: signature verification is REQUIRED regardless of NODE_ENV.
    // See /eternitas/webhook above for the same pattern.
    const signature = req.headers['x-eternitas-signature'] as string | undefined;
    const webhookSecret = config.ETERNITAS_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(503).json({
        error: 'ETERNITAS_WEBHOOK_SECRET not configured on this server',
        code: 'webhook_secret_not_configured',
      });
    }
    if (typeof signature !== 'string' || !signature) {
      return res.status(401).json({ error: 'Missing X-Eternitas-Signature header' });
    }
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    // P1-15 replay protection — mirror the ±5 min window from
    // /eternitas/webhook. An attacker who captured a valid signed
    // webhook could otherwise replay it indefinitely.
    if (timestamp !== undefined && timestamp !== null) {
      const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
      const tsSec = typeof ts === 'number' && ts > 1e12 ? ts / 1000 : ts; // accept ms or s
      const ageSec = Math.abs(Date.now() / 1000 - tsSec);
      if (!Number.isFinite(ageSec) || ageSec > 300) {
        return res.status(401).json({ error: 'Webhook timestamp outside accepted window (±5 min)' });
      }
    }

    if (!event || !passport_number) {
      return res.status(400).json({ error: 'event and passport_number are required' });
    }

    const db = getDb();

    switch (event) {
      case 'passport.revoked': {
        // Cascade revocation across all products
        cascadeRevocation(passport_number);
        console.log(`[Webhook] passport.revoked: ${passport_number}`);
        break;
      }

      case 'passport.suspended': {
        // Similar to revoked but set status to 'suspended' instead of 'revoked'
        const passport = db.prepare(
          'SELECT identity_id FROM eternitas_passports WHERE passport_number = ?',
        ).get(passport_number) as { identity_id: string } | undefined;

        if (passport) {
          db.prepare(
            "UPDATE product_accounts SET status = 'suspended' WHERE identity_id = ?",
          ).run(passport.identity_id);
          db.prepare(
            "UPDATE eternitas_passports SET status = 'suspended' WHERE passport_number = ?",
          ).run(passport_number);
          db.prepare(
            "UPDATE bot_api_keys SET status = 'revoked' WHERE identity_id = ?",
          ).run(passport.identity_id);
          logAuditEvent('passport_suspend', passport.identity_id, { event, passport_number });
        }
        console.log(`[Webhook] passport.suspended: ${passport_number}`);
        break;
      }

      case 'passport.reinstated': {
        // Restore: reactivate product accounts, passport, and API keys
        const passport = db.prepare(
          'SELECT identity_id FROM eternitas_passports WHERE passport_number = ?',
        ).get(passport_number) as { identity_id: string } | undefined;

        if (passport) {
          db.prepare(
            "UPDATE product_accounts SET status = 'active' WHERE identity_id = ?",
          ).run(passport.identity_id);
          db.prepare(
            "UPDATE eternitas_passports SET status = 'active' WHERE passport_number = ?",
          ).run(passport_number);
          db.prepare(
            "UPDATE bot_api_keys SET status = 'active' WHERE identity_id = ?",
          ).run(passport.identity_id);
          logAuditEvent('passport_reinstate', passport.identity_id, { event, passport_number });
        }
        console.log(`[Webhook] passport.reinstated: ${passport_number}`);
        break;
      }

      case 'trust_updated': {
        const trustScore = data?.trust_score;
        if (typeof trustScore === 'number' && trustScore >= 0 && trustScore <= 1) {
          db.prepare(
            'UPDATE eternitas_passports SET trust_score = ? WHERE passport_number = ?',
          ).run(trustScore, passport_number);

          const passport = db.prepare(
            'SELECT identity_id FROM eternitas_passports WHERE passport_number = ?',
          ).get(passport_number) as { identity_id: string } | undefined;

          if (passport) {
            logAuditEvent('trust_updated', passport.identity_id, { passport_number, trustScore });
          }
        }
        console.log(`[Webhook] trust_updated: ${passport_number} -> ${data?.trust_score}`);
        break;
      }

      default:
        console.log(`[Webhook] Unknown event: ${event} for ${passport_number}`);
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error('[Webhook] Eternitas platform webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─── GET /api/v1/identity/provisioning-status/:identity_id — Provisioning status ───

router.get('/provisioning-status/:identity_id', authenticateToken, (req: Request, res: Response) => {
  try {
    const requestingUser = (req as AuthRequest).user;
    const { identity_id } = req.params;

    // Only allow viewing own status or admin
    const isAdmin = requestingUser.role === 'admin' || (requestingUser.scopes || []).some(
      (s: string) => s === 'admin:*',
    );
    if (identity_id !== requestingUser.userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only view your own provisioning status' });
    }

    const db = getDb();

    // Get product accounts
    const productAccounts = db.prepare(
      'SELECT product, status, external_id, metadata FROM product_accounts WHERE identity_id = ?',
    ).all(identity_id) as { product: string; status: string; external_id: string | null; metadata: string }[];

    // Get pending provisions
    const pendingProvisions = db.prepare(
      'SELECT product, attempts, next_retry_at, payload FROM pending_provisions WHERE identity_id = ?',
    ).all(identity_id) as { product: string; attempts: number; next_retry_at: string; payload: string }[];

    // Build products map
    const products: Record<string, any> = {};

    for (const account of productAccounts) {
      const pending = pendingProvisions.find(p => p.product === account.product);
      let lastError: string | undefined;
      if (pending) {
        try {
          const payload = JSON.parse(pending.payload);
          lastError = payload.lastError || undefined;
        } catch { /* ignore */ }
      }

      products[account.product] = {
        status: account.status,
        ...(account.external_id ? { external_id: account.external_id } : {}),
        pending_retries: pending?.attempts || 0,
        ...(pending ? { next_retry: pending.next_retry_at } : {}),
        ...(lastError ? { last_error: lastError } : {}),
      };
    }

    // Include pending provisions for products not yet in product_accounts
    for (const pending of pendingProvisions) {
      if (!products[pending.product]) {
        let lastError: string | undefined;
        try {
          const payload = JSON.parse(pending.payload);
          lastError = payload.lastError || undefined;
        } catch { /* ignore */ }

        products[pending.product] = {
          status: 'pending',
          pending_retries: pending.attempts,
          next_retry: pending.next_retry_at,
          ...(lastError ? { last_error: lastError } : {}),
        };
      }
    }

    res.json({
      identity_id,
      products,
    });
  } catch (err: any) {
    console.error('[identity] provisioning-status error:', err);
    res.status(500).json({ error: 'Failed to fetch provisioning status' });
  }
});

export default router;
