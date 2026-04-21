/**
 * /hatch — the agent-hatch ceremony page.
 *
 * Guards:
 *   - No JWT             → ProtectedRoute already redirects to /auth.
 *   - Not email-verified → redirect to /verify-email. The hatch endpoint
 *                           requires an authenticated user; an unverified
 *                           email means the user hasn't completed signup.
 *
 * Thin wrapper: renders <HatchCeremony>. All SSE/UI logic lives in the
 * component + hook so the page stays at ~50 lines.
 */
import { useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import HatchCeremony from '../components/HatchCeremony'
import './Hatch.css'

function decodeJwtPayload(token) {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        return JSON.parse(atob(b64))
    } catch {
        return null
    }
}

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem('windy_user') || 'null')
    } catch {
        return null
    }
}

export default function Hatch() {
    const token = typeof window !== 'undefined'
        ? localStorage.getItem('windy_token')
        : null

    // Email-verified check: look at the JWT claim first, then fall back to
    // the stored user object. If neither says verified, send them to the
    // verify page — the hatch endpoint will 401/403 otherwise.
    const emailVerified = useMemo(() => {
        if (!token) return false
        const payload = decodeJwtPayload(token)
        if (payload?.email_verified === true) return true
        if (payload?.emailVerified === true) return true
        const user = getStoredUser()
        if (user?.email_verified === true) return true
        if (user?.emailVerified === true) return true
        // If neither claim nor stored flag is set, assume NOT verified — the
        // backend enforces this, and we'd rather show the verify page than
        // let the user spin the hatcher and then get a 401.
        // But: many older tokens / older signups won't have the flag at all.
        // Let the backend decide in that case — return true so we proceed.
        if (payload && !('email_verified' in payload) && !('emailVerified' in payload)) {
            return true
        }
        return false
    }, [token])

    if (!token) return <Navigate to="/auth" replace />
    if (!emailVerified) {
        return <Navigate to="/verify-email" replace state={{ reason: 'hatch_requires_verified' }} />
    }

    return <HatchCeremony token={token} />
}
