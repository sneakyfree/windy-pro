import { useState, useEffect } from 'react'

export default function ClonePanel({ apiFetch }) {
    const [bundles, setBundles] = useState([])
    const [stats, setStats] = useState(null)

    useEffect(() => {
        apiFetch('/clone/training-data').then(d => {
            if (d?.bundles) setBundles(d.bundles)
        }).catch(() => {})
        apiFetch('/recordings/stats').then(d => d && setStats(d)).catch(() => {})
    }, [apiFetch])

    const hours = Math.round((stats?.totalDuration || 0) / 3600)
    const readyPct = stats?.totalRecordings > 0
        ? Math.round((stats.cloneReady / stats.totalRecordings) * 100)
        : 0

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\ud83e\uddec'}</span>
                <div>
                    <h1 className="panel-title">Windy Clone</h1>
                    <p className="panel-subtitle">Voice clone progress and data</p>
                </div>
            </div>

            <div className="panel-grid" style={{ marginBottom: '20px' }}>
                <div className="panel-card">
                    <div className="panel-card-title">Hours Recorded</div>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{hours}</span>
                        <span className="panel-stat-label">/ 10 recommended</span>
                    </div>
                </div>
                <div className="panel-card">
                    <div className="panel-card-title">Clone Ready</div>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{bundles.length}</span>
                        <span className="panel-stat-label">bundles ({readyPct}%)</span>
                    </div>
                </div>
                <div className="panel-card">
                    <div className="panel-card-title">Quality</div>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{stats?.avgQuality ?? 0}</span>
                        <span className="panel-stat-label">/ 100</span>
                    </div>
                </div>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Clone Training</div>
                <p style={{ color: '#94A3B8', fontSize: '14px', lineHeight: '1.7' }}>
                    Clone training integration coming soon. In the meantime, export your voice data
                    package for use with ElevenLabs, PlayHT, or other voice cloning services.
                </p>
                <p style={{ color: '#64748B', fontSize: '13px' }}>
                    In the Windy Word desktop app: Clone Data Archive &rarr; Select bundles &rarr; Export Clone Package.
                </p>
            </div>

            <a href="/soul-file" className="panel-btn" style={{ marginTop: '12px' }}>Open Soul File</a>
        </div>
    )
}
