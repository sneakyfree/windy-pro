/**
 * Hardening tests for Stripe billing edge cases.
 *
 * Covers: invalid tiers, missing Stripe config, webhook signature verification,
 * unhandled event types, idempotent replay, refund reversion, and subscription deletion.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { generateKeyPair } from '../jwks';

// ═══════════════════════════════════════════
//  RATE-LIMIT MOCK (noop)
// ═══════════════════════════════════════════

jest.mock('express-rate-limit', () => {
  return () => (_req: Request, _res: Response, next: NextFunction) => next();
});

// ═══════════════════════════════════════════
//  IN-MEMORY DATA STORES
// ═══════════════════════════════════════════

const TEST_USER_ID = 'user-billing-hardening-001';
const TEST_USER_EMAIL = 'billing-test@windypro.com';

const users = new Map<string, any>();
const transactions = new Map<string, any>();
const tokenBlacklist = new Set<string>();
const identityScopes = new Map<string, any[]>();
const productAccounts = new Map<string, any[]>();

function resetStores() {
  users.clear();
  transactions.clear();
  tokenBlacklist.clear();
  identityScopes.clear();
  productAccounts.clear();

  // Pre-seed the test user
  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    name: 'Billing Hardening User',
    tier: 'free',
    stripe_customer_id: null,
    storage_limit: 500 * 1024 * 1024,
    storage_used: 0,
    role: 'user',
  });

  identityScopes.set(TEST_USER_ID, [
    { scope: 'windy_pro:*', granted_by: 'registration' },
  ]);

  productAccounts.set(TEST_USER_ID, [
    { id: crypto.randomUUID(), identity_id: TEST_USER_ID, product: 'windy_pro', status: 'active' },
  ]);
}

// ═══════════════════════════════════════════
//  KEY PAIR FOR RS256 (test-scoped)
// ═══════════════════════════════════════════

const testKeyPair = generateKeyPair();

// ═══════════════════════════════════════════
//  MOCK: ../db/schema
// ═══════════════════════════════════════════

jest.mock('../db/schema', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: any[]) => {
        if (sql.includes('INSERT INTO transactions')) {
          const [id, userId, email, amount, currency, type, status, stripePaymentId] = args;
          transactions.set(id, {
            id, user_id: userId, email, amount, currency, type, status,
            stripe_payment_id: stripePaymentId,
            created_at: new Date().toISOString(),
          });
          return { changes: 1 };
        }
        if (sql.includes('UPDATE users SET stripe_customer_id')) {
          const user = users.get(args[1]);
          if (user) user.stripe_customer_id = args[0];
          return { changes: user ? 1 : 0 };
        }
        // Specific: tier = 'free' (hardcoded in SQL) — must come BEFORE generic tier update
        if (sql.includes("UPDATE users SET tier = 'free'") && sql.includes('WHERE email')) {
          for (const u of users.values()) {
            if (u.email === args[args.length - 1]) {
              u.tier = 'free';
              u.storage_limit = args[0];
            }
          }
          return { changes: 1 };
        }
        if (sql.includes("UPDATE users SET tier = 'free'") && sql.includes('WHERE id')) {
          const user = users.get(args[args.length - 1]);
          if (user) {
            user.tier = 'free';
            user.storage_limit = args[0];
          }
          return { changes: user ? 1 : 0 };
        }
        // Generic: tier = ? (parameterized) — upgrade path
        if (sql.includes('UPDATE users SET tier') && sql.includes('storage_limit') && sql.includes('WHERE id')) {
          const user = users.get(args[args.length - 1]);
          if (user) {
            user.tier = args[0];
            user.storage_limit = args[1];
          }
          return { changes: user ? 1 : 0 };
        }
        if (sql.includes("UPDATE transactions SET status")) {
          // Status is hardcoded in the SQL (e.g. status = 'refunded'), not parameterized.
          // The only arg is the transaction id.
          const txId = args[0];
          for (const tx of transactions.values()) {
            if (tx.id === txId) {
              // Extract the status value from the SQL string
              const statusMatch = sql.match(/status\s*=\s*'(\w+)'/);
              tx.status = statusMatch ? statusMatch[1] : 'refunded';
            }
          }
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get: (...args: any[]) => {
        // User lookups by id
        if (sql.includes('FROM users WHERE id')) {
          return users.get(args[0]) || null;
        }
        // User lookups by email
        if (sql.includes('FROM users WHERE email')) {
          for (const u of users.values()) {
            if (u.email === args[0]) return u;
          }
          return null;
        }
        // Transaction lookup by stripe_payment_id
        if (sql.includes('FROM transactions WHERE stripe_payment_id')) {
          for (const tx of transactions.values()) {
            if (tx.stripe_payment_id === args[0]) return tx;
          }
          return null;
        }
        // Token blacklist
        if (sql.includes('FROM token_blacklist')) {
          return tokenBlacklist.has(args[0]) ? { token_hash: args[0] } : null;
        }
        // Billing summary — SUM
        if (sql.includes('SELECT SUM')) {
          let total = 0;
          for (const tx of transactions.values()) {
            if (tx.user_id === args[0] && tx.status === 'paid') total += tx.amount;
          }
          return { total };
        }
        // Billing summary — COUNT
        if (sql.includes('SELECT COUNT')) {
          let count = 0;
          for (const tx of transactions.values()) {
            if (tx.user_id === args[0] && tx.type === 'subscription' && tx.status === 'paid') count++;
          }
          return { count };
        }
        return null;
      },
      all: (...args: any[]) => {
        // identity_scopes
        if (sql.includes('identity_scopes')) {
          return identityScopes.get(args[0]) || [];
        }
        // product_accounts
        if (sql.includes('product_accounts')) {
          return productAccounts.get(args[0]) || [];
        }
        return [];
      },
    }),
    exec: jest.fn(),
    pragma: jest.fn().mockReturnValue([]),
  }),
}));

// ═══════════════════════════════════════════
//  MOCK: ../config
// ═══════════════════════════════════════════

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-hardening-billing',
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/test',
    UPLOADS_PATH: '/tmp/test/uploads',
    PORT: 0,
    BCRYPT_ROUNDS: 4,
    MAX_DEVICES: 5,
    STRIPE_SECRET_KEY: '',         // empty by default — tests can override
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  },
}));

// ═══════════════════════════════════════════
//  MOCK: ../jwks
// ═══════════════════════════════════════════

jest.mock('../jwks', () => ({
  isRS256Available: () => false,
  getSigningKey: () => null,
  getVerificationKeys: () => [],
  getPublicKeyByKid: () => null,
  initializeJWKS: () => false,
  generateKeyPair: jest.requireActual('../jwks').generateKeyPair,
}));

// ═══════════════════════════════════════════
//  MOCK: ../identity-service
// ═══════════════════════════════════════════

jest.mock('../identity-service', () => ({
  logAuditEvent: jest.fn(),
  getScopes: jest.fn().mockReturnValue(['windy_pro:*']),
  getProductAccounts: jest.fn().mockReturnValue([]),
}));

// ═══════════════════════════════════════════
//  MOCK: ../redis
// ═══════════════════════════════════════════

jest.mock('../redis', () => ({
  isRedisAvailable: () => false,
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
}));

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateTestAccessToken(userId = TEST_USER_ID): string {
  return jwt.sign(
    {
      userId,
      email: TEST_USER_EMAIL,
      tier: 'free',
      accountId: userId,
      role: 'user',
      type: 'human',
      scopes: ['windy_pro:*'],
      products: ['windy_pro'],
    },
    'test-secret-hardening-billing',
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

function createWebhookSignature(payload: string, secret: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function buildWebhookEvent(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: `evt_${crypto.randomBytes(12).toString('hex')}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_${crypto.randomBytes(12).toString('hex')}`,
        amount: 4900,
        currency: 'usd',
        receipt_email: TEST_USER_EMAIL,
        customer: 'cus_test123',
      },
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════
//  APP SETUP
// ═══════════════════════════════════════════

let app: Express;

beforeEach(() => {
  resetStores();

  // Reset module-level Stripe client cache between tests
  jest.resetModules();

  app = express();

  // Raw body parser for webhook route (mirrors real server)
  app.use('/api/v1/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const { stripeRouter, billingRouter } = require('../routes/billing');
  app.use('/api/v1/stripe', stripeRouter);
  app.use('/api/v1/billing', billingRouter);
});

// ═══════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════

describe('Billing Hardening — Stripe Edge Cases', () => {
  // ─── 1. Invalid tier → 400 ───────────────────────────────────
  // NOTE: In the real route, getStripe() is called BEFORE tier validation.
  // With STRIPE_SECRET_KEY empty, getStripe() throws first → 503. So we test
  // that an invalid tier with unconfigured Stripe still produces an error (503).
  // The 400 validation only fires when Stripe IS configured but tier is wrong.
  it('POST /stripe/create-checkout-session rejects invalid tier with 400 when Stripe is configured', async () => {
    // Temporarily set STRIPE_SECRET_KEY so getStripe() doesn't throw before validation
    const { config } = require('../config');
    const orig = config.STRIPE_SECRET_KEY;
    config.STRIPE_SECRET_KEY = 'sk_test_fake_for_validation';

    const token = generateTestAccessToken();
    const res = await request(app)
      .post('/api/v1/stripe/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'ultra', billing_type: 'monthly' });

    config.STRIPE_SECRET_KEY = orig;

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid tier/i);
  });

  // ─── 2. STRIPE_SECRET_KEY not set → 503 ──────────────────────
  it('POST /stripe/create-checkout-session returns 503 when Stripe is not configured', async () => {
    const token = generateTestAccessToken();
    const res = await request(app)
      .post('/api/v1/stripe/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'pro', billing_type: 'monthly' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/stripe is not configured/i);
  });

  // ─── 3. Portal session with no stripe_customer_id → 400 ─────
  // NOTE: getStripe() is called before the customer_id check, so with empty
  // STRIPE_SECRET_KEY, the route returns 503 first. We configure a fake key
  // so the validation logic is reached.
  it('POST /stripe/create-portal-session returns 400 when user has no billing history', async () => {
    const { config } = require('../config');
    const orig = config.STRIPE_SECRET_KEY;
    config.STRIPE_SECRET_KEY = 'sk_test_fake_for_portal';

    const token = generateTestAccessToken();
    const res = await request(app)
      .post('/api/v1/stripe/create-portal-session')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    config.STRIPE_SECRET_KEY = orig;

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no billing history/i);
  });

  // ─── 4. Webhook with invalid signature → 400 ────────────────
  it('POST /stripe/webhook rejects invalid signature with 400', async () => {
    const payload = JSON.stringify(buildWebhookEvent());
    const badSig = createWebhookSignature(payload, 'wrong_secret_entirely');

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', badSig)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  // ─── 5. Webhook with unhandled event type → 200 ─────────────
  it('POST /stripe/webhook returns 200 for unhandled event types', async () => {
    const event = buildWebhookEvent({ type: 'some.unknown.event' });
    const payload = JSON.stringify(event);
    const sig = createWebhookSignature(payload, 'whsec_test_secret');

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  // ─── 6. Webhook replay (idempotent) → 200 both times ────────
  it('POST /stripe/webhook is idempotent for replayed events', async () => {
    const event = buildWebhookEvent({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_replay_test',
          amount: 4900,
          currency: 'usd',
          receipt_email: TEST_USER_EMAIL,
          customer: 'cus_replay',
        },
      },
    });
    const payload = JSON.stringify(event);
    const sig = createWebhookSignature(payload, 'whsec_test_secret');

    const res1 = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig)
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ received: true });

    // Send the exact same event a second time (new signature because timestamp changes)
    const sig2 = createWebhookSignature(payload, 'whsec_test_secret');
    const res2 = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig2)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ received: true });
  });

  // ─── 7. Refund webhook → tier reverts to free ───────────────
  it('charge.refunded webhook reverts user tier to free', async () => {
    const paymentIntentId = 'pi_refund_test_001';

    // Step 1: Process a payment_intent.succeeded to upgrade to pro
    const successEvent = buildWebhookEvent({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntentId,
          amount: 4900,
          currency: 'usd',
          receipt_email: TEST_USER_EMAIL,
          customer: 'cus_refund_test',
        },
      },
    });
    const successPayload = JSON.stringify(successEvent);
    const successSig = createWebhookSignature(successPayload, 'whsec_test_secret');

    await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', successSig)
      .send(successPayload);

    // Verify user was upgraded
    const user = users.get(TEST_USER_ID)!;
    expect(user.tier).toBe('pro');

    // Step 2: Process charge.refunded with the same payment_intent
    const refundEvent = buildWebhookEvent({
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${crypto.randomBytes(12).toString('hex')}`,
          payment_intent: paymentIntentId,
          amount: 4900,
          currency: 'usd',
        },
      },
    });
    const refundPayload = JSON.stringify(refundEvent);
    const refundSig = createWebhookSignature(refundPayload, 'whsec_test_secret');

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', refundSig)
      .send(refundPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Verify user tier reverted to free
    expect(user.tier).toBe('free');

    // Verify transaction was marked as refunded
    let refundedTx: any = null;
    for (const tx of transactions.values()) {
      if (tx.stripe_payment_id === paymentIntentId) {
        refundedTx = tx;
        break;
      }
    }
    expect(refundedTx).not.toBeNull();
    expect(refundedTx.status).toBe('refunded');
  });

  // ─── 8. Subscription deleted → tier reverts to free ─────────
  it('customer.subscription.deleted webhook reverts user tier to free', async () => {
    // Manually set user to pro (simulating a prior subscription)
    const user = users.get(TEST_USER_ID)!;
    user.tier = 'pro';
    user.storage_limit = 5 * 1024 * 1024 * 1024;

    expect(user.tier).toBe('pro');

    // Process subscription deleted event
    const event = buildWebhookEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: `sub_${crypto.randomBytes(12).toString('hex')}`,
          customer: 'cus_sub_del_test',
          customer_email: TEST_USER_EMAIL,
          status: 'canceled',
        },
      },
    });
    const payload = JSON.stringify(event);
    const sig = createWebhookSignature(payload, 'whsec_test_secret');

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Verify tier reverted to free
    expect(user.tier).toBe('free');
    expect(user.storage_limit).toBe(500 * 1024 * 1024);
  });
});
