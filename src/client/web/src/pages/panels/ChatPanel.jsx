import { useState, useEffect } from 'react'

export default function ChatPanel({ apiFetch }) {
    const [chatProfile, setChatProfile] = useState(null)
    // Activate button used to fire-and-forget with no UI feedback \u2014 failed
    // POSTs silently no-op'd, leaving the user clicking a dead button. Now
    // tracks activating + error state so the button can show "Activating\u2026"
    // and surface a clear error on failure.
    const [activating, setActivating] = useState(false)
    const [activateError, setActivateError] = useState(null)

    useEffect(() => {
        apiFetch('/identity/chat/profile').then(d => {
            if (d) setChatProfile(d)
        }).catch(() => {})
    }, [apiFetch])

    async function activate() {
        if (activating) return
        setActivating(true)
        setActivateError(null)
        try {
            const d = await apiFetch('/identity/chat/provision', { method: 'POST', body: '{}' })
            if (d?.success) {
                window.location.reload()
                return
            }
            setActivateError(d?.error || 'Provisioning returned no success flag \u2014 server may have rejected the request silently.')
        } catch (e) {
            setActivateError(e?.message || 'Could not reach the provisioning endpoint. Is the backend running?')
        }
        setActivating(false)
    }

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\ud83d\udcac'}</span>
                <div>
                    <h1 className="panel-title">Windy Chat</h1>
                    <p className="panel-subtitle">Messaging, social feed, contacts</p>
                </div>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Chat Profile</div>
                {chatProfile?.provisioned ? (
                    <div>
                        <p style={{ color: '#CBD5E1', fontSize: '14px' }}>
                            Matrix ID: <code style={{ color: '#a3e635' }}>{chatProfile.profile?.matrix_user_id}</code>
                        </p>
                        <span className="panel-badge badge-active">Active</span>
                    </div>
                ) : (
                    <div>
                        <p style={{ color: '#94A3B8', fontSize: '14px' }}>Chat account not yet provisioned.</p>
                        <button
                            className="panel-btn"
                            onClick={activate}
                            disabled={activating}
                        >{activating ? 'Activating\u2026' : 'Activate Chat'}</button>
                        {activateError && (
                            <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '10px' }}>
                                \u274c {activateError}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Conversations</div>
                <p className="panel-empty">Chat messages will appear here when Windy Chat is online.</p>
            </div>

            <a href="https://windychat.ai" target="_blank" rel="noopener noreferrer" className="panel-btn" style={{ marginTop: '12px' }}>
                Open Windy Chat
            </a>
        </div>
    )
}
