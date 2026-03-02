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

export default function Vault() {
    const [recordings, setRecordings] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [expanded, setExpanded] = useState(null)
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [stats, setStats] = useState(null)
    const [copyFeedback, setCopyFeedback] = useState(null)
    const user = getUser()
    const navigate = useNavigate()
    const perPage = 20

    const fetchRecordings = useCallback(async () => {
        setLoading(true)
        const params = new URLSearchParams({ page, limit: perPage })
        if (search) params.set('search', search)
        const data = await apiFetch(`/recordings?${params}`)
        if (data) {
            setRecordings(data.recordings || [])
            setTotal(data.total || 0)
        }
        setLoading(false)
    }, [page, search])

    useEffect(() => { fetchRecordings() }, [fetchRecordings])

    useEffect(() => {
        apiFetch('/recordings/stats').then(data => {
            if (data) setStats(data)
        })
    }, [])

    const handleSearch = (e) => {
        e.preventDefault()
        setPage(1)
        fetchRecordings()
    }

    const handleCopy = async (text, id) => {
        await navigator.clipboard.writeText(text)
        setCopyFeedback(id)
        setTimeout(() => setCopyFeedback(null), 2000)
    }

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this transcript permanently?')) return
        await apiFetch(`/recordings/${id}`, { method: 'DELETE' })
        fetchRecordings()
    }

    const handleExportAll = async () => {
        const allData = await apiFetch('/recordings?limit=9999')
        if (!allData?.recordings?.length) return
        const text = allData.recordings
            .map(r => `--- ${r.recorded_at || r.created_at} (${r.word_count} words) ---\n${r.transcript}`)
            .join('\n\n')
        const blob = new Blob([text], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `windy-vault-export-${new Date().toISOString().slice(0, 10)}.txt`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleSignOut = () => {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/')
    }

    // Group recordings by date
    const groups = recordings.reduce((acc, rec) => {
        const date = formatDate(rec.recorded_at || rec.created_at)
        if (!acc[date]) acc[date] = []
        acc[date].push(rec)
        return acc
    }, {})

    const totalPages = Math.ceil(total / perPage)

    return (
        <div className="dashboard">
            {/* Header */}
            <header className="dash-header">
                <div className="dash-header-left">
                    <Link to="/" className="dash-logo">
                        <span className="dash-logo-icon">🌪️</span> Windy Pro
                    </Link>
                </div>
                <div className="dash-header-right">
                    <Link to="/dashboard" className="dash-btn" style={{ borderColor: '#22C55E', color: '#22C55E' }}>
                        📊 Dashboard
                    </Link>
                    <Link to="/soul-file" className="dash-btn" style={{ borderColor: '#8B5CF6', color: '#8B5CF6' }}>
                        🧬 Soul File
                    </Link>
                    <div className="dash-user">
                        <div className="dash-avatar">{user?.name?.[0]?.toUpperCase() || '?'}</div>
                    </div>
                    <button className="dash-logout" onClick={handleSignOut}>Sign Out</button>
                </div>
            </header>

            {/* Stats */}
            {stats && (
                <div className="dash-stats">
                    <div className="dash-stat">
                        <span className="dash-stat-value">{stats.total_recordings || 0}</span>
                        <span className="dash-stat-label">Transcripts</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{(stats.total_words || 0).toLocaleString()}</span>
                        <span className="dash-stat-label">Total Words</span>
                    </div>
                    <div className="dash-stat">
                        <span className="dash-stat-value">{Math.round((stats.total_duration || 0) / 3600)}h</span>
                        <span className="dash-stat-label">Recorded</span>
                    </div>
                </div>
            )}

            {/* Search + Export */}
            <form className="dash-search" onSubmit={handleSearch} style={{ maxWidth: '700px' }}>
                <input
                    className="dash-search-input"
                    type="text"
                    placeholder="Search transcripts by keyword..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <button type="submit" className="dash-search-btn">Search</button>
                <button
                    type="button"
                    className="dash-btn"
                    onClick={handleExportAll}
                    style={{ whiteSpace: 'nowrap' }}
                    title="Download all transcripts as a text file"
                >
                    📥 Export
                </button>
            </form>

            {/* Content */}
            <div className="dash-main">
                {loading ? (
                    <div className="dash-loading">Loading transcripts...</div>
                ) : recordings.length === 0 ? (
                    <div className="dash-empty">
                        <div className="dash-empty-icon">📝</div>
                        <h3>No transcripts yet</h3>
                        <p>Start recording with Windy Pro desktop app and your transcripts will appear here.</p>
                    </div>
                ) : (
                    Object.entries(groups).map(([date, recs]) => (
                        <div key={date} className="dash-group">
                            <div className="dash-group-date">{date}</div>
                            {recs.map(rec => (
                                <div
                                    key={rec.id}
                                    className={`dash-entry ${expanded === rec.id ? 'expanded' : ''}`}
                                >
                                    <div
                                        className="dash-entry-header"
                                        onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}
                                    >
                                        <span className="dash-entry-time">
                                            {formatTime(rec.recorded_at || rec.created_at)}
                                        </span>
                                        <span className="dash-entry-preview">
                                            {rec.transcript?.slice(0, 100) || '(empty)'}
                                            {rec.transcript?.length > 100 ? '…' : ''}
                                        </span>
                                        <span className="dash-entry-meta">
                                            <span className="dash-entry-words">{rec.word_count || 0}w</span>
                                            <span className="dash-entry-engine">{rec.engine || 'local'}</span>
                                        </span>
                                        <span className="dash-entry-chevron">
                                            {expanded === rec.id ? '▲' : '▼'}
                                        </span>
                                    </div>

                                    {expanded === rec.id && (
                                        <div className="dash-entry-body">
                                            <div className="dash-transcript">
                                                <div className="dash-transcript-text">
                                                    {rec.transcript || '(no transcript)'}
                                                </div>
                                                <div className="dash-transcript-actions">
                                                    <button
                                                        className="dash-btn"
                                                        onClick={() => handleCopy(rec.transcript, rec.id)}
                                                    >
                                                        {copyFeedback === rec.id ? '✅ Copied!' : '📋 Copy'}
                                                    </button>
                                                    <button
                                                        className="dash-btn danger"
                                                        onClick={() => handleDelete(rec.id)}
                                                    >
                                                        🗑️ Delete
                                                    </button>
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
                        <button
                            className="dash-page-btn"
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                        >
                            ← Prev
                        </button>
                        <span className="dash-page-info">Page {page} of {totalPages}</span>
                        <button
                            className="dash-page-btn"
                            disabled={page >= totalPages}
                            onClick={() => setPage(p => p + 1)}
                        >
                            Next →
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
