import { Link } from 'react-router-dom'
import './Legal.css'

export default function Privacy() {
    return (
        <div className="legal-page">
            <nav className="legal-nav">
                <Link to="/" className="legal-back">&larr; Windy Word</Link>
            </nav>
            <div className="legal-content">
                <h1>Privacy Policy</h1>
                <p className="legal-updated">Last updated: April 2026</p>

                <div style={{
                    background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)',
                    borderRadius: '10px', padding: '16px 20px', marginBottom: '32px'
                }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#22C55E', marginBottom: '8px', letterSpacing: '1px' }}>TABLE OF CONTENTS</div>
                    {['Overview', 'Data We Collect', 'How We Store Your Data', 'Third-Party Services', 'Your Rights (GDPR)', 'Data Retention', 'Cookies & Local Storage', 'Children\'s Privacy', 'Changes', 'Contact'].map((s, i) => (
                        <a key={i} href={`#${s.toLowerCase().replace(/[^a-z]/g, '-')}`} style={{
                            display: 'block', color: '#94A3B8', fontSize: '13px', textDecoration: 'none',
                            padding: '3px 0', transition: 'color 0.2s'
                        }}>{i + 1}. {s}</a>
                    ))}
                </div>

                <h2 id="overview">1. Overview</h2>
                <p>
                    Windy Word (<a href="https://windyword.ai" style={{ color: '#22C55E' }}>windyword.ai</a>) is committed to protecting your privacy. This policy explains what personal data we collect, how we use it, and your rights regarding that data. By using Windy Word, you consent to the practices described in this policy.
                </p>

                <h2 id="data-we-collect">2. Data We Collect</h2>
                <p>We collect the following categories of personal data:</p>
                <ul>
                    <li><strong>Account information:</strong> email address, full name, and hashed password when you create an account.</li>
                    <li><strong>Voice recordings:</strong> audio data captured during transcription sessions. Storage location (local device or Windy Cloud) is determined by your preference.</li>
                    <li><strong>Transcripts & translations:</strong> text output generated from your voice recordings and any translation history.</li>
                    <li><strong>Usage analytics:</strong> anonymised interaction data (features used, session duration) to improve the product. No advertising trackers are used.</li>
                    <li><strong>Payment information:</strong> billing details processed securely by Stripe. We do not store card numbers on our servers.</li>
                </ul>

<<<<<<< HEAD
                <h2 id="cloud-mode">Cloud Mode (Web App)</h2>
                <p>When you use WindyCloud, the following data is processed:</p>
=======
                <h2 id="how-we-store-your-data">3. How We Store Your Data</h2>
>>>>>>> 677e1414521bd8746ee9ef10412308bbf67fad52
                <ul>
                    <li><strong>Encryption at rest:</strong> all data stored on our servers (SQLite or PostgreSQL) is encrypted at rest.</li>
                    <li><strong>Encryption in transit:</strong> all network communication uses TLS/SSL.</li>
                    <li><strong>Passwords:</strong> hashed with bcrypt and never stored in plain text.</li>
                    <li><strong>Local mode:</strong> when using "Device Only" mode, your audio and transcriptions remain entirely on your machine in an encrypted local database. No data is sent to any server.</li>
                    <li><strong>Cloud mode:</strong> when using Windy Cloud, recordings and transcripts are stored on our infrastructure. You can choose between local-only and cloud storage at any time.</li>
                </ul>

                <h2 id="third-party-services">4. Third-Party Services</h2>
                <p>We integrate with the following third-party services:</p>
                <ul>
                    <li><strong>Stripe</strong> — payment processing. Stripe's privacy policy applies to payment data. See <a href="https://stripe.com/privacy" style={{ color: '#22C55E' }}>stripe.com/privacy</a>.</li>
                    <li><strong>OpenAI / Groq</strong> — cloud transcription engines (opt-in only). Audio is sent to these providers only when you explicitly select a cloud transcription engine. Audio is not retained by these providers after processing.</li>
                    <li><strong>Anthropic</strong> — AI agent capabilities via the Eternitas trust framework. Queries may be processed by Anthropic's API when using AI-powered features.</li>
                </ul>
                <p>We do not sell, share, or provide your data to any other third party. We do not use advertising trackers.</p>

                <h2 id="your-rights--gdpr-">5. Your Rights (GDPR)</h2>
                <p>If you are located in the European Economic Area, you have the following rights under the General Data Protection Regulation:</p>
                <ul>
                    <li><strong>Right of access:</strong> request a copy of your personal data via <code>GET /api/v1/auth/me</code> or through your account settings.</li>
                    <li><strong>Right to deletion:</strong> delete your account and all associated data via <code>DELETE /api/v1/auth/me</code>. This triggers a cascading deletion of all recordings, transcripts, translations, and account data.</li>
                    <li><strong>Right to data portability:</strong> export your recordings and transcripts via <code>POST /api/v1/recordings/export</code> or through the app's export feature.</li>
                    <li><strong>Right to rectification:</strong> update your account information at any time through your profile settings.</li>
                    <li><strong>Right to object:</strong> you may opt out of analytics collection at any time in your account settings.</li>
                </ul>
                <p>To exercise any of these rights, contact us at <a href="mailto:privacy@windyword.ai" style={{ color: '#22C55E' }}>privacy@windyword.ai</a>.</p>

                <h2 id="data-retention">6. Data Retention</h2>
                <ul>
                    <li><strong>Recordings & transcripts:</strong> retained until you delete them. You may delete individual recordings at any time.</li>
                    <li><strong>Account data:</strong> deleted within 30 days of account deletion. During this period, your account is deactivated and inaccessible.</li>
                    <li><strong>Payment records:</strong> retained as required by applicable tax and financial regulations.</li>
                </ul>

                <h2 id="cookies---local-storage">7. Cookies & Local Storage</h2>
                <p>
                    Windy Word does <strong>not</strong> use tracking cookies. Authentication is handled via a JSON Web Token (JWT) stored in your browser's <code>localStorage</code>. This token is used solely for session authentication and is never shared with third parties.
                </p>

                <h2 id="children-s-privacy">8. Children's Privacy</h2>
                <p>
                    Windy Word is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has provided us with personal data, please contact us at <a href="mailto:privacy@windyword.ai" style={{ color: '#22C55E' }}>privacy@windyword.ai</a> so we can remove it.
                </p>

                <h2 id="changes">9. Changes to This Policy</h2>
                <p>
                    We may update this privacy policy from time to time. Material changes will be communicated via email or an in-app notification. The "Last updated" date at the top of this page indicates when this policy was last revised.
                </p>

                <h2 id="contact">10. Contact</h2>
                <p>
                    If you have questions or concerns about this privacy policy, contact us at:<br />
                    <a href="mailto:privacy@windyword.ai" style={{ color: '#22C55E' }}>privacy@windyword.ai</a><br />
                    Windy Word &mdash; <a href="https://windyword.ai" style={{ color: '#22C55E' }}>windyword.ai</a>
                </p>
            </div>
            <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                style={{
                    position: 'fixed', bottom: '24px', right: '24px',
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: '#22C55E', border: 'none', color: '#000',
                    fontSize: '18px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
            >&uarr;</button>
        </div>
    )
}
