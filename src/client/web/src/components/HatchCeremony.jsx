/**
 * HatchCeremony — the visual player for the agent-hatch SSE stream.
 *
 * Ported from src/client/desktop/renderer/hatch-ceremony.js (the 310-line
 * vanilla-JS class). Beat-for-beat identical flow; React idiomatic state.
 *
 * Responsibilities:
 *   - Render the progress log (13 canonical events, 7 de-duped rows)
 *   - Translate each backend `label` into plain-English grandma copy
 *   - Render the birth certificate card when birth_certificate.ready lands
 *   - Surface failures with a red icon + plain-English guidance + retry
 *   - Swap in the post-hatch CTAs on hatch.complete
 *   - Persist the certificate + room ID to localStorage so HatchCard flips
 *     into "your helper is ready" state on next login
 *
 * The component is presentational — it receives the stream state from
 * useHatchStream and owns no fetch logic of its own.
 */
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useHatchStream from '../hooks/useHatchStream'
import { saveHatchState } from '../utils/hatchStorage'

// ─── Grandma-English copy ──────────────────────────────────────────
//
// The backend emits the canonical 13 event types. We map each one to the
// user-facing string. Anything the backend emits that isn't in this table
// falls back to the raw label (which is itself dev-oriented, so the map
// should cover every real case).
const STEP_LABELS = {
    'eternitas.registering':      { pending: "Setting up your helper's identity…",    ok: 'Identity ready' },
    'eternitas.registered':       { pending: "Setting up your helper's identity…",    ok: 'Identity ready' },
    'mail.provisioning':          { pending: 'Getting your helper an email address…', ok: 'Email address ready' },
    'mail.provisioned':           { pending: 'Getting your helper an email address…', ok: 'Email address ready' },
    'chat.provisioning':          { pending: 'Building your helper a chat room…',     ok: 'Chat room ready' },
    'chat.provisioned':           { pending: 'Building your helper a chat room…',     ok: 'Chat room ready' },
    'cloud.provisioning':         { pending: 'Setting up storage…',                   ok: 'Storage ready' },
    'cloud.provisioned':          { pending: 'Setting up storage…',                   ok: 'Storage ready' },
    'phone.assigning':            { pending: 'Preparing phone line…',                 ok: 'Phone line ready' },
    'phone.assigned':             { pending: 'Preparing phone line…',                 ok: 'Phone line ready' },
    'birth_certificate.generating': { pending: 'Generating your birth certificate…',  ok: 'Birth certificate ready' },
    'birth_certificate.ready':    { pending: 'Generating your birth certificate…',    ok: 'Birth certificate ready' },
    'hatch.complete':             { pending: 'Finishing up…',                         ok: 'Your helper is ready!' },
}

// Failure copy per family. Keyed off the baseType (type with .ing/.ed
// suffix stripped — same collapse as useHatchStream.
const FAILURE_COPY = {
    eternitas: "Our identity service is having a hiccup. Try again in a few minutes.",
    mail:      "Email setup didn't finish. Your helper still works — you can use it, just without its own inbox for now.",
    chat:      "Chat room setup didn't finish. Try again, or open your helper directly from your dashboard.",
    cloud:     "Storage setup didn't finish. Your helper will still work.",
    phone:     "Phone line setup didn't finish. Your helper still works.",
    birth_certificate: "Something went wrong writing your certificate. Try again.",
    hatch:     'Something went wrong. Try again in a moment.',
}

// Same baseType collapse used in the hook — kept in sync.
const STEP_SUFFIX_RX = /\.(registering|provisioning|assigning|generating|issuing|hatching|registered|provisioned|assigned|ready|issued|hatched|complete)$/
function baseType(type) {
    return (type || '').replace(STEP_SUFFIX_RX, '')
}

function formatBytes(bytes) {
    if (!bytes) return null
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}

function formatBornAt(iso) {
    if (!iso) return null
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso
    }
}

// ─── Row component ─────────────────────────────────────────────────
function StepRow({ step }) {
    const { type, status, label } = step
    const copy = STEP_LABELS[type]
    let display
    if (status === 'failed') {
        const family = baseType(type)
        display = FAILURE_COPY[family] || FAILURE_COPY.hatch
    } else if (copy) {
        display = status === 'ok' ? copy.ok : copy.pending
    } else {
        display = label
    }

    return (
        <li className={`hatch-step hatch-step-${status || 'pending'}`}>
            <span className="hatch-dot" aria-hidden="true" />
            <span className="hatch-step-label">{display}</span>
        </li>
    )
}

// ─── Birth certificate card ────────────────────────────────────────
function BirthCertificate({ data }) {
    if (!data) return null
    const cloud = formatBytes(data.cloud_storage_bytes)
    const born = formatBornAt(data.born_at)
    const brain = data.brain
        ? [data.brain.model, data.brain.provider].filter(Boolean).join(' · ')
        : null

    const rows = [
        ['Certificate No.', data.certificate_no],
        ['Name',            data.agent_name],
        ['Identity',        data.passport_number],
        ['Born',            born],
        ['Creator',         data.creator],
        ['Email',           data.email],
        ['Phone',           data.phone],
        ['Cloud storage',   cloud],
        ['Brain',           brain],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '')

    return (
        <section className="hatch-cert" aria-label="Birth certificate">
            <div className="hatch-cert-header">
                <div className="hatch-cert-title">CERTIFICATE OF BIRTH</div>
                <div className="hatch-cert-seal" aria-hidden="true">🪰</div>
            </div>
            <dl className="hatch-cert-grid">
                {rows.map(([k, v]) => (
                    <div key={k} className="hatch-cert-row">
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                    </div>
                ))}
            </dl>
        </section>
    )
}

