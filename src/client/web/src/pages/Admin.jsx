import { useState, useEffect, useCallback } from 'react'
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
    if (res.status === 401) {
        localStorage.removeItem('windy_user')
        localStorage.removeItem('windy_token')
        window.location.href = '/auth'
        return null
    }
    return res.json()
}

function StatCard({ icon, label, value, color = '#22C55E' }) {
    return (
        <div style={{
            background: '#111827', border: '1px solid #1E293B', borderRadius: '12px',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px',
            transition: 'transform 0.2s, border-color 0.2s'
        }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}50`; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1E293B'; e.currentTarget.style.transform = 'none' }}
        >
            <div style={{ fontSize: '13px', color: '#64748B' }}>{icon} {label}</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color }}>{value}</div>
        </div>
    )
}

function SimpleBarChart({ data, label }) {
    const max = Math.max(...data.map(d => d.value), 1)
    return (
        <div style={{ background: '#111827', border: '1px solid #1E293B', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#CBD5E1', marginBottom: '16px' }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '120px' }}>
                {data.map((d, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <div style={{
                            width: '100%', background: `rgba(34, 197, 94, ${0.3 + (d.value / max) * 0.7})`,
                            borderRadius: '4px 4px 0 0',
                            height: `${Math.max(4, (d.value / max) * 100)}%`,
                            transition: 'height 0.3s ease'
                        }} title={`${d.label}: ${d.value}`} />
                        <span style={{ fontSize: '10px', color: '#475569' }}>{d.label}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function Admin() {
    const [users, setUsers] = useState([])
    const [userSearch, setUserSearch] = useState('')
    const [userPage, setUserPage] = useState(1)
    const [totalUsers, setTotalUsers] = useState(0)
    const [stats, setStats] = useState(null)
    const [revenue, setRevenue] = useState(null)
    const [analytics, setAnalytics] = useState(null)
    const [analyticsPeriod, setAnalyticsPeriod] = useState('week')
    const [loading, setLoading] = useState(true)
    const navigate = useNavigate()
    const user = getUser()

    const loadUsers = useCallback(async () => {
        const params = new URLSearchParams({ page: userPage, limit: 20 })
        if (userSearch) params.set('search', userSearch)
        const data = await apiFetch(`/admin/users?${params}`)
        if (data) {
            setUsers(data.users || [])
            setTotalUsers(data.total || 0)
        }
    }, [userPage, userSearch])

    const loadAnalytics = useCallback(async (period) => {
        const data = await apiFetch(`/admin/analytics?period=${period || analyticsPeriod}`)
        if (data) setAnalytics(data)
    }, [analyticsPeriod])

    useEffect(() => {
        Promise.all([
            apiFetch('/admin/stats'),
            apiFetch('/admin/revenue'),
            loadUsers(),
            loadAnalytics()
        ]).then(([statsData, revData]) => {
            if (statsData) setStats(statsData)
            if (revData) setRevenue(revData)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [loadUsers, loadAnalytics])

    const handleLogout = () => {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/auth')
    }

    // Generate last 7 days for chart
    const chartData = []
    for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toLocaleDateString('en-US', { weekday: 'short' })
        chartData.push({ label: key, value: stats?.dailyTranslations?.[i] || 0 })
    }

    return (
        <div className="dashboard">
            <header className="dash-header">
                <div className="dash-header-left">
                    <Link to="/" className="dash-logo">
                        <span className="dash-logo-icon">🌪️</span> Windy Word
                    </Link>
                    <span style={{ background: '#7F1D1D', color: '#FCA5A5', padding: '2px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 600 }}>
                        ADMIN
                    </span>
                </div>
                <div className="dash-header-right">
                    <Link to="/dashboard" className="dash-btn" style={{ textDecoration: 'none' }}>📊 Dashboard</Link>
                    <button className="dash-logout" onClick={handleLogout}>Sign Out</button>
                </div>
            </header>

            <main className="dash-main" style={{ maxWidth: '1100px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '24px 0 16px', color: '#E2E8F0' }}>
                    🛡️ Admin Panel
                </h2>

                {loading ? (
                    <div className="dash-loading">Loading admin data...</div>
                ) : (
                    <>
                        {/* Stats Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                            <StatCard icon="👥" label="Total Users" value={stats?.totalUsers || totalUsers} />
                            <StatCard icon="🌍" label="Translations" value={stats?.totalTranslations || 0} color="#3B82F6" />
                            <StatCard icon="🎙️" label="Recordings" value={stats?.totalRecordings || 0} color="#F59E0B" />
                            <StatCard icon="💰" label="Revenue" value={`$${((revenue?.total || 0) / 100).toFixed(0)}`} color="#8B5CF6" />
                            <StatCard icon="📈" label="MRR" value={`$${((revenue?.mrr || 0) / 100).toFixed(0)}`} color="#EC4899" />
                            <StatCard icon="🟢" label="Server" value={stats?.serverStatus || 'OK'} />
                        </div>

                        {/* Analytics Section */}
                        {analytics && (
                            <div style={{ background: '#111827', border: '1px solid #1E293B', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#CBD5E1' }}>Analytics</div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        {['day', 'week', 'month'].map(p => (
                                            <button key={p} onClick={() => { setAnalyticsPeriod(p); loadAnalytics(p) }}
                                                style={{
                                                    background: analyticsPeriod === p ? '#22C55E' : '#1E293B',
                                                    color: analyticsPeriod === p ? '#000' : '#94A3B8',
                                                    border: 'none', padding: '4px 12px', borderRadius: '6px',
                                                    fontSize: '12px', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize'
                                                }}>{p}</button>
                                        ))}
                                    </div>
                                </div>

                                {/* Key Metrics Cards */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                                    <StatCard icon="" label="Total Users" value={analytics.users?.total || 0} />
                                    <StatCard icon="" label="DAU" value={analytics.users?.dau || 0} color="#3B82F6" />
                                    <StatCard icon="" label="WAU" value={analytics.users?.wau || 0} color="#8B5CF6" />
                                    <StatCard icon="" label="MAU" value={analytics.users?.mau || 0} color="#EC4899" />
                                    <StatCard icon="" label="Recordings" value={analytics.events?.recording_created || 0} color="#F59E0B" />
                                    <StatCard icon="" label="Active Subs" value={Object.values(analytics.revenue?.active_subscriptions || {}).reduce((a, b) => a + b, 0)} color="#10B981" />
                                </div>

                                {/* Event Counts List */}
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#94A3B8', marginBottom: '8px' }}>
                                    Event Breakdown ({analytics.period})
                                </div>
                                {Object.keys(analytics.events || {}).length === 0 ? (
                                    <div style={{ color: '#475569', fontSize: '13px', padding: '8px 0' }}>No events recorded yet</div>
                                ) : (
                                    Object.entries(analytics.events || {})
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([event, count]) => {
                                            const maxCount = Math.max(...Object.values(analytics.events || {}), 1)
                                            return (
                                                <div key={event} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                                    <span style={{ width: '180px', fontSize: '12px', color: '#94A3B8', fontFamily: 'monospace' }}>
                                                        {event}
                                                    </span>
                                                    <div style={{ flex: 1, height: '6px', background: '#1E293B', borderRadius: '3px', overflow: 'hidden' }}>
                                                        <div style={{
                                                            width: `${Math.max((count / maxCount) * 100, 2)}%`,
                                                            height: '100%', background: '#22C55E', borderRadius: '3px',
                                                            transition: 'width 0.3s'
                                                        }} />
                                                    </div>
                                                    <span style={{ fontSize: '12px', color: '#E2E8F0', fontWeight: 600, minWidth: '40px', textAlign: 'right' }}>
                                                        {count}
                                                    </span>
                                                </div>
                                            )
                                        })
                                )}
                            </div>
                        )}

                        {/* Charts Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                            <SimpleBarChart data={chartData} label="📊 Translation Volume (7 days)" />
                            <div style={{ background: '#111827', border: '1px solid #1E293B', borderRadius: '12px', padding: '20px' }}>
                                <div style={{ fontSize: '14px', fontWeight: 600, color: '#CBD5E1', marginBottom: '16px' }}>💳 Plan Breakdown</div>
                                {['free', 'pro', 'translate', 'translate_pro'].map(tier => {
                                    const count = revenue?.planCounts?.[tier] || 0
                                    const pct = totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0
                                    const colors = { free: '#64748B', pro: '#22C55E', translate: '#3B82F6', translate_pro: '#8B5CF6' }
                                    return (
                                        <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                            <span style={{ width: '100px', fontSize: '12px', color: '#94A3B8', textTransform: 'capitalize' }}>
                                                {tier.replace('_', ' ')}
                                            </span>
                                            <div style={{ flex: 1, height: '8px', background: '#1E293B', borderRadius: '4px', overflow: 'hidden' }}>
                                                <div style={{ width: `${Math.max(pct, 2)}%`, height: '100%', background: colors[tier], borderRadius: '4px', transition: 'width 0.5s' }} />
                                            </div>
                                            <span style={{ fontSize: '12px', color: '#64748B', minWidth: '50px' }}>{count} ({pct}%)</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* System Health */}
                        <div style={{ background: '#111827', border: '1px solid #1E293B', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#CBD5E1', marginBottom: '12px' }}>🖥️ System Health</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                {[
                                    { label: 'Uptime', value: stats?.uptime || '—' },
                                    { label: 'DB Size', value: stats?.dbSize || '—' },
                                    { label: 'Memory', value: stats?.memoryUsage || '—' },
                                    { label: 'API Latency', value: stats?.apiLatency || '—' },
                                ].map((item, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1E293B' }}>
                                        <span style={{ color: '#64748B', fontSize: '13px' }}>{item.label}</span>
                                        <span style={{ color: '#E2E8F0', fontSize: '13px', fontWeight: 500 }}>{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* User Management */}
                        <div style={{ background: '#111827', border: '1px solid #1E293B', borderRadius: '12px', padding: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <div style={{ fontSize: '14px', fontWeight: 600, color: '#CBD5E1' }}>👥 User Management ({totalUsers})</div>
                                <form onSubmit={e => { e.preventDefault(); setUserPage(1); loadUsers() }} style={{ display: 'flex', gap: '6px' }}>
                                    <input type="text" placeholder="Search users..." value={userSearch}
                                        onChange={e => setUserSearch(e.target.value)}
                                        style={{ background: '#0B0F1A', border: '1px solid #334155', color: '#E2E8F0', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', outline: 'none' }}
                                    />
                                    <button type="submit" style={{ background: '#22C55E', color: '#000', border: 'none', padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                                        Search
                                    </button>
                                </form>
                            </div>

                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #1E293B' }}>
                                            <th style={{ padding: '8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Name</th>
                                            <th style={{ padding: '8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Email</th>
                                            <th style={{ padding: '8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Plan</th>
                                            <th style={{ padding: '8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Joined</th>
                                            <th style={{ padding: '8px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Recordings</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.length === 0 ? (
                                            <tr><td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#475569' }}>No users found</td></tr>
                                        ) : users.map(u => (
                                            <tr key={u.id} style={{ borderBottom: '1px solid #1E293B' }}>
                                                <td style={{ padding: '8px', color: '#E2E8F0' }}>{u.name || '—'}</td>
                                                <td style={{ padding: '8px', color: '#94A3B8' }}>{u.email}</td>
                                                <td style={{ padding: '8px' }}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                                                        background: u.tier === 'free' ? '#1E293B' : 'rgba(34,197,94,0.15)',
                                                        color: u.tier === 'free' ? '#64748B' : '#22C55E'
                                                    }}>{u.tier || 'free'}</span>
                                                </td>
                                                <td style={{ padding: '8px', color: '#475569' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                                <td style={{ padding: '8px', color: '#94A3B8' }}>{u.recording_count || 0}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {totalUsers > 20 && (
                                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '12px' }}>
                                    <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} className="dash-page-btn">← Prev</button>
                                    <span style={{ color: '#64748B', fontSize: '13px', lineHeight: '30px' }}>Page {userPage}</span>
                                    <button onClick={() => setUserPage(p => p + 1)} className="dash-page-btn">Next →</button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    )
}
