import { Link } from 'react-router-dom'
import './Legal.css'

// DRAFT — plain-language Data & Communications Disclosure for the sign-up flow.
// NOT final legal text. Attorney review is REQUIRED before public launch; see
// docs/LEGAL-REVIEW-CHECKLIST.md for the specific questions counsel must answer
// (biometric consent under BIPA / GDPR Art. 9, opt-in vs opt-out for EU and
// Canadian email, digital-replica statutes, and CCPA "sale/sharing" if the
// Windy Clone marketplace ever routes data to third-party vendors).
//
// Drafting rule applied throughout: describe only what the product actually
// does today, and mark anything not yet available as such. An unshipped
// privacy or security claim is an FTC deception risk and a brand risk — trust
// is the moat, so we never spend it on copy.
export default function Disclosure() {
    const linkStyle = { color: '#22C55E' }

    return (
        <div className="legal-page">
            <nav className="legal-nav">
                <Link to="/" className="legal-back">&larr; Windy Word</Link>
            </nav>
            <div className="legal-content">
                <h1>Data &amp; Communications Disclosure</h1>
                <p className="legal-updated">
                    Draft — last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · pending legal review
                </p>

                <p>
                    Please read this before creating your free account. It explains, in plain language,
                    what stays on your device, what we collect, how we may contact you, and what we will
                    never do without asking you first. By signing up you confirm you have read and agree
                    to it, along with our{' '}
                    <Link to="/terms" style={linkStyle}>Terms of Service</Link> and{' '}
                    <Link to="/privacy" style={linkStyle}>Privacy Policy</Link>.
                </p>

                <h2>The short version</h2>
                <p>
                    Windy Word is free, and it stays free. In exchange, you give us your email address and
                    permission to send you occasional messages about the product — typically a few times a
                    year — by email and inside the app. That is the trade, and we would rather state it
                    plainly than bury it.
                </p>
                <p>
                    What you say and record is <strong>not</strong> part of that trade. Your recordings stay
                    on your computer, where we have no access to them at all, and we do not sell your
                    content. If you want to keep everything local forever and never turn on a single cloud
                    feature, that is a completely normal way to use Windy Word, and nothing about the app
                    gets worse if you do.
                </p>

                <h2>1. Your recordings stay on your device</h2>
                <p>
                    Windy Word is <strong>local-first by default</strong>. The audio and video you record and
                    the text it produces are processed and stored <strong>on your own machine</strong>. We do
                    not upload, read, listen to, or have access to that content.
                </p>
                <p>
                    The <strong>only</strong> times your content leaves your device are when you explicitly
                    choose to turn on a cloud feature:
                </p>
                <ul>
                    <li><strong>Cloud compute</strong> — send a recording to a server for faster or cleaner transcription, useful when your computer is slow or working hard.</li>
                    <li><strong>WindyCloud storage</strong> — save or archive your files with us instead of only on your machine.</li>
                    <li><strong>Windy Clone</strong> — use your own recordings to create a voice clone or avatar of yourself.</li>
                </ul>
                <p>
                    Every one of these is off until you turn it on. Creating an account does{' '}
                    <strong>not</strong> turn any of them on, and this disclosure is{' '}
                    <strong>not</strong> your permission for any of them. We ask again, separately and
                    specifically, at the moment each one would actually happen. You can run Windy Word fully
                    offline and dark, indefinitely.
                </p>

                <h2>2. Information we do collect (never your content)</h2>
                <p>
                    To run the service, keep it working, and understand how it is used, we collect{' '}
                    <strong>information about your usage — not your content</strong>. For example: when and
                    how often you use the app, how long sessions last, how many devices are on your account,
                    which transcription engines you use, your app version and operating system, and your{' '}
                    <strong>country</strong> (worked out from your internet connection — we do not collect
                    precise or GPS location).
                </p>
                <p>
                    This is information <em>about</em> your usage. It never includes the words you dictate,
                    your recordings, or your files. We use it to fix problems, decide what to build, and
                    decide what to tell you about.
                </p>

                <h2>3. How we contact you</h2>
                <p>
                    Your free account is tied to your email address. By signing up you agree that we may
                    contact you about the product, new features, and occasional offers —{' '}
                    <strong>typically a few times per year</strong> — in two ways:
                </p>
                <ul>
                    <li><strong>Email</strong> sent to the address on your account.</li>
                    <li><strong>Messages inside the app</strong>, shown when you open or sign in to Windy Word.</li>
                </ul>
                <p>
                    <strong>You can turn both off at any time</strong> — using the unsubscribe link in every
                    email, or in your account settings. Turning off marketing does not limit the app in any
                    way. We may still send essential service messages, such as a security alert, a password
                    reset, or notice of an important change to these terms; those are not marketing and
                    cannot be switched off while you have an account.
                </p>
                <p>We do not sell your email address.</p>

                <h2>4. WindyCloud storage — optional, and only if you ask</h2>
                <p>
                    Recordings, especially video, fill up a hard drive quickly. If you ever want your files
                    kept somewhere other than your own machine — for backup, or to reach them from a second
                    device — WindyCloud is designed to be a single button rather than a project.
                </p>
                <p>
                    If you turn it on: you choose what goes up, you can see how much space you are using, you
                    can download everything back at any time, and you can delete it. If you never turn it on,
                    nothing is ever uploaded.
                </p>
                <p>
                    <em>Availability note: WindyCloud storage is not yet available on all accounts. When it
                    is, we will explain exactly how your files are protected before you upload anything — we
                    would rather give you the specifics then than make a promise here we have not yet
                    built.</em>
                </p>

                <h2>5. Windy Clone — voice clones and avatars</h2>
                <p>
                    Over time your recordings become a genuinely valuable record of how you speak, sound, and
                    explain things. Windy Clone is intended to let you turn that into a{' '}
                    <strong>voice clone or avatar of yourself</strong>, easily, if you ever want one.
                </p>
                <p>
                    Because this involves your voice and your likeness, we hold it to a higher bar than
                    anything else in this document:
                </p>
                <ul>
                    <li><strong>We will never create a clone from your data unless you specifically ask us to</strong> — each time, in a separate request that is clearly about exactly that.</li>
                    <li>Creating an account, and using cloud storage, are <strong>not</strong> permission to make a clone.</li>
                    <li>Before you agree, you will be told which of your recordings would be used and who would process them, including any outside company involved.</li>
                    <li>You can withdraw that permission, and ask us to delete a clone we made, at any time.</li>
                    <li>We will not use your voice or likeness to advertise Windy Word, and will not let anyone else use them, without asking you separately.</li>
                </ul>
                <p>
                    <em>Availability note: Windy Clone is not yet available. It is described here so you know
                    our intentions before you start recording — not because it is something you are agreeing
                    to today.</em>
                </p>

                <h2>6. Your choices and your rights</h2>
                <ul>
                    <li><strong>Opt out of marketing</strong> — email and in-app messages, at any time, without losing any features.</li>
                    <li><strong>Stay fully local</strong> — never turn on cloud compute, storage, or cloning. This is a supported, permanent way to use the app.</li>
                    <li><strong>Get your data out</strong> — your recordings and transcripts are ordinary files on your own computer, and anything stored with us can be downloaded back.</li>
                    <li><strong>Delete your account</strong> — which removes your account information, and anything you stored with us, from our systems.</li>
                    <li><strong>Rights where you live</strong> — depending on your location (for example the EU or UK under GDPR, or California under the CCPA), you may have additional rights to access, correct, delete, or restrict how your information is used. Contact{' '}
                        <a href="mailto:privacy@windyword.ai" style={linkStyle}>privacy@windyword.ai</a>.</li>
                </ul>

                <h2>7. Age</h2>
                <p>
                    You must be at least 13 to create an account, and if you are under 18 you need a parent
                    or guardian&rsquo;s permission.
                </p>

                <h2>8. Changes to this disclosure</h2>
                <p>
                    If we change how we use your information in a way that materially affects you, we will
                    tell you — by email and in the app — before the change takes effect, not afterwards.
                </p>

                <p style={{ marginTop: '32px', fontSize: '13px', color: '#94A3B8' }}>
                    This is a plain-language summary provided during our early access period and is not a
                    substitute for the full{' '}
                    <Link to="/terms" style={linkStyle}>Terms of Service</Link> and{' '}
                    <Link to="/privacy" style={linkStyle}>Privacy Policy</Link>. It is a draft pending review
                    by legal counsel and will be finalized before general availability. Questions:{' '}
                    <a href="mailto:privacy@windyword.ai" style={linkStyle}>privacy@windyword.ai</a>.
                </p>
            </div>
        </div>
    )
}
