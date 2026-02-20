import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Transcribe.css'

export default function Transcribe() {
    const [isRecording, setIsRecording] = useState(false)
    const [state, setState] = useState('idle') // idle | listening | buffering | error
    const [segments, setSegments] = useState([])
    const [audioLevel, setAudioLevel] = useState(0)
    const [connected, setConnected] = useState(false)
    const [sessionStart, setSessionStart] = useState(null)
    const [elapsed, setElapsed] = useState(0)
    const [copyMsg, setCopyMsg] = useState('')
    const [reconnectCount, setReconnectCount] = useState(0)
    const navigate = useNavigate()

    const wsRef = useRef(null)
    const mediaStreamRef = useRef(null)
    const audioContextRef = useRef(null)
    const transcriptRef = useRef(null)

    // Connect to cloud WebSocket (first-message auth)
    const connect = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const token = localStorage.getItem('windy_token')
        const ws = new WebSocket(`${protocol}://${window.location.host}/ws/transcribe`)

        ws.onopen = () => {
            // Send auth as first message (token never in URL)
            if (token) {
                ws.send(JSON.stringify({ action: 'auth', token }))
            }
            setConnected(true)
            console.log('[Cloud] WebSocket connected, auth sent')
        }

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data)

                if (msg.type === 'error' && msg.message?.includes('token')) {
                    // Auth failure — redirect to login
                    localStorage.removeItem('windy_token')
                    navigate('/auth')
                    return
                }

                if (msg.type === 'state') {
                    setState(msg.state)
                } else if (msg.type === 'transcript') {
                    setSegments(prev => {
                        // Replace partial segment or add new
                        if (msg.is_partial) {
                            const existing = prev.findIndex(s => s.isPartial)
                            if (existing >= 0) {
                                const updated = [...prev]
                                updated[existing] = { ...msg, isPartial: true }
                                return updated
                            }
                            return [...prev, { ...msg, isPartial: true }]
                        }
                        // Finalized: remove partials, add finalized
                        return [...prev.filter(s => !s.isPartial), { ...msg, isPartial: false }]
                    })
                }
            } catch (e) { }
        }

        ws.onclose = () => {
            setConnected(false)
            setReconnectCount(prev => prev + 1)
            setTimeout(connect, 3000)
        }

        wsRef.current = ws
    }, [navigate])

    useEffect(() => {
        connect()
        return () => wsRef.current?.close()
    }, [connect])

    // Auto-scroll transcript
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
        }
    }, [segments])

    // Session timer
    useEffect(() => {
        if (!sessionStart) return
        const id = setInterval(() => {
            setElapsed(Math.floor((Date.now() - sessionStart) / 1000))
        }, 1000)
        return () => clearInterval(id)
    }, [sessionStart])

    // Start audio capture
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
            })
            mediaStreamRef.current = stream

            const audioCtx = new AudioContext({ sampleRate: 16000 })
            audioContextRef.current = audioCtx
            const source = audioCtx.createMediaStreamSource(stream)
            const processor = audioCtx.createScriptProcessor(4096, 1, 1)

            processor.onaudioprocess = (e) => {
                const float32 = e.inputBuffer.getChannelData(0)

                // Audio level
                let sum = 0
                for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i]
                setAudioLevel(Math.sqrt(sum / float32.length))

                // Convert to Int16 PCM
                const int16 = new Int16Array(float32.length)
                for (let i = 0; i < float32.length; i++) {
                    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768))
                }

                // Stream to server
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(int16.buffer)
                }
            }

            source.connect(processor)
            processor.connect(audioCtx.destination)

            // Resume AudioContext for Chrome autoplay policy
            if (audioCtx.state === 'suspended') await audioCtx.resume()

            // Tell server to start
            wsRef.current?.send(JSON.stringify({ action: 'start' }))
            setIsRecording(true)
            setSessionStart(Date.now())
        } catch (err) {
            setState('error')
            console.error('[Audio] Mic access denied:', err)
        }
    }

    const stopRecording = () => {
        // Stop audio
        mediaStreamRef.current?.getTracks().forEach(t => t.stop())
        audioContextRef.current?.close()
        setAudioLevel(0)

        // Tell server to stop
        wsRef.current?.send(JSON.stringify({ action: 'stop' }))
        setIsRecording(false)
        setSessionStart(null)
        setElapsed(0)
    }

    const clearTranscript = () => setSegments([])

    const copyTranscript = () => {
        const text = segments.map(s => s.text).join(' ')
        navigator.clipboard.writeText(text)
        setCopyMsg('Copied!')
        setTimeout(() => setCopyMsg(''), 2000)
    }

    const wordCount = segments.filter(s => !s.isPartial).reduce((n, s) => n + (s.text?.trim().split(/\s+/).length || 0), 0)

    const formatTime = (seconds) => {
        if (!seconds) return '0:00'
        const m = Math.floor(seconds / 60)
        const s = Math.floor(seconds % 60)
        return `${m}:${s.toString().padStart(2, '0')}`
    }

    const handleLogout = () => {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/auth')
    }

    return (
        <div className="transcribe-page">
            {/* Top bar */}
            <nav className="transcribe-nav">
                <Link to="/" className="transcribe-back">← Windy Pro</Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className={`connection-dot ${connected ? 'connected' : ''}`}></div>
                    <button onClick={handleLogout} className="btn-logout">Logout</button>
                </div>
            </nav>

            {/* State indicator */}
            <div className={`state-bar state-${state}`}>
                <div className="state-dot"></div>
                <span className="state-label">{state.toUpperCase()}</span>
                {isRecording && (
                    <>
                        <span className="session-timer">{formatTime(elapsed)}</span>
                        <div className="audio-meter">
                            <div className="audio-meter-fill" style={{ width: `${Math.min(audioLevel * 400, 100)}%` }}></div>
                        </div>
                    </>
                )}
                {wordCount > 0 && <span className="word-count">{wordCount} words</span>}
            </div>

            {/* Transcript area */}
            <div className="transcript-area" ref={transcriptRef}>
                {segments.length === 0 ? (
                    <div className="transcript-empty">
                        <div className="transcript-empty-icon">🎙️</div>
                        <h3>Ready to transcribe</h3>
                        <p>Click the record button below to start. Your audio streams to the cloud and text appears here in real-time.</p>
                    </div>
                ) : (
                    segments.map((seg, i) => (
                        <div key={i} className={`segment ${seg.isPartial ? 'partial' : ''}`}>
                            <span className="segment-time">[{formatTime(seg.start_time)}]</span>
                            <span className="segment-text">{seg.text}</span>
                        </div>
                    ))
                )}
            </div>

            {/* Control bar */}
            <div className="control-bar">
                <button className="ctrl-btn" onClick={clearTranscript} title="Clear">
                    🗑️
                </button>
                <button
                    className={`record-btn ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={!connected}
                >
                    {isRecording ? '⏹' : '🎙️'}
                </button>
                <button className="ctrl-btn" onClick={copyTranscript} title="Copy All">
                    {copyMsg || '📋'}
                </button>
            </div>
        </div>
    )
}
