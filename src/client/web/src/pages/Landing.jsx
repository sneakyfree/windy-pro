import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import './Landing.css'

// Tasteful inline SVG US flag icon — small, polished, not emoji
const USFlag = ({ size = 16 }) => (
    <svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 24 17" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
        <rect width="24" height="17" rx="2" fill="#B22234" />
        <rect y="1.3" width="24" height="1.3" fill="white" />
        <rect y="3.9" width="24" height="1.3" fill="white" />
        <rect y="6.5" width="24" height="1.3" fill="white" />
        <rect y="9.1" width="24" height="1.3" fill="white" />
        <rect y="11.7" width="24" height="1.3" fill="white" />
        <rect y="14.3" width="24" height="1.3" fill="white" />
        <rect width="10" height="9.1" rx="1" fill="#3C3B6E" />
        {[...Array(5)].map((_, r) => [...Array(r % 2 === 0 ? 6 : 5)].map((_, c) => (
            <circle key={`${r}-${c}`} cx={r % 2 === 0 ? 0.8 + c * 1.7 : 1.6 + c * 1.7} cy={0.7 + r * 1.8} r="0.45" fill="white" />
        )))}
    </svg>
)

function isLoggedIn() {
    const token = localStorage.getItem('windy_token')
    if (!token) return false
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        return payload.exp && payload.exp > Date.now() / 1000
    } catch { return false }
}

