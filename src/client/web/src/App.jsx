import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import { Component } from 'react'
import './analytics' // H8: Privacy-first analytics (auto-initializes)
import Landing from './pages/Landing'
import Transcribe from './pages/Transcribe'
import Dashboard from './pages/Dashboard'
import EcosystemDashboard from './pages/EcosystemDashboard'
import SoulFile from './pages/SoulFile'
import Vault from './pages/Vault'
import Translate from './pages/Translate'
import Auth from './pages/Auth'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Settings from './pages/Settings'
import Admin from './pages/Admin'
import Profile from './pages/Profile'
import ProtectedRoute from './components/ProtectedRoute'

function NotFound() {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100vh', color: '#94A3B8', background: '#0B0F1A',
            fontFamily: "'Inter', -apple-system, sans-serif"
        }}>
            <div style={{
                fontSize: '72px', animation: 'spin 4s linear infinite',
                marginBottom: '8px', filter: 'drop-shadow(0 0 20px rgba(34,197,94,0.3))'
            }}>🌪️</div>
            <h1 style={{
                fontSize: '80px', fontWeight: '900', margin: '0',
                background: 'linear-gradient(135deg, #22C55E, #3B82F6)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
            }}>404</h1>
            <p style={{ fontSize: '20px', margin: '8px 0 24px', color: '#CBD5E1' }}>
                This page got swept away by the wind.
            </p>
            <div style={{
                display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '24px'
            }}>
                {[
                    { to: '/', label: '🏠 Home' },
                    { to: '/dashboard', label: '📊 Dashboard' },
                    { to: '/transcribe', label: '🎙️ Transcribe' },
                    { to: '/translate', label: '🌍 Translate' },
                ].map(l => (
                    <Link key={l.to} to={l.to} style={{
                        padding: '10px 20px', borderRadius: '10px', textDecoration: 'none',
                        background: 'rgba(30,41,59,0.8)', border: '1px solid #334155',
                        color: '#E2E8F0', fontSize: '14px', fontWeight: '600',
                        transition: 'all 0.2s ease'
                    }}>{l.label}</Link>
                ))}
            </div>
            <Link to="/" style={{
                color: '#22C55E', textDecoration: 'none', fontSize: '15px',
                padding: '8px 24px', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.3)',
                transition: 'all 0.2s ease'
            }}>← Back to Home</Link>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}

class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo)
        const dsn = import.meta.env.VITE_SENTRY_DSN
        if (dsn) {
            try {
                const url = new URL(dsn)
                const publicKey = url.username
                const host = url.host
                const projectId = url.pathname.replace('/', '')
                const eventId = crypto.randomUUID().replace(/-/g, '')
                const timestamp = new Date().toISOString()
                const header = JSON.stringify({ event_id: eventId, dsn, sent_at: timestamp })
                const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' })
                const event = JSON.stringify({
                    event_id: eventId,
                    timestamp,
                    platform: 'javascript',
                    environment: import.meta.env.MODE || 'production',
                    exception: {
                        values: [{
                            type: error.name || 'Error',
                            value: error.message,
                            stacktrace: error.stack ? {
                                frames: error.stack.split('\n').slice(1).reverse().map(line => {
                                    const match = line.match(/at\s+(.+?)\s+\((.+):(\d+):(\d+)\)/)
                                    if (match) return { function: match[1], filename: match[2], lineno: parseInt(match[3]), colno: parseInt(match[4]) }
                                    return { filename: line.trim() }
                                })
                            } : undefined,
                        }],
                    },
                    extra: { componentStack: errorInfo?.componentStack || '' },
                })
                fetch(`https://${host}/api/${projectId}/envelope/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-sentry-envelope',
                        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=windy-word-web/1.0`,
                    },
                    body: `${header}\n${itemHeader}\n${event}`,
                }).catch(() => {})
            } catch {
                // Silently ignore — error reporting should never itself cause errors
            }
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100vh', color: '#CBD5E1', background: '#0B0F1A',
                    fontFamily: "'Inter', -apple-system, sans-serif", padding: '24px', textAlign: 'center'
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>:(</div>
                    <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px', color: '#E2E8F0' }}>
                        Something went wrong
                    </h1>
                    <p style={{ fontSize: '15px', color: '#94A3B8', marginBottom: '24px', maxWidth: '400px' }}>
                        An unexpected error occurred. Please reload the page to continue.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '12px 32px', borderRadius: '10px', border: 'none',
                            background: '#22C55E', color: '#000', fontSize: '15px',
                            fontWeight: '700', cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
                            transition: 'transform 0.2s ease'
                        }}
                    >
                        Reload Page
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}

export default function App() {
    return (
        <BrowserRouter>
            <ErrorBoundary>
            <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/transcribe" element={
                    <ProtectedRoute><Transcribe /></ProtectedRoute>
                } />
                <Route path="/dashboard" element={
                    <ProtectedRoute><Dashboard /></ProtectedRoute>
                } />
                <Route path="/soul-file" element={
                    <ProtectedRoute><SoulFile /></ProtectedRoute>
                } />
                <Route path="/vault" element={
                    <ProtectedRoute><Vault /></ProtectedRoute>
                } />
                <Route path="/translate" element={
                    <ProtectedRoute><Translate /></ProtectedRoute>
                } />
                <Route path="/settings" element={
                    <ProtectedRoute><Settings /></ProtectedRoute>
                } />
                <Route path="/admin" element={
                    <ProtectedRoute><Admin /></ProtectedRoute>
                } />
                <Route path="/profile" element={
                    <ProtectedRoute><Profile /></ProtectedRoute>
                } />
                <Route path="/app" element={
                    <ProtectedRoute><Navigate to="/app/hub" replace /></ProtectedRoute>
                } />
                <Route path="/app/:panel" element={
                    <ProtectedRoute><EcosystemDashboard /></ProtectedRoute>
                } />
                <Route path="/auth" element={<Auth />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
            </ErrorBoundary>
        </BrowserRouter>
    )
}
