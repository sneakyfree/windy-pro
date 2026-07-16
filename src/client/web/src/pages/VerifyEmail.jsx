import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authFetch } from '../lib/authFetch'
import './Auth.css'
import './VerifyEmail.css'

const RESEND_COOLDOWN_SECONDS = 30

function getStoredEmail() {
    try {
        const raw = localStorage.getItem('windy_user')
        if (!raw) return ''
        const parsed = JSON.parse(raw)
        return parsed?.email || ''
    } catch {
        return ''
    }
}

export default function VerifyEmail() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('windy_token') : null
    const location = useLocation()
    const navigate = useNavigate()

    // Keep hooks order stable before the early return below. Hooks must not be
    // called conditionally, so everything happens first, and we branch on token
    // only in the returned JSX.
    const emailFromState = location.state?.email || getStoredEmail()
    const [email] = useState(emailFromState)
    const [code, setCode] = useState('')
    const [status, setStatus] = useState('idle') // 'idle' | 'submitting' | 'resending' | 'success'
    const [message, setMessage] = useState('')
    const [messageTone, setMessageTone] = useState('info') // 'info' | 'error' | 'success'
    const [resendCooldown, setResendCooldown] = useState(0)
    const didAutoSendRef = useRef(false)
    const inputRef = useRef(null)

    // Auto-send a code on first mount. The backend's /register deliberately
    // does NOT send a verification email — it waits for an explicit POST to
    // /send-verification (see account-server/src/routes/auth.ts:392). So this
    // page's mount IS the trigger that causes grandma's inbox to light up.
    useEffect(() => {
        if (!token) return
        if (didAutoSendRef.current) return
        didAutoSendRef.current = true
        // Don't re-request on every reload/remount. A code we sent in the last
        // ~14 min is still valid (they expire at 15), so re-requesting would just
        // burn the resend budget for no benefit. Skip the network call and point
        // the user at the code already in their inbox.
        try {
            const lastSent = Number(sessionStorage.getItem('windy_verify_sent_at') || 0)
            if (lastSent && Date.now() - lastSent < 14 * 60 * 1000) {
                setMessageTone('info')
                setMessage(`Look for the 6-digit code we emailed to ${email || 'your email'}.`)
                return
            }
        } catch { /* sessionStorage disabled — fall through and just send */ }
        void sendCode({ silentOnRateLimit: true })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Resend cooldown tick
    useEffect(() => {
        if (resendCooldown <= 0) return undefined
        const t = setTimeout(() => setResendCooldown(s => Math.max(0, s - 1)), 1000)
        return () => clearTimeout(t)
    }, [resendCooldown])

    // Auto-focus the code input on mount so grandma can just start typing
    useEffect(() => {
        if (inputRef.current) inputRef.current.focus()
    }, [])

    async function sendCode({ silentOnRateLimit = false, force = false } = {}) {
        if (!token) return
        try {
            setStatus(prev => (prev === 'submitting' ? prev : 'resending'))
            // authFetch attaches the token and refreshes-then-retries on a 401,
            // so a lapsed access token here no longer dead-ends the page.
            const res = await authFetch('/api/v1/auth/send-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Auto-send on mount omits force → the server reuses a still-valid
                // code so a page reload never invalidates the one already in the
                // inbox. Only an explicit "Send another one" click forces a new code.
                body: JSON.stringify({ force }),
            })

            if (res.ok) {
                const data = await res.json().catch(() => ({}))
                // Remember we have a live code so reloads don't re-request it.
                if (data.sent || data.reused) {
                    try { sessionStorage.setItem('windy_verify_sent_at', String(Date.now())) } catch { /* noop */ }
                }
                if (data.alreadyVerified) {
                    setMessageTone('success')
                    setMessage("You're already verified! Taking you to your dashboard…")
                    setTimeout(() => navigate('/dashboard', { replace: true }), 1200)
                    return
                }
                setMessageTone('info')
                setMessage(
                    `We sent a 6-digit code to ${email || 'your email'}. It should arrive in about a minute.`
                )
                setResendCooldown(RESEND_COOLDOWN_SECONDS)
                return
            }

            if (res.status === 429) {
                if (silentOnRateLimit) {
                    // Auto-send on mount hit the resend limiter — user already
                    // has a recent code, no need to alarm them.
                    setMessageTone('info')
                    setMessage(
                        `Look for the 6-digit code we emailed to ${email || 'your email'}.`
                    )
                    return
                }
                setMessageTone('error')
                setMessage("You've requested a lot of codes. Try again in an hour.")
                return
            }

            setMessageTone('error')
            setMessage('Something went wrong on our end. Try again in a moment.')
        } catch {
            setMessageTone('error')
            setMessage('Something went wrong on our end. Try again in a moment.')
        } finally {
            setStatus(prev => (prev === 'success' ? prev : 'idle'))
        }
    }

    async function handleSubmit(e) {
        e.preventDefault()
        if (!/^\d{6}$/.test(code)) {
            setMessageTone('error')
            setMessage('Please enter the 6-digit code from your email.')
            return
        }
        try {
            setStatus('submitting')
            setMessage('')
            const res = await authFetch('/api/v1/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            })
            const data = await res.json().catch(() => ({}))

            if (res.ok && data.verified) {
                setStatus('success')
                setMessageTone('success')
                setMessage("You're in!")
                setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
                return
            }

            // Error branches — translate backend strings to plain English
            const errText = String(data?.error || '')
            if (/expired/i.test(errText)) {
                setMessageTone('error')
                setMessage('That code expired. We just sent a new one — check your inbox.')
                setCode('')
                // Force a fresh code — the old one is expired, so idempotent reuse
                // would hand back nothing. Mint and email a new one.
                void sendCode({ force: true, silentOnRateLimit: true })
            } else if (/already used/i.test(errText)) {
                setMessageTone('error')
                setMessage('That code was already used. We just sent a new one — check your inbox.')
                setCode('')
                void sendCode({ force: true, silentOnRateLimit: true })
            } else if (res.status === 429) {
                setMessageTone('error')
                setMessage('Too many wrong tries. Send yourself a new code.')
            } else if (res.status === 401) {
                setMessageTone('error')
                setMessage('Your session expired. Please sign in again.')
                setTimeout(() => {
                    localStorage.removeItem('windy_token')
                    navigate('/auth', { replace: true })
                }, 1500)
            } else {
                setMessageTone('error')
                setMessage("That code didn't match. Check your email and try again.")
            }
        } catch {
            setMessageTone('error')
            setMessage('Something went wrong on our end. Try again in a moment.')
        } finally {
            setStatus(prev => (prev === 'success' ? prev : 'idle'))
        }
    }

    if (!token) {
        return <Navigate to="/auth" replace />
    }

    const submitDisabled = status === 'submitting' || status === 'success' || !/^\d{6}$/.test(code)
    const resendDisabled = resendCooldown > 0 || status === 'submitting' || status === 'resending' || status === 'success'

    return (
        <div className="auth-page">
            <div className="auth-container verify-email-container">
                {/* Left — Branding */}
                <div className="auth-brand">
                    <Link to="/" className="auth-logo">
                        <div className="auth-logo-icon"></div>
                        <span>Windy Word</span>
                    </Link>
                    <h2 className="auth-tagline">One last step.<br />Check your email.</h2>
                    <p className="auth-desc">
                        We sent you a 6-digit code. Type it in and you're all set.
                    </p>
                    <div className="auth-features">
                        <div className="auth-feature">Codes expire in 15 minutes.</div>
                        <div className="auth-feature">Don't see it? Check your Spam or Promotions folder.</div>
                    </div>
                </div>

                {/* Right — Form */}
                <div className="auth-form-wrapper">
                    <h1 className="verify-email-title">Check your email</h1>
                    <p className="verify-email-sub">
                        {email
                            ? <>We sent a 6-digit code to <strong>{email}</strong>. It should arrive in about a minute.</>
                            : <>We sent a 6-digit code to your email. It should arrive in about a minute.</>
                        }
                    </p>

                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="form-group">
                            <label htmlFor="code">Enter your 6-digit code</label>
                            <input
                                id="code"
                                ref={inputRef}
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                pattern="\d{6}"
                                maxLength={6}
                                value={code}
                                onChange={(e) => {
                                    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 6)
                                    setCode(digitsOnly)
                                    if (message && messageTone === 'error') setMessage('')
                                }}
                                placeholder="123456"
                                aria-describedby="verify-email-result"
                                className="verify-email-code-input"
                                required
                                disabled={status === 'success'}
                            />
                        </div>

                        <div
                            id="verify-email-result"
                            role="status"
                            aria-live="polite"
                            className={`verify-email-message verify-email-message-${messageTone}`}
                        >
                            {status === 'success' && <span className="verify-email-check" aria-hidden>✓</span>}
                            {message}
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary auth-submit verify-email-submit"
                            disabled={submitDisabled}
                        >
                            {status === 'submitting' ? 'Checking…' : status === 'success' ? 'Verified' : 'Verify'}
                        </button>
                    </form>

                    <div className="verify-email-resend-row">
                        <span>Didn't get it? </span>
                        <button
                            type="button"
                            className="auth-switch"
                            onClick={() => sendCode({ force: true })}
                            disabled={resendDisabled}
                        >
                            {resendCooldown > 0
                                ? `Send another one (${resendCooldown}s)`
                                : status === 'resending'
                                    ? 'Sending…'
                                    : 'Send another one'}
                        </button>
                    </div>

                    <p className="verify-email-hint">
                        Codes expire in 15 minutes. Check your Spam or Promotions folder if you don't see it.
                    </p>

                    <div className="auth-footer">
                        <p>
                            Wrong account? <Link to="/auth" className="auth-switch">Sign in with a different email</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
