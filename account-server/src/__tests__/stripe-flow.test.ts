/**
 * Stripe payment flow integration tests.
 *
 * Tests the complete lifecycle:
 *   1. Checkout session creation
 *   2. checkout.session.completed webhook -> tier upgrade
 *   3. customer.subscription.updated webhook -> tier change
 *   4. customer.subscription.deleted webhook -> tier downgrade
 *   5. invoice.payment_failed webhook -> failed transaction recorded
 *   6. charge.refunded webhook -> tier reverted
 *
 * All Stripe API calls are mocked — no real Stripe interaction.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// ═══════════════════════════════════════════
//  RATE-LIMIT MOCK (noop)
// ═══════════════════════════════════════════

jest.mock('express-rate-limit', () => {
  return () => (_req: Request, _res: Response, next: NextFunction) => next();
});

// ═══════════════════════════════════════════
//  IN-MEMORY DATA STORES
// ═══════════════════════════════════════════

const TEST_USER_ID = 'user-stripe-flow-001';
const TEST_USER_EMAIL = 'stripe-flow@windypro.com';
const JWT_SECRET = 'test-secret-stripe-flow';

const users = new Map<string, any>();
const transactions = new Map<string, any>();

function resetStores() {
  users.clear();
  transactions.clear();

  users.set(TEST_USER_ID, {
    id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    name: 'Stripe Flow User',
    tier: 'free',
    stripe_customer_id: null,
    storage_limit: 500 * 1024 * 1024,
    storage_used: 0,
    role: 'user',
  });
}

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
        // checkout.session.completed / customer.subscription.updated — generic tier + storage_limit + WHERE id
        if (sql.includes('UPDATE users SET tier') && sql.includes('storage_limit') && !sql.includes("'free'") && sql.includes('WHERE id')) {
          const user = users.get(args[args.length - 1]);
          if (user) {
            user.tier = args[0];
            user.storage_limit = args[1];
          }
          return { changes: user ? 1 : 0 };
        }
        // Subscription deleted — tier = 'free' by email
        if (sql.includes("UPDATE users SET tier = 'free'") && sql.includes('WHERE email')) {
          for (const u of users.values()) {
            if (u.email === args[args.length - 1]) {
              u.tier = 'free';
              u.storage_limit = args[0];
            }
          }
          return { changes: 1 };
        }
        // Refund — tier = 'free' by id
        if (sql.includes("UPDATE users SET tier = 'free'") && sql.includes('WHERE id')) {
          const user = users.get(args[args.length - 1]);
          if (user) {
            user.tier = 'free';
            user.storage_limit = args[0];
          }
          return { changes: user ? 1 : 0 };
        }
        if (sql.includes("UPDATE transactions SET status")) {
          const txId = args[0];
          for (const tx of transactions.values()) {
            if (tx.id === txId) {
              const statusMatch = sql.match(/status\s*=\s*'(\w+)'/);
              tx.status = statusMatch ? statusMatch[1] : 'refunded';
            }
          }
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get: (...args: any[]) => {
        if (sql.includes('FROM users WHERE id')) {
          return users.get(args[0]) || null;
        }
        if (sql.includes('FROM users WHERE email')) {
          for (const u of users.values()) {
            if (u.email === args[0]) return u;
          }
          return null;
        }
        if (sql.includes('stripe_customer_id FROM users WHERE id')) {
          return users.get(args[0]) || null;
        }
        if (sql.includes('FROM transactions WHERE stripe_payment_id')) {
          for (const tx of transactions.values()) {
            if (tx.stripe_payment_id === args[0]) return tx;
          }
          return null;
        }
        if (sql.includes('SELECT SUM')) {
          let total = 0;
          for (const tx of transactions.values()) {
            if (tx.user_id === args[0] && tx.status === 'paid') total += tx.amount;
          }
          return { total };
        }
        if (sql.includes('SELECT COUNT')) {
          let count = 0;
          for (const tx of transactions.values()) {
            if (tx.user_id === args[0] && tx.type === 'subscription' && tx.status === 'paid') count++;
          }
          return { count };
        }
        return null;
      },
      all: () => [],
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
    JWT_SECRET,
    JWT_EXPIRY: '15m',
    DB_PATH: ':memory:',
    DATA_ROOT: '/tmp/test',
    UPLOADS_PATH: '/tmp/test/uploads',
    PORT: 0,
    BCRYPT_ROUNDS: 4,
    MAX_DEVICES: 5,
    STRIPE_SECRET_KEY: 'sk_test_mock_stripe_key',
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
  generateKeyPair: jest.fn(),
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
//  MOCK: stripe (the npm package)
// ═══════════════════════════════════════════

const mockCheckoutSessionCreate = jest.fn().mockResolvedValue({
  id: 'cs_test_session_123',
  url: 'https://checkout.stripe.com/pay/cs_test_session_123',
});
const mockCustomerCreate = jest.fn().mockResolvedValue({
  id: 'cus_test_new_customer',
});
const mockPortalSessionCreate = jest.fn().mockResolvedValue({
  url: 'https://billing.stripe.com/session/test_portal',
});

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomerCreate },
    checkout: { sessions: { create: mockCheckoutSessionCreate } },
    billingPortal: { sessions: { create: mockPortalSessionCreate } },
  }));
});

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function generateToken(userId = TEST_USER_ID): string {
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
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

function createSignature(payload: string, secret: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function webhookEvent(type: string, object: Record<string, any>): Record<string, any> {
  return {
    id: `evt_${crypto.randomBytes(12).toString('hex')}`,
    object: 'event',
    type,
    data: { object },
  };
}

function sendWebhook(app: Express, event: Record<string, any>) {
  const payload = JSON.stringify(event);
  const sig = createSignature(payload, 'whsec_test_secret');
  return request(app)
    .post('/api/v1/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', sig)
    .send(payload);
}

// ═══════════════════════════════════════════
//  APP SETUP
// ═══════════════════════════════════════════

let app: Express;

beforeEach(() => {
  resetStores();
  jest.clearAllMocks();

  app = express();
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

describe('Stripe Payment Flow — End to End', () => {
  // ─── 1. Checkout session creation ────────────────────────────

  it('creates a checkout session and returns a URL', async () => {
    // Set the STRIPE_PRO_MONTHLY_PRICE_ID env var so price resolution works
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_pro_monthly_test';

    const token = generateToken();
    const res = await request(app)
      .post('/api/v1/stripe/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'pro', billing_type: 'monthly' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
    expect(res.body.sessionId).toBe('cs_test_session_123');
    expect(mockCheckoutSessionCreate).toHaveBeenCalledTimes(1);

    // Verify customer was created since user had no stripe_customer_id
    expect(mockCustomerCreate).toHaveBeenCalledTimes(1);

    // Verify stripe_customer_id was saved
    const user = users.get(TEST_USER_ID)!;
    expect(user.stripe_customer_id).toBe('cus_test_new_customer');

    delete process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
  });

  // ─── 2. checkout.session.completed → tier upgraded ───────────

  it('checkout.session.completed upgrades user tier to pro', async () => {
    const event = webhookEvent('checkout.session.completed', {
      id: 'cs_completed_001',
      customer: 'cus_checkout_test',
      customer_email: TEST_USER_EMAIL,
      amount_total: 499,
      currency: 'usd',
      mode: 'subscription',
      payment_intent: 'pi_checkout_001',
      metadata: {
        windy_user_id: TEST_USER_ID,
        tier: 'pro',
        billing_type: 'monthly',
      },
    });

    const res = await sendWebhook(app, event);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const user = users.get(TEST_USER_ID)!;
    expect(user.tier).toBe('pro');
    expect(user.storage_limit).toBe(5 * 1024 * 1024 * 1024); // 5 GB
    expect(user.stripe_customer_id).toBe('cus_checkout_test');

    // Verify transaction was recorded
    expect(transactions.size).toBe(1);
    const tx = [...transactions.values()][0];
    expect(tx.user_id).toBe(TEST_USER_ID);
    expect(tx.status).toBe('paid');
    expect(tx.type).toBe('subscription');
  });

  // ─── 3. customer.subscription.updated → tier changed ─────────

  it('customer.subscription.updated changes tier based on new price', async () => {
    // Pre-set user to pro
    const user = users.get(TEST_USER_ID)!;
    user.tier = 'pro';
    user.storage_limit = 5 * 1024 * 1024 * 1024;

    const event = webhookEvent('customer.subscription.updated', {
      id: 'sub_updated_001',
      customer: 'cus_sub_test',
      customer_email: TEST_USER_EMAIL,
      status: 'active',
      items: {
        data: [{
          price: {
            unit_amount: 7900, // translate tier price
            currency: 'usd',
          },
        }],
      },
    });

    const res = await sendWebhook(app, event);

    expect(res.status).toBe(200);
    expect(user.tier).toBe('translate');
    expect(user.storage_limit).toBe(10 * 1024 * 1024 * 1024); // 10 GB
  });

  it('customer.subscription.updated downgrades on past_due status', async () => {
    const user = users.get(TEST_USER_ID)!;
    user.tier = 'pro';
    user.storage_limit = 5 * 1024 * 1024 * 1024;

    const event = webhookEvent('customer.subscription.updated', {
      id: 'sub_pastdue_001',
      customer: 'cus_pastdue',
      customer_email: TEST_USER_EMAIL,
      status: 'past_due',
      items: { data: [] },
    });

    const res = await sendWebhook(app, event);

    expect(res.status).toBe(200);
    expect(user.tier).toBe('free');
    expect(user.storage_limit).toBe(500 * 1024 * 1024);
  });

  // ─── 4. customer.subscription.deleted → reverted to free ─────

  it('customer.subscription.deleted reverts user to free tier', async () => {
    const user = users.get(TEST_USER_ID)!;
    user.tier = 'pro';
    user.storage_limit = 5 * 1024 * 1024 * 1024;

    const event = webhookEvent('customer.subscription.deleted', {
      id: 'sub_deleted_001',
      customer: 'cus_del',
      customer_email: TEST_USER_EMAIL,
      status: 'canceled',
    });

    const res = await sendWebhook(app, event);

    expect(res.status).toBe(200);
    expect(user.tier).toBe('free');
    expect(user.storage_limit).toBe(500 * 1024 * 1024);
  });

  // ─── 5. invoice.payment_failed → failed transaction recorded ─

  it('invoice.payment_failed records a failed transaction', async () => {
    const event = webhookEvent('invoice.payment_failed', {
      id: 'in_failed_001',
      customer: 'cus_fail',
      customer_email: TEST_USER_EMAIL,
      amount_due: 499,
      currency: 'usd',
    });

    const res = await sendWebhook(app, event);

    expect(res.status).toBe(200);

    // Verify a failed transaction was recorded
    expect(transactions.size).toBe(1);
    const tx = [...transactions.values()][0];
    expect(tx.status).toBe('failed');
    expect(tx.type).toBe('subscription');
    expect(tx.user_id).toBe(TEST_USER_ID);
  });

  // ─── 6. charge.refunded → tier reverted ──────────────────────

  it('charge.refunded reverts tier to free and marks transaction', async () => {
    // First, simulate a successful payment
    const paymentIntentId = 'pi_refund_flow_001';
    const successEvent = webhookEvent('payment_intent.succeeded', {
      id: paymentIntentId,
      amount: 4900,
      currency: 'usd',
      receipt_email: TEST_USER_EMAIL,
      customer: 'cus_refund_flow',
    });

    await sendWebhook(app, successEvent);

    const user = users.get(TEST_USER_ID)!;
    expect(user.tier).toBe('pro');

    // Now refund
    const refundEvent = webhookEvent('charge.refunded', {
      id: `ch_${crypto.randomBytes(8).toString('hex')}`,
      payment_intent: paymentIntentId,
      amount: 4900,
      currency: 'usd',
    });

    const res = await sendWebhook(app, refundEvent);

    expect(res.status).toBe(200);
    expect(user.tier).toBe('free');

    // Verify transaction marked as refunded
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

  // ─── 7. Webhook signature verification ───────────────────────

  it('rejects webhook with missing signature header', async () => {
    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(webhookEvent('test.event', {})));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing stripe-signature/i);
  });

  it('rejects webhook with invalid signature', async () => {
    const payload = JSON.stringify(webhookEvent('test.event', {}));
    const badSig = createSignature(payload, 'wrong_secret');

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', badSig)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  // ─── 8. Full lifecycle: checkout → subscription delete ───────

  it('handles full lifecycle: checkout completed then subscription deleted', async () => {
    // Step 1: checkout.session.completed — upgrade to translate
    const checkoutEvent = webhookEvent('checkout.session.completed', {
      id: 'cs_lifecycle_001',
      customer: 'cus_lifecycle',
      customer_email: TEST_USER_EMAIL,
      amount_total: 899,
      currency: 'usd',
      mode: 'subscription',
      subscription: 'sub_lifecycle_001',
      metadata: {
        windy_user_id: TEST_USER_ID,
        tier: 'translate',
        billing_type: 'monthly',
      },
    });

    await sendWebhook(app, checkoutEvent);

    const user = users.get(TEST_USER_ID)!;
    expect(user.tier).toBe('translate');
    expect(user.storage_limit).toBe(10 * 1024 * 1024 * 1024);

    // Step 2: customer.subscription.deleted — back to free
    const deleteEvent = webhookEvent('customer.subscription.deleted', {
      id: 'sub_lifecycle_001',
      customer: 'cus_lifecycle',
      customer_email: TEST_USER_EMAIL,
      status: 'canceled',
    });

    await sendWebhook(app, deleteEvent);

    expect(user.tier).toBe('free');
    expect(user.storage_limit).toBe(500 * 1024 * 1024);
  });
});
