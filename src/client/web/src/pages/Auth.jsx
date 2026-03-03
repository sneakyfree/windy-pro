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
    const navigate = useNavigate()

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

            // Store JWT token
            localStorage.setItem('windy_token', data.token)
            localStorage.setItem('windy_user', JSON.stringify(data.user))

            // Redirect to dashboard
            navigate('/dashboard')
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
                        <span>Windy Pro</span>
                    </Link>
                    <h2 className="auth-tagline">Voice to text,<br />in the cloud.</h2>
                    <p className="auth-desc">
                        Stream audio from any device. Get real-time transcription powered by the Windy Pro Engine.
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
                            onClick={() => { setIsLogin(true); setError(''); }}
                        >
                            Sign In
                        </button>
                        <button
                            className={`auth-tab ${!isLogin ? 'active' : ''}`}
                            onClick={() => { setIsLogin(false); setError(''); }}
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

                        {isLogin && (
                            <div style={{ textAlign: 'right', marginTop: '-8px', marginBottom: '8px' }}>
                                <button type="button" className="auth-switch" style={{ fontSize: '13px', color: '#64748B' }}>Forgot password?</button>
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

                        {error && <div className="auth-error">{error}</div>}

                        <button
                            type="submit"
                            className="btn btn-primary auth-submit"
                            disabled={loading}
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
                        <button type="button" style={{
                            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #334155',
                            background: '#1E293B', color: '#E2E8F0', cursor: 'pointer', fontSize: '14px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                        }}>🔵 Google</button>
                        <button type="button" style={{
                            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #334155',
                            background: '#1E293B', color: '#E2E8F0', cursor: 'pointer', fontSize: '14px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                        }}>⚫ GitHub</button>
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
