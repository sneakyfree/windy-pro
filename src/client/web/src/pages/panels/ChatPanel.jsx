import { useState, useEffect } from 'react'

export default function ChatPanel({ apiFetch }) {
    const [chatProfile, setChatProfile] = useState(null)
    const [activating, setActivating] = useState(false)
    const [activateError, setActivateError] = useState(null)

    useEffect(() => {
        apiFetch('/identity/chat/profile').then(d => {
            if (d) setChatProfile(d)
        }).catch(() => {})
    }, [apiFetch])

    async function handleActivate() {
        setActivating(true)
        setActivateError(null)
        try {
            const d = await apiFetch('/identity/chat/provision', { method: 'POST', body: '{}' })
            if (d?._error) {
                setActivateError(
                    d._error === 'network'
                        ? "Can't reach the chat service. Check your connection and try again."
                        : 'Chat activation failed. Please try again in a moment.'
                )
                return
            }
            if (d?.success) {
                window.location.reload()
                return
            }
            setActivateError('Chat activation failed. Please try again in a moment.')
        } catch (err) {
            setActivateError(`Chat activation failed: ${err?.message || 'unknown error'}`)
        } finally {
            setActivating(false)
        }
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
                            onClick={handleActivate}
                            disabled={activating}
                            style={activating ? { opacity: 0.6, cursor: 'wait' } : undefined}
                        >
                            {activating ? 'Activating…' : 'Activate Chat'}
                        </button>
                        {activateError && (
                            <p
                                role="alert"
                                style={{
                                    color: '#EF4444',
                                    fontSize: '13px',
                                    marginTop: '10px',
                                    lineHeight: '1.5',
                                }}
                            >
                                {activateError}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Conversations</div>
                <p className="panel-empty">Chat messages will appear here when Windy Chat is online.</p>
            </div>

            <a href="https://app.windychat.ai" target="_blank" rel="noopener noreferrer" className="panel-btn" style={{ marginTop: '12px' }}>
                Open Windy Chat
            </a>
        </div>
    )
}
