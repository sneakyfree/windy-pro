import { Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
    return (
        <div className="landing">
            {/* Navigation */}
            <nav className="nav">
                <div className="container nav-inner">
                    <div className="nav-logo">
                        <div className="logo-icon"></div>
                        <span className="logo-text">Windy Pro</span>
                    </div>
                    <div className="nav-links">
                        <a href="#features">Features</a>
                        <a href="#pricing">Pricing</a>
                        <a href="#download">Download</a>
                        <Link to="/auth" className="btn btn-primary nav-cta">Get Started</Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <header className="hero">
                <div className="container hero-inner">
                    <div className="hero-badge">🌪️ v0.4.0 — Tornado Widget, Audio Archive, Batch Mode</div>
                    <h1 className="hero-title">
                        Voice to Text,<br />
                        <span className="hero-gradient">Unlimited.</span>
                    </h1>
                    <p className="hero-subtitle">
                        Windy Pro transforms your speech into text at the speed of thought.
                        No time limits, no subscriptions, no data leaving your machine.
                    </p>
                    <div className="hero-actions">
                        <a href="#download" className="btn btn-primary btn-large">
                            ⬇ Download Free
                        </a>
                        <Link to="/transcribe" className="btn btn-secondary btn-large">
                            ☁ Try Cloud Version
                        </Link>
                    </div>
                    <div className="hero-stats">
                        <div className="stat">
                            <div className="stat-value">∞</div>
                            <div className="stat-label">Recording Time</div>
                        </div>
                        <div className="stat">
                            <div className="stat-value">&lt;500ms</div>
                            <div className="stat-label">Latency</div>
                        </div>
                        <div className="stat">
                            <div className="stat-value">100%</div>
                            <div className="stat-label">Private</div>
                        </div>
                    </div>
                </div>
                <div className="hero-glow"></div>
            </header>

            {/* Green Strobe Demo */}
            <section className="strobe-section">
                <div className="container">
                    <div className="strobe-demo">
                        <div className="strobe-ring">
                            <div className="strobe-core"></div>
                        </div>
                        <div className="strobe-text">
                            <h3>The Green Strobe Never Lies</h3>
                            <p>When it pulses, audio is being captured. When it stops, it stops. No hidden recording. No trust issues.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="features" id="features">
                <div className="container">
                    <h2 className="section-title">Everything Your Voice Needs</h2>
                    <p className="section-subtitle">Built for speed, privacy, and power users.</p>
                    <div className="feature-grid">
                        <div className="feature-card">
                            <div className="feature-icon">🎙️</div>
                            <h3>Unlimited Recording</h3>
                            <p>No 5-minute caps. Record meetings, lectures, podcasts — for as long as you want.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">🔒</div>
                            <h3>100% Local</h3>
                            <p>Whisper runs on YOUR hardware. Audio never leaves your machine. Zero cloud dependency.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">⚡</div>
                            <h3>Sub-Second Latency</h3>
                            <p>GPU-accelerated transcription with real-time streaming. See words appear as you speak.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">📋</div>
                            <h3>Cursor Injection</h3>
                            <p>Paste text directly into any app — Word, Slack, your terminal. No copy-paste needed.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">✨</div>
                            <h3>Batch Mode</h3>
                            <p>Record everything, process once. Like Wispr Flow — best quality transcription with zero interruptions.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">🌪️</div>
                            <h3>Tornado Widget</h3>
                            <p>Draggable floating indicator that pulses green with your voice. Minimize to a tiny tornado — your desktop stays clean.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">📜</div>
                            <h3>History & Search</h3>
                            <p>Every transcript searchable and organized by date. Export to .txt, .md, or .srt. Your entire voice archive at your fingertips.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">🎵</div>
                            <h3>Audio Archive</h3>
                            <p>Save recordings alongside transcripts. Build a voice library for avatar training, voice cloning, or personal AI development.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="how-it-works">
                <div className="container">
                    <h2 className="section-title">3 Steps. Zero Learning Curve.</h2>
                    <div className="steps">
                        <div className="step">
                            <div className="step-number">1</div>
                            <h3>Install</h3>
                            <p>TurboTax-style wizard detects your hardware, picks the right model, downloads everything.</p>
                        </div>
                        <div className="step-arrow">→</div>
                        <div className="step">
                            <div className="step-number">2</div>
                            <h3>Record</h3>
                            <p>Hit Ctrl+Shift+Space. The green strobe pulses. Start speaking.</p>
                        </div>
                        <div className="step-arrow">→</div>
                        <div className="step">
                            <div className="step-number">3</div>
                            <h3>Paste</h3>
                            <p>Text injects directly at your cursor. Or copy to clipboard. Or export from the Vault.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pricing */}
            <section className="pricing" id="pricing">
                <div className="container">
                    <h2 className="section-title">Simple Pricing</h2>
                    <p className="section-subtitle">Free forever for local use. Cloud for when you need it.</p>
                    <div className="pricing-grid">
                        <div className="pricing-card">
                            <div className="pricing-badge">LOCAL</div>
                            <div className="pricing-price">$0</div>
                            <div className="pricing-period">forever</div>
                            <ul className="pricing-features">
                                <li>✓ Unlimited recording time</li>
                                <li>✓ All Whisper models</li>
                                <li>✓ Auto-paste at cursor</li>
                                <li>✓ Tornado widget</li>
                                <li>✓ History & search</li>
                                <li>✓ Audio archive</li>
                                <li>✓ 100% offline & private</li>
                            </ul>
                            <a href="#download" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>Download</a>
                        </div>
                        <div className="pricing-card pricing-card-pro">
                            <div className="pricing-badge pro">CLOUD PRO</div>
                            <div className="pricing-price">$9<span>/mo</span></div>
                            <div className="pricing-period">cancel anytime</div>
                            <ul className="pricing-features">
                                <li>✓ Everything in Local</li>
                                <li>✓ Cloud transcription (large-v3)</li>
                                <li>✓ Mobile web access</li>
                                <li>✓ Sync across devices</li>
                                <li>✓ Voice clone-ready exports</li>
                                <li>✓ Priority support</li>
                            </ul>
                            <Link to="/auth" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Start Free Trial</Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Download */}
            <section className="download" id="download">
                <div className="container download-inner">
                    <h2 className="section-title">Download Windy Pro</h2>
                    <p className="section-subtitle">Available for all major platforms.</p>
                    <div className="download-grid">
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.4.0/Windy-Pro-0.4.0.dmg" className="download-card">
                            <div className="download-icon">🍎</div>
                            <div className="download-platform">macOS</div>
                            <div className="download-detail">Intel Mac (.dmg)</div>
                        </a>
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.4.0/Windy-Pro-Setup-0.4.0.exe" className="download-card">
                            <div className="download-icon">🪟</div>
                            <div className="download-platform">Windows</div>
                            <div className="download-detail">Windows 10+</div>
                        </a>
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.4.0/Windy-Pro-0.4.0.AppImage" className="download-card">
                            <div className="download-icon">🐧</div>
                            <div className="download-platform">Linux AppImage</div>
                            <div className="download-detail">Universal — just run it</div>
                        </a>
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.4.0/windy-pro_0.4.0_amd64.deb" className="download-card">
                            <div className="download-icon">🐧</div>
                            <div className="download-platform">Linux .deb</div>
                            <div className="download-detail">Ubuntu / Debian</div>
                        </a>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="footer">
                <div className="container footer-inner">
                    <div className="footer-brand">
                        <div className="logo-icon small"></div>
                        <span>Windy Pro</span>
                    </div>
                    <div className="footer-links">
                        <a href="https://github.com/sneakyfree/windy-pro" target="_blank" rel="noopener noreferrer">GitHub</a>
                        <a href="https://github.com/sneakyfree/windy-pro#readme" target="_blank" rel="noopener noreferrer">Docs</a>
                        <Link to="/privacy">Privacy</Link>
                        <Link to="/terms">Terms</Link>
                    </div>
                    <div className="footer-copy">© 2026 Windy Pro. The Green Strobe Never Lies.</div>
                </div>
            </footer>
        </div>
    )
}
