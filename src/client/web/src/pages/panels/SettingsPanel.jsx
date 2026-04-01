import { useState, useEffect } from 'react'

export default function SettingsPanel({ apiFetch, user }) {
    const [ecosystem, setEcosystem] = useState(null)
    const [devices, setDevices] = useState([])
    const [pwForm, setPwForm] = useState({ current: '', new: '' })
    const [pwMsg, setPwMsg] = useState('')

    useEffect(() => {
        apiFetch('/identity/ecosystem-status').then(d => d && setEcosystem(d)).catch(() => {})
        apiFetch('/auth/devices').then(d => {
            if (Array.isArray(d)) setDevices(d)
            else if (d?.devices) setDevices(d.devices)
        }).catch(() => {})
    }, [apiFetch])

    async function handleChangePassword(e) {
        e.preventDefault()
        setPwMsg('')
        const data = await apiFetch('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.new }),
        })
        if (data?.success) {
            setPwMsg('Password changed successfully.')
            setPwForm({ current: '', new: '' })
        } else {
            setPwMsg(data?.error || 'Failed to change password.')
        }
    }

    const products = ecosystem?.products || {}

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\u2699\ufe0f'}</span>
                <div>
                    <h1 className="panel-title">Settings</h1>
                    <p className="panel-subtitle">Account, devices, billing, ecosystem</p>
                </div>
            </div>

            {/* Account info */}
            <div className="panel-card">
                <div className="panel-card-title">Account</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94A3B8' }}>Name</span>
                        <span style={{ color: '#E2E8F0' }}>{user?.name || 'Unknown'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94A3B8' }}>Email</span>
                        <span style={{ color: '#E2E8F0' }}>{ecosystem?.email || user?.email || ''}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#94A3B8' }}>Tier</span>
                        <span className="panel-badge badge-active">{ecosystem?.tier || 'free'}</span>
                    </div>
                </div>
            </div>

            {/* Ecosystem status */}
            <div className="panel-card">
                <div className="panel-card-title">Ecosystem Products</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Object.entries(products).map(([key, val]) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                            <span style={{ color: '#CBD5E1' }}>{key.replace('windy_', 'Windy ').replace(/^\w/, c => c.toUpperCase())}</span>
                            <span className={`panel-badge ${val.status === 'active' ? 'badge-active' : val.status === 'pending' ? 'badge-pending' : 'badge-offline'}`}>
                                {val.status}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Devices */}
            <div className="panel-card">
                <div className="panel-card-title">Devices ({devices.length})</div>
                {devices.length === 0 ? (
                    <p className="panel-empty">No devices registered.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {devices.map((d, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid rgba(51,65,85,0.2)' }}>
                                <span style={{ color: '#CBD5E1' }}>{d.name || d.id}</span>
                                <span style={{ color: '#64748B' }}>{d.platform || ''}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Change password */}
            <div className="panel-card">
                <div className="panel-card-title">Change Password</div>
                <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                        type="password" placeholder="Current password" value={pwForm.current}
                        onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                        className="chat-input" style={{ maxWidth: '300px' }}
                    />
                    <input
                        type="password" placeholder="New password" value={pwForm.new}
                        onChange={e => setPwForm(p => ({ ...p, new: e.target.value }))}
                        className="chat-input" style={{ maxWidth: '300px' }}
                    />
                    <button type="submit" className="panel-btn" style={{ alignSelf: 'flex-start' }}>Change Password</button>
                    {pwMsg && <p style={{ fontSize: '13px', color: pwMsg.includes('success') ? '#22C55E' : '#EF4444' }}>{pwMsg}</p>}
                </form>
            </div>

            {/* Billing */}
            <div className="panel-card">
                <div className="panel-card-title">Billing</div>
                <a href="/settings" className="panel-btn">Manage Subscription</a>
            </div>
        </div>
    )
}
