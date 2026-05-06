/**
 * VoiceButton — the universal voice-input affordance.
 *
 * v0 ships text-input mode (modal with a textarea) so frontends can
 * integrate against the protocol contract today. v1 adds audio capture
 * via MediaRecorder + multipart upload to the same dispatch endpoint.
 *
 * Drop this anywhere a user might want to talk to their agent. It
 * fixes-position itself in the bottom-right corner by default but
 * accepts a `position` prop for inline mounts.
 *
 * Usage:
 *   <VoiceButton token={proJwt} surface="dashboard" />
 *
 * Once @windy/voice-button is extracted as a standalone package, every
 * Windy frontend imports the same component and gets identical behavior
 * with zero per-surface logic.
 */
import { useEffect, useRef, useState } from 'react'
import useVoiceDispatch from '../hooks/useVoiceDispatch'
import './VoiceButton.css'

export default function VoiceButton({
    token,
    surface = 'unknown',
    apiBase = '/api/v1',
    position = 'fixed-br',
}) {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState('')
    const textareaRef = useRef(null)
    const {
        status,
        transcript,
        events,
        response,
        errorMessage,
        dispatch,
        reset,
    } = useVoiceDispatch({ token, apiBase })

    // Focus the textarea when the modal opens.
    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => textareaRef.current?.focus())
        }
    }, [open])

    // Auto-close after a happy 'done' so the user isn't stuck dismissing.
    useEffect(() => {
        if (status === 'done') {
            const t = setTimeout(() => setOpen(false), 4000)
            return () => clearTimeout(t)
        }
    }, [status])

    const onSubmit = (e) => {
        e?.preventDefault()
        if (!text.trim()) return
        dispatch({ text, context: { surface } })
    }

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            onSubmit()
        } else if (e.key === 'Escape') {
            setOpen(false)
        }
    }

    const close = () => {
        setOpen(false)
        // Don't reset the events — leave the chip showing last-task state.
    }

    const clear = () => {
        setText('')
        reset()
    }

    return (
        <>
            <button
                type="button"
                className={`voice-button voice-button-${position}`}
                onClick={() => setOpen(true)}
                aria-label="Talk to your agent"
                title="Talk to your agent"
            >
                <span className="voice-button-icon" aria-hidden="true">🎙️</span>
                <span className="voice-button-label">Talk to agent</span>
            </button>

            {open ? (
                <div
                    className="voice-modal-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Talk to your agent"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) close()
                    }}
                >
                    <div className="voice-modal">
                        <div className="voice-modal-header">
                            <span className="voice-modal-title">Talk to your agent</span>
                            <button
                                type="button"
                                className="voice-modal-close"
                                onClick={close}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>

                        <form className="voice-modal-body" onSubmit={onSubmit}>
                            <textarea
                                ref={textareaRef}
                                className="voice-modal-input"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder="What should I do? (e.g., research the Austin mortgage market and email Bob)"
                                rows={3}
                                disabled={status === 'dispatching' || status === 'streaming'}
                            />
                            <div className="voice-modal-hint">
                                Press <kbd>⌘</kbd>+<kbd>Enter</kbd> to send · <kbd>Esc</kbd> to close
                            </div>
                            <div className="voice-modal-actions">
                                <button
                                    type="button"
                                    className="voice-modal-secondary"
                                    onClick={clear}
                                    disabled={status === 'dispatching' || status === 'streaming'}
                                >
                                    Clear
                                </button>
                                <button
                                    type="submit"
                                    className="voice-modal-primary"
                                    disabled={!text.trim() || status === 'dispatching' || status === 'streaming'}
                                >
                                    {status === 'dispatching' || status === 'streaming' ? 'Working…' : 'Send'}
                                </button>
                            </div>
                        </form>

                        <VoiceStatus
                            status={status}
                            transcript={transcript}
                            events={events}
                            response={response}
                            errorMessage={errorMessage}
                        />
                    </div>
                </div>
            ) : null}
        </>
    )
}

function VoiceStatus({ status, transcript, events, response, errorMessage }) {
    if (status === 'idle') return null

    return (
        <div className="voice-status">
            {transcript ? (
                <div className="voice-status-transcript">
                    <span className="voice-status-label">You said:</span> {transcript}
                </div>
            ) : null}

            <ol className="voice-status-events">
                {events.map((ev, i) => (
                    <li key={i} className={`voice-status-event voice-status-event-${ev.event}`}>
                        {labelFor(ev)}
                    </li>
                ))}
            </ol>

            {response ? (
                <div className="voice-status-response">
                    <span className="voice-status-label">Agent:</span> {response}
                </div>
            ) : null}

            {status === 'scaffold' ? (
                <div className="voice-status-scaffold">
                    Your agent is offline. The voice command was recorded but not run. Try again once your agent is online.
                </div>
            ) : null}

            {status === 'failed' && errorMessage ? (
                <div className="voice-status-error">{errorMessage}</div>
            ) : null}
        </div>
    )
}

function labelFor(ev) {
    switch (ev.event) {
        case 'dispatched':
            return '✓ Sent to your agent'
        case 'thinking':
            return '🤔 Thinking…'
        case 'response':
            return '💬 Got a response'
        case 'done':
            return ev.data?.scaffold ? '⚠ Agent offline (scaffold mode)' : '✓ Done'
        case 'failed':
            return '✗ Failed'
        case 'scaffold_mode':
            return '⚠ Agent offline'
        default:
            return ev.event
    }
}
