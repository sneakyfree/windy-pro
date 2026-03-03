import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Dashboard.css'

const API_BASE = '/api/v1'

function getToken() { return localStorage.getItem('windy_token') }
function getUser() { try { return JSON.parse(localStorage.getItem('windy_user')) } catch { return null } }

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
    if (res.status === 401) { window.location.href = '/auth'; return null }
    return res.json()
}

export default function Profile() {
    const [history, setHistory] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const navigate = useNavigate()
    const user = getUser()

    useEffect(() => {
        Promise.all([
            apiFetch('/user/history?limit=20'),
            apiFetch('/recordings/stats')
        ]).then(([histData, statsData]) => {
            if (histData) setHistory(histData.translations || [])
            if (statsData) setStats(statsData.stats)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [])

    const handleLogout = () => {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/auth')
    }

    const handleDeleteAccount = async () => {
        if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return
        if (!confirm('This will permanently delete all your data. Type "DELETE" in the next prompt.')) return
        const input = prompt('Type DELETE to confirm:')
        if (input !== 'DELETE') return

        await apiFetch('/auth/delete-account', { method: 'DELETE' })
        localStorage.clear()
        navigate('/')
    }

    return (
        <div className="dashboard">
            <header className="dash-header">
                <div className="dash-header-left">
                    <Link to="/" className="dash-logo">
                        <span className="dash-logo-icon">🌪️</span> Windy Pro
                    </Link>
                </div>
                <div className="dash-header-right">
                    <Link to="/dashboard" className="dash-btn" style={{ textDecoration: 'none' }}>📊 Dashboard</Link>
                    <Link to="/settings" className="dash-btn" style={{ textDecoration: 'none' }}>⚙️ Settings</Link>
                    <button className="dash-logout" onClick={handleLogout}>Sign Out</button>
                </div>
            </header>

            <main className="dash-main" style={{ maxWidth: '700px' }}>
                {/* Profile Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '20px',
                    background: '#111827', border: '1px solid #1E293B', borderRadius: '16px',
                    padding: '28px', margin: '24px 0 16px'
                }}>
                    <div style={{
                        width: '72px', height: '72px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, #22C55E, #3B82F6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '28px', fontWeight: 700, color: 'white',
                        boxShadow: '0 0 24px rgba(34, 197, 94, 0.3)'
                    }}>
                        {user?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#E2E8F0', margin: 0 }}>{user?.name || 'User'}</h2>
                        <div style={{ color: '#64748B', fontSize: '14px', marginTop: '4px' }}>{user?.email || '—'}</div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <span style={{
                                padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                                background: 'rgba(34, 197, 94, 0.15)', color: '#22C55E'
                            }}>
                                {stats ? `${stats.totalRecordings} recordings` : '—'}
                            </span>
                            <span style={{
                                padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                                background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6'
                            }}>
                                {stats ? `${stats.totalWords.toLocaleString()} words` : '—'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Translation History */}
                <div style={{
                    background: '#111827', border: '1px solid #1E293B', borderRadius: '12px',
                    padding: '20px', marginBottom: '16px'
                }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#CBD5E1', marginBottom: '12px' }}>
                        🌍 Translation History
                    </h3>
                    {loading ? (
                        <div style={{ color: '#475569' }}>Loading...</div>
                    ) : history.length === 0 ? (
                        <div style={{ color: '#475569', fontSize: '14px', textAlign: 'center', padding: '24px' }}>
                            No translations yet. Try the <Link to="/translate" style={{ color: '#22C55E' }}>Translate page</Link>!
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {history.map((t, i) => (
                                <div key={i} style={{
                                    background: '#0B0F1A', border: '1px solid #1E293B', borderRadius: '8px',
                                    padding: '10px 14px', transition: 'border-color 0.2s'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '11px', color: '#64748B' }}>
                                            {t.source_lang} → {t.target_lang}
                                        </span>
                                        <span style={{ fontSize: '11px', color: '#475569' }}>
                                            {new Date(t.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '2px' }}>
                                        {(t.source_text || '').substring(0, 60)}{(t.source_text || '').length > 60 ? '…' : ''}
                                    </div>
                                    <div style={{ fontSize: '14px', color: '#E2E8F0', fontWeight: 500 }}>
                                        {(t.translated_text || '').substring(0, 60)}{(t.translated_text || '').length > 60 ? '…' : ''}
                                    </div>
                                    {t.is_favorite ? (
                                        <span style={{ fontSize: '11px', color: '#F59E0B' }}>⭐ Favorite</span>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Danger Zone */}
                <div style={{
                    background: '#111827', border: '1px solid #7F1D1D', borderRadius: '12px',
                    padding: '20px'
                }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#FCA5A5', marginBottom: '8px' }}>⚠️ Danger Zone</h3>
                    <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px' }}>
                        Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                    <button onClick={handleDeleteAccount} style={{
                        background: 'transparent', border: '1px solid #EF4444', color: '#EF4444',
                        padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.2s'
                    }}>
                        Delete Account
                    </button>
                </div>
            </main>
        </div>
    )
}