export default function Landing() {
    const loggedIn = isLoggedIn()
    const [menuOpen, setMenuOpen] = useState(false)
    const [latestVersion, setLatestVersion] = useState('v0.6.0')
    const closeMenu = () => setMenuOpen(false)

    // Fetch latest version from cache-proof download API
    useEffect(() => {
        fetch('/download/version')
            .then(r => r.json())
            .then(data => { if (data.version) setLatestVersion(data.version) })
            .catch(() => { }) // Fallback to default version
    }, [])

    return (
        <div className="landing">
            {/* Navigation */}
            <nav className="nav">
                <div className="container nav-inner">
                    <div className="nav-logo">
                        <div className="logo-icon"></div>
                        <span className="logo-text">Windy Pro</span>
                    </div>
                    <button
                        className={`nav-hamburger ${menuOpen ? 'open' : ''}`}
                        onClick={() => setMenuOpen(!menuOpen)}
                        aria-label="Toggle menu"
                        aria-expanded={menuOpen}
                    >
                        <span></span><span></span><span></span>
                    </button>
                    <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
                        <a href="#features" onClick={closeMenu}>Features</a>
                        <a href="#pricing" onClick={closeMenu}>Pricing</a>
                        <a href="#download" onClick={closeMenu}>Download</a>
                        {loggedIn ? (
                            <Link to="/dashboard" className="btn btn-primary nav-cta" onClick={closeMenu}>Dashboard</Link>
                        ) : (
                            <>
                                <Link to="/auth" className="nav-signin" onClick={closeMenu}>Sign In</Link>
                                <Link to="/auth" className="btn btn-primary nav-cta" onClick={closeMenu}>Get Started</Link>
                            </>
                        )}
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
                    <div className="hero-trust-badge">
                        <USFlag size={14} />
                        <span>Built in the USA · Privacy-First</span>
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
                        <div className="feature-card feature-card--trust">
                            <div className="feature-icon"><USFlag size={24} /></div>
                            <h3>US-Based & Privacy-First</h3>
                            <p>Built in New York, hosted on US infrastructure, subject to US privacy law. Your recordings are processed locally on your device and never sent to external servers.</p>
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

            {/* Feature Comparison Table */}
            <section className="comparison" id="comparison">
                <div className="container">
                    <h2 className="section-title">Feature Comparison</h2>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="comparison-table">
                            <thead>
                                <tr>
                                    <th>Feature</th>
                                    <th>Free</th>
                                    <th>Pro</th>
                                    <th className="highlight-col">Translate</th>
                                    <th>Translate Pro</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    ['Languages', '1', '99', '99', '99'],
                                    ['Engines', '3', '15', '15', '15'],
                                    ['Max Recording', '5 min', '30 min', '30 min', '30 min'],
                                    ['Batch Mode', '✕', '✓', '✓', '✓'],
                                    ['LLM Polish', '✕', '✓', '✓', '✓'],
                                    ['Cloud Sync', '✕', '✕', '✓', '✓'],
                                    ['Translation', '✕', '✕', '✓', '✓'],
                                    ['Conversation Mode', '✕', '✕', '✓', '✓'],
                                    ['Text-to-Speech', '✕', '✕', '✕', '✓'],
                                    ['Medical Glossaries', '✕', '✕', '✕', '✓'],
                                    ['Voice Clone Export', '✕', '✕', '✕', '✓'],
                                    ['Priority Support', '✕', '✕', '✕', '✓'],
                                ].map(([feature, ...vals], i) => (
                                    <tr key={i}>
                                        <td>{feature}</td>
                                        {vals.map((v, j) => (
                                            <td key={j} className={j === 2 ? 'highlight-col' : ''}>
                                                <span className={v === '✓' ? 'check' : v === '✕' ? 'cross' : ''}>{v}</span>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* Testimonials */}
            <section className="testimonials">
                <div className="container">
                    <h2 className="section-title">What Users Say</h2>
                    <div className="testimonial-grid">
                        {[
                            { name: 'James M.', role: 'Podcast Creator', text: 'Windy Pro replaced three different tools for me. The local transcription is incredibly fast and I never worry about my content leaking.', avatar: '🎙️' },
                            { name: 'Dr. Sarah K.', role: 'Medical Researcher', text: 'The medical glossary support in Translate Pro is a game-changer. Accurate transcription of clinical terms that other tools butcher.', avatar: '🩺' },
                            { name: 'Carlos R.', role: 'Freelance Translator', text: 'Conversation mode lets me conduct bilingual interviews effortlessly. The real-time translation is surprisingly accurate.', avatar: '🌍' },
                            { name: 'Priya D.', role: 'Software Engineer', text: 'I use the cursor injection feature daily for voice-coding comments and documentation. Saves me hours every week.', avatar: '💻' }
                        ].map((t, i) => (
                            <div key={i} className="testimonial-card">
                                <div className="testimonial-text">"{t.text}"</div>
                                <div className="testimonial-author">
                                    <span className="testimonial-avatar">{t.avatar}</span>
                                    <div>
                                        <div className="testimonial-name">{t.name}</div>
                                        <div className="testimonial-role">{t.role}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Banner */}
            <section className="cta-banner">
                <div className="container" style={{ textAlign: 'center' }}>
                    <h2 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '12px', color: '#F8FAFC' }}>
                        Ready to transform your voice into text?
                    </h2>
                    <p style={{ fontSize: '18px', color: '#94A3B8', maxWidth: '500px', margin: '0 auto 24px' }}>
                        Free forever. No credit card required. Download now and start recording in 60 seconds.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <a href="#download" className="btn btn-primary btn-large">⬇ Download Free</a>
                        <Link to="/auth" className="btn btn-secondary btn-large">Create Account →</Link>
                    </div>
                </div>
            </section>

            {/* Download — Cache-proof: all links use /download/latest/:platform redirect */}
            <section className="download" id="download">
                <div className="container download-inner">
                    <h2 className="section-title">Download Windy Pro</h2>
                    <p className="section-subtitle">
                        {latestVersion ? `${latestVersion}` : 'Loading...'} · Available for all major platforms.
                    </p>
                    <div className="download-grid">
                        <a href="/download/latest/macos" className="download-card">
                            <div className="download-icon">🍎</div>
                            <div className="download-platform">macOS</div>
                            <div className="download-detail">Intel Mac (.dmg)</div>
                        </a>
                        <a href="/download/latest/windows" className="download-card">
                            <div className="download-icon">🪟</div>
                            <div className="download-platform">Windows</div>
                            <div className="download-detail">Windows 10+</div>
                        </a>
                        <a href="/download/latest/linux-appimage" className="download-card">
                            <div className="download-icon">🐧</div>
                            <div className="download-platform">Linux AppImage</div>
                            <div className="download-detail">Universal — just run it</div>
                        </a>
                        <a href="/download/latest/linux-deb" className="download-card">
                            <div className="download-icon">🐧</div>
                            <div className="download-platform">Linux .deb</div>
                            <div className="download-detail">Ubuntu / Debian</div>
                        </a>
                    </div>
                    <div className="download-oneliner">
                        <p className="download-helper">
                            <strong>🐧 Linux one-liner install:</strong>
                        </p>
                        <code className="download-command">
                            curl -fsSL https://windypro.thewindstorm.uk/download/latest/linux-install.sh | bash
                        </code>
                        <p className="download-helper-sub">
                            Or download the .deb, then: <code>sudo dpkg -i windy-pro_*.deb</code>
                        </p>
                    </div>
                    <div className="download-trust">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, opacity: 0.7 }}>
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                        <USFlag size={12} />
                        <span>Secure download from US-hosted servers</span>
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
                    <div className="footer-location">
                        <USFlag size={12} />
                        <span>Built and hosted in the United States · New York, NY</span>
                    </div>
                </div>
            </footer>
        </div>
    )
}
