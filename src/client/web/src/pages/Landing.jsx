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
                    <div className="hero-badge">🌪️ v0.6.0 — Cloud Storage, Stripe Payments, Setup Wizard</div>
                    <h1 className="hero-title">
                        Voice to Text,<br />
                        <span className="hero-gradient">Unlimited.</span>
                    </h1>
                    <p className="hero-subtitle">
                        Windy Pro transforms your speech into text at the speed of thought.
                        No time limits, no data leaving your machine. Guided setup gets you recording in 60 seconds.
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

            {/* What's New in v0.6.0 */}
            <section className="whats-new">
                <div className="container">
                    <h2 className="section-title">What's New in v0.6.0</h2>
                    <div className="whats-new-grid">
                        <div className="whats-new-item">
                            <span className="whats-new-icon">☁️</span>
                            <div>
                                <strong>Windy Pro Cloud Storage</strong>
                                <p>Archive recordings to our distributed cloud — no third-party accounts needed.</p>
                            </div>
                        </div>
                        <div className="whats-new-item">
                            <span className="whats-new-icon">💳</span>
                            <div>
                                <strong>In-App Payments</strong>
                                <p>Upgrade to Pro or Translate directly from Settings via Stripe.</p>
                            </div>
                        </div>
                        <div className="whats-new-item">
                            <span className="whats-new-icon">🧙</span>
                            <div>
                                <strong>Setup Wizard</strong>
                                <p>6-step guided onboarding: mic test, engine selection, account creation.</p>
                            </div>
                        </div>
                        <div className="whats-new-item">
                            <span className="whats-new-icon">🎬</span>
                            <div>
                                <strong>Video Recording & Media Badges</strong>
                                <p>Record webcam alongside voice. History shows 📝🎤🎬 badges per entry.</p>
                            </div>
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
                            <div className="feature-icon">☁️</div>
                            <h3>Windy Pro Cloud</h3>
                            <p>Archive recordings to Windy Pro's distributed cloud. Sync across devices, access from anywhere.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">🌪️</div>
                            <h3>Tornado Widget</h3>
                            <p>Draggable floating indicator that pulses green with your voice. Minimize to a tiny tornado — your desktop stays clean.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">📜</div>
                            <h3>History & Media Badges</h3>
                            <p>Every transcript searchable and organized by date. See 📝🎤🎬 badges showing what media each recording includes.</p>
                        </div>
                        <div className="feature-card">
                            <div className="feature-icon">🧙</div>
                            <h3>Easy Setup</h3>
                            <p>Guided 6-step wizard detects your hardware, tests your mic, picks the right engine. Recording in 60 seconds.</p>
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
                            <p>Guided wizard detects your hardware, picks the right model, downloads everything.</p>
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
                    <p className="section-subtitle">Start free. Upgrade when you're ready.</p>
                    <div className="pricing-grid pricing-grid-4">
                        <div className="pricing-card">
                            <div className="pricing-badge">FREE</div>
                            <div className="pricing-price">$0</div>
                            <div className="pricing-period">forever</div>
                            <ul className="pricing-features">
                                <li>✓ 1 language</li>
                                <li>✓ 3 transcription engines</li>
                                <li>✓ 5-minute recordings</li>
                                <li>✓ Local transcription</li>
                                <li>✓ Tornado widget</li>
                                <li>✓ 100% offline & private</li>
                            </ul>
                            <a href="#download" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>Download</a>
                        </div>
                        <div className="pricing-card">
                            <div className="pricing-badge pro">PRO</div>
                            <div className="pricing-price">$49</div>
                            <div className="pricing-period">one-time</div>
                            <ul className="pricing-features">
                                <li>✓ All 15 engines</li>
                                <li>✓ 99 languages</li>
                                <li>✓ 30-min recordings</li>
                                <li>✓ Batch mode</li>
                                <li>✓ LLM polish</li>
                                <li>✓ Audio archive</li>
                            </ul>
                            <Link to="/auth" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Upgrade →</Link>
                        </div>
                        <div className="pricing-card pricing-card-pro">
                            <div className="pricing-badge pro">TRANSLATE</div>
                            <div className="pricing-price">$79<span> or $7.99/mo</span></div>
                            <div className="pricing-period">one-time or monthly</div>
                            <ul className="pricing-features">
                                <li>✓ Everything in Pro</li>
                                <li>✓ Real-time translation</li>
                                <li>✓ Conversation mode</li>
                                <li>✓ 99 language pairs</li>
                                <li>✓ Cloud sync</li>
                            </ul>
                            <Link to="/auth" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Upgrade →</Link>
                        </div>
                        <div className="pricing-card">
                            <div className="pricing-badge pro">TRANSLATE PRO</div>
                            <div className="pricing-price">$149</div>
                            <div className="pricing-period">one-time</div>
                            <ul className="pricing-features">
                                <li>✓ Everything in Translate</li>
                                <li>✓ Text-to-speech</li>
                                <li>✓ Medical/legal glossaries</li>
                                <li>✓ Priority support</li>
                                <li>✓ Voice clone-ready exports</li>
                            </ul>
                            <Link to="/auth" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Upgrade →</Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Download */}
            <section className="download" id="download">
                <div className="container download-inner">
                    <h2 className="section-title">Download Windy Pro</h2>
                    <p className="section-subtitle">v0.6.0 · Available for all major platforms.</p>
                    <div className="download-grid">
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.6.0/Windy-Pro-0.6.0.dmg" className="download-card">
                            <div className="download-icon">🍎</div>
                            <div className="download-platform">macOS</div>
                            <div className="download-detail">Intel Mac (.dmg)</div>
                        </a>
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.6.0/Windy-Pro-Setup-0.6.0.exe" className="download-card">
                            <div className="download-icon">🪟</div>
                            <div className="download-platform">Windows</div>
                            <div className="download-detail">Windows 10+</div>
                        </a>
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.6.0/Windy-Pro-0.6.0.AppImage" className="download-card">
                            <div className="download-icon">🐧</div>
                            <div className="download-platform">Linux AppImage</div>
                            <div className="download-detail">Universal — just run it</div>
                        </a>
                        <a href="https://github.com/sneakyfree/windy-pro/releases/download/v0.6.0/windy-pro_0.6.0_amd64.deb" className="download-card">
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
