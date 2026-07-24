import { Link } from 'react-router-dom'
import './Legal.css'

// DRAFT — plain-language Data & Communications Disclosure for the sign-up flow.
// NOT the final legal text; to be reviewed by an attorney before public launch.
// Covers the five points agreed for the free-tier sandbox: (1) clear consent,
// (2) EU access/opt-out rights, (3) email unsubscribe, (4) country-level (not
// precise) location, (5) the local-by-default promise.
export default function Disclosure() {
    return (
        <div className="legal-page">
            <nav className="legal-nav">
                <Link to="/" className="legal-back">&larr; Windy Word</Link>
            </nav>
            <div className="legal-content">
                <h1>Data &amp; Communications Disclosure</h1>
                <p className="legal-updated">Draft — last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · pending legal review</p>

                <p>
                    Please read this before creating your free account. It explains, in plain language,
                    what stays on your device, what we collect, and how we may contact you. By signing up
                    you confirm you have read and agree to it, along with our{' '}
                    <Link to="/terms" style={{ color: '#22C55E' }}>Terms of Service</Link> and{' '}
                    <Link to="/privacy" style={{ color: '#22C55E' }}>Privacy Policy</Link>.
                </p>

                <h2>1. Your recordings stay on your device</h2>
                <p>
                    Windy Word is <strong>local-first by default</strong>. The audio and video you record
                    and the text it produces are processed and stored <strong>on your own machine</strong>.
                    We do not upload, read, listen to, or have access to that content.
                </p>
                <p>
                    The <strong>only</strong> times your content leaves your device are when you explicitly
                    choose to:
                </p>
                <ul>
                    <li><strong>Cloud compute</strong> — send a recording to our servers for faster transcription or AI polish; or</li>
                    <li><strong>WindyCloud storage</strong> — save your data to our encrypted cloud storage.</li>
                </ul>
                <p>
                    Both are opt-in and clearly labeled. If you never turn them on, your content never leaves
                    your machine — you can run Windy Word fully offline and dark.
                </p>

                <h2>2. Usage information we do collect (never your content)</h2>
                <p>
                    To operate and improve the service and to understand how it's used, we collect
                    <strong> information about your usage — not your content</strong>. This includes things like:
                    when and how often you use the app, session lengths, how many devices your account is on,
                    which engines you use, your app version and operating system, and your <strong>country-level
                    location</strong> (derived from your network — we do not collect precise or GPS location).
                </p>
                <p>
                    This is metadata about your usage. It never includes the words you dictate, your recordings,
                    or your files.
                </p>

                <h2>3. Communications</h2>
                <p>
                    Your free account is tied to your email address. By signing up you agree that we may contact
                    you about the product and occasional offers (typically a few times per year) by email and via
                    in-app messages. <strong>You can unsubscribe from marketing email at any time</strong> using
                    the link in every message, or in your account settings. Essential service messages (for
                    example, security or account notices) may still be sent.
                </p>

                <h2>4. Your choices and rights</h2>
                <ul>
                    <li>You can opt out of marketing communications at any time.</li>
                    <li>Depending on where you live (for example, the EU/UK under GDPR, or California under CCPA), you may have the right to access, correct, or delete your account information, and to opt out of certain analytics. Contact us at <a href="mailto:privacy@windyword.ai" style={{ color: '#22C55E' }}>privacy@windyword.ai</a>.</li>
                    <li>You can delete your account, which removes your account information from our systems.</li>
                </ul>

                <h2>5. Age</h2>
                <p>You must be at least 13 to create an account (and have a parent or guardian's consent if under 18).</p>

                <p style={{ marginTop: '32px', fontSize: '13px', color: '#94A3B8' }}>
                    This is a plain-language summary provided during our early access period and is not a substitute
                    for the full Terms of Service and Privacy Policy. It will be finalized with legal counsel before
                    general availability.
                </p>
            </div>
        </div>
    )
}
