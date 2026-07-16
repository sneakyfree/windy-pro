// authFetch — keeps the 15-minute access token fresh so long sessions
// (hatch, checkout, Settings) don't die mid-flow.
//
// The server issues a short-lived access token (windy_token, 15m) plus a
// long-lived refresh token (windy_refresh_token, 30d) and exposes a rotating
// POST /api/v1/auth/refresh. This module is the missing client half: it stores
// the refresh token, silently renews the access token before it expires, and
// reactively refreshes-then-retries on a 401.
//
// Prior behavior: the client kept only the 15m access token and threw the
// refresh token away, so it dead-ended at 401 ("Your session expired" with a
// Try-again that re-401s forever) partway through a hatch or after idling on
// Settings.

const ACCESS_KEY = 'windy_token'
const REFRESH_KEY = 'windy_refresh_token'

// Renew ~3 minutes before the 15m access token expires, so an active session
// always has a valid token in hand.
const REFRESH_INTERVAL_MS = 12 * 60 * 1000

let inFlightRefresh = null
let proactiveTimer = null

export function getAccessToken() {
    try { return localStorage.getItem(ACCESS_KEY) } catch { return null }
}

export function storeTokens({ token, refreshToken } = {}) {
    try {
        if (token) localStorage.setItem(ACCESS_KEY, token)
        if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
    } catch { /* storage disabled — nothing we can do */ }
}

export function clearTokens() {
    try {
        localStorage.removeItem(ACCESS_KEY)
        localStorage.removeItem(REFRESH_KEY)
    } catch { /* noop */ }
}

// Exchange the refresh token for a new access token. Concurrent callers share
// one in-flight request. Returns the new access token, or null if refresh
// failed (caller should then send the user to sign in).
export async function refreshAccessToken() {
    if (inFlightRefresh) return inFlightRefresh

    const refreshToken = (() => {
        try { return localStorage.getItem(REFRESH_KEY) } catch { return null }
    })()
    if (!refreshToken) return null

    inFlightRefresh = (async () => {
        try {
            const res = await fetch('/api/v1/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            })
            if (!res.ok) {
                // The refresh token itself is invalid/expired — a genuine
                // sign-out condition. Clear so we stop retrying with it.
                if (res.status === 401) clearTokens()
                return null
            }
            const data = await res.json().catch(() => ({}))
            if (!data.token) return null
            storeTokens({ token: data.token, refreshToken: data.refreshToken })
            return data.token
        } catch {
            return null
        } finally {
            inFlightRefresh = null
        }
    })()

    return inFlightRefresh
}

// fetch() wrapper that attaches the access token and, on a 401, refreshes once
// and retries. Use for any authenticated API call.
export async function authFetch(url, options = {}) {
    const token = getAccessToken()
    const withAuth = (t) => ({
        ...options,
        headers: {
            ...(options.headers || {}),
            ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
    })

    let res = await fetch(url, withAuth(token))
    if (res.status !== 401) return res

    const fresh = await refreshAccessToken()
    if (!fresh) return res // still 401 — let the caller handle sign-out
    return fetch(url, withAuth(fresh))
}

// Start a single silent-refresh timer for the session. Idempotent — safe to
// call from every ProtectedRoute mount. Refreshes now if a refresh token
// exists, then every REFRESH_INTERVAL_MS, so the access token never lapses
// during active use.
export function ensureProactiveRefresh() {
    if (proactiveTimer) return
    let hasRefresh = false
    try { hasRefresh = !!localStorage.getItem(REFRESH_KEY) } catch { hasRefresh = false }
    if (!hasRefresh) return

    // Refresh immediately, not only on the first 12-minute tick — a token in
    // its last minutes would otherwise lapse before the interval first fires
    // (seen live: idle /transcribe held an expired token, so WS reconnects
    // auth'd with a stale token until a manual reload).
    void refreshAccessToken()

    proactiveTimer = setInterval(() => {
        try {
            if (!localStorage.getItem(REFRESH_KEY)) { stopProactiveRefresh(); return }
        } catch { /* noop */ }
        void refreshAccessToken()
    }, REFRESH_INTERVAL_MS)
}

export function stopProactiveRefresh() {
    if (proactiveTimer) {
        clearInterval(proactiveTimer)
        proactiveTimer = null
    }
}

// Return an access token that is valid for at least the next 60 seconds,
// refreshing first when the stored one is missing/near expiry. For callers
// that hand the token to a non-HTTP channel (the /ws/transcribe socket sends
// it as a first-message auth), where authFetch's 401-retry can't help.
export async function getValidAccessToken() {
    const token = getAccessToken()
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
            const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : new Date(payload.exp).getTime()
            if (expMs - Date.now() > 60_000) return token
        } catch { /* undecodable — fall through to refresh */ }
    }
    return (await refreshAccessToken()) || token
}
