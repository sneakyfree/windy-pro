import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Auth.css'

export default function Auth() {
    const [isLogin, setIsLogin] = useState(true)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [forgotSent, setForgotSent] = useState(false)
    const [agreedToTerms, setAgreedToTerms] = useState(false)
    const navigate = useNavigate()

    const handleForgotPassword = () => {
        if (!email) {
            setError('Enter your email address first, then click Forgot password.')
            return
        }
        // Fire-and-forget: attempt reset endpoint, show confirmation regardless
        // (don't reveal whether the email exists)
        fetch('/api/v1/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        }).catch(() => {})
        setForgotSent(true)
        setError('')
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const endpoint = isLogin ? '/api/v1/auth/login' : '/api/v1/auth/register'
            const body = isLogin
                ? { email, password }
                : { email, password, name }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Something went wrong')
                return
            }

            // Store JWT token. The /register response returns user fields at
            // the top level (userId/name/email/tier/token/refreshToken/devices),
            // not under a `user` key — build the cached user object from those
            // top-level fields so /verify-email can display the email back to
            // the user.
            localStorage.setItem('windy_token', data.token)
            const cachedUser = data.user || {
                userId: data.userId,
                name: data.name,
                email: data.email,
                tier: data.tier,
            }
            localStorage.setItem('windy_user', JSON.stringify(cachedUser))

            if (isLogin) {
                navigate('/dashboard')
            } else {
                // New signup → route through /verify-email so the user can
                // enter the 6-digit code the backend will email. Without
                // this, the 24h login-grace window silently expires and the
                // user is locked out (see account-server/src/routes/auth.ts:425-439).
                navigate('/verify-email', { state: { email: cachedUser.email } })
            }
        } catch (err) {
            setError('Unable to connect to server')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-container">
                {/* Left — Branding */}
                <div className="auth-brand">
                    <Link to="/" className="auth-logo">
                        <div className="auth-logo-icon"></div>
                        <span>Windy Word</span>
                    </Link>
                    <h2 className="auth-tagline">Voice to text,<br />in the cloud.</h2>
                    <p className="auth-desc">
                        Stream audio from any device. Get real-time transcription powered by the Windy Word Engine.
                        No downloads, no installs.
                    </p>
                    <div className="auth-features">
                        <div className="auth-feature">☁️ Cloud transcription API</div>
                        <div className="auth-feature">📱 Mobile web access</div>
                        <div className="auth-feature">🔄 Sync across devices</div>
                    </div>
                </div>

                {/* Right — Form */}
                <div className="auth-form-wrapper">
                    <div className="auth-tabs">
                        <button
                            className={`auth-tab ${isLogin ? 'active' : ''}`}
                            onClick={() => { setIsLogin(true); setError(''); setAgreedToTerms(false); }}
                        >
                            Sign In
                        </button>
                        <button
                            className={`auth-tab ${!isLogin ? 'active' : ''}`}
                            onClick={() => { setIsLogin(false); setError(''); setAgreedToTerms(false); }}
                        >
                            Sign Up
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="auth-form">
                        {!isLogin && (
                            <div className="form-group">
                                <label htmlFor="name">Full Name</label>
                                <input
                                    id="name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Jane Smith"
                                    required={!isLogin}
                                />
                            </div>
                        )}

                        <div className="form-group">
                            <label htmlFor="email">Email</label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">Password</label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={8}
                            />
                        </div>

                        {isLogin && !forgotSent && (
                            <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '8px' }}>
                                <button type="button" className="auth-switch" style={{ fontSize: '13px', color: '#64748B' }} onClick={handleForgotPassword}>Forgot password?</button>
                            </div>
                        )}
                        {isLogin && forgotSent && (
                            <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '8px', fontSize: '13px', color: '#22C55E' }}>
                                If that email is registered, a reset link has been sent.
                            </div>
                        )}

                        {!isLogin && password.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                                    {[1, 2, 3, 4].map(i => (
                                        <div key={i} style={{
                                            flex: 1, height: '3px', borderRadius: '2px',
                                            background: password.length >= i * 3 ? (password.length >= 12 ? '#22C55E' : password.length >= 8 ? '#F59E0B' : '#EF4444') : '#1E293B'
                                        }} />
                                    ))}
                                </div>
                                <span style={{ fontSize: '11px', color: password.length >= 12 ? '#22C55E' : password.length >= 8 ? '#F59E0B' : '#EF4444' }}>
                                    {password.length >= 12 ? 'Strong' : password.length >= 8 ? 'Good' : 'Too short'}
                                </span>
                            </div>
                        )}

                        {!isLogin && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' }}>
                                <input
                                    id="agree-terms"
                                    type="checkbox"
                                    checked={agreedToTerms}
                                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                                    style={{ marginTop: '3px', accentColor: '#22C55E', cursor: 'pointer' }}
                                />
                                <label htmlFor="agree-terms" style={{ fontSize: '13px', color: '#94A3B8', cursor: 'pointer', lineHeight: '1.4' }}>
                                    I agree to the <Link to="/terms" style={{ color: '#22C55E', textDecoration: 'underline' }}>Terms of Service</Link> and <Link to="/privacy" style={{ color: '#22C55E', textDecoration: 'underline' }}>Privacy Policy</Link>
                                </label>
                            </div>
                        )}

                        {error && <div className="auth-error">{error}</div>}

                        <button
                            type="submit"
                            className="btn btn-primary auth-submit"
                            disabled={loading || (!isLogin && !agreedToTerms)}
                        >
                            {loading ? (
                                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                    <span style={{ width: '16px', height: '16px', border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                                    Please wait...
                                </span>
                            ) : isLogin ? 'Sign In' : 'Create Account'}
                        </button>
                    </form>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                        <div style={{ flex: 1, height: '1px', background: '#334155' }} />
                        <span style={{ color: '#64748B', fontSize: '12px' }}>or continue with</span>
                        <div style={{ flex: 1, height: '1px', background: '#334155' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                        <button type="button" disabled title="Google OAuth coming soon" style={{
                            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #334155',
                            background: '#1E293B', color: '#475569', cursor: 'not-allowed', fontSize: '14px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                            opacity: 0.5
                        }}>🔵 Google <span style={{ fontSize: '10px' }}>soon</span></button>
                        <button type="button" disabled title="GitHub OAuth coming soon" style={{
                            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #334155',
                            background: '#1E293B', color: '#475569', cursor: 'not-allowed', fontSize: '14px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                            opacity: 0.5
                        }}>⚫ GitHub <span style={{ fontSize: '10px' }}>soon</span></button>
                    </div>

                    <div className="auth-footer">
                        {isLogin ? (
                            <p>No account? <button className="auth-switch" onClick={() => setIsLogin(false)}>Sign up free</button></p>
                        ) : (
                            <p>Already have an account? <button className="auth-switch" onClick={() => setIsLogin(true)}>Sign in</button></p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
