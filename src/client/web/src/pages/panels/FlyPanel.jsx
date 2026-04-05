import { useState, useEffect, useRef } from 'react'

export default function FlyPanel({ apiFetch, user }) {
    const [messages, setMessages] = useState([
        { role: 'agent', text: "Hi! I'm your Windy Fly agent. I was just born and I'm ready to help. What would you like to do?" }
    ])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [agentStatus, setAgentStatus] = useState(null)
    const messagesEnd = useRef(null)

    useEffect(() => {
        apiFetch('/identity/ecosystem-status').then(data => {
            if (data?.products?.windy_fly) setAgentStatus(data.products.windy_fly)
        }).catch(() => {})
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

            {/* Agent status card */}
            <div className="panel-card">
                <div className="panel-card-title">Agent Status</div>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{agentStatus?.status === 'active' ? 'Online' : 'Offline'}</span>
                    </div>
                    <span className={`panel-badge ${agentStatus?.status === 'active' ? 'badge-active' : 'badge-offline'}`}>
                        {agentStatus?.status || 'not provisioned'}
                    </span>
                </div>
                <p style={{ fontSize: '13px', color: '#64748B', marginTop: '8px' }}>
                    {agentStatus?.status === 'active'
                        ? 'Agent is running and accepting messages.'
                        : "Agent is offline. Start it with 'windy start' on your computer, or hatch a new one at windyfly.ai."}
                </p>
            </div>

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
