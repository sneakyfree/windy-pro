/**
 * useVoiceDispatch — React hook wrapping the voice-dispatch protocol.
 *
 * Two-stage flow per docs/VOICE_DISPATCH_PROTOCOL.md:
 *   1. POST /api/v1/voice/dispatch with { text, context? } → returns
 *      { task_id, transcript, stream_url }.
 *   2. GET stream_url as SSE → events: dispatched | thinking | response |
 *      done | failed | scaffold_mode.
 *
 * Why fetch+ReadableStream instead of EventSource: native EventSource is
 * GET-only and crucially does NOT support custom headers, so the Bearer
 * JWT we use everywhere else can't be attached. Mirrors the same shim
 * used by useHatchStream.
 *
 * Status state machine:
 *   'idle' → 'dispatching' → 'streaming' → 'done' | 'failed' | 'scaffold'
 *
 * On 'done' the stream closes itself; on reconnect (rare in v0 but
 * supported by the backend), the same task_id replays cached events
 * with replayed:true on the terminal frame.
 */
import { useCallback, useRef, useState } from 'react'

function parseSseFrame(frame) {
    if (!frame || frame.startsWith(':')) return null // heartbeat
    let event = 'message'
    let data = ''
    for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data = line.slice(5).trim()
    }
    if (!data) return null
    try {
        return { event, data: JSON.parse(data) }
    } catch {
        return { event, data }
    }
}

export default function useVoiceDispatch({ token, apiBase = '/api/v1' } = {}) {
    const [status, setStatus] = useState('idle')
    const [taskId, setTaskId] = useState(null)
    const [transcript, setTranscript] = useState('')
    const [events, setEvents] = useState([])
    const [response, setResponse] = useState(null)
    const [errorMessage, setErrorMessage] = useState(null)
    const abortRef = useRef(null)

    const cancel = useCallback(() => {
        try {
            abortRef.current?.abort()
        } catch {
            /* noop */
        }
        abortRef.current = null
    }, [])

    const reset = useCallback(() => {
        cancel()
        setStatus('idle')
        setTaskId(null)
        setTranscript('')
        setEvents([])
        setResponse(null)
        setErrorMessage(null)
    }, [cancel])

    const dispatch = useCallback(
        async ({ text, context = {} }) => {
            if (!token) {
                setErrorMessage('You need to be signed in to use voice.')
                setStatus('failed')
                return
            }
            if (!text || !text.trim()) {
                setErrorMessage('Say or type something first.')
                setStatus('failed')
                return
            }

            reset()
            setStatus('dispatching')

            // Stage 1: POST /dispatch
            let dispatchResp
            try {
                dispatchResp = await fetch(`${apiBase}/voice/dispatch`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ text: text.trim(), context }),
                })
            } catch {
                setErrorMessage("We couldn't reach our servers. Check your internet and try again.")
                setStatus('failed')
                return
            }

            if (dispatchResp.status === 429) {
                setErrorMessage("Too many voice commands at once. Wait a moment and try again.")
                setStatus('failed')
                return
            }
            if (dispatchResp.status === 401) {
                setErrorMessage('Your session expired. Please sign in again.')
                setStatus('failed')
                return
            }
            if (!dispatchResp.ok) {
                let detail = ''
                try {
                    const body = await dispatchResp.json()
                    detail = body?.error || ''
                } catch {
                    /* noop */
                }
                setErrorMessage(detail || 'Voice dispatch failed. Try again in a moment.')
                setStatus('failed')
                return
            }

            const { task_id, transcript: t, stream_url } = await dispatchResp.json()
            setTaskId(task_id)
            setTranscript(t || text.trim())
            setStatus('streaming')

            // Stage 2: SSE stream
            const controller = new AbortController()
            abortRef.current = controller

            let streamResp
            try {
                streamResp = await fetch(stream_url, {
                    method: 'GET',
                    headers: {
                        Accept: 'text/event-stream',
                        Authorization: `Bearer ${token}`,
                    },
                    signal: controller.signal,
                })
            } catch (err) {
                if (controller.signal.aborted) {
                    setStatus('idle')
                    return
                }
                setErrorMessage('Lost connection to the agent. Try again.')
                setStatus('failed')
                return
            }

            if (!streamResp.ok || !streamResp.body) {
                setErrorMessage('Could not subscribe to the agent stream.')
                setStatus('failed')
                return
            }

            const reader = streamResp.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buf += decoder.decode(value, { stream: true })
                    const frames = buf.split('\n\n')
                    buf = frames.pop() || ''
                    for (const frame of frames) {
                        const parsed = parseSseFrame(frame)
                        if (!parsed) continue
                        setEvents((prev) => [...prev, parsed])
                        if (parsed.event === 'response') {
                            setResponse(parsed.data?.text || '')
                        } else if (parsed.event === 'done') {
                            setStatus(parsed.data?.scaffold ? 'scaffold' : 'done')
                        } else if (parsed.event === 'failed') {
                            setErrorMessage(parsed.data?.error || 'The agent failed to complete.')
                            setStatus('failed')
                        } else if (parsed.event === 'scaffold_mode') {
                            // Don't mark failed — the v0 backend uses this to
                            // signal "agent offline, no real work happened."
                            // We'll let the subsequent 'done' transition.
                        }
                    }
                }
            } catch (err) {
                if (controller.signal.aborted) {
                    setStatus('idle')
                    return
                }
                setErrorMessage('The connection dropped mid-task. Try again.')
                setStatus('failed')
            } finally {
                abortRef.current = null
            }
        },
        [apiBase, reset, token],
    )

    return {
        status,
        taskId,
        transcript,
        events,
        response,
        errorMessage,
        dispatch,
        cancel,
        reset,
    }
}
