export default function MailPanel({ apiFetch }) {
    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-emoji">{'\ud83d\udce7'}</span>
                <div>
                    <h1 className="panel-title">Windy Mail</h1>
                    <p className="panel-subtitle">Agent-friendly email for humans and bots</p>
                </div>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Inbox</div>
                <p className="panel-empty">Your Windy Mail inbox will appear here when the mail service is online.</p>
            </div>

            <div className="panel-card">
                <div className="panel-card-title">Features</div>
                <ul style={{ color: '#94A3B8', fontSize: '14px', lineHeight: '2', paddingLeft: '20px' }}>
                    <li>Dedicated @windymail.ai address</li>
                    <li>Agent-readable inbox (Fly can check your mail)</li>
                    <li>Reputation scoring system</li>
                    <li>Per-tier rate limits</li>
                </ul>
            </div>

            <a href="https://windymail.ai" target="_blank" rel="noopener noreferrer" className="panel-btn" style={{ marginTop: '12px' }}>
                Open Windy Mail
            </a>
        </div>
    )
}
