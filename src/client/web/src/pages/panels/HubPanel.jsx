import { useState, useEffect } from 'react'
import { openHandoff } from '../../lib/ssoHandoff'

const PRODUCTS = [
    {
        // API /identity/ecosystem-status returns the Word entry under
        // `windy_word` (matches the user-facing brand). The repo's internal
        // dev-name is `windy-pro` but the ecosystem key tracks the brand.
        key: 'windy_word',
        name: 'Windy Word',
        description: 'Your recordings and translations',
        icon: '\uD83C\uDF99\uFE0F',
        href: '/dashboard',
        internal: true,
    },
    {
        key: 'windy_chat',
        name: 'Windy Chat',
        description: 'Chat with people and agents',
        icon: '\uD83D\uDCAC',
        // Logged-in ecosystem users go straight to the chat web app at
        // app.windychat.ai \u2014 separate CF Pages project from the marketing
        // site at windychat.ai (which is the gateway-drug surface for
        // first-touch discovery, not for return users with credentials).
        href: 'https://app.windychat.ai',
        internal: false,
        // Tactical SSO handoff \u2014 append the current Pro JWT as a URL
        // fragment so the chat app can skip its login screen. Bridge
        // until account.windyword.ai/oauth/authorize is built.
        ssoHandoff: true,
    },
    {
        key: 'windy_mail',
        name: 'Windy Mail',
        description: 'Your email inbox',
        icon: '\uD83D\uDCE7',
        // Bare apex (windymail.ai) is behind a Cloudflare Access wall and 401s
        // for a signed-in Pro user. app.windymail.ai is the public webmail app.
        href: 'https://app.windymail.ai',
        internal: false,
        // The webmail app ingests #token= (mail#88) — without the handoff
        // a signed-in Pro user landed on mail's login screen.
        ssoHandoff: true,
    },
    {
        key: 'windy_cloud',
        name: 'Windy Cloud',
        description: 'Your websites and domains',
        icon: '\u2601\uFE0F',
        // The portal ROOT serves the migration placeholder (503) — land on
        // the Websites page, signed in via the fragment handoff (the twins
        // portals read #token= per the Clone #55/#56 law).
        href: 'https://cloud.windycloud.com/websites',
        internal: false,
        ssoHandoff: true,
    },
    {
        key: 'windy_code',
        name: 'Windy Code',
        description: 'Build a website with your helper',
        icon: '\uD83D\uDEE0\uFE0F',
        // The browser builder — same-origin under the Cloud portal.
        // Fragment handoff signs grandma straight in.
        href: 'https://cloud.windycloud.com/build',
        internal: false,
        ssoHandoff: true,
    },
    {
        key: 'windy_fly',
        name: 'Windy Fly',
        description: 'Your AI agent',
        icon: '\uD83E\uDEB0',
        // windyfly.ai has no public web surface (401 behind Access); the agent
        // lives in-app. Route to the in-product Fly panel like Eternitas does.
        href: '/app/fly',
        internal: true,
    },
    {
        // Eternitas: in-product Passport panel rather than the external app
        // host (app.eternitas.ai was NXDOMAIN as of 2026-05-17). Keeps the
        // authed user inside the working UI.
        key: 'eternitas',
        name: 'Eternitas',
        description: "Your agent's passport",
        icon: '\uD83E\uDEA8',
        href: '/app/passport',
        internal: true,
    },
]

function statusColor(status) {
    switch (status) {
        case 'active':
        case 'healthy':
            return '#22C55E'
        case 'available':
            return '#A78BFA'
        case 'pending':
            return '#EAB308'
        case 'error':
        case 'suspended':
            return '#EF4444'
        default:
            return '#64748B'
    }
}

function statusLabel(status) {
    switch (status) {
        case 'active':
        case 'healthy':
            return 'Active'
        case 'available':
            // account-server marks always-on products 'available' — the
            // old fall-through rendered them as a scary "Not provisioned".
            return 'Available'
        case 'pending':
            return 'Pending'
        case 'error':
            return 'Error'
        case 'suspended':
            return 'Suspended'
        default:
            return 'Not provisioned'
    }
}

