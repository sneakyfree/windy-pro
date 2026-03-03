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
    if (res.status === 401) {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        window.location.href = '/auth'
        return null
    }
    return res.json()
}

const PLANS = {
    free: { name: 'Free', color: '#64748B', icon: '🌪️' },
    pro: { name: 'Pro', color: '#22C55E', icon: '⚡' },
    translate: { name: 'Translate', color: '#3B82F6', icon: '🌍' },
    translate_pro: { name: 'Translate Pro', color: '#8B5CF6', icon: '👑' },
}

export default function Settings() {
    const [billing, setBilling] = useState(null)
    const [loading, setLoading] = useState(true)
    const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' })
    const [passwordMsg, setPasswordMsg] = useState('')
    const navigate = useNavigate()
    const user = getUser()

    useEffect(() => {
        apiFetch('/auth/billing').then(data => {
            if (data) setBilling(data)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [])

    const handlePasswordChange = async (e) => {
        e.preventDefault()
        if (passwordForm.newPass !== passwordForm.confirm) {
            setPasswordMsg('Passwords do not match')
            return
        }
        try {
            const res = await apiFetch('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    currentPassword: passwordForm.current,
                    newPassword: passwordForm.newPass
                })
            })
            setPasswordMsg(res?.success ? '✓ Password updated' : res?.error || 'Failed')
            if (res?.success) setPasswordForm({ current: '', newPass: '', confirm: '' })
        } catch { setPasswordMsg('Failed to change password') }
    }

    const handlePortal = async () => {
        try {
            const data = await apiFetch('/auth/create-portal-session', { method: 'POST' })
            if (data?.url) window.location.href = data.url
            else alert('Billing portal not available')
        } catch { alert('Could not open billing portal') }
    }

    const handleLogout = () => {
        apiFetch('/auth/logout', { method: 'POST' }).catch(() => { })
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/auth')
    }

    const plan = PLANS[billing?.tier] || PLANS.free

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
                    <button className="dash-logout" onClick={handleLogout}>Sign Out</button>
                </div>
            </header>

            <main className="dash-main" style={{ maxWidth: '700px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '24px 0 16px', color: '#E2E8F0' }}>
                    ⚙️ Account Settings
                </h2>

                {/* Current Plan */}
                <div className="settings-card">
                    <h3 className="settings-card-title">Current Plan</h3>
                    {loading ? (
                        <div style={{ color: '#64748B' }}>Loading...</div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                            <div className="plan-badge" style={{
                                background: `${plan.color}20`,
                                color: plan.color,
                                border: `1px solid ${plan.color}40`
                            }}>
                                {plan.icon} {plan.name}
                            </div>
                            <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                                {billing?.email || user?.email || 'No email on file'}
                            </div>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
                        {billing?.tier === 'free' && (
                            <Link to="/#pricing" className="settings-upgrade-btn">⚡ Upgrade to Pro — $49</Link>
                        )}
                        {billing?.tier === 'pro' && (
                            <Link to="/#pricing" className="settings-upgrade-btn" style={{ borderColor: '#3B82F6', color: '#3B82F6' }}>
                                🌍 Upgrade to Translate — $79
                            </Link>
                        )}
                        <button className="dash-btn" onClick={handlePortal}>💳 Manage Billing</button>
                    </div>
                </div>

                {/* Account Info */}
                <div className="settings-card">
                    <h3 className="settings-card-title">Account</h3>
                    <div className="settings-row">
                        <span className="settings-label">Name</span>
                        <span className="settings-value">{user?.name || '—'}</span>
                    </div>
                    <div className="settings-row">
                        <span className="settings-label">Email</span>
                        <span className="settings-value">{user?.email || billing?.email || '—'}</span>
                    </div>
                    <div className="settings-row">
                        <span className="settings-label">Member since</span>
                        <span className="settings-value">
                            {billing?.createdAt ? new Date(billing.createdAt).toLocaleDateString() : '—'}
                        </span>
                    </div>
                </div>

                {/* Change Password */}
                <div className="settings-card">
                    <h3 className="settings-card-title">Change Password</h3>
                    <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <input type="password" placeholder="Current password" className="settings-input"
                            value={passwordForm.current}
                            onChange={e => setPasswordForm(p => ({ ...p, current: e.target.value }))} />
                        <input type="password" placeholder="New password" className="settings-input"
                            value={passwordForm.newPass}
                            onChange={e => setPasswordForm(p => ({ ...p, newPass: e.target.value }))} />
                        <input type="password" placeholder="Confirm new password" className="settings-input"
                            value={passwordForm.confirm}
                            onChange={e => setPasswordForm(p => ({ ...p, confirm: e.target.value }))} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <button type="submit" className="settings-upgrade-btn">Update Password</button>
                            {passwordMsg && <span style={{ fontSize: '13px', color: passwordMsg.startsWith('✓') ? '#22C55E' : '#EF4444' }}>{passwordMsg}</span>}
                        </div>
                    </form>
                </div>

                {/* Billing History */}
                <div className="settings-card">
                    <h3 className="settings-card-title">Billing History</h3>
                    {billing?.payments?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {billing.payments.map((p, i) => (
                                <div key={i} className="settings-row">
                                    <span className="settings-label">{new Date(p.date).toLocaleDateString()}</span>
                                    <span className="settings-value">{p.description} — ${(p.amount / 100).toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ color: '#475569', fontSize: '14px' }}>
                            No billing history yet. <button className="dash-btn" onClick={handlePortal} style={{ marginLeft: '8px' }}>Open Stripe Portal</button>
                        </div>
                    )}
                </div>
            </main>

            <style>{`
                .settings-card {
                    background: #111827;
                    border: 1px solid #1E293B;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 16px;
                }
                .settings-card-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #CBD5E1;
                    margin-bottom: 12px;
                }
                .settings-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 0;
                    border-bottom: 1px solid #1E293B;
                }
                .settings-row:last-child { border-bottom: none; }
                .settings-label { color: #64748B; font-size: 13px; }
                .settings-value { color: #E2E8F0; font-size: 14px; font-weight: 500; }
                .settings-input {
                    background: #0B0F1A;
                    border: 1px solid #334155;
                    color: #E2E8F0;
                    padding: 10px 14px;
                    border-radius: 8px;
                    font-size: 14px;
                    outline: none;
                }
                .settings-input:focus { border-color: #22C55E; }
                .plan-badge {
                    padding: 8px 20px;
                    border-radius: 10px;
                    font-weight: 700;
                    font-size: 15px;
                }
                .settings-upgrade-btn {
                    background: transparent;
                    border: 1px solid #22C55E;
                    color: #22C55E;
                    padding: 8px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    text-decoration: none;
                    transition: all 0.2s;
                }
                .settings-upgrade-btn:hover {
                    background: rgba(34, 197, 94, 0.1);
                    transform: translateY(-1px);
                }
            `}</style>
        </div>
    )
}
