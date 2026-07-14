import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import HatchCard from '../components/HatchCard'
import VoiceButton from '../components/VoiceButton'
import './Dashboard.css'
import './Hatch.css'

const API_BASE = '/api/v1'

function getToken() {
    return localStorage.getItem('windy_token')
}

function getUser() {
    try { return JSON.parse(localStorage.getItem('windy_user')) } catch { return null }
}

// Windy Admin RBAC (ADR-WA-001 §6): the account-server JWT carries an
// `admin_role` claim only for staff. Read it so the dashboard can show
// the super-admin panel tile to the handful of people who have a role.
function getAdminRole() {
    const token = getToken()
    if (!token) return null
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        return payload.admin_role || null
    } catch { return null }
}

const ADMIN_ROLE_LABEL = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    support: 'Support',
    analyst: 'Analyst',
}

async function apiFetch(path, options = {}) {
    const token = getToken()
    let res
    try {
        res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...options.headers
            }
        })
    } catch {
        return { _error: 'network' }
    }
    if (res.status === 401) {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        window.location.href = '/auth'
        return null
    }
    if (res.status >= 500) {
        return { _error: 'server' }
    }
    return res.json()
}

function formatDate(dateStr) {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now - d
    const dayMs = 86400000

    if (diff < dayMs && d.getDate() === now.getDate()) return 'Today'
    if (diff < 2 * dayMs) return 'Yesterday'
    if (diff < 7 * dayMs) return d.toLocaleDateString('en-US', { weekday: 'long' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(seconds) {
    if (!seconds) return '0s'
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return m ? `${m}m ${s}s` : `${s}s`
}

export default function Dashboard() {
    const [recordings, setRecordings] = useState([])
    const [stats, setStats] = useState(null)
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [expanded, setExpanded] = useState(null)
    const [expandedData, setExpandedData] = useState(null)
    const [translationStats, setTranslationStats] = useState(null)
    const [ecosystem, setEcosystem] = useState(null)
    const navigate = useNavigate()
    const user = getUser()

    const loadRecordings = useCallback(async () => {
        setLoading(true)
        setError(null)
        const params = new URLSearchParams({ page })
        if (search) params.set('search', search)
        const data = await apiFetch(`/recordings?${params}`)
        if (data?._error) {
            setError(data._error)
            setLoading(false)
            return
        }
        if (data) {
            setRecordings(data.recordings || [])
            setTotalPages(data.pagination?.totalPages || 1)
        }
        setLoading(false)
    }, [page, search])

    const loadStats = useCallback(async () => {
        const data = await apiFetch('/recordings/stats')
        if (data) setStats(data)
    }, [])

    useEffect(() => { loadRecordings() }, [loadRecordings])
    useEffect(() => { loadStats() }, [loadStats])
    useEffect(() => {
        apiFetch('/user/history?limit=1').then(data => {
            if (data) setTranslationStats({
                total: data.total || 0,
                languages: data.languages || [],
                favorites: data.favoriteCount || 0
            })
        }).catch(err => console.warn('API error:', err.message))
    }, [])

    useEffect(() => {
        apiFetch('/identity/ecosystem-status').then(data => {
            if (data?.products) setEcosystem(data)
        }).catch(() => {})
    }, [])

    // Track per-tile "connecting" state so the Connect-Now badge can show
    // a spinner while a provision call is in flight. Keyed by product key.
    const [provisioning, setProvisioning] = useState({})
    // Track per-tile provision failures so the badge can say "⚠ Try again"
    // instead of silently reverting to "⚡ Connect" — a grandma who sees
    // nothing happen after a tap assumes the whole app is broken.
    const [provisionError, setProvisionError] = useState({})

    const handleProvision = useCallback(async (productKey, provisionPath, event) => {
        // Tile is wrapped in an <a> link; intercept before navigation.
        if (event) {
            event.preventDefault()
            event.stopPropagation()
        }
        setProvisioning(p => ({ ...p, [productKey]: true }))
        setProvisionError(e => ({ ...e, [productKey]: false }))
        try {
            const result = await apiFetch(provisionPath, { method: 'POST', body: '{}' })
            if (result && !result._error) {
                // Refresh ecosystem so the badge flips to Active immediately.
                const fresh = await apiFetch('/identity/ecosystem-status')
                if (fresh?.products) setEcosystem(fresh)
            } else {
                // network / 5xx / downstream service unavailable — surface it.
                setProvisionError(e => ({ ...e, [productKey]: true }))
            }
        } catch {
            setProvisionError(e => ({ ...e, [productKey]: true }))
        } finally {
            setProvisioning(p => ({ ...p, [productKey]: false }))
        }
    }, [])

    const handleExpand = async (id) => {
        if (expanded === id) { setExpanded(null); setExpandedData(null); return }
        setExpanded(id)
        const data = await apiFetch(`/recordings/${id}`)
        if (data) setExpandedData(data.recording)
    }

    const handleDelete = async (id) => {
        if (!confirm('Delete this recording permanently?')) return
        await apiFetch(`/recordings/${id}`, { method: 'DELETE' })
        setExpanded(null)
        setExpandedData(null)
        loadRecordings()
        loadStats()
    }

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text)
    }

    const handleLogout = () => {
        apiFetch('/auth/logout', { method: 'POST' }).catch(err => console.warn('Logout error:', err.message))
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/auth')
    }

    const handleSearch = (e) => {
        e.preventDefault()
        setPage(1)
        loadRecordings()
    }

    // Group recordings by date
    const groups = {}
    recordings.forEach(r => {
        const key = formatDate(r.createdAt)
        if (!groups[key]) groups[key] = []
        groups[key].push(r)
    })

    return (
        <div className="dashboard">
            {/* Header */}
            <header className="dash-header">
                <div className="dash-header-left">
                    <Link to="/" className="dash-logo">
                        <span className="dash-logo-icon">🌪️</span>
                        <span>Windy Word</span>
                    </Link>
                </div>
                <div className="dash-header-right">
                    <Link to="/soul-file" className="dash-btn" style={{ textDecoration: 'none' }}>🧬 Soul File</Link>
                    <Link to="/vault" className="dash-btn" style={{ textDecoration: 'none', borderColor: '#3B82F6', color: '#3B82F6' }}>📝 Vault</Link>
                    <Link to="/translate" className="dash-btn" style={{ textDecoration: 'none', borderColor: '#F59E0B', color: '#F59E0B' }}>🌍 Translate</Link>
                    <Link to="/profile" className="dash-btn" style={{ textDecoration: 'none', borderColor: '#8B5CF6', color: '#8B5CF6' }}>👤 Profile</Link>
                    <Link to="/settings" className="dash-btn" style={{ textDecoration: 'none', borderColor: '#64748B', color: '#94A3B8' }}>⚙️</Link>
                    <div className="dash-user">
                        <span className="dash-avatar">{user?.name?.[0] || '?'}</span>
                        <span className="dash-username">{user?.name || 'User'}</span>
                    </div>
                    <button className="dash-logout" onClick={handleLogout}>Sign Out</button>
                </div>
            </header>

            {/* Hatch hero card — ballroom-blocker ribbon entry point.
                ADR-050: HatchCard derives hatched state from the API
                (ecosystem.products.windy_fly.status) rather than
                localStorage, closing the stale-cache trap surfaced
                2026-05-19. localStorage stays as first-paint fallback. */}
            <HatchCard ecosystem={ecosystem} />

            {/* Stats Bar */}
            {stats && (
                <div className="dash-stats">
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats?.totalRecordings?.toLocaleString() || '0'}</span>
                        <span className="dash-stat-label">Recordings</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats?.totalSize ? Math.round(stats.totalSize / 1024).toLocaleString() + ' KB' : '0'}</span>
                        <span className="dash-stat-label">Size</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{Math.round((stats?.totalDuration || 0) / 3600)}h</span>
                        <span className="dash-stat-label">Hours</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats?.cloneReady?.toLocaleString() || '0'}</span>
                        <span className="dash-stat-label">Clone Ready</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats?.videoRecordings?.toLocaleString() || '0'}</span>
                        <span className="dash-stat-label">🎬 Video</span>
                    </div>
                    {translationStats && (
                        <>
                            <div className="dash-stat">
                                <span className="dash-stat-value" style={{ color: '#3B82F6' }}>{translationStats.total}</span>
                                <span className="dash-stat-label">🌍 Translations</span>
                            </div>
                            <div className="dash-stat">
                                <span className="dash-stat-value" style={{ color: '#F59E0B' }}>{translationStats.favorites}</span>
                                <span className="dash-stat-label">⭐ Favorites</span>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Staff — the super-admin panel, shown ONLY to accounts with an
                admin_role claim. Deep-links to admin.windyword.ai with the
                account-server JWT in the URL fragment for seamless SSO
                (same token the panel verifies; no second login). */}
            {getAdminRole() && (
                <div className="dash-ecosystem" style={{ marginBottom: '1.5rem' }}>
                    <h3 className="dash-ecosystem-title">Staff</h3>
                    <div className="dash-ecosystem-grid">
                        <a
                            className="dash-eco-card"
                            href={`https://admin.windyword.ai/#token=${encodeURIComponent(getToken() || '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the Windy Admin super-admin panel"
                        >
                            <span className="dash-eco-icon">🛠️</span>
                            <span className="dash-eco-label">Admin Panel</span>
                            <span className="dash-eco-badge eco-active">
                                {ADMIN_ROLE_LABEL[getAdminRole()] || getAdminRole()}
                            </span>
                        </a>
                    </div>
                </div>
            )}

            {/* Ecosystem */}
            {ecosystem && (
                <div className="dash-ecosystem">
                    <h3 className="dash-ecosystem-title">Windy Ecosystem</h3>
                    <div className="dash-ecosystem-grid">
                        {/* TODO(arch): this list is duplicated across SPA / mobile /
                            account-server. Next iteration: extract to a shared
                            registry (likely shared/ecosystem-products.ts re-exported
                            via @windy-pro/contracts) so a new product gets one
                            source-of-truth row, not four. Tracked: ADR-008
                            companion in kit-army-config/docs.                       */}
                        {[
                            // In-product surfaces (SPA panels / pages) — preferred where they exist,
                            // because authed user lands directly in the working UI instead of a
                            // marketing apex that can be broken or a JSON-only API host.
                            //
                            // `provisionPath` (optional) — if a tile shows status "not_active"
                            // and a provisionPath is set, an inline Connect-Now button appears
                            // that POSTs to that endpoint and refreshes ecosystem-status. Lets
                            // users light up a product without leaving the dashboard.
                            { key: 'windy_word', label: 'Windy Word', icon: '🎙️', href: '/transcribe' },
                            { key: 'windy_chat', label: 'Windy Chat', icon: '💬', href: '/app/chat', provisionPath: '/identity/chat/provision' },
                            { key: 'windy_mail', label: 'Windy Mail', icon: '📧', href: '/app/mail', provisionPath: '/identity/mail/provision' },
                            { key: 'windy_cloud', label: 'Windy Cloud', icon: '☁️', href: '/vault' },
                            { key: 'windy_fly', label: 'Windy Fly', icon: '🪰', href: '/app/fly' },
                            // Windy Clone: external — the marketplace SPA is live at the
                            // apex (served by the Clone API container, 2026-07-07). Clone
                            // validates the same Pro JWT via JWKS. The token is handed off in
                            // the URL *fragment* (#token=), not the querystring, so the live
                            // credential never lands in windyclone.ai's access logs, the
                            // Referer header, or CDN query logs (mirrors the admin.windyword.ai
                            // handoff above). Clone captures it synchronously on load, stores
                            // it to localStorage, and strips the URL. (Clone still accepts
                            // ?token= for backward compat — sneakyfree/Windy-Clone#55/#56.)
                            { key: 'windy_clone', label: 'Windy Clone', icon: '🧬', href: `https://windyclone.ai/#token=${encodeURIComponent(getToken() || '')}` },
                            { key: 'windy_traveler', label: 'Windy Traveler', icon: '🌍', href: '/translate' },
                            // Windy Code — VS Code soft-fork; windycode.org has no public
                            // web surface (401 behind Cloudflare Access). Render as a
                            // dimmed "Coming Soon" chip rather than a dead login-wall link.
                            { key: 'windy_code', label: 'Windy Code', icon: '💻', comingSoon: true },
                            // Eternitas: in-product Passport panel, not the external app
                            // host (app.eternitas.ai was NXDOMAIN as of 2026-05-17).
                            { key: 'eternitas', label: 'Eternitas', icon: '🛡️', href: '/app/passport' },
                            // Surfaces without a working destination yet — render as
                            // non-clickable "Coming soon" chips rather than dead links.
                            // Domains are owned (CF zones) but no site is deployed; mobile
                            // route at /mobile doesn't exist. Will become real links as each
                            // surface lands. See ballroom-blockers doc for tracking.
                            { key: 'windy_text', label: 'Windy Text', icon: '📱', comingSoon: true },
                            { key: 'windy_call', label: 'Windy Call', icon: '📞', comingSoon: true },
                            { key: 'windy_mobile', label: 'Windy Mobile', icon: '📲', comingSoon: true },
                            // Windy Talk — Platform 14 (blessed by Grant 2026-07-08, amends
                            // ADR-010 §2/§5; see ADR-058). The universal voice layer: talk
                            // to your agent hands-free and it acts on your computer. Repo
                            // sneakyfree/windytalk; windytalk.com. Coming soon.
                            { key: 'windy_talk', label: 'Windy Talk', icon: '🗣️', comingSoon: true },
                            // Windy Mind — Platform 12 per ADR-010 §2. BYOM intelligence
                            // layer. windymind.ai serves a Developer Preview Live landing
                            // page (9 providers, 15+ models) as of 2026-05-19. Tile is now
                            // a real link; the dimmed "Coming Soon" rendering was retired
                            // once the destination surface was honest about state.
                            { key: 'windy_mind', label: 'Windy Mind', icon: '🧠', href: 'https://windymind.ai' },
                            // Windy Search — Platform 13. Agent web-access toolkit;
                            // api.windysearch.com is live (Phase 1); windysearch.com apex
                            // serves a Developer Preview Live landing page as of 2026-05-19.
                            // Phase 2 Chrome extension + Phase 3 browser fork still pending.
                            { key: 'windy_search', label: 'Windy Search', icon: '🔍', href: 'https://windysearch.com' },
                            // Windy Hand — the browser/render layer (Search finds pages,
                            // Hand uses them: renders JS, navigates, extracts, gets past
                            // walls). Beachhead: sneakyfree/windy-hand + windyhand.com (not
                            // yet a deployed standalone product). Phase-1 is already live as
                            // rented Browserbase behind Windy Search's /web/fetch (render
                            // on/auto); the own-built fleet is pending. Coming-soon chip until
                            // there's a standalone surface — no account-server product row
                            // needed (comingSoon forces the badge). See project_windy_hand.
                            { key: 'windy_hand', label: 'Windy Hand', icon: '🖐️', comingSoon: true },
                            // Windy Connect — agent-onboarding kernel. The `windy` CLI
                            // (PyPI `windy-connect`) pairs any agent runtime — OpenClaw,
                            // Hermes, Claude Code, generic — with the rest of the Windy
                            // ecosystem (Mail mailbox, Matrix chat ID, Windy Mind LLM
                            // access, optional Eternitas Passport). Marketing site at
                            // windyconnect.com (Cloudflare Pages, sneakyfree/windy-connect-site).
                            // External-link tile follows the windy-code/windy-mind/
                            // windy-search pattern. Account-server returns
                            // windy_connect: { status: 'available' } so the badge
                            // renders purple "Available" matching the others.
                            { key: 'windy_connect', label: 'Windy Connect', icon: '🔌', href: 'https://windyconnect.com' },
                            // Windy Drops — the open marketplace for the Windy
                            // ecosystem (WD-31). Marketing/browse surface at
                            // windydrops.com (CF Pages, sneakyfree/windy-drops-site);
                            // registry API at api.windydrops.com; drop bundles at
                            // drops.windydrops.com. The in-Pro install path lives
                            // inside Windy Word's Control Panel (Phase 3 of WD-31,
                            // shipped in v1.7.0 DMG 2026-05-22) — this web tile is
                            // the discovery surface for browsers. Account-server
                            // returns windy_drops: { status: 'available' } matching
                            // the windy_connect/windy_mind/windy_search pattern.
                            { key: 'windy_drops', label: 'Windy Drops', icon: '🌀', href: 'https://windydrops.com' },
                            // Windy Calendar — the born-installed scheduler + calendar
                            // view (repo sneakyfree/windy-calendar; windycalendar.com being
                            // acquired). Steps 1–6 built + adversarially reviewed on OC5
                            // (atomic slot lock proven, ADR-060 Class C control surface,
                            // local wrangler smoke green — see that repo's HANDOFF.md);
                            // first shipped job is replacing the Calendly embed on
                            // grantwhitmer.com — CUTOVER DONE 2026-07-14: the Calendly embed
                            // is replaced and windycalendar.com is live, so the tile links out
                            // (external-link pattern like windy_mind/windy_search).
                            { key: 'windy_calendar', label: 'Windy Calendar', icon: '📅', href: 'https://windycalendar.com' },
                        ].map(p => {
                            const product = ecosystem.products?.[p.key] || {}
                            const status = p.comingSoon ? 'coming_soon' : (product.status || 'not_provisioned')
                            const badgeClass = status === 'active' ? 'eco-active'
                                : status === 'pending' ? 'eco-pending'
                                : status === 'upgrade_required' ? 'eco-upgrade'
                                : status === 'available' ? 'eco-available'
                                : status === 'coming_soon' ? 'eco-pending'
                                : 'eco-inactive'
                            const badgeLabel = status === 'active' ? 'Active'
                                : status === 'pending' ? 'Pending'
                                : status === 'upgrade_required' ? 'Upgrade'
                                : status === 'available' ? 'Available'
                                : status === 'coming_soon' ? 'Coming Soon'
                                : 'Not Active'
                            // Coming-soon tiles render as dimmed, non-clickable cards.
                            if (p.comingSoon) {
                                return (
                                    <div
                                        key={p.key}
                                        className="dash-eco-card"
                                        style={{ opacity: 0.55, cursor: 'default' }}
                                        title={`${p.label} — coming soon`}
                                    >
                                        <span className="dash-eco-icon">{p.icon}</span>
                                        <span className="dash-eco-label">{p.label}</span>
                                        <span className={`dash-eco-badge ${badgeClass}`}>{badgeLabel}</span>
                                    </div>
                                )
                            }
                            const isExternal = p.href.startsWith('http')
                            // Show a Connect-Now button on tiles where the product has
                            // a provision endpoint AND the user hasn't activated it yet.
                            // Click stops propagation so the surrounding <a> doesn't
                            // navigate before the provision call completes.
                            const showConnect = p.provisionPath
                                && (status === 'not_provisioned' || status === 'pending' || status === 'available')
                            const isConnecting = provisioning[p.key]
                            const connectFailed = provisionError[p.key]
                            return (
                                <a
                                    key={p.key}
                                    href={p.href}
                                    className="dash-eco-card"
                                    {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                                >
                                    <span className="dash-eco-icon">{p.icon}</span>
                                    <span className="dash-eco-label">{p.label}</span>
                                    {showConnect ? (
                                        <button
                                            type="button"
                                            onClick={(e) => handleProvision(p.key, p.provisionPath, e)}
                                            disabled={isConnecting}
                                            className={`dash-eco-badge ${connectFailed ? 'eco-upgrade' : 'eco-available'}`}
                                            style={{ cursor: 'pointer', border: 'none', opacity: isConnecting ? 0.6 : 1 }}
                                            title={connectFailed ? `${p.label} couldn't connect just now — tap to try again` : `Connect ${p.label} now`}
                                        >
                                            {isConnecting ? 'Connecting…' : connectFailed ? '⚠ Try again' : '⚡ Connect'}
                                        </button>
                                    ) : (
                                        <span className={`dash-eco-badge ${badgeClass}`}>{badgeLabel}</span>
                                    )}
                                </a>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Search */}
            <form className="dash-search" onSubmit={handleSearch}>
                <input
                    type="text"
                    placeholder="Search transcripts..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="dash-search-input"
                />
                <button type="submit" className="dash-search-btn">Search</button>
            </form>

            {/* Recording List */}
            <main className="dash-main">
                {loading ? (
                    <div className="dash-loading">Loading recordings...</div>
                ) : error ? (
                    <div className="dash-empty">
                        <div className="dash-empty-icon">{error === 'network' ? '📡' : '⚠️'}</div>
                        <h3>{error === 'network' ? "Can't reach server. Check your connection." : 'Something went wrong. Try refreshing.'}</h3>
                        <button className="dash-btn" onClick={() => loadRecordings()} style={{ marginTop: '16px', cursor: 'pointer' }}>Retry</button>
                    </div>
                ) : recordings.length === 0 ? (
                    <div className="dash-empty">
                        <div className="dash-empty-icon">🎙️</div>
                        <h3>No recordings yet</h3>
                        <p>Welcome to Windy Word! Here's how to get started:</p>
                        <div style={{ textAlign: 'left', margin: '16px auto', maxWidth: '360px', lineHeight: '2' }}>
                            <div>1. <Link to="/transcribe" style={{ color: '#3B82F6' }}>Try cloud transcription</Link> — speak and see text in real-time</div>
                            <div>2. <a href="#download" style={{ color: '#3B82F6' }}>Download the desktop app</a> — for local, private transcription</div>
                            <div style={{ color: '#64748B' }}>3. Mobile apps for iOS &amp; Android — <span style={{ color: '#94A3B8' }}>coming soon</span></div>
                        </div>
                    </div>
                ) : (
                    Object.entries(groups).map(([date, recs]) => (
                        <div key={date} className="dash-group">
                            <h3 className="dash-group-date">{date}</h3>
                            {recs.map(r => (
                                <div key={r.id} className={`dash-entry ${expanded === r.id ? 'expanded' : ''}`}>
                                    <div className="dash-entry-header" onClick={() => handleExpand(r.id)}>
                                        <div className="dash-entry-time">{formatTime(r.createdAt)}</div>
                                        <div className="dash-entry-preview">{r.preview || '(no text)'}</div>
                                        <div className="dash-entry-meta">
                                            {r.hasAudio ? <span className="dash-badge audio">🎤</span> : null}
                                            {r.hasVideo ? <span className="dash-badge video">🎬</span> : null}
                                            {r.mode === 'clone_capture' ? <span className="dash-badge clone">🧬</span> : null}
                                            <span className="dash-entry-words">{r.wordCount} words</span>
                                            <span className="dash-entry-duration">{formatDuration(r.durationSeconds)}</span>
                                            <span className="dash-entry-engine">{r.engine}</span>
                                        </div>
                                        <span className="dash-entry-chevron">{expanded === r.id ? '▼' : '▶'}</span>
                                    </div>

                                    {expanded === r.id && expandedData && (
                                        <div className="dash-entry-body">
                                            {/* Media Players */}
                                            {expandedData.hasAudio ? (
                                                <div className="dash-player">
                                                    <audio controls preload="metadata"
                                                        src={`${API_BASE}/recordings/${r.id}/audio?token=${getToken()}`}>
                                                    </audio>
                                                </div>
                                            ) : null}
                                            {expandedData.hasVideo ? (
                                                <div className="dash-player video-player">
                                                    <video controls preload="metadata"
                                                        src={`${API_BASE}/recordings/${r.id}/video?token=${getToken()}`}>
                                                    </video>
                                                </div>
                                            ) : null}

                                            {/* Transcript */}
                                            <div className="dash-transcript">
                                                <div className="dash-transcript-text">
                                                    {expandedData.transcript || '(empty transcript)'}
                                                </div>
                                                <div className="dash-transcript-actions">
                                                    <button onClick={() => handleCopy(expandedData.transcript)} className="dash-btn">📋 Copy</button>
                                                    <button onClick={() => handleDelete(r.id)} className="dash-btn danger">🗑️ Delete</button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="dash-pagination">
                        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="dash-page-btn">← Previous</button>
                        <span className="dash-page-info">Page {page} of {totalPages}</span>
                        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="dash-page-btn">Next →</button>
                    </div>
                )}
            </main>
            <VoiceButton token={getToken()} surface="dashboard" />
        </div>
    )
}
