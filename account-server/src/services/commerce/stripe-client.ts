/**
 * Shared Stripe client for the commerce engine. Same lazy pattern as
 * billing.ts, plus a test seam so the suite can inject a mock without
 * network access. TEST MODE ONLY until Grant's gated go-live: the key is
 * whatever STRIPE_SECRET_KEY holds — staging/dev must set the sk_test_* key
 * (by name from the lockbox), never a live key.
 */
import Stripe from 'stripe';
import { config } from '../../config';

let _stripe: Stripe | null = null;
let _testOverride: Stripe | null = null;

export function getStripeClient(): Stripe {
    if (_testOverride) return _testOverride;
    if (!_stripe) {
        if (!config.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY not configured');
        }
        _stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
    }
    return _stripe;
}

export function stripeConfigured(): boolean {
    return !!_testOverride || !!config.STRIPE_SECRET_KEY;
}

/** Test seam — inject a mock Stripe client (jest). */
export function setStripeClientForTests(client: any | null): void {
    _testOverride = client;
}
