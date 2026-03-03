import { useState, useEffect } from 'react'
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

                <div style={{
                    background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)',
                    borderRadius: '10px', padding: '16px 20px', marginBottom: '32px'
                }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#22C55E', marginBottom: '8px', letterSpacing: '1px' }}>TABLE OF CONTENTS</div>
                    {['Overview', 'Local Mode', 'Cloud Mode', 'Data Retention', 'Third-Party Services', 'Cookies', 'Children\'s Privacy', 'Changes', 'Contact'].map((s, i) => (
                        <a key={i} href={`#${s.toLowerCase().replace(/[^a-z]/g, '-')}`} style={{
                            display: 'block', color: '#94A3B8', fontSize: '13px', textDecoration: 'none',
                            padding: '3px 0', transition: 'color 0.2s'
                        }}>{i + 1}. {s}</a>
                    ))}
                </div>

                <h2 id="overview">Overview</h2>
                <p>
                    Windy Pro is built on the principle of <strong>local-first privacy</strong>.
                    When you use Windy Pro in local mode, your audio and transcriptions never leave your machine.
                    This privacy policy explains how we handle data in both local and cloud modes.
                </p>

                <h2 id="local-mode">Local Mode (Desktop App)</h2>
                <ul>
                    <li><strong>Audio data</strong> is processed entirely on your device by the Windy Pro engine.</li>
                    <li><strong>Transcriptions</strong> are stored locally in an encrypted SQLite database (Prompt Vault).</li>
                    <li><strong>No data is sent</strong> to any server, API, or third party.</li>
                    <li><strong>No telemetry</strong> or analytics are collected.</li>
                    <li>We cannot access, view, or recover your local data.</li>
                </ul>

                <h2 id="cloud-mode">Cloud Mode (Web App)</h2>
                <p>When you use Windy Pro Cloud, the following data is processed:</p>
                <ul>
                    <li><strong>Audio data</strong> is streamed to our servers for transcription and immediately discarded after processing. We do not store raw audio.</li>
                    <li><strong>Transcriptions</strong> are stored in your account's Prompt Vault so you can access them across devices.</li>
                    <li><strong>Account data</strong> (email, hashed password) is stored securely to authenticate you.</li>
                    <li>We use industry-standard encryption (TLS/SSL) for all data in transit.</li>
                    <li>Passwords are hashed using bcrypt and are never stored in plain text.</li>
                </ul>

                <h2 id="data-retention">Data Retention</h2>
                <ul>
                    <li>Cloud transcriptions are retained until you delete them or close your account.</li>
                    <li>You can export and delete your data at any time from the Prompt Vault.</li>
                    <li>Account deletion removes all associated data within 30 days.</li>
                </ul>

                <h2 id="third-party-services">Third-Party Services</h2>
                <p>
                    Windy Pro does not sell, share, or provide your data to any third party.
                    We do not use advertising trackers or third-party analytics.
                </p>

                <h2 id="cookies">Cookies</h2>
                <p>
                    The web app uses a JSON Web Token (JWT) stored in your browser's local storage for authentication.
                    We do not use tracking cookies.
                </p>

                <h2 id="children-s-privacy">Children's Privacy</h2>
                <p>
                    Windy Pro is not directed at children under 13. We do not knowingly collect
                    personal information from children.
                </p>

                <h2 id="changes">Changes to This Policy</h2>
                <p>
                    We may update this policy from time to time. Changes will be posted on this page
                    with an updated revision date.
                </p>

                <h2 id="contact">Contact</h2>
                <p>
                    Questions about this policy? Email us at <a href="mailto:privacy@windypro.com">privacy@windypro.com</a>.
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
            >↑</button>
        </div>
    )
}
