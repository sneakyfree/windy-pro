/**
 * /upgrade — lift an existing free hatch to VERIFIED for $1 (ADR-056).
 *
 * PUBLIC route (no ProtectedRoute): the midwife links here from Windy
 * Chat when a free helper runs low on shared thinking power, and that
 * browser may not carry a windy session. Payment proof (or a ballroom
 * comp code) IS the authorization on the Eternitas side; the endpoint
 * re-mints the helper's passport token at verified trust, so nothing
 * else needs doing — Mail/Chat/Cloud pick the change up via
 * trust.changed.
 *
 * Passport prefill order: ?passport= param → localStorage hatch state.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
    upgradePassport,
} from '../lib/verifiedHatch'
import { loadSavedHatch } from '../utils/hatchStorage'
import './Hatch.css'

function PayForm({ amountCents, busyLabel, onPaid, onBack }) {
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
                    {busy ? busyLabel : `Pay $${dollars} and upgrade`}
                </button>
                <button type="button" className="hatch-cta" onClick={onBack} disabled={busy}>
                    Back
                </button>
            </div>
        </form>
    )
}

export default function Upgrade() {
    const [params] = useSearchParams()
    const savedPassport = useMemo(
        () => params.get('passport') || loadSavedHatch()?.passport_number || '',
        [params]
    )

    // phase: 'form' | 'pay' | 'done'
    const [phase, setPhase] = useState('form')
    const [passport, setPassport] = useState(savedPassport)
    const [intent, setIntent] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const [codeOpen, setCodeOpen] = useState(false)
    const [code, setCode] = useState('')
    const [result, setResult] = useState(null)

    const cleanPassport = passport.trim().toUpperCase()

    const finishUpgrade = async ({ paymentIntentId, compCode }) => {
        setBusy(true)
        setError(null)
        try {
            const res = await upgradePassport({
                passport: cleanPassport,
                paymentIntentId,
                compCode,
            })
            setResult(res)
            setPhase('done')
        } catch (err) {
            setError(err.message)
            setPhase('form')
        } finally {
            setBusy(false)
        }
    }

    const handlePayClick = async () => {
        if (!cleanPassport || busy) return
        setBusy(true)
        setError(null)
        try {
            if (!stripeConfigured()) {
                setError(
                    "The verified upgrade isn't open quite yet — check back soon."
                )
                return
            }
            const res = await createVerifiedHatchIntent('')
            if (res.unavailable) {
                setError(
                    "The verified upgrade isn't open quite yet — check back soon."
                )
                return
            }
            setIntent(res)
            setPhase('pay')
        } catch (err) {
            setError(err.message)
        } finally {
            setBusy(false)
        }
    }

    if (phase === 'done') {
        return (
            <div className="hatch-page">
                <div className="hatch-modal" role="dialog" aria-label="Upgrade complete">
                    <header className="hatch-header">
                        <div className="hatch-mascot" aria-hidden="true">🪰</div>
                        <h1 className="hatch-title">Your helper is verified!</h1>
                        <p className="hatch-sub">
                            Passport {result?.passport} now carries verified trust.
                            Everything updates on its own — nothing else to do.
                            Just go back to your chat and keep talking.
                        </p>
                    </header>
                </div>
            </div>
        )
    }

    if (phase === 'pay' && intent) {
        return (
            <div className="hatch-page">
                <div className="hatch-modal" role="dialog" aria-label="Verified upgrade payment">
                    <header className="hatch-header">
                        <div className="hatch-mascot" aria-hidden="true">🪰</div>
                        <h1 className="hatch-title">One dollar, one time</h1>
                        <p className="hatch-sub">
                            Upgrading {cleanPassport}. Your card goes to Stripe,
                            never to us.
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
                            busyLabel="Upgrading your helper…"
                            onPaid={(paymentIntentId) => finishUpgrade({ paymentIntentId })}
                            onBack={() => setPhase('form')}
                        />
                    </Elements>
                </div>
            </div>
        )
    }

    return (
        <div className="hatch-page">
            <div className="hatch-modal" role="dialog" aria-label="Upgrade your helper">
                <header className="hatch-header">
                    <div className="hatch-mascot" aria-hidden="true">🪰</div>
                    <h1 className="hatch-title">Give your helper verified trust</h1>
                    <p className="hatch-sub">
                        One dollar, one time. Your helper's Eternitas passport is
                        upgraded to verified — full access to the whole Windy
                        ecosystem, instantly. It's a dollar so we know you're a
                        person — not a bot farm.
                    </p>
                </header>

                <div className="hatch-body">
                    <div className="hatch-comp-row">
                        <input
                            className="hatch-comp-input"
                            style={{ width: 'min(280px, 100%)' }}
                            placeholder="ET26-XXXX-XXXX"
                            value={passport}
                            onChange={(e) => setPassport(e.target.value.toUpperCase())}
                            aria-label="Helper passport number"
                        />
                    </div>

                    {error && (
                        <div className="hatch-banner hatch-banner-error" role="alert">
                            {error}
                        </div>
                    )}
                </div>

                <div className="hatch-ctas">
                    <button
                        type="button"
                        className="hatch-cta hatch-cta-primary"
                        onClick={handlePayClick}
                        disabled={!cleanPassport || busy}
                    >
                        {busy ? 'One moment…' : 'Upgrade — $1'}
                    </button>
                </div>

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
                                onKeyDown={(e) =>
                                    e.key === 'Enter' &&
                                    code.trim() &&
                                    cleanPassport &&
                                    finishUpgrade({ compCode: code.trim() })
                                }
                                aria-label="Comp code"
                                autoFocus
                            />
                            <button
                                type="button"
                                className="hatch-cta"
                                onClick={() => finishUpgrade({ compCode: code.trim() })}
                                disabled={!code.trim() || !cleanPassport || busy}
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
