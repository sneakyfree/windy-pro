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
                setError(data.detail || 'Something went wrong')
                return
            }

            // Store JWT token
            localStorage.setItem('windy_token', data.token)
            localStorage.setItem('windy_user', JSON.stringify(data.user))

            // Redirect to transcription
            navigate('/transcribe')
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
                        Stream audio from any device. Get real-time transcription powered by Whisper.
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

                        {error && <div className="auth-error">{error}</div>}

                        <button
                            type="submit"
                            className="btn btn-primary auth-submit"
                            disabled={loading}
                        >
                            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
                        </button>
                    </form>

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
