/**
 * GoogleAuthFinish — terminal page in the Google OAuth flow.
 *
 * The account-server's /callback redirects here with the JWT in the URL
 * fragment (after `#`), e.g. `/auth/google/finish#token=...&refreshToken=...`.
 * We lift the tokens into localStorage to match the email/password flow
 * (Auth.jsx writes the same `windy_token` + `windy_user` keys), then strip
 * the fragment and navigate to /dashboard.
 *
 * Why fragment instead of query string: fragments aren't sent to the server
 * on subsequent requests, so tokens don't end up in our access logs or in
 * referrer headers when the user clicks an outbound link.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function GoogleAuthFinish() {
    const navigate = useNavigate()
    const [error, setError] = useState('')

    useEffect(() => {
        const fragment = window.location.hash.replace(/^#/, '')
        if (!fragment) {
            setError('Missing sign-in payload. Please try again.')
            return
        }
        const params = new URLSearchParams(fragment)
        const errParam = params.get('error')
        if (errParam) {
            setError(prettyError(errParam))
            return
        }
        const token = params.get('token')
        const refreshToken = params.get('refreshToken')
        if (!token) {
            setError('No token in callback. Please try again.')
            return
        }

        localStorage.setItem('windy_token', token)
        if (refreshToken) localStorage.setItem('windy_refresh_token', refreshToken)
        const user = {
            userId: params.get('userId') || '',
            name: params.get('name') || '',
            email: params.get('email') || '',
            tier: params.get('tier') || 'free',
        }
        localStorage.setItem('windy_user', JSON.stringify(user))

        // Strip the fragment so a refresh doesn't re-trigger the lift.
        window.history.replaceState(null, '', '/auth/google/finish')

        navigate('/dashboard', { replace: true })
    }, [navigate])

    if (error) {
        return (
            <div style={{
                minHeight: '100vh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', background: '#0F172A',
                color: '#F1F5F9', padding: '20px', textAlign: 'center',
            }}>
                <h2 style={{ marginBottom: '12px' }}>Sign-in didn't complete</h2>
                <p style={{ color: '#94A3B8', maxWidth: '400px', marginBottom: '20px' }}>{error}</p>
                <button
                    onClick={() => { window.location.href = '/auth' }}
                    style={{
                        padding: '10px 20px', borderRadius: '8px', border: 'none',
                        background: '#22C55E', color: '#000', cursor: 'pointer', fontWeight: 600,
                    }}
                >Back to sign-in</button>
            </div>
        )
    }

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0F172A', color: '#94A3B8',
        }}>
            Signing you in…
        </div>
    )
}

function prettyError(code) {
    switch (code) {
        case 'access_denied': return 'You cancelled the Google sign-in.'
        case 'token_exchange_failed': return 'Google rejected our token request. The OAuth client may need re-configuring.'
        case 'no_access_token': return "Google didn't return an access token. Try again."
        case 'userinfo_failed': return "Couldn't read your Google profile. Try again."
        case 'no_email': return 'Your Google account has no email associated. Use email/password instead.'
        case 'network': return 'Network problem reaching Google. Check your connection.'
        default: return `Sign-in failed (${code}). Please try again.`
    }
}
