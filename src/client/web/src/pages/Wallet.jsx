/**
 * /wallet — the unified Windy wallet (Commerce P1/P2/P3).
 *
 * One card on file, one tap to buy any bundle, everything unlocks across
 * the whole ecosystem. Grandma bar: the three bundles are the hero (one
 * price, one button each); à-la-carte hides behind a link. Desktop and
 * mobile deep-link here with ?sku=<id> when there's no card on file yet.
 *
 * The catalog (names, prices, contents) is 100% server-driven — this page
 * renders whatever the account-server returns.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    Elements,
    PaymentElement,
    useElements,
    useStripe,
} from '@stripe/react-stripe-js'
import { getStripe, stripeConfigured } from '../lib/verifiedHatch'
import {
    getCatalog, getWallet, getEntitlements,
    createSetupIntent, attachPaymentMethod, purchaseSku, cancelSubscription,
} from '../lib/wallet'
import './Hatch.css'

const price = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

function AddCardForm({ onSaved, onCancel }) {
    const stripe = useStripe()
    const elements = useElements()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!stripe || !elements || busy) return
        setBusy(true)
        setError(null)
        const { error: confirmError, setupIntent } = await stripe.confirmSetup({
            elements,
            redirect: 'if_required',
        })
        if (confirmError) {
            setError(confirmError.message || 'The card could not be saved. Try another card.')
            setBusy(false)
            return
        }
        const pmId = typeof setupIntent?.payment_method === 'string'
            ? setupIntent.payment_method
            : setupIntent?.payment_method?.id
        if (!pmId) {
            setError('The card could not be saved. Try again.')
            setBusy(false)
            return
        }
        const attach = await attachPaymentMethod(pmId)
        if (attach.ok) {
            onSaved()
        } else {
            setError(attach.message || 'The card could not be saved. Try again.')
            setBusy(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="hatch-payform">
            <PaymentElement />
            {error && <p className="hatch-banner hatch-banner-error" role="alert">{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" className="hatch-cta hatch-cta-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save card'}
                </button>
                {onCancel && (
                    <button type="button" className="hatch-cta" onClick={onCancel} disabled={busy}>
                        Cancel
                    </button>
                )}
            </div>
            <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
                Your card is stored by Stripe — Windy never sees the number.
            </p>
        </form>
    )
}

export default function Wallet() {
    const [params] = useSearchParams()
    const wantedSku = params.get('sku') || ''
    const [catalog, setCatalog] = useState(null)
    const [wallet, setWallet] = useState(null)
    const [ents, setEnts] = useState(null)
    const [setupSecret, setSetupSecret] = useState(null)
    const [addingCard, setAddingCard] = useState(false)
    const [busySku, setBusySku] = useState(null)
    const [notice, setNotice] = useState(null)
    const [showAlacarte, setShowAlacarte] = useState(false)

    const refresh = async () => {
        const [c, w, e] = await Promise.all([getCatalog(), getWallet(), getEntitlements()])
        if (c.bundles) setCatalog(c)
        if (w.httpStatus === 200) setWallet(w)
        if (e.features) setEnts(e)
    }
    useEffect(() => { refresh() }, [])

    const startAddCard = async () => {
        setNotice(null)
        const si = await createSetupIntent()
        if (si.client_secret) {
            setSetupSecret(si.client_secret)
            setAddingCard(true)
        } else {
            setNotice(si.message || 'Purchases are not open on this server yet.')
        }
    }

    const buy = async (sku) => {
        setNotice(null)
        if (!wallet?.has_payment_method) {
            await startAddCard()
            return
        }
        setBusySku(sku.sku_id)
        const result = await purchaseSku(sku.sku_id)
        if (result.status === 'succeeded') {
            setNotice(`✅ ${sku.name} is active — everything it includes just unlocked across your Windy apps.`)
        } else {
            setNotice(result.message || 'The payment didn\'t go through — nothing was charged.')
        }
        setBusySku(null)
        refresh()
    }

    const cancel = async (subscriptionId, name) => {
        if (!window.confirm(`Cancel ${name}? It stops billing right away and the extras switch off.`)) return
        const res = await cancelSubscription(subscriptionId)
        setNotice(res.ok ? `${name} cancelled — it's off your bill.` : (res.message || 'Could not cancel — try again.'))
        refresh()
    }

    const stripeOptions = useMemo(
        () => (setupSecret ? { clientSecret: setupSecret } : null),
        [setupSecret],
    )

    const activeSubs = (wallet?.purchases || []).filter(p => p.status === 'succeeded' && p.subscription_id)

    return (
        <div className="hatch-page" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
            <h1>Windy Wallet</h1>
            <p style={{ opacity: 0.75 }}>
                One card, one tap — everything unlocks across Windy Word, Cloud, Chat and Translate.
            </p>

            {notice && <p role="status" style={{ padding: '10px 14px', background: 'rgba(102,126,234,0.12)', borderRadius: 10 }}>{notice}</p>}

            {/* ── Payment method ── */}
            <section style={{ margin: '20px 0' }}>
                <h2 style={{ fontSize: 18 }}>Payment method</h2>
                {wallet?.has_payment_method && !addingCard ? (
                    <p>
                        💳 {wallet.payment_method.brand.toUpperCase()} ending in {wallet.payment_method.last4}
                        {' · '}
                        <button className="hatch-comp-link" onClick={startAddCard}>Change card</button>
                    </p>
                ) : addingCard && stripeOptions && stripeConfigured() ? (
                    <Elements stripe={getStripe()} options={stripeOptions}>
                        <AddCardForm
                            onSaved={() => { setAddingCard(false); setSetupSecret(null); setNotice('Card saved — you can buy with one tap now.'); refresh() }}
                            onCancel={() => { setAddingCard(false); setSetupSecret(null) }}
                        />
                    </Elements>
                ) : (
                    <button className="hatch-cta hatch-cta-primary" onClick={startAddCard}>
                        Add a card
                    </button>
                )}
            </section>

            {/* ── Bundles (the hero) ── */}
            <section style={{ margin: '20px 0' }}>
                <h2 style={{ fontSize: 18 }}>Bundles</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    {(catalog?.bundles || []).map((b, i) => (
                        <div
                            key={b.sku_id}
                            style={{
                                border: (b.sku_id === wantedSku || (!wantedSku && i === 1)) ? '2px solid #667eea' : '1px solid rgba(128,128,128,0.35)',
                                borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
                            }}
                        >
                            <strong style={{ fontSize: 16 }}>{b.name}</strong>
                            <span style={{ fontSize: 22, fontWeight: 700 }}>{price(b.price_cents)}<span style={{ fontSize: 13, fontWeight: 400 }}>/month</span></span>
                            <span style={{ fontSize: 13, opacity: 0.75, flex: 1 }}>{b.description}</span>
                            <button
                                className="hatch-cta hatch-cta-primary"
                                disabled={busySku === b.sku_id}
                                onClick={() => buy(b)}
                            >
                                {busySku === b.sku_id ? 'One moment…' : `Get ${b.name}`}
                            </button>
                        </div>
                    ))}
                </div>
                {(catalog?.alacarte || []).length > 0 && (
                    <p style={{ marginTop: 10, fontSize: 13 }}>
                        <button className="hatch-comp-link" onClick={() => setShowAlacarte(v => !v)}>
                            {showAlacarte ? 'Hide single add-ons' : 'Just need one thing? Single add-ons'}
                        </button>
                    </p>
                )}
                {showAlacarte && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(catalog?.alacarte || []).map(a => (
                            <div key={a.sku_id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '8px 12px' }}>
                                <span style={{ flex: 1 }}>
                                    <strong>{a.name}</strong> — {price(a.price_cents)}{a.billing_mode === 'subscription' ? '/month' : ' once'}
                                    <br /><span style={{ fontSize: 12, opacity: 0.7 }}>{a.description}</span>
                                </span>
                                <button className="hatch-cta" disabled={busySku === a.sku_id} onClick={() => buy(a)}>
                                    {busySku === a.sku_id ? '…' : 'Get'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* ── What you have now ── */}
            {ents && (
                <section style={{ margin: '20px 0' }}>
                    <h2 style={{ fontSize: 18 }}>What you have</h2>
                    <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {ents.features.map(f => (
                            <li key={f.feature} style={{ fontSize: 14 }}>
                                {f.on_free_tier ? '◽' : '✅'} {f.label}: <strong>{f.limit_human}</strong>
                                {f.on_free_tier ? ' (free plan)' : f.expires_at ? ` · renews/ends ${f.expires_at.slice(0, 10)}` : ''}
                                {f.message && <div style={{ fontSize: 12, opacity: 0.7 }}>{f.message}</div>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* ── Active plans ── */}
            {activeSubs.length > 0 && (
                <section style={{ margin: '20px 0' }}>
                    <h2 style={{ fontSize: 18 }}>Your plans</h2>
                    {activeSubs.map(p => (
                        <p key={p.purchase_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ flex: 1 }}>{p.sku_id.replace('bundle_', '').replace('alacarte_', '')} — {price(p.amount_cents)}/month</span>
                            <button className="hatch-comp-link" onClick={() => cancel(p.subscription_id, p.sku_id)}>Cancel</button>
                        </p>
                    ))}
                </section>
            )}
        </div>
    )
}
