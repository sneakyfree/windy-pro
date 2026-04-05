import { useState, useEffect } from 'react'

export default function ChatPanel({ apiFetch }) {
    const [chatProfile, setChatProfile] = useState(null)

    useEffect(() => {
        apiFetch('/identity/chat/profile').then(d => {
            if (d) setChatProfile(d)
        }).catch(() => {})
    }, [apiFetch])

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
                            onClick={() => {
                                apiFetch('/identity/chat/provision', { method: 'POST', body: '{}' })
                                    .then(d => { if (d?.success) window.location.reload() })
                            }}
                        >Activate Chat</button>
                    </div>
                )}
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Conversations</div>
                <p className="panel-empty">Chat messages will appear here when Windy Chat is online.</p>
            </div>

            <a href="https://windychat.com" target="_blank" rel="noopener noreferrer" className="panel-btn" style={{ marginTop: '12px' }}>
                Open Windy Chat
            </a>
        </div>
    )
}
