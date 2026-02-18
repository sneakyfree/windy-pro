import { Link } from 'react-router-dom'
import './Legal.css'

export default function Terms() {
    return (
        <div className="legal-page">
            <nav className="legal-nav">
                <Link to="/" className="legal-back">← Windy Pro</Link>
            </nav>
            <div className="legal-content">
                <h1>Terms of Service</h1>
                <p className="legal-updated">Last updated: February 2026</p>

                <h2>1. Acceptance</h2>
                <p>
                    By using Windy Pro ("the Service"), you agree to these Terms of Service.
                    If you do not agree, do not use the Service.
                </p>

                <h2>2. Description of Service</h2>
                <p>
                    Windy Pro provides voice-to-text transcription software available as a
                    desktop application (local mode) and a cloud-hosted web application (cloud mode).
                </p>

                <h2>3. User Accounts</h2>
                <ul>
                    <li>Cloud mode requires creating an account with a valid email and password.</li>
                    <li>You are responsible for maintaining the security of your account credentials.</li>
                    <li>You must be at least 13 years old to create an account.</li>
                </ul>

                <h2>4. Acceptable Use</h2>
                <p>You agree not to:</p>
                <ul>
                    <li>Use the Service for any unlawful purpose.</li>
                    <li>Attempt to reverse-engineer, decompile, or disassemble the Service beyond what is permitted by applicable law.</li>
                    <li>Transmit malicious code or interfere with the Service's infrastructure.</li>
                    <li>Exceed reasonable usage limits that degrade the experience for other users.</li>
                </ul>

                <h2>5. Intellectual Property</h2>
                <p>
                    Your transcriptions belong to you. Windy Pro does not claim ownership of any
                    content you create using the Service. The Windy Pro software, branding, and
                    documentation are the intellectual property of Windy Pro and its contributors.
                </p>

                <h2>6. Cloud Pro Subscription</h2>
                <ul>
                    <li>Cloud Pro is billed monthly at the current listed price.</li>
                    <li>You may cancel at any time; access continues until the end of the billing period.</li>
                    <li>Refunds are provided at our discretion for technical issues within 7 days of purchase.</li>
                </ul>

                <h2>7. Disclaimer of Warranties</h2>
                <p>
                    The Service is provided "as is" without warranty of any kind. We do not guarantee
                    transcription accuracy, uptime, or uninterrupted access. Transcription accuracy depends
                    on audio quality, language, and hardware.
                </p>

                <h2>8. Limitation of Liability</h2>
                <p>
                    To the maximum extent permitted by law, Windy Pro shall not be liable for any
                    indirect, incidental, special, or consequential damages arising from your use
                    of the Service.
                </p>

                <h2>9. Termination</h2>
                <p>
                    We reserve the right to suspend or terminate accounts that violate these terms.
                    You may delete your account at any time through the app settings.
                </p>

                <h2>10. Changes</h2>
                <p>
                    We may update these terms from time to time. Continued use of the Service
                    constitutes acceptance of the updated terms.
                </p>

                <h2>11. Contact</h2>
                <p>
                    Questions? Email us at <a href="mailto:support@windypro.com">support@windypro.com</a>.
                </p>
            </div>
        </div>
    )
}
