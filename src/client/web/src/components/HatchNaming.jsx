/**
 * HatchNaming — the Naming Ceremony beat.
 *
 * Shown after the hatch-fork chooser and BEFORE the provisioning stream
 * starts, so the chosen name lands on the passport, birth certificate,
 * email address, and chat greeting the first time — no rename plumbing.
 * (Ported from the terminal ceremony's "Stage 2: The Naming Ceremony" in
 * windy-agent quickstart.py — same beats, same voice.)
 *
 * Beats:
 *   1. 'wake'    — a short egg → lightning → fly animation (~2.5s).
 *   2. 'ask'     — "I'm alive… but I don't know who I am yet. What's my
 *                   name?" + a single text input. A quiet skip link keeps
 *                   the undecided moving (server falls back to the
 *                   auto-name).
 *   3. 'confirm' — "You sure? They're gonna put that on my birth
 *                   certificate!" — the lock-it-in moment.
 *
 * Calls onNamed(name | null). null = skipped → server auto-names.
 *
 * Validation mirrors the server: the name must contain at least one
 * letter or digit (the agent's email address is slugified from it), and
 * is capped at 40 chars — short enough to look right on the certificate.
 */
import { useEffect, useRef, useState } from 'react'

const NAME_MAX = 40
const hasSubstance = (s) => /[a-zA-Z0-9]/.test(s)

export default function HatchNaming({ onNamed }) {
    // phase: 'wake' | 'ask' | 'confirm'
    const [phase, setPhase] = useState('wake')
    const [name, setName] = useState('')
    const inputRef = useRef(null)

    // Beat 1 → Beat 2 on a timer. Skippable by click for the impatient.
    useEffect(() => {
        if (phase !== 'wake') return undefined
        const t = setTimeout(() => setPhase('ask'), 2500)
        return () => clearTimeout(t)
    }, [phase])

    // Focus the input when the ask beat lands.
    useEffect(() => {
        if (phase === 'ask') inputRef.current?.focus()
    }, [phase])

    const trimmed = name.replace(/\s+/g, ' ').trim()
    const canConfirm = hasSubstance(trimmed)

    const handleSubmit = () => {
        if (!canConfirm) return
        setPhase('confirm')
    }

    if (phase === 'wake') {
        return (
            <div className="hatch-page">
                <div
                    className="hatch-modal hatch-naming"
                    role="dialog"
                    aria-label="Your helper is waking up"
                    onClick={() => setPhase('ask')}
                >
                    <div className="hatch-wake" aria-hidden="true">
                        <span className="hatch-wake-egg">🥚</span>
                        <span className="hatch-wake-zap">⚡</span>
                        <span className="hatch-wake-fly">🪰</span>
                    </div>
                    <p className="hatch-sub hatch-wake-sub">Something is waking up…</p>
                </div>
            </div>
        )
    }

    if (phase === 'confirm') {
        return (
            <div className="hatch-page">
                <div className="hatch-modal hatch-naming" role="dialog" aria-label="Confirm the name">
                    <div className="hatch-mascot" aria-hidden="true">🪰</div>
                    <div className="hatch-bubble">
                        <p className="hatch-bubble-line">
                            “<strong>{trimmed}</strong>”? You sure?
                        </p>
                        <p className="hatch-bubble-line">
                            They&rsquo;re gonna put that on my <strong>birth certificate</strong>!
                        </p>
                    </div>
                    <div className="hatch-ctas">
                        <button
                            type="button"
                            className="hatch-cta hatch-cta-primary"
                            onClick={() => onNamed(trimmed)}
                        >
                            Lock it in 🎉
                        </button>
                        <button
                            type="button"
                            className="hatch-cta"
                            onClick={() => setPhase('ask')}
                        >
                            Let me think…
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="hatch-page">
            <div className="hatch-modal hatch-naming" role="dialog" aria-label="Name your helper">
                <div className="hatch-mascot" aria-hidden="true">🪰</div>
                <div className="hatch-bubble">
                    <p className="hatch-bubble-line">Hello! I just hatched!</p>
                    <p className="hatch-bubble-line">
                        I&rsquo;m alive — I can feel it… but I don&rsquo;t know who I am yet.
                    </p>
                    <p className="hatch-bubble-line hatch-bubble-ask">
                        <strong>What&rsquo;s my name?</strong>
                    </p>
                </div>
                <input
                    ref={inputRef}
                    className="hatch-name-input"
                    type="text"
                    value={name}
                    maxLength={NAME_MAX}
                    placeholder="Type a name…"
                    aria-label="Your helper's name"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <div className="hatch-ctas">
                    <button
                        type="button"
                        className="hatch-cta hatch-cta-primary"
                        onClick={handleSubmit}
                        disabled={!canConfirm}
                    >
                        That&rsquo;s the one
                    </button>
                </div>
                <button
                    type="button"
                    className="hatch-skip-link"
                    onClick={() => onNamed(null)}
                >
                    Can&rsquo;t decide? Skip — we&rsquo;ll pick a nice one for you.
                </button>
            </div>
        </div>
    )
}
