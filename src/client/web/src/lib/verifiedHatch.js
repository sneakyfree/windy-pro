/**
 * ADR-056 — browser-side client for the $1 verified hatch.
 *
 * The PaymentIntent is created against Eternitas DIRECTLY (the endpoint
 * is unauthenticated by design — the payer has no operator yet — and
 * Eternitas CORS allows app.windyword.ai). The card is confirmed with
 * Stripe.js, so the PAN never touches Windy servers (PCI SAQ-A), and
 * the resulting payment_intent_id is passed into the hatch SSE where
 * the account-server → Eternitas chain proves it server-side. The
 * browser is never trusted about payment status.
 *
 * While verified_hatch_enabled is dark in prod, the intent endpoint
 * returns 403 — surfaced here as { unavailable: true } so the UI can
 * fall back to the free path gracefully.
 */
import { loadStripe } from '@stripe/stripe-js'

const ETERNITAS_URL =
    import.meta.env.VITE_ETERNITAS_URL || 'https://api.eternitas.ai'
const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''

let stripePromise = null

/** True when the build carries a publishable key — without one the $1
 *  path degrades to the same "not open yet" message as the dark flag. */
export function stripeConfigured() {
    return !!STRIPE_PK
}

export function getStripe() {
    if (!stripePromise) stripePromise = loadStripe(STRIPE_PK)
    return stripePromise
}

/**
 * Create the $1 PaymentIntent. Returns:
 *   { client_secret, payment_intent_id, amount_cents }  on success
 *   { unavailable: true }                               while the flag is dark
 * Throws Error(message) with grandma-safe copy on other failures.
 */
export async function createVerifiedHatchIntent(creatorEmail) {
    if (!STRIPE_PK) return { unavailable: true }
    let resp
    try {
        resp = await fetch(
            `${ETERNITAS_URL}/api/v1/payments/verified-hatch/intent`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creator_email: creatorEmail || '' }),
            }
        )
    } catch {
        throw new Error(
            "We couldn't reach the payment service. Check your internet and try again."
        )
    }
    if (resp.status === 403) return { unavailable: true }
    if (resp.status === 429) {
        throw new Error('Too many attempts — wait a minute, then try again.')
    }
    if (!resp.ok) {
        throw new Error('Could not start the payment. Try again in a moment.')
    }
    return resp.json()
}

/**
 * Lift an existing free hatch to verified — $1 payment proof OR a
 * one-use ballroom comp code. Returns the Eternitas response
 * ({ passport, trust_score, trust_ceiling, status }) on success;
 * throws Error(message) with friendly copy otherwise.
 */
export async function upgradePassport({ passport, paymentIntentId, compCode }) {
    const body = { passport }
    if (paymentIntentId) body.payment_intent_id = paymentIntentId
    if (compCode) body.comp_code = compCode

    let resp
    try {
        resp = await fetch(
            `${ETERNITAS_URL}/api/v1/payments/verified-hatch/upgrade`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        )
    } catch {
        throw new Error(
            "We couldn't reach the upgrade service. Check your internet and try again."
        )
    }
    if (resp.ok) return resp.json()

    let detail = ''
    try {
        detail = (await resp.json())?.detail || ''
    } catch {
        /* non-JSON body */
    }
    if (resp.status === 403) {
        throw new Error(
            "The verified upgrade isn't open quite yet — check back soon."
        )
    }
    if (resp.status === 404) {
        throw new Error(
            "We couldn't find that passport. Double-check the letters and dashes."
        )
    }
    if (resp.status === 409) {
        throw new Error(
            compCode
                ? 'That code has already been used.'
                : 'That payment was already used for an upgrade.'
        )
    }
    if (resp.status === 402) {
        throw new Error(
            compCode
                ? "That code didn't work — double-check the letters and try again."
                : 'The payment could not be verified. Try again in a moment.'
        )
    }
    throw new Error(detail || 'Something went wrong. Try again in a moment.')
}
