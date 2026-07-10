/**
 * Unified wallet + catalog + entitlement routes (Commerce P1/P2).
 *
 * GET  /api/v1/catalog                          — public server-driven SKU catalog
 * GET  /api/v1/wallet                           — payment method + purchase history
 * POST /api/v1/wallet/setup-intent              — start saving a card (Stripe Elements)
 * POST /api/v1/wallet/payment-method            — set the saved card as wallet default
 * POST /api/v1/wallet/purchase                  — ONE-TAP purchase of any SKU (idempotent)
 * POST /api/v1/wallet/subscriptions/:id/cancel  — cancel a plan (clean re-lock)
 * GET  /api/v1/entitlements                     — human-readable entitlement status
 * GET  /api/v1/entitlements/limits              — compact feature→limit map (service reads)
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { makeRateLimiter } from '../services/rate-limiter';
import { publicCatalog } from '../services/commerce/catalog';
import {
    walletSummary, createSetupIntent, setDefaultPaymentMethod,
    purchaseSku, cancelSubscription, PurchaseError,
} from '../services/commerce/purchase';
import { entitlementStatus, effectiveLimits, expireDueEntitlements } from '../services/commerce/entitlements';

export const catalogRouter = Router();
export const walletRouter = Router();
export const entitlementsRouter = Router();

function freshUser(userId: string): any | undefined {
    return getDb().get(
        'SELECT id, email, name, tier, frozen, stripe_customer_id, windy_identity_id FROM users WHERE id = ?', userId,
    );
}

function sendPurchaseError(res: Response, err: any): void {
    if (err instanceof PurchaseError) {
        res.status(err.httpStatus).json({ error: err.code, message: err.friendly });
        return;
    }
    if (err?.message === 'STRIPE_SECRET_KEY not configured') {
        res.status(503).json({ error: 'billing_unconfigured', message: 'Purchases are not open on this server yet.' });
        return;
    }
    console.error('[Wallet] error:', err);
    res.status(500).json({ error: 'internal_error', message: 'Something went wrong — nothing was charged.' });
}

// ─── Catalog (public — clients render whatever this returns) ────────────────

catalogRouter.get('/', (_req: Request, res: Response) => {
    try {
        res.json({ ok: true, ...publicCatalog() });
    } catch (err) {
        console.error('[Catalog] error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

// ─── Wallet ─────────────────────────────────────────────────────────────────

const purchaseLimiter = makeRateLimiter('wallet-purchase', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 10,
    message: { error: 'too_many_requests', message: 'Too many purchase attempts — wait a minute and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const walletSetupLimiter = makeRateLimiter('wallet-setup', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 20,
    message: { error: 'too_many_requests', message: 'Too many card-setup attempts — wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

walletRouter.get('/', authenticateToken, async (req: Request, res: Response) => {
    try {
        const user = freshUser((req as AuthRequest).user.userId);
        if (!user) return res.status(404).json({ error: 'user_not_found' });
        res.json({ ok: true, ...(await walletSummary(user)) });
    } catch (err) {
        sendPurchaseError(res, err);
    }
});

walletRouter.post('/setup-intent', authenticateToken, walletSetupLimiter, async (req: Request, res: Response) => {
    try {
        const user = freshUser((req as AuthRequest).user.userId);
        if (!user) return res.status(404).json({ error: 'user_not_found' });
        res.json({ ok: true, ...(await createSetupIntent(user)) });
    } catch (err) {
        sendPurchaseError(res, err);
    }
});

walletRouter.post('/payment-method', authenticateToken, walletSetupLimiter, async (req: Request, res: Response) => {
    try {
        const user = freshUser((req as AuthRequest).user.userId);
        if (!user) return res.status(404).json({ error: 'user_not_found' });
        const { payment_method_id } = req.body || {};
        if (!payment_method_id || typeof payment_method_id !== 'string') {
            return res.status(400).json({ error: 'missing_payment_method', message: 'payment_method_id is required.' });
        }
        await setDefaultPaymentMethod(user, payment_method_id);
        res.json({ ok: true });
    } catch (err) {
        sendPurchaseError(res, err);
    }
});

walletRouter.post('/purchase', authenticateToken, purchaseLimiter, async (req: Request, res: Response) => {
    try {
        const user = freshUser((req as AuthRequest).user.userId);
        if (!user) return res.status(404).json({ error: 'user_not_found' });
        const { sku_id, idempotency_key } = req.body || {};
        if (!sku_id || typeof sku_id !== 'string') {
            return res.status(400).json({ error: 'missing_sku', message: 'sku_id is required.' });
        }
        const result = await purchaseSku(user, sku_id, String(idempotency_key || ''));
        const httpStatus = result.status === 'succeeded' ? 200
            : result.status === 'failed' ? 402
            : 200;
        res.status(httpStatus).json({ ok: result.status === 'succeeded', ...result });
    } catch (err) {
        sendPurchaseError(res, err);
    }
});

walletRouter.post('/subscriptions/:id/cancel', authenticateToken, async (req: Request, res: Response) => {
    try {
        const user = freshUser((req as AuthRequest).user.userId);
        if (!user) return res.status(404).json({ error: 'user_not_found' });
        res.json(await cancelSubscription(user, String(req.params.id)));
    } catch (err) {
        sendPurchaseError(res, err);
    }
});

// ─── Entitlements ───────────────────────────────────────────────────────────

entitlementsRouter.get('/', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        // Opportunistic expiry so a read never shows a stale unlock.
        await expireDueEntitlements(userId);
        res.json({ ok: true, ...entitlementStatus(userId) });
    } catch (err) {
        console.error('[Entitlements] error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});

entitlementsRouter.get('/limits', authenticateToken, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user.userId;
        await expireDueEntitlements(userId);
        res.json({ ok: true, limits: effectiveLimits(userId) });
    } catch (err) {
        console.error('[Entitlements] error:', err);
        res.status(500).json({ error: 'internal_error' });
    }
});
