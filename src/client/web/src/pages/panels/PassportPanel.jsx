import { useState, useEffect } from 'react'

export default function PassportPanel({ apiFetch }) {
    const [passport, setPassport] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        apiFetch('/identity/me').then(d => {
            if (d?.passport) setPassport(d.passport)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [apiFetch])

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\ud83e\udea8'}</span>
                <div>
                    <h1 className="panel-title">Eternitas Passport</h1>
                    <p className="panel-subtitle">Bot identity, trust score, verification</p>
                </div>
            </div>

            {loading ? (
                <p style={{ color: '#64748B' }}>Loading...</p>
            ) : passport ? (
                <>
                    <div className="panel-card">
                        <div className="panel-card-title">Passport Details</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#94A3B8', fontSize: '13px' }}>Passport ID</span>
                                <code style={{ color: '#a3e635', fontSize: '13px' }}>{passport.passport_id}</code>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#94A3B8', fontSize: '13px' }}>Type</span>
                                <span style={{ color: '#CBD5E1', fontSize: '13px' }}>{passport.passport_type || 'standard'}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#94A3B8', fontSize: '13px' }}>Verified</span>
                                <span className={`panel-badge ${passport.verified ? 'badge-active' : 'badge-pending'}`}>
                                    {passport.verified ? 'Verified' : 'Pending'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="panel-card">
                        <div className="panel-card-title">Trust Score</div>
                        <div className="panel-stat">
                            <span className="panel-stat-value">{passport.trust_score ?? 'N/A'}</span>
                            <span className="panel-stat-label">/ 1.0</span>
                        </div>
                    </div>
                </>
            ) : (
                <div className="panel-card">
                    <div className="panel-card-title">No Passport</div>
                    <p style={{ color: '#94A3B8', fontSize: '14px', lineHeight: '1.7' }}>
                        You don't have an Eternitas passport yet. Passports are issued when you
                        hatch an AI agent through Windy Fly.
                    </p>
                    <a href="https://eternitas.ai" target="_blank" rel="noopener noreferrer" className="panel-btn" style={{ marginTop: '12px' }}>
                        Learn about Eternitas
                    </a>
                </div>
            )}
        </div>
    )
}
