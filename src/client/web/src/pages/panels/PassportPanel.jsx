import { useState, useEffect } from 'react'

export default function PassportPanel({ apiFetch }) {
    const [passport, setPassport] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        apiFetch('/identity/me').then(async d => {
            let p = d?.passport || null
            // Enrich with the LIVE Eternitas trust view so "Verified" and
            // "Trust Score" reflect reality, not the local default (1.0). The
            // registry is public and allows the canonical windyword.ai origins.
            if (p?.passport_number) {
                try {
                    const base = import.meta.env.VITE_ETERNITAS_URL || 'https://api.eternitas.ai'
                    const t = await fetch(`${base}/api/v1/trust/${encodeURIComponent(p.passport_number)}`)
                        .then(r => (r.ok ? r.json() : null))
                    if (t) {
                        p = {
                            ...p,
                            clearance: t.clearance_level,
                            band: t.band,
                            verified: !!t.clearance_level && t.clearance_level !== 'registered',
                            trust_score: typeof t.integrity_score === 'number'
                                ? +(t.integrity_score / 1000).toFixed(2)
                                : p.trust_score,
                        }
                    }
                } catch { /* registry unreachable — show what we have */ }
            }
            if (!cancelled) { setPassport(p); setLoading(false) }
        }).catch(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
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
                            {passport.clearance && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '13px' }}>Clearance</span>
                                    <span style={{ color: '#CBD5E1', fontSize: '13px', textTransform: 'capitalize' }}>{passport.clearance}</span>
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#94A3B8', fontSize: '13px' }}>Status</span>
                                <span className={`panel-badge ${passport.status === 'active' ? 'badge-active' : 'badge-pending'}`}>
                                    {passport.status || 'unknown'}
                                </span>
                            </div>
                        </div>
                    </div>
                    {!passport.verified && (
                        <a href="/upgrade" className="panel-btn" style={{ marginTop: '4px', display: 'inline-block' }}>
                            Upgrade to verified — $1 {'→'}
                        </a>
                    )}

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
                    {/* In-product CTA: send the user to the working /hatch flow
                        instead of the external app host (app.eternitas.ai was
                        NXDOMAIN as of 2026-05-17). */}
                    <a href="/hatch" className="panel-btn" style={{ marginTop: '12px' }}>
                        Hatch an agent to get your passport {'→'}
                    </a>
                </div>
            )}
        </div>
    )
}
