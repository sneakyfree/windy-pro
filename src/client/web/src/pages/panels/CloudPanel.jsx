import { useState, useEffect } from 'react'

function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let val = bytes
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
    return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export default function CloudPanel({ apiFetch }) {
    const [files, setFiles] = useState([])
    const [storage, setStorage] = useState({ used: 0, limit: 0 })

    useEffect(() => {
        apiFetch('/files').then(d => {
            if (d) {
                setFiles(d.files || [])
                setStorage({ used: d.storageUsed || 0, limit: d.storageLimit || 0 })
            }
        }).catch(() => {})
    }, [apiFetch])

    const pct = storage.limit > 0 ? Math.min(100, (storage.used / storage.limit) * 100) : 0

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\u2601\ufe0f'}</span>
                <div>
                    <h1 className="panel-title">Windy Cloud</h1>
                    <p className="panel-subtitle">Files, storage, sync</p>
                </div>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Storage</div>
                <div className="panel-stat" style={{ marginBottom: '10px' }}>
                    <span className="panel-stat-value">{formatBytes(storage.used)}</span>
                    <span className="panel-stat-label">/ {formatBytes(storage.limit)}</span>
                </div>
                <div style={{ height: '8px', borderRadius: '4px', background: 'rgba(51,65,85,0.3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: '4px', background: pct > 90 ? '#EF4444' : '#22C55E', transition: 'width 0.3s' }} />
                </div>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Files ({files.length})</div>
                {files.length === 0 ? (
                    <p className="panel-empty">No files uploaded yet.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {files.slice(0, 15).map(f => (
                            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(51,65,85,0.2)', fontSize: '13px' }}>
                                <span style={{ color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{f.name}</span>
                                <span style={{ color: '#64748B' }}>{formatBytes(f.size)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <a href="/vault" className="panel-btn" style={{ marginTop: '12px' }}>Open Full Vault</a>
        </div>
    )
}