export default function HubPanel({ apiFetch }) {
    const [statuses, setStatuses] = useState({})
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        apiFetch('/identity/ecosystem-status')
            .then(data => {
                if (data?.products) setStatuses(data.products)
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [apiFetch])

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\uD83C\uDF2A\uFE0F'}</span>
                <div>
                    <h1 className="panel-title">Windy Ecosystem</h1>
                    <p className="panel-subtitle">All your Windy products in one place</p>
                </div>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748B' }}>
                    Loading ecosystem status...
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px',
                    marginTop: '8px',
                }}>
                    {PRODUCTS.map(product => {
                        const info = statuses[product.key] || {}
                        const status = info.status || null
                        const color = statusColor(status)

                        const cardContent = (
                            <div
                                key={product.key}
                                style={{
                                    background: 'rgba(15, 23, 42, 0.7)',
                                    border: '1px solid rgba(51, 65, 85, 0.5)',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    position: 'relative',
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)'
                                    e.currentTarget.style.transform = 'translateY(-2px)'
                                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(34, 197, 94, 0.1)'
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = 'rgba(51, 65, 85, 0.5)'
                                    e.currentTarget.style.transform = 'translateY(0)'
                                    e.currentTarget.style.boxShadow = 'none'
                                }}
                            >
                                {/* Status dot */}
                                <div style={{
                                    position: 'absolute',
                                    top: '16px',
                                    right: '16px',
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    backgroundColor: color,
                                    boxShadow: `0 0 6px ${color}`,
                                }} title={statusLabel(status)} />

                                <div style={{
                                    fontSize: '32px',
                                    marginBottom: '12px',
                                    filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.2))',
                                }}>
                                    {product.icon}
                                </div>

                                <h3 style={{
                                    fontSize: '16px',
                                    fontWeight: '700',
                                    color: '#E2E8F0',
                                    margin: '0 0 4px',
                                }}>
                                    {product.name}
                                </h3>

                                <p style={{
                                    fontSize: '13px',
                                    color: '#94A3B8',
                                    margin: '0 0 12px',
                                    lineHeight: '1.4',
                                }}>
                                    {product.description}
                                </p>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }}>
                                    <span style={{
                                        fontSize: '11px',
                                        color: color,
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                    }}>
                                        {statusLabel(status)}
                                    </span>
                                    <span style={{
                                        fontSize: '12px',
                                        color: '#64748B',
                                    }}>
                                        {product.internal ? 'Open' : 'Visit'} {'\u2192'}
                                    </span>
                                </div>
                            </div>
                        )

                        if (product.internal) {
                            // Internal link — use React Router via onClick
                            return (
                                <a
                                    key={product.key}
                                    href={product.href}
                                    style={{ textDecoration: 'none', color: 'inherit' }}
                                >
                                    {cardContent}
                                </a>
                            )
                        }

                        const onClickHandler = product.ssoHandoff
                            ? (e) => {
                                // SSO handoff — mint a fresh access+refresh
                                // pair and pass both in the URL fragment so
                                // the target session survives past the 15-min
                                // access token (falls back to the plain href
                                // on any error — better to land on login than
                                // to fail the click).
                                try {
                                    e.preventDefault()
                                    openHandoff(`${product.href}/`)
                                } catch { /* default navigation proceeds */ }
                            }
                            : undefined

                        return (
                            <a
                                key={product.key}
                                href={product.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={onClickHandler}
                                style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                                {cardContent}
                            </a>
                        )
                    })}
                </div>
            )}

            {/* Summary footer */}
            <div style={{
                marginTop: '24px',
                padding: '16px 20px',
                background: 'rgba(15, 23, 42, 0.5)',
                borderRadius: '10px',
                border: '1px solid rgba(51, 65, 85, 0.3)',
                display: 'flex',
                gap: '24px',
                flexWrap: 'wrap',
                fontSize: '13px',
                color: '#94A3B8',
            }}>
                {(() => {
                    // Scope counts to the products SHOWN on this hub (PRODUCTS),
                    // not the full ecosystem-status response — comparing the
                    // two sources produced a negative "Not provisioned" count
                    // when the API returned more products than the hub lists.
                    const localStatuses = PRODUCTS.map(p => statuses[p.key]?.status)
                    const active = localStatuses.filter(s => s === 'active' || s === 'healthy').length
                    const pending = localStatuses.filter(s => s === 'pending').length
                    const notProvisioned = PRODUCTS.length - active - pending
                    return (
                        <>
                            <div>
                                <span style={{ color: '#22C55E', fontWeight: '700', marginRight: '6px' }}>{active}</span>
                                Active
                            </div>
                            <div>
                                <span style={{ color: '#EAB308', fontWeight: '700', marginRight: '6px' }}>{pending}</span>
                                Pending
                            </div>
                            <div>
                                <span style={{ color: '#64748B', fontWeight: '700', marginRight: '6px' }}>{notProvisioned}</span>
                                Not provisioned
                            </div>
                        </>
                    )
                })()}
            </div>
        </div>
    )
}
