import { Link } from 'react-router-dom'
import './Legal.css'

export default function Privacy() {
    return (
        <div className="legal-page">
            <nav className="legal-nav">
                <Link to="/" className="legal-back">← Windy Pro</Link>
            </nav>
            <div className="legal-content">
                <h1>Privacy Policy</h1>
                <p className="legal-updated">Last updated: February 2026</p>

                <h2>Overview</h2>
                <p>
                    Windy Pro is built on the principle of <strong>local-first privacy</strong>.
                    When you use Windy Pro in local mode, your audio and transcriptions never leave your machine.
                    This privacy policy explains how we handle data in both local and cloud modes.
                </p>

                <h2>Local Mode (Desktop App)</h2>
                <ul>
                    <li><strong>Audio data</strong> is processed entirely on your device using Whisper.</li>
                    <li><strong>Transcriptions</strong> are stored locally in an encrypted SQLite database (Prompt Vault).</li>
                    <li><strong>No data is sent</strong> to any server, API, or third party.</li>
                    <li><strong>No telemetry</strong> or analytics are collected.</li>
                    <li>We cannot access, view, or recover your local data.</li>
                </ul>

                <h2>Cloud Mode (Web App)</h2>
                <p>When you use Windy Pro Cloud, the following data is processed:</p>
                <ul>
                    <li><strong>Audio data</strong> is streamed to our servers for transcription and immediately discarded after processing. We do not store raw audio.</li>
                    <li><strong>Transcriptions</strong> are stored in your account's Prompt Vault so you can access them across devices.</li>
                    <li><strong>Account data</strong> (email, hashed password) is stored securely to authenticate you.</li>
                    <li>We use industry-standard encryption (TLS/SSL) for all data in transit.</li>
                    <li>Passwords are hashed using bcrypt and are never stored in plain text.</li>
                </ul>

                <h2>Data Retention</h2>
                <ul>
                    <li>Cloud transcriptions are retained until you delete them or close your account.</li>
                    <li>You can export and delete your data at any time from the Prompt Vault.</li>
                    <li>Account deletion removes all associated data within 30 days.</li>
                </ul>

                <h2>Third-Party Services</h2>
                <p>
                    Windy Pro does not sell, share, or provide your data to any third party.
                    We do not use advertising trackers or third-party analytics.
                </p>

                <h2>Cookies</h2>
                <p>
                    The web app uses a JSON Web Token (JWT) stored in your browser's local storage for authentication.
                    We do not use tracking cookies.
                </p>

                <h2>Children's Privacy</h2>
                <p>
                    Windy Pro is not directed at children under 13. We do not knowingly collect
                    personal information from children.
                </p>

                <h2>Changes to This Policy</h2>
                <p>
                    We may update this policy from time to time. Changes will be posted on this page
                    with an updated revision date.
                </p>

                <h2>Contact</h2>
                <p>
                    Questions about this policy? Email us at <a href="mailto:privacy@windypro.com">privacy@windypro.com</a>.
                </p>
            </div>
        </div>
    )
}
