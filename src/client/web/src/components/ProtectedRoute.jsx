import { Navigate } from 'react-router-dom'

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

export default function ProtectedRoute({ children }) {
    const token = localStorage.getItem('windy_token')
    if (!token || isTokenExpired(token)) {
        localStorage.removeItem('windy_token')
        return <Navigate to="/auth" replace />
    }
    return children
}
