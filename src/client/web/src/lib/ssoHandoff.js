// ssoHandoff — cross-app tile handoff with a refresh credential.
//
// The dashboard hands sessions to sibling apps (chat/mail/cloud/clone/admin)
// via a URL fragment. Historically that fragment carried only the 15-minute
// access token, so a tile-entered session died at 15 minutes even after the
// direct-login flows learned to silently refresh (windy-pro #247). The fix:
// mint a FRESH access+refresh pair at click time (POST /api/v1/auth/handoff)
// and put both in the fragment — `#token=<access>&refreshToken=<refresh>` —
// the same shape GoogleAuthFinish already ingests.
//
// Security posture: the refresh token in the fragment is a newly minted,
// single-use rotating credential in its own session row — NOT the dashboard's
// own refresh token (rotation would kill the dashboard session) and never a
// reused raw one. Fragments don't reach servers/logs/Referer, the target
// strips the URL on arrival, and the receiving SPA's proactive refresh
// rotates it away within seconds of landing.

import { authFetch, getAccessToken } from './authFetch'

// Mint a fresh {token, refreshToken} pair for a handoff. Falls back to the
// current access token (the old behavior) if the mint fails for any reason —
// a broken mint must never make the handoff worse than it already was.
export async function buildHandoffFragment() {
    try {
        const res = await authFetch('/api/v1/auth/handoff', { method: 'POST' })
        if (res.ok) {
            const data = await res.json().catch(() => ({}))
            if (data.token) {
                return data.refreshToken
                    ? `token=${encodeURIComponent(data.token)}&refreshToken=${encodeURIComponent(data.refreshToken)}`
                    : `token=${encodeURIComponent(data.token)}`
            }
        }
    } catch { /* fall through to the access-token-only fragment */ }
    const t = getAccessToken()
    return t ? `token=${encodeURIComponent(t)}` : ''
}

// Open `href` with the handoff fragment appended. Call from a click handler:
// the tab is opened synchronously (popup-blocker rule), then navigated once
// the mint completes. If the popup is blocked, falls back to same-tab.
export function openHandoff(href, { newTab = true, search } = {}) {
    let win = null
    if (newTab) {
        try {
            win = window.open('', '_blank')
            // Sever the reverse link (reverse-tabnabbing hygiene); targets are
            // our own apps, but there's no reason to keep the opener handle.
            if (win) { try { win.opener = null } catch { /* noop */ } }
        } catch { win = null }
    }
    void buildHandoffFragment().then((frag) => {
        let url = href
        if (search) url += (url.includes('?') ? '&' : '?') + search
        if (frag) url += `#${frag}`
        if (win) win.location.replace(url)
        else window.location.href = url
    })
}
