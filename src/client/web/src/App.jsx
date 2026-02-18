import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Landing from './pages/Landing'
import Transcribe from './pages/Transcribe'
import Auth from './pages/Auth'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import ProtectedRoute from './components/ProtectedRoute'

function NotFound() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#94A3B8', background: '#0F172A' }}>
            <h1 style={{ fontSize: '64px', color: '#22C55E', margin: '0 0 8px' }}>404</h1>
            <p style={{ fontSize: '18px' }}>This page doesn't exist.</p>
            <Link to="/" style={{ color: '#22C55E', marginTop: '16px', textDecoration: 'none' }}>← Back to Home</Link>
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
                <Route path="/auth" element={<Auth />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    )
}
