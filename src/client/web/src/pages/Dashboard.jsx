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
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    })
    if (res.status === 401) {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        window.location.href = '/auth'
        return null
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
    const [expanded, setExpanded] = useState(null)
    const [expandedData, setExpandedData] = useState(null)
    const navigate = useNavigate()
    const user = getUser()

    const loadRecordings = useCallback(async () => {
        setLoading(true)
        const params = new URLSearchParams({ page })
        if (search) params.set('search', search)
        const data = await apiFetch(`/recordings?${params}`)
        if (data) {
            setRecordings(data.recordings || [])
            setTotalPages(data.pagination?.totalPages || 1)
        }
        setLoading(false)
    }, [page, search])

    const loadStats = useCallback(async () => {
        const data = await apiFetch('/recordings/stats')
        if (data) setStats(data.stats)
    }, [])

    useEffect(() => { loadRecordings() }, [loadRecordings])
    useEffect(() => { loadStats() }, [loadStats])

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
        apiFetch('/auth/logout', { method: 'POST' }).catch(() => { })
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
        const key = formatDate(r.recorded_at)
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
                        <span className="dash-stat-value">{stats.totalRecordings}</span>
                        <span className="dash-stat-label">Recordings</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats.totalWords.toLocaleString()}</span>
                        <span className="dash-stat-label">Words</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats.totalHours}h</span>
                        <span className="dash-stat-label">Hours</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats.audioCount}</span>
                        <span className="dash-stat-label">🎤 Audio</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats.videoCount}</span>
                        <span className="dash-stat-label">🎬 Video</span>
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
                ) : recordings.length === 0 ? (
                    <div className="dash-empty">
                        <div className="dash-empty-icon">🎙️</div>
                        <h3>No recordings yet</h3>
                        <p>Start recording with Windy Pro desktop app and your transcripts will appear here.</p>
                    </div>
                ) : (
                    Object.entries(groups).map(([date, recs]) => (
                        <div key={date} className="dash-group">
                            <h3 className="dash-group-date">{date}</h3>
                            {recs.map(r => (
                                <div key={r.id} className={`dash-entry ${expanded === r.id ? 'expanded' : ''}`}>
                                    <div className="dash-entry-header" onClick={() => handleExpand(r.id)}>
                                        <div className="dash-entry-time">{formatTime(r.recorded_at)}</div>
                                        <div className="dash-entry-preview">{r.preview || '(no text)'}</div>
                                        <div className="dash-entry-meta">
                                            {r.has_audio ? <span className="dash-badge audio">🎤</span> : null}
                                            {r.has_video ? <span className="dash-badge video">🎬</span> : null}
                                            {r.mode === 'clone_capture' ? <span className="dash-badge clone">🧬</span> : null}
                                            <span className="dash-entry-words">{r.word_count} words</span>
                                            <span className="dash-entry-duration">{formatDuration(r.duration_seconds)}</span>
                                            <span className="dash-entry-engine">{r.engine}</span>
                                        </div>
                                        <span className="dash-entry-chevron">{expanded === r.id ? '▼' : '▶'}</span>
                                    </div>

                                    {expanded === r.id && expandedData && (
                                        <div className="dash-entry-body">
                                            {/* Media Players */}
                                            {expandedData.has_audio ? (
                                                <div className="dash-player">
                                                    <audio controls preload="metadata"
                                                        src={`${API_BASE}/recordings/${r.id}/audio?token=${getToken()}`}>
                                                    </audio>
                                                </div>
                                            ) : null}
                                            {expandedData.has_video ? (
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
