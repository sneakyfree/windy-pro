import { Link } from 'react-router-dom'
import './Legal.css'

export default function Terms() {
    return (
        <div className="legal-page">
            <nav className="legal-nav">
                <Link to="/" className="legal-back">&larr; Windy Word</Link>
            </nav>
            <div className="legal-content">
                <h1>Terms of Service</h1>
                <p className="legal-updated">Last updated: April 2026</p>

                <h2>1. Acceptance of Terms</h2>
                <p>
                    By accessing or using Windy Word ("the Service"), operated via <a href="https://windyword.ai" style={{ color: '#22C55E' }}>windyword.ai</a>, you agree to be bound by these Terms of Service. If you do not agree to these terms, you must not use the Service.
                </p>

                <h2>2. Description of Service</h2>
                <p>
                    Windy Word provides voice-to-text transcription, translation, and AI-powered productivity tools. The Service is available as a desktop application (local mode) and a cloud-hosted web application (cloud mode).
                </p>

                <h2>3. Minimum Age</h2>
                <p>
                    You must be at least 13 years of age to use the Service. By creating an account, you represent and warrant that you are at least 13 years old. If you are under 18, you must have the consent of a parent or legal guardian to use the Service.
                </p>

                <h2>4. User Accounts</h2>
                <ul>
                    <li>Cloud mode requires creating an account with a valid email address and password.</li>
                    <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
                    <li>You are responsible for all activity that occurs under your account.</li>
                    <li>You must notify us immediately of any unauthorised use of your account.</li>
                </ul>

                <h2>5. Acceptable Use</h2>
                <p>You agree not to:</p>
                <ul>
                    <li>Use the Service for any unlawful purpose or to process illegal content.</li>
                    <li>Transmit spam, unsolicited messages, or malicious content through the Service.</li>
                    <li>Attempt to reverse-engineer, decompile, disassemble, or otherwise derive the source code of the Service, except where permitted by applicable law.</li>
                    <li>Interfere with, disrupt, or place an unreasonable burden on the Service's infrastructure.</li>
                    <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity.</li>
                    <li>Use automated tools (bots, scrapers) to access the Service without our prior written consent.</li>
                </ul>

                <h2>6. AI Agent Policy</h2>
                <p>
                    Windy Word integrates AI agent capabilities. All AI agents operating within or on behalf of the Service must comply with the Eternitas trust framework, including identity verification, clearance levels, and integrity scoring. Misuse of AI agents — including attempting to bypass trust controls or impersonate other users — is strictly prohibited and may result in immediate account termination.
                </p>

                <h2>7. Subscriptions & Billing</h2>
                <ul>
                    <li>Windy Word offers monthly and annual subscription plans, billed via Stripe.</li>
                    <li>You may cancel your subscription at any time. Access continues until the end of the current billing period.</li>
                    <li>No refunds are provided for partial months or unused portions of a billing period.</li>
                    <li>We reserve the right to change subscription prices with 30 days' prior notice. Price changes do not apply to the current billing period.</li>
                    <li>Failed payment may result in suspension of your account until payment is resolved.</li>
                </ul>

                <h2>8. Intellectual Property</h2>
                <p>
                    <strong>Your content:</strong> you retain full ownership of all recordings, transcripts, translations, and other content you create using the Service. Windy Word does not claim any ownership or licence over your content.
                </p>
                <p>
                    <strong>Our content:</strong> the Windy Word software, branding, documentation, and all associated intellectual property are owned by Windy Word and its contributors. You may not copy, modify, or distribute our software except as expressly permitted.
                </p>

                <h2>9. Disclaimer of Warranties</h2>
                <p>
                    The Service is provided <strong>"as is"</strong> and <strong>"as available"</strong> without warranty of any kind, whether express, implied, or statutory. We do not guarantee transcription accuracy, translation quality, uptime, or uninterrupted access. Transcription accuracy depends on audio quality, language, accent, and hardware.
                </p>

                <h2>10. Limitation of Liability</h2>
                <p>
                    To the maximum extent permitted by applicable law, Windy Word shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. Our total liability for any claim arising from the Service is limited to the total subscription fees you have paid to us in the 12 months preceding the claim.
                </p>

                <h2>11. Termination</h2>
                <ul>
                    <li>We reserve the right to suspend or terminate accounts that violate these terms, with or without notice.</li>
                    <li>You may delete your account at any time through the app settings. Upon deletion, your data will be removed in accordance with our <Link to="/privacy" style={{ color: '#22C55E' }}>Privacy Policy</Link>.</li>
                </ul>

                <h2>12. Dispute Resolution</h2>
                <p>
                    These Terms are governed by and construed in accordance with the laws of England and Wales. Any dispute arising from or relating to these Terms or the Service shall be resolved through binding arbitration in accordance with the rules of the London Court of International Arbitration (LCIA). You agree to waive any right to participate in a class action lawsuit or class-wide arbitration.
                </p>

                <h2>13. Changes to These Terms</h2>
                <p>
                    We may update these terms from time to time. Material changes will be communicated via email or an in-app notification at least 14 days before they take effect. Continued use of the Service after changes take effect constitutes acceptance of the updated terms.
                </p>

                <h2>14. Contact</h2>
                <p>
                    Questions about these terms? Contact us at <a href="mailto:privacy@windyword.ai" style={{ color: '#22C55E' }}>privacy@windyword.ai</a>.<br />
                    Windy Word &mdash; <a href="https://windyword.ai" style={{ color: '#22C55E' }}>windyword.ai</a>
                </p>
            </div>
        </div>
    )
}
