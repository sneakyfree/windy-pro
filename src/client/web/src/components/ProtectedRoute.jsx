import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ensureProactiveRefresh, refreshAccessToken, getAccessToken } from '../lib/authFetch'

function isTokenExpired(token) {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return true
        // base64url → base64 → decode
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const decoded = JSON.parse(atob(payload))
        if (!decoded.exp) return true
        // exp may be ISO string (custom JWT) or unix timestamp
        const expMs = typeof decoded.exp === 'number'
            ? decoded.exp * 1000
            : new Date(decoded.exp).getTime()
        return Date.now() >= expMs
    } catch {
        return true
    }
}

function hasRefreshToken() {
    try { return !!localStorage.getItem('windy_refresh_token') } catch { return false }
}

export default function ProtectedRoute({ children }) {
    // Seed synchronously so a valid token renders children immediately (no
    // flash). Only when the access token is missing/expired do we drop into
    // 'checking' and try a refresh before deciding to redirect.
    const [state, setState] = useState(() => {
        const token = getAccessToken()
        return token && !isTokenExpired(token) ? 'authed' : 'checking'
    })

    useEffect(() => {
        let cancelled = false

        if (state === 'authed') {
            // Keep the session alive so the token never lapses mid-flow.
            ensureProactiveRefresh()
            return () => { cancelled = true }
        }

        // Access token missing/expired. Before booting the user to sign-in
        // (the old behavior that dead-ended mid-hatch), try to refresh.
        if (!hasRefreshToken()) {
            setState('redirect')
            return () => { cancelled = true }
        }

        ;(async () => {
            const fresh = await refreshAccessToken()
            if (cancelled) return
            if (fresh) {
                ensureProactiveRefresh()
                setState('authed')
            } else {
                try { localStorage.removeItem('windy_token') } catch { /* noop */ }
                setState('redirect')
            }
        })()

        return () => { cancelled = true }
    }, [state])

    if (state === 'redirect') return <Navigate to="/auth" replace />
    if (state === 'checking') {
        return (
            <div style={{
                minHeight: '60vh', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--text-muted, #8ba0b3)',
                fontSize: '0.95rem',
            }}>
                Restoring your session…
            </div>
        )
    }
    return children
}
