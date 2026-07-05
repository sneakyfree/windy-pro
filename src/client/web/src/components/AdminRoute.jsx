import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

/**
 * Route guard for /admin. ProtectedRoute only checks that SOME valid token
 * exists — so any signed-in user could load the Admin Panel shell (the data
 * was 403-gated server-side, but the admin UI + "ADMIN" badge still rendered
 * for a non-admin, which is confusing and looks leaky).
 *
 * This confirms the user is actually an admin (identity.isAdmin from
 * /identity/me, which the server derives from the DB role) before rendering.
 * Non-admins are redirected to /dashboard. Server routes still enforce admin
 * independently — this is UX/defense-in-depth, not the security boundary.
 */
const API_BASE = '/api/v1'

export default function AdminRoute({ children }) {
    const [state, setState] = useState('checking') // 'checking' | 'admin' | 'denied'

    useEffect(() => {
        const token = localStorage.getItem('windy_token')
        if (!token) { setState('denied'); return }
        let cancelled = false
        fetch(`${API_BASE}/identity/me`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (cancelled) return
                setState(d?.identity?.isAdmin ? 'admin' : 'denied')
            })
            .catch(() => { if (!cancelled) setState('denied') })
        return () => { cancelled = true }
    }, [])

    if (state === 'checking') {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: '#0B0F1A', color: '#64748B' }}>
                Checking access…
            </div>
        )
    }
    if (state === 'denied') return <Navigate to="/dashboard" replace />
    return children
}
