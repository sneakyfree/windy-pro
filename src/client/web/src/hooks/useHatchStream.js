/**
 * useHatchStream — React hook wrapping POST /api/v1/agent/hatch's SSE.
 *
 * The endpoint is POST-only (not plain GET), so the browser's native
 * EventSource cannot be used — it only supports GET. We use fetch with a
 * ReadableStream body and parse SSE frames by hand, same as the desktop
 * reference implementation in src/client/desktop/renderer/hatch-ceremony.js.
 *
 * State shape:
 *   status:   'idle' | 'streaming' | 'complete' | 'error'
 *   events:   [{ seq, at, type, status, label, data? }, …]  // raw, in order
 *   steps:    { [baseType]: { status, label } }             // de-duped by
 *                                                             .ing/.ed pairs
 *   certificate:    object | null   // birth_certificate.ready.data
 *   complete:       object | null   // hatch.complete.data (e.g. { resumed })
 *   errorMessage:   string | null   // plain-English, set on transport failure
 *                                     (SSE step failures surface via events/
 *                                     steps; this is for fetch/network errors)
 *
 * API:
 *   const { status, events, steps, certificate, complete, errorMessage,
 *           start, cancel } = useHatchStream({ token, apiBase })
 *
 *   start()   — begins the POST. Disabled while status === 'streaming'.
 *   cancel()  — aborts the underlying fetch. Ceremony on the backend is
 *               idempotent; a re-run will replay events.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// Keep this in sync with the desktop reference (hatch-ceremony.js:236-238).
// The backend fires pairs like `.provisioning` → `.provisioned`; we collapse
// them into a single row that flips spinner → tick.
const STEP_SUFFIX_RX = /\.(registering|provisioning|assigning|generating|issuing|hatching|registered|provisioned|assigned|ready|issued|hatched|complete)$/

function baseType(type) {
    return (type || '').replace(STEP_SUFFIX_RX, '')
}

function parseSseFrame(frame) {
    if (!frame || frame.startsWith(':')) return null // heartbeat or empty
    const lines = frame.split('\n')
    let dataLine = ''
    for (const l of lines) if (l.startsWith('data: ')) dataLine += l.slice(6)
    if (!dataLine) return null
    try {
        return JSON.parse(dataLine)
    } catch {
        return null
    }
}

export default function useHatchStream({ token, apiBase = '/api/v1' } = {}) {
    const [status, setStatus] = useState('idle')
    const [events, setEvents] = useState([])
    const [steps, setSteps] = useState({}) // baseType → { status, label, type }
    const [stepOrder, setStepOrder] = useState([]) // insertion order of baseTypes
    const [certificate, setCertificate] = useState(null)
    const [complete, setComplete] = useState(null)
    const [errorMessage, setErrorMessage] = useState(null)
    const abortRef = useRef(null)

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            try {
                abortRef.current?.abort()
            } catch {
                /* noop */
            }
        }
    }, [])

    const cancel = useCallback(() => {
        try {
            abortRef.current?.abort()
        } catch {
            /* noop */
        }
        abortRef.current = null
    }, [])

    const reset = useCallback(() => {
        setStatus('idle')
        setEvents([])
        setSteps({})
        setStepOrder([])
        setCertificate(null)
        setComplete(null)
        setErrorMessage(null)
    }, [])

    const applyEvent = useCallback((ev) => {
        if (!ev || typeof ev !== 'object') return
        setEvents((prev) => [...prev, ev])

        const key = baseType(ev.type)
        setSteps((prev) => ({
            ...prev,
            [key]: {
                type: ev.type,
                status: ev.status || 'ok',
                label: ev.label || ev.type,
            },
        }))
        setStepOrder((prev) => (prev.includes(key) ? prev : [...prev, key]))

        if (ev.type === 'birth_certificate.ready' && ev.data) {
            setCertificate(ev.data)
        }
        if (ev.type === 'hatch.complete') {
            setComplete(ev.data || {})
            setStatus(ev.status === 'failed' ? 'error' : 'complete')
        }
    }, [])

    const start = useCallback(async () => {
        if (status === 'streaming') return
        reset()
        setStatus('streaming')

        if (!token) {
            setErrorMessage('You need to be signed in to hatch your helper.')
            setStatus('error')
            return
        }

        const controller = new AbortController()
        abortRef.current = controller

        let resp
        try {
            resp = await fetch(`${apiBase}/agent/hatch`, {
                method: 'POST',
                headers: {
                    Accept: 'text/event-stream',
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
                signal: controller.signal,
            })
        } catch (err) {
            if (controller.signal.aborted) {
                setStatus('idle')
                return
            }
            setErrorMessage("We couldn't reach our servers. Check your internet and try again.")
            setStatus('error')
            return
        }

        if (resp.status === 429) {
            setErrorMessage("You've tried to hatch a few times in a row. Please wait a minute, then try again.")
            setStatus('error')
            return
        }
        if (resp.status === 401) {
            setErrorMessage('Your session expired. Please sign in again.')
            setStatus('error')
            return
        }
        if (!resp.ok || !resp.body) {
            setErrorMessage('Something went wrong on our end. Try again in a moment.')
            setStatus('error')
            return
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        try {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                const frames = buf.split('\n\n')
                buf = frames.pop() || ''
                for (const frame of frames) {
                    const ev = parseSseFrame(frame)
                    if (ev) applyEvent(ev)
                }
            }
            // Drain trailing buffer if the server didn't terminate with \n\n.
            if (buf) {
                const ev = parseSseFrame(buf)
                if (ev) applyEvent(ev)
            }
        } catch (err) {
            if (controller.signal.aborted) {
                setStatus('idle')
                return
            }
            setErrorMessage('The connection was interrupted. Try again in a moment.')
            setStatus('error')
            return
        } finally {
            abortRef.current = null
        }

        // If the stream ended without a hatch.complete frame, treat it as an
        // error so the UI offers a retry path. (The backend always emits one
        // on happy path — this is purely defensive.)
        setStatus((prev) => {
            if (prev !== 'streaming') return prev
            setErrorMessage((m) => m || 'The ceremony ended unexpectedly. Try again in a moment.')
            return 'error'
        })
    }, [status, token, apiBase, reset, applyEvent])

    return {
        status,
        events,
        steps,
        stepOrder,
        certificate,
        complete,
        errorMessage,
        start,
        cancel,
        reset,
    }
}
