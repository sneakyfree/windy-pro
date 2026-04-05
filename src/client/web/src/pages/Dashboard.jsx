import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Dashboard.css'

const API_BASE = '/api/v1'

function getToken() {
    return localStorage.getItem('windy_token')
}

function getUser() {
    try { return JSON.parse(localStorage.getItem('windy_user')) } catch { return null }
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
                        <span>Windy Pro</span>
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

            {/* Ecosystem */}
            {ecosystem && (
                <div className="dash-ecosystem">
                    <h3 className="dash-ecosystem-title">Windy Ecosystem</h3>
                    <div className="dash-ecosystem-grid">
                        {[
                            { key: 'windy_word', label: 'Windy Word', icon: '🎙️', href: '/transcribe' },
                            { key: 'windy_chat', label: 'Windy Chat', icon: '💬', href: 'https://windychat.com' },
                            { key: 'windy_mail', label: 'Windy Mail', icon: '📧', href: 'https://windymail.ai' },
                            { key: 'windy_cloud', label: 'Windy Cloud', icon: '☁️', href: '/vault' },
                            { key: 'windy_fly', label: 'Windy Fly', icon: '🤖', href: 'https://windyfly.ai' },
                            { key: 'windy_clone', label: 'Windy Clone', icon: '🧬', href: '/soul-file' },
                            { key: 'windy_traveler', label: 'Windy Traveler', icon: '🌍', href: '/translate' },
                            { key: 'eternitas', label: 'Eternitas', icon: '🛡️', href: 'https://eternitas.ai' },
                        ].map(p => {
                            const product = ecosystem.products?.[p.key] || {}
                            const status = product.status || 'not_provisioned'
                            const badgeClass = status === 'active' ? 'eco-active'
                                : status === 'pending' ? 'eco-pending'
                                : status === 'upgrade_required' ? 'eco-upgrade'
                                : status === 'available' ? 'eco-available'
                                : 'eco-inactive'
                            const badgeLabel = status === 'active' ? 'Active'
                                : status === 'pending' ? 'Pending'
                                : status === 'upgrade_required' ? 'Upgrade'
                                : status === 'available' ? 'Available'
                                : 'Not Active'
                            const isExternal = p.href.startsWith('http')
                            return (
                                <a
                                    key={p.key}
                                    href={p.href}
                                    className="dash-eco-card"
                                    {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                                >
                                    <span className="dash-eco-icon">{p.icon}</span>
                                    <span className="dash-eco-label">{p.label}</span>
                                    <span className={`dash-eco-badge ${badgeClass}`}>{badgeLabel}</span>
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
                            <div>3. Get the mobile app — <a href="https://apps.apple.com/app/windy-pro" target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6' }}>iOS</a> / <a href="https://play.google.com/store/apps/details?id=pro.windy.app" target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6' }}>Android</a></div>
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
        </div>
    )
}
