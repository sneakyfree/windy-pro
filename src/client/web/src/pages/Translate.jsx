import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Dashboard.css'

const POPULAR_LANGS = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'fr', name: 'French', flag: '🇫🇷' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
    { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
    { code: 'ko', name: 'Korean', flag: '🇰🇷' },
    { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
    { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
    { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
    { code: 'ru', name: 'Russian', flag: '🇷🇺' },
    { code: 'it', name: 'Italian', flag: '🇮🇹' },
    { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
    { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
    { code: 'th', name: 'Thai', flag: '🇹🇭' },
    { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
    { code: 'pl', name: 'Polish', flag: '🇵🇱' },
    { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
    { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
    { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
]

function getUser() {
    try { return JSON.parse(localStorage.getItem('windy_user')) } catch { return null }
}

export default function Translate() {
    const [sourceLang, setSourceLang] = useState('en')
    const [targetLang, setTargetLang] = useState('es')
    const [inputText, setInputText] = useState('')
    const [messages, setMessages] = useState([])
    const [translating, setTranslating] = useState(false)
    const [apiStatus, setApiStatus] = useState('checking')
    const chatEndRef = useRef(null)
    const user = getUser()
    const navigate = useNavigate()

    // Check translate API health on mount
    useEffect(() => {
        fetch('/health')
            .then(r => r.ok ? r.json() : null)
            .then(data => setApiStatus(data?.worker === 'ready' ? 'ready' : data ? 'loading' : 'offline'))
            .catch(() => setApiStatus('offline'))
    }, [])

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const handleTranslate = async (e) => {
        e.preventDefault()
        const text = inputText.trim()
        if (!text || translating) return

        // Add source message
        const sourceMsg = {
            id: Date.now(),
            text,
            lang: sourceLang,
            flag: POPULAR_LANGS.find(l => l.code === sourceLang)?.flag || '🌐',
            side: 'left',
            translatedText: null
        }
        setMessages(prev => [...prev, sourceMsg])
        setInputText('')
        setTranslating(true)

        try {
            const res = await fetch('/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, sourceLang, targetLang })
            })

            if (!res.ok) throw new Error('Translation failed')
            const data = await res.json()

            // Add translated message
            const transMsg = {
                id: Date.now() + 1,
                text: data.translated,
                lang: targetLang,
                flag: POPULAR_LANGS.find(l => l.code === targetLang)?.flag || '🌐',
                side: 'right',
                cached: data.cached,
                originalText: text
            }
            setMessages(prev => [...prev, transMsg])
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                text: `Translation error: ${err.message}`,
                lang: 'error',
                flag: '⚠️',
                side: 'right',
                isError: true
            }])
        } finally {
            setTranslating(false)
        }
    }

    const swapLanguages = () => {
        setSourceLang(targetLang)
        setTargetLang(sourceLang)
    }

    const clearChat = () => setMessages([])

    const copyMessage = async (text) => {
        await navigator.clipboard.writeText(text)
    }

    const exportConversation = () => {
        if (messages.length === 0) return
        const text = messages.map(m => {
            const lang = POPULAR_LANGS.find(l => l.code === m.lang)?.name || m.lang
            return `[${lang}] ${m.text}`
        }).join('\n\n')
        const blob = new Blob([text], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `windy-translate-${new Date().toISOString().slice(0, 10)}.txt`
        a.click()
        URL.revokeObjectURL(url)
    }

    const speakText = (text, langCode) => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel()
            const u = new SpeechSynthesisUtterance(text)
            u.lang = langCode
            u.rate = 0.9
            window.speechSynthesis.speak(u)
        }
    }

    const handleSignOut = () => {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/')
    }

    return (
        <div className="dashboard">
            {/* Header */}
            <header className="dash-header">
                <div className="dash-header-left">
                    <Link to="/" className="dash-logo">
                        <span className="dash-logo-icon">🌪️</span> Windy Pro
                    </Link>
                </div>
                <div className="dash-header-right">
                    <Link to="/dashboard" className="dash-btn" style={{ borderColor: '#22C55E', color: '#22C55E', textDecoration: 'none' }}>
                        📊 Dashboard
                    </Link>
                    <div className="dash-user">
                        <div className="dash-avatar">{user?.name?.[0]?.toUpperCase() || '?'}</div>
                    </div>
                    <button className="dash-logout" onClick={handleSignOut}>Sign Out</button>
                </div>
            </header>

            {/* Language Selectors */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '16px', padding: '16px', flexWrap: 'wrap'
            }}>
                <select
                    value={sourceLang}
                    onChange={e => setSourceLang(e.target.value)}
                    style={{
                        background: '#1E293B', color: '#E2E8F0', border: '1px solid #334155',
                        borderRadius: '8px', padding: '10px 16px', fontSize: '15px', cursor: 'pointer'
                    }}
                >
                    {POPULAR_LANGS.map(l => (
                        <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
                    ))}
                </select>

                <button
                    onClick={swapLanguages}
                    style={{
                        background: 'transparent', border: '1px solid #334155', borderRadius: '50%',
                        width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px',
                        color: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title="Swap languages"
                >
                    ⇄
                </button>

                <select
                    value={targetLang}
                    onChange={e => setTargetLang(e.target.value)}
                    style={{
                        background: '#1E293B', color: '#E2E8F0', border: '1px solid #334155',
                        borderRadius: '8px', padding: '10px 16px', fontSize: '15px', cursor: 'pointer'
                    }}
                >
                    {POPULAR_LANGS.map(l => (
                        <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
                    ))}
                </select>

                <span style={{
                    fontSize: '11px', padding: '4px 10px', borderRadius: '12px',
                    background: apiStatus === 'ready' ? '#064E3B' : apiStatus === 'loading' ? '#78350F' : '#7F1D1D',
                    color: apiStatus === 'ready' ? '#34D399' : apiStatus === 'loading' ? '#FCD34D' : '#FCA5A5'
                }}>
                    {apiStatus === 'ready' ? '● Model Ready' : apiStatus === 'loading' ? '◌ Loading Model...' : '✕ Offline'}
                </span>
            </div>

            {/* Chat Area */}
            <div className="dash-main" style={{ maxWidth: '800px', margin: '0 auto', padding: '0 16px' }}>
                <div style={{
                    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px',
                    minHeight: '400px', maxHeight: '60vh', padding: '16px 0'
                }}>
                    {messages.length === 0 ? (
                        <div className="dash-empty" style={{ padding: '60px 20px' }}>
                            <div className="dash-empty-icon">🌍</div>
                            <h3>Conversation Mode</h3>
                            <p>Type a message below to translate it in real-time. Both speakers see the conversation in their own language.</p>
                        </div>
                    ) : (
                        messages.map(msg => (
                            <div
                                key={msg.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: msg.side === 'left' ? 'flex-start' : 'flex-end',
                                    width: '100%'
                                }}
                            >
                                <div
                                    onClick={() => copyMessage(msg.text)}
                                    title="Click to copy"
                                    style={{
                                        maxWidth: '75%',
                                        padding: '12px 16px',
                                        borderRadius: msg.side === 'left' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                                        background: msg.isError ? '#7F1D1D' :
                                            msg.side === 'left' ? '#1E293B' : '#064E3B',
                                        border: `1px solid ${msg.isError ? '#991B1B' :
                                            msg.side === 'left' ? '#334155' : '#065F46'}`,
                                        cursor: 'pointer',
                                        transition: 'opacity 0.2s'
                                    }}
                                >
                                    <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>{msg.flag} {POPULAR_LANGS.find(l => l.code === msg.lang)?.name || msg.lang}</span>
                                        {msg.cached && <span style={{ color: '#6366F1' }}>⚡ cached</span>}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); speakText(msg.text, msg.lang); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '0', marginLeft: 'auto' }}
                                            title="Listen"
                                        >🔊</button>
                                    </div>
                                    <div style={{ color: '#E2E8F0', fontSize: '15px', lineHeight: '1.5' }}>
                                        {msg.text}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    {translating && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                            <div style={{
                                padding: '12px 20px', borderRadius: '16px 4px 16px 16px',
                                background: '#064E3B', border: '1px solid #065F46'
                            }}>
                                <span style={{ color: '#34D399', animation: 'pulse 1.5s infinite' }}>Translating...</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Bar */}
                <form onSubmit={handleTranslate} style={{
                    display: 'flex', gap: '8px', padding: '12px 0', borderTop: '1px solid #1E293B'
                }}>
                    <input
                        type="text"
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        placeholder={`Type in ${POPULAR_LANGS.find(l => l.code === sourceLang)?.name || sourceLang}...`}
                        disabled={translating || apiStatus === 'offline'}
                        style={{
                            flex: 1, background: '#0F172A', color: '#E2E8F0',
                            border: '1px solid #334155', borderRadius: '12px',
                            padding: '12px 16px', fontSize: '15px', outline: 'none'
                        }}
                    />
                    <button
                        type="submit"
                        disabled={translating || !inputText.trim() || apiStatus === 'offline'}
                        style={{
                            background: '#22C55E', color: '#000', border: 'none',
                            borderRadius: '12px', padding: '12px 24px', fontSize: '15px',
                            fontWeight: '700', cursor: 'pointer', opacity: translating ? 0.5 : 1
                        }}
                    >
                        {translating ? '...' : '→'}
                    </button>
                    <button
                        type="button"
                        onClick={clearChat}
                        style={{
                            background: 'transparent', color: '#64748B', border: '1px solid #334155',
                            borderRadius: '12px', padding: '12px', cursor: 'pointer', fontSize: '14px'
                        }}
                        title="Clear conversation"
                    >
                        🗑️
                    </button>
                    {messages.length > 0 && (
                        <button
                            type="button"
                            onClick={exportConversation}
                            style={{
                                background: 'transparent', color: '#64748B', border: '1px solid #334155',
                                borderRadius: '12px', padding: '12px', cursor: 'pointer', fontSize: '14px'
                            }}
                            title="Export conversation"
                        >
                            📥
                        </button>
                    )}
                </form>
            </div>
        </div>
    )
}