// ─── Main component ────────────────────────────────────────────────
export default function HatchCeremony({ token, onDone }) {
    const navigate = useNavigate()
    const {
        status,
        steps,
        stepOrder,
        certificate,
        complete,
        errorMessage,
        start,
        cancel,
        reset,
    } = useHatchStream({ token, apiBase: '/api/v1' })

    // Auto-start the SSE on mount. Don't retry on failure — surface the
    // error + retry button so the user decides.
    useEffect(() => {
        if (status === 'idle') start()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // On hatch.complete, persist to localStorage so HatchCard flips state.
    useEffect(() => {
        if (status !== 'complete') return
        const dmRoomId = certificate?.chat?.dm_room_id || null
        saveHatchState({
            hatched_at: new Date().toISOString(),
            passport_number: certificate?.passport_number || null,
            dm_room_id: dmRoomId,
            agent_name: certificate?.agent_name || null,
            certificate: certificate || null,
        })
    }, [status, certificate])

    // Detect any failed step — the whole ceremony is retriable as a unit
    // (per scoping doc: no per-step retry in MVP).
    const hasFailedStep = useMemo(
        () => stepOrder.some((k) => steps[k]?.status === 'failed'),
        [steps, stepOrder]
    )

    const isStreaming = status === 'streaming'
    const isDone = status === 'complete' && !hasFailedStep
    const showRetry = status === 'error' || hasFailedStep

    const dmRoomId = certificate?.chat?.dm_room_id || null
    const resumed = !!complete?.resumed

    const orderedSteps = stepOrder.map((k) => ({ key: k, ...steps[k] }))

    const handleRetry = () => {
        cancel()
        reset()
        // slight yield so the reset commits before start() picks up fresh
        setTimeout(() => start(), 0)
    }

    const handleTalkToAgent = () => {
        // Navigate to /app/fly with the dm_room_id (if any). Known gotcha:
        // dm_room_id can be null on chat.provisioned — the agent will
        // materialize the room on first message send.
        const qs = dmRoomId ? `?dm_room_id=${encodeURIComponent(dmRoomId)}` : ''
        navigate(`/app/fly${qs}`)
    }

    const handleDone = () => {
        cancel()
        if (onDone) onDone()
        else navigate('/dashboard')
    }

    return (
        <div className="hatch-page">
            <div className="hatch-modal" role="dialog" aria-label="Hatch your helper">
                <header className="hatch-header">
                    <div className="hatch-mascot" aria-hidden="true">🪰</div>
                    <h1 className="hatch-title">
                        {isDone ? 'Your helper is ready!' : 'Your helper is being born'}
                    </h1>
                    <p className="hatch-sub">
                        {isDone
                            ? resumed
                                ? "You've done this already — here's your helper."
                                : 'Say hi when you are ready.'
                            : isStreaming
                                ? 'This takes about 30 seconds. Sit tight.'
                                : showRetry
                                    ? "We hit a snag."
                                    : "Getting things ready…"}
                    </p>
                </header>

                <div className="hatch-body">
                    {/* Progress log */}
                    <ul className="hatch-log" aria-live="polite">
                        {orderedSteps.length === 0 && isStreaming && (
                            <li className="hatch-step hatch-step-pending">
                                <span className="hatch-dot" aria-hidden="true" />
                                <span className="hatch-step-label">Getting started…</span>
                            </li>
                        )}
                        {orderedSteps.map((s) => (
                            <StepRow key={s.key} step={s} />
                        ))}
                    </ul>

                    {/* Birth certificate */}
                    {certificate && <BirthCertificate data={certificate} />}

                    {/* Transport-level error banner (distinct from a failed SSE
                        step — this is set when fetch/abort/429 etc. fire) */}
                    {errorMessage && status === 'error' && (
                        <div
                            className="hatch-banner hatch-banner-error"
                            role="alert"
                            aria-live="assertive"
                        >
                            {errorMessage}
                        </div>
                    )}
                </div>

                {/* CTAs */}
                <div className="hatch-ctas">
                    {isDone && (
                        <>
                            <button
                                type="button"
                                className="hatch-cta hatch-cta-primary"
                                onClick={handleTalkToAgent}
                            >
                                💬 Talk to My Helper
                            </button>
                            <button
                                type="button"
                                className="hatch-cta"
                                onClick={handleDone}
                            >
                                Done
                            </button>
                        </>
                    )}
                    {showRetry && (
                        <>
                            <button
                                type="button"
                                className="hatch-cta hatch-cta-primary"
                                onClick={handleRetry}
                            >
                                Try again
                            </button>
                            <button
                                type="button"
                                className="hatch-cta"
                                onClick={handleDone}
                            >
                                Not now
                            </button>
                        </>
                    )}
                    {isStreaming && (
                        <button
                            type="button"
                            className="hatch-cta"
                            disabled
                            aria-disabled="true"
                        >
                            Please wait…
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
