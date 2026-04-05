import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import './Dashboard.css'

const API_BASE = '/api/v1'

function getToken() {
    return localStorage.getItem('windy_token')
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
        window.location.href = '/auth'
        return null
    }
    return res.json()
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    })
}

function formatDuration(seconds) {
    if (!seconds) return '0s'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.round(seconds % 60)
    if (h) return `${h}h ${m}m`
    return m ? `${m}m ${s}s` : `${s}s`
}

export default function SoulFile() {
    const [recordings, setRecordings] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState(null)
    const [expandedData, setExpandedData] = useState(null)

    const loadData = useCallback(async () => {
        setLoading(true)
        // Fetch only clone_capture recordings
        const [recData, statData] = await Promise.all([
            apiFetch('/recordings?search=&page=1'),
            apiFetch('/recordings/stats')
        ])
        if (recData) {
            // Filter for clone_capture mode
            const cloneRecs = (recData.recordings || []).filter(r => r.mode === 'clone_capture')
            setRecordings(cloneRecs)
        }
        if (statData) setStats(statData)
        setLoading(false)
    }, [])

    useEffect(() => { loadData() }, [loadData])

    const handleExpand = async (id) => {
        if (expanded === id) { setExpanded(null); setExpandedData(null); return }
        setExpanded(id)
        const data = await apiFetch(`/recordings/${id}`)
        if (data) setExpandedData(data.recording)
    }

    return (
        <div className="dashboard">
            <header className="dash-header">
                <div className="dash-header-left">
                    <Link to="/dashboard" className="dash-logo">
                        <span className="dash-logo-icon">🧬</span>
                        <span>Soul File</span>
                    </Link>
                </div>
                <div className="dash-header-right">
                    <Link to="/dashboard" className="dash-btn">← Dashboard</Link>
                </div>
            </header>

            {/* Soul File Stats */}
            <div className="dash-stats">
                <div className="dash-stat">
                    <span className="dash-stat-value">{recordings.length}</span>
                    <span className="dash-stat-label">Clone Sessions</span>
                </div>
                {stats && (
                    <>
                        <div className="dash-stat">
                            <span className="dash-stat-value">{Math.round((stats.totalDuration || 0) / 3600)}h</span>
                            <span className="dash-stat-label">Total Audio</span>
                        </div>
                        <div className="dash-stat">
                            <span className="dash-stat-value">{(stats.totalRecordings || 0).toLocaleString()}</span>
                            <span className="dash-stat-label">Recordings</span>
                        </div>
                    </>
                )}
            </div>

            {/* Info Banner */}
            <div style={{
                maxWidth: '900px', margin: '16px auto', padding: '16px 32px',
                background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.15)',
                borderRadius: '10px', fontSize: '14px', color: '#94A3B8', lineHeight: '1.6'
            }}>
                <strong style={{ color: '#22C55E' }}>🧬 What is the Soul File?</strong><br />
                Your Soul File is a growing archive of audio, video, and transcripts captured
                in <strong>Clone Capture</strong> mode. Over time, this data forms the foundation
                for your digital twin — voice clone, avatar, and behavioral model.
                The more you record, the richer your digital self becomes.
            </div>

            <main className="dash-main">
                {loading ? (
                    <div className="dash-loading">Loading clone data...</div>
                ) : recordings.length === 0 ? (
                    <div className="dash-empty">
                        <div className="dash-empty-icon">🧬</div>
                        <h3>Build Your Digital Twin</h3>
                        <p style={{ maxWidth: '420px', margin: '0 auto 20px' }}>
                            Your Soul File grows with every recording. The more you capture, the richer your digital twin becomes.
                        </p>
                        <div style={{
                            display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px'
                        }}>
                            {[
                                { step: '1', icon: '🎙️', title: 'Record', desc: 'Enable Clone Capture in desktop app' },
                                { step: '2', icon: '📊', title: 'Review', desc: 'Your sessions appear here automatically' },
                                { step: '3', icon: '🧬', title: 'Train', desc: 'AI learns your voice patterns' }
                            ].map(s => (
                                <div key={s.step} style={{
                                    background: 'rgba(30,41,59,0.6)', border: '1px solid #334155',
                                    borderRadius: '12px', padding: '16px', width: '140px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '28px', marginBottom: '6px' }}>{s.icon}</div>
                                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#22C55E', marginBottom: '4px' }}>Step {s.step}</div>
                                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#E2E8F0' }}>{s.title}</div>
                                    <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>{s.desc}</div>
                                </div>
                            ))}
                        </div>
                        <button style={{
                            background: '#22C55E', color: '#000', border: 'none', padding: '12px 32px',
                            borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: 'pointer'
                        }}>🎙️ Start Clone Capture</button>
                    </div>
                ) : (
                    recordings.map(r => (
                        <div key={r.id} className={`dash-entry ${expanded === r.id ? 'expanded' : ''}`}>
                            <div className="dash-entry-header" onClick={() => handleExpand(r.id)}>
                                <div className="dash-entry-time">{formatDate(r.recorded_at)}</div>
                                <div className="dash-entry-preview">
                                    <span className="dash-badge clone">🧬 Clone Capture</span>
                                </div>
                                <div className="dash-entry-meta">
                                    {r.has_audio ? <span className="dash-badge audio">🎤</span> : null}
                                    {r.has_video ? <span className="dash-badge video">🎬</span> : null}
                                    <span className="dash-entry-duration">{formatDuration(r.duration_seconds)}</span>
                                    <span className="dash-entry-words">{r.word_count} words</span>
                                </div>
                                <span className="dash-entry-chevron">{expanded === r.id ? '▼' : '▶'}</span>
                            </div>

                            {expanded === r.id && expandedData && (
                                <div className="dash-entry-body">
                                    {expandedData.has_audio && (
                                        <div className="dash-player">
                                            <audio controls preload="metadata"
                                                src={`${API_BASE}/recordings/${r.id}/audio?token=${getToken()}`} />
                                        </div>
                                    )}
                                    {expandedData.has_video && (
                                        <div className="dash-player video-player">
                                            <video controls preload="metadata"
                                                src={`${API_BASE}/recordings/${r.id}/video?token=${getToken()}`} />
                                        </div>
                                    )}
                                    {expandedData.transcript && (
                                        <div className="dash-transcript">
                                            <div className="dash-transcript-text">{expandedData.transcript}</div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </main>
        </div>
    )
}
