import { useState, useEffect } from 'react'

export default function WordPanel({ apiFetch }) {
    const [stats, setStats] = useState(null)
    const [recordings, setRecordings] = useState([])

    useEffect(() => {
        apiFetch('/recordings/stats').then(d => d && setStats(d)).catch(() => {})
        apiFetch('/recordings?since=1970-01-01T00:00:00Z').then(d => {
            if (d?.bundles) setRecordings(d.bundles.slice(0, 10))
        }).catch(() => {})
    }, [apiFetch])

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\ud83c\udf99\ufe0f'}</span>
                <div>
                    <h1 className="panel-title">Windy Word</h1>
                    <p className="panel-subtitle">Recordings, transcriptions, voice data</p>
                </div>
            </div>

            <div className="panel-grid" style={{ marginBottom: '20px' }}>
                <div className="panel-card">
                    <div className="panel-card-title">Recordings</div>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{stats?.totalRecordings ?? 0}</span>
                        <span className="panel-stat-label">total</span>
                    </div>
                </div>
                <div className="panel-card">
                    <div className="panel-card-title">Duration</div>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{Math.round((stats?.totalDuration || 0) / 3600)}h</span>
                        <span className="panel-stat-label">recorded</span>
                    </div>
                </div>
                <div className="panel-card">
                    <div className="panel-card-title">Clone Ready</div>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{stats?.cloneReady ?? 0}</span>
                        <span className="panel-stat-label">bundles</span>
                    </div>
                </div>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Recent Recordings</div>
                {recordings.length === 0 ? (
                    <p className="panel-empty">No recordings yet. Download the desktop app to start recording.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {recordings.map(r => (
                            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(51,65,85,0.2)' }}>
                                <span style={{ fontSize: '13px', color: '#CBD5E1' }}>{r.transcript?.slice(0, 80) || 'No transcript'}{r.transcript?.length > 80 ? '...' : ''}</span>
                                <span style={{ fontSize: '12px', color: '#64748B', whiteSpace: 'nowrap', marginLeft: '12px' }}>{r.durationSeconds ? `${Math.round(r.durationSeconds)}s` : ''}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <a href="/dashboard" className="panel-btn" style={{ marginTop: '12px' }}>Open Full Dashboard</a>
        </div>
    )
}
