import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import './analytics' // H8: Privacy-first analytics (auto-initializes)
import Landing from './pages/Landing'
import Transcribe from './pages/Transcribe'
import Dashboard from './pages/Dashboard'
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

export default function App() {
    return (
        <BrowserRouter>
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
                <Route path="/auth" element={<Auth />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    )
}
