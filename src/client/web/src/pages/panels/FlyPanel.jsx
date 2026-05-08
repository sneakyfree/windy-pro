import { useState, useEffect, useRef } from 'react'

export default function FlyPanel({ apiFetch, user }) {
    const [messages, setMessages] = useState([
        { role: 'agent', text: "Hi! I'm your Windy Fly agent. I was just born and I'm ready to help. What would you like to do?" }
    ])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [agentStatus, setAgentStatus] = useState(null)
    // null while loading, true if /api/health on the gateway is reachable, false otherwise.
    // Distinct from agentStatus.status === 'active', which only confirms the user has
    // a hatched windy_fly product record — it does NOT confirm a runtime is connected.
    const [runtimeOnline, setRuntimeOnline] = useState(null)
    const messagesEnd = useRef(null)

    useEffect(() => {
        apiFetch('/identity/ecosystem-status').then(data => {
            if (data?.products?.windy_fly) setAgentStatus(data.products.windy_fly)
        }).catch(() => {})
        apiFetch('/fly/runtime-status').then(data => {
            setRuntimeOnline(!!data?.runtime_online)
        }).catch(() => setRuntimeOnline(false))
    }, [apiFetch])

    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    async function sendMessage(e) {
        e.preventDefault()
        if (!input.trim() || sending) return
        const text = input.trim()
        setInput('')
        setMessages(prev => [...prev, { role: 'user', text }])
        setSending(true)
        try {
            const data = await apiFetch('/fly/chat', {
                method: 'POST',
                body: JSON.stringify({ message: text }),
            })
            setMessages(prev => [...prev, { role: 'agent', text: data?.response || 'No response' }])
        } catch {
            setMessages(prev => [...prev, { role: 'agent', text: 'Could not reach agent. Is it running?' }])
        }
        setSending(false)
    }

    const quickCommands = ['/status', '/doctor', '/budget', '/help']

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\ud83e\udeb0'}</span>
                <div>
                    <h1 className="panel-title">Windy Fly</h1>
                    <p className="panel-subtitle">Your AI agent — talk, command, monitor</p>
                </div>
            </div>

            {/* Agent status card — 3-state honest UI.
                Provisioned-but-runtime-offline used to show 'Online' (a lie); now shows
                'Hatched — runtime offline' so the user knows where the gap is.        */}
            {(() => {
                const provisioned = agentStatus?.status === 'active'
                let valueLabel, badgeLabel, badgeClass, helperText
                if (!provisioned) {
                    valueLabel = 'Not hatched'
                    badgeLabel = agentStatus?.status || 'not provisioned'
                    badgeClass = 'badge-offline'
                    helperText = "You haven't hatched an agent yet. Visit /app/fly to start the ceremony."
                } else if (runtimeOnline === true) {
                    valueLabel = 'Online'
                    badgeLabel = 'active'
                    badgeClass = 'badge-active'
                    helperText = 'Agent is running and accepting messages.'
                } else if (runtimeOnline === false) {
                    valueLabel = 'Hatched — runtime offline'
                    badgeLabel = 'runtime offline'
                    badgeClass = 'badge-offline'
                    helperText = "Your agent is hatched but no runtime is connected. Install Windy Pro on your computer and sign in, or run `pip install windyfly && windy go` on a machine you own to bring the runtime online."
                } else {
                    // runtimeOnline still loading
                    valueLabel = 'Checking…'
                    badgeLabel = 'probing runtime'
                    badgeClass = 'badge-offline'
                    helperText = 'Checking if your agent runtime is reachable…'
                }
                return (
                    <div className="panel-card">
                        <div className="panel-card-title">Agent Status</div>
                        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                            <div className="panel-stat">
                                <span className="panel-stat-value">{valueLabel}</span>
                            </div>
                            <span className={`panel-badge ${badgeClass}`}>{badgeLabel}</span>
                        </div>
                        <p style={{ fontSize: '13px', color: '#64748B', marginTop: '8px' }}>{helperText}</p>
                    </div>
                )
            })()}

            {/* Quick commands */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {quickCommands.map(cmd => (
                    <button
                        key={cmd}
                        className="panel-btn panel-btn-secondary"
                        onClick={() => { setInput(cmd) }}
                        style={{ fontSize: '12px', padding: '5px 12px' }}
                    >{cmd}</button>
                ))}
            </div>

            {/* Chat box */}
            <div className="chat-box">
                <div className="chat-messages">
                    {messages.map((msg, i) => (
                        <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                            {msg.text}
                        </div>
                    ))}
                    <div ref={messagesEnd} />
                </div>
                <form className="chat-input-row" onSubmit={sendMessage}>
                    <input
                        className="chat-input"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Message your agent..."
                        disabled={sending}
                    />
                    <button type="submit" className="chat-send" disabled={sending || !input.trim()}>
                        {sending ? '...' : 'Send'}
                    </button>
                </form>
            </div>
        </div>
    )
}
