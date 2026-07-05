/**
 * HatchChooser — the ADR-056 hatch fork: "Hatch free" vs "$1 verified".
 *
 * Shown before the ceremony starts. Calls onChoose(extras) where extras
 * is {} (free), { verified_payment_intent_id } ($1 paid + confirmed via
 * Stripe Elements), or { comp_code } (ballroom comp — ADR-056 D5).
 *
 * Copy rules (ADR-052): the free path is NEVER phrased as a trial or
 * "limited" — free is a real, permanent tier. The $1 buys trust (a
 * verified Eternitas passport), not compute.
 *
 * Dark-safe: while verified_hatch_enabled is off in prod (or the build
 * has no Stripe key), picking "$1 verified" shows a friendly
 * "not open yet" note and the free path stays one tap away.
 */
import { useState } from 'react'
import {
    Elements,
    PaymentElement,
    useElements,
    useStripe,
} from '@stripe/react-stripe-js'
import {
    createVerifiedHatchIntent,
    getStripe,
    stripeConfigured,
} from '../lib/verifiedHatch'

function getStoredEmail() {
    try {
        return JSON.parse(localStorage.getItem('windy_user') || 'null')?.email || ''
    } catch {
        return ''
    }
}

// ─── The $1 card-confirm step (inside <Elements>) ──────────────────
function PayForm({ amountCents, onPaid, onBack }) {
    const stripe = useStripe()
    const elements = useElements()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const dollars = ((amountCents || 100) / 100).toFixed(2).replace(/\.00$/, '')

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!stripe || !elements || busy) return
        setBusy(true)
        setError(null)
        const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
        })
        if (confirmError) {
            setError(confirmError.message || 'The card was declined. Try another card.')
            setBusy(false)
            return
        }
        if (paymentIntent?.status === 'succeeded') {
            onPaid(paymentIntent.id)
            return
        }
        setError('The payment did not complete. Try again.')
        setBusy(false)
    }

    return (
        <form onSubmit={handleSubmit} className="hatch-payform">
            <PaymentElement options={{ layout: 'tabs' }} />
            {error && (
                <div className="hatch-banner hatch-banner-error" role="alert">
                    {error}
                </div>
            )}
            <div className="hatch-ctas">
                <button
                    type="submit"
                    className="hatch-cta hatch-cta-primary"
                    disabled={!stripe || busy}
                >
                    {busy ? 'Checking your card…' : `Pay $${dollars} and hatch`}
                </button>
                <button type="button" className="hatch-cta" onClick={onBack} disabled={busy}>
                    Back
                </button>
            </div>
        </form>
    )
}

// ─── Main chooser ──────────────────────────────────────────────────
export default function HatchChooser({ onChoose }) {
    // phase: 'fork' | 'pay'
    const [phase, setPhase] = useState('fork')
    const [intent, setIntent] = useState(null) // { client_secret, payment_intent_id, amount_cents }
    const [notice, setNotice] = useState(null) // friendly info line (e.g. flag dark)
    const [busy, setBusy] = useState(false)
    const [codeOpen, setCodeOpen] = useState(false)
    const [code, setCode] = useState('')

    const handleVerified = async () => {
        if (busy) return
        setBusy(true)
        setNotice(null)
        try {
            if (!stripeConfigured()) {
                setNotice(
                    "The $1 verified hatch isn't open quite yet — hatch free below, and you can upgrade any time."
                )
                return
            }
            const result = await createVerifiedHatchIntent(getStoredEmail())
            if (result.unavailable) {
                setNotice(
                    "The $1 verified hatch isn't open quite yet — hatch free below, and you can upgrade any time."
                )
                return
            }
            setIntent(result)
            setPhase('pay')
        } catch (err) {
            setNotice(err.message)
        } finally {
            setBusy(false)
        }
    }

    const handleUseCode = () => {
        const trimmed = code.trim()
        if (!trimmed) return
        onChoose({ comp_code: trimmed })
    }

    if (phase === 'pay' && intent) {
        return (
            <div className="hatch-page">
                <div className="hatch-modal" role="dialog" aria-label="Verified hatch payment">
                    <header className="hatch-header">
                        <div className="hatch-mascot" aria-hidden="true">🪰</div>
                        <h1 className="hatch-title">One dollar, one time</h1>
                        <p className="hatch-sub">
                            Your card goes to Stripe, never to us. When it clears,
                            your helper is born verified.
                        </p>
                    </header>
                    <Elements
                        stripe={getStripe()}
                        options={{
                            clientSecret: intent.client_secret,
                            appearance: {
                                theme: 'night',
                                variables: { colorPrimary: '#8B5CF6' },
                            },
                        }}
                    >
                        <PayForm
                            amountCents={intent.amount_cents}
                            onPaid={(paymentIntentId) =>
                                onChoose({ verified_payment_intent_id: paymentIntentId })
                            }
                            onBack={() => setPhase('fork')}
                        />
                    </Elements>
                </div>
            </div>
        )
    }

    return (
        <div className="hatch-page">
            <div className="hatch-modal" role="dialog" aria-label="Choose how to hatch">
                <header className="hatch-header">
                    <div className="hatch-mascot" aria-hidden="true">🪰</div>
                    <h1 className="hatch-title">Bring your helper to life</h1>
                    <p className="hatch-sub">Two ways to hatch — both are yours forever.</p>
                </header>

                <div className="hatch-fork">
                    <section className="hatch-fork-card">
                        <h2 className="hatch-fork-title">Hatch free</h2>
                        <p className="hatch-fork-body">
                            No card, no cost — ever. Your helper runs on shared
                            thinking power, and it will help you connect power of
                            your own whenever you're ready.
                        </p>
                        <button
                            type="button"
                            className="hatch-cta"
                            onClick={() => onChoose({})}
                        >
                            Hatch free
                        </button>
                    </section>

                    <section className="hatch-fork-card hatch-fork-card-verified">
                        <h2 className="hatch-fork-title">Verified hatch — $1</h2>
                        <p className="hatch-fork-body">
                            One dollar, one time. Your helper is born with its
                            verified Eternitas passport and full access to the
                            whole Windy ecosystem, instantly. It's a dollar so we
                            know you're a person — not a bot farm.
                        </p>
                        <button
                            type="button"
                            className="hatch-cta hatch-cta-primary"
                            onClick={handleVerified}
                            disabled={busy}
                        >
                            {busy ? 'One moment…' : 'Continue — $1'}
                        </button>
                    </section>
                </div>

                {notice && (
                    <div className="hatch-banner hatch-banner-info" role="status">
                        {notice}
                    </div>
                )}

                <div className="hatch-comp">
                    {!codeOpen ? (
                        <button
                            type="button"
                            className="hatch-comp-link"
                            onClick={() => setCodeOpen(true)}
                        >
                            Have a code from the Windstorm team?
                        </button>
                    ) : (
                        <div className="hatch-comp-row">
                            <input
                                className="hatch-comp-input"
                                placeholder="WINDY-XXXX-XXXX"
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && handleUseCode()}
                                aria-label="Comp code"
                                autoFocus
                            />
                            <button
                                type="button"
                                className="hatch-cta"
                                onClick={handleUseCode}
                                disabled={!code.trim()}
                            >
                                Use my code
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
