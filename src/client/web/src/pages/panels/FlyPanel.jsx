import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PRESETS, EMPTY_STATES } from '../../lib/panelContract'
import { getPanelSummary, getSlidersInfo, putSlider, getPersonalityHistory } from '../../lib/flyPanelApi'

/**
 * Windy Fly panel — grandma's control panel for her agent (windy.panel.v1).
 *
 * The sliders are the star: they're how she edits her agent's soul without
 * touching markdown. Everything is capability-driven off /summary — sections
 * whose capability the agent doesn't have render an honest empty state
 * (never a broken panel, never a spinner that can't resolve).
 */

const STATUS_UI = {
    alive: { label: 'Awake', badge: 'badge-active', help: 'is awake and answering messages.' },
    sleeping: { label: 'Resting', badge: 'badge-offline', help: 'is resting right now — your settings still save and apply the moment it wakes.' },
    unknown: { label: 'Status unknown', badge: 'badge-offline', help: 'didn’t answer our status check — your settings still save.' },
}

const TABS = [
    { id: 'personality', label: 'Personality' },
    { id: 'memory', label: 'Memory' },
    { id: 'skills', label: 'Skills' },
    { id: 'costs', label: 'Costs' },
]

function presetFor(sliders) {
    for (const [name, values] of Object.entries(PRESETS)) {
        if (Object.keys(values).every(k => (sliders[k] ?? 5) === values[k])) return name
    }
    return 'custom'
}

export default function FlyPanel() {
    const navigate = useNavigate()
    const [summary, setSummary] = useState(null)
    // 'loading' | 'ready' | 'no_agent' | 'error'
    const [phase, setPhase] = useState('loading')
    const [info, setInfo] = useState({})
    const [sliders, setSliders] = useState({})
    const [saving, setSaving] = useState(null)
    const [history, setHistory] = useState([])
    const [toast, setToast] = useState(null)
    const [tab, setTab] = useState('personality')
    const toastTimer = useRef(null)

    const showToast = useCallback((message) => {
        setToast(message)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 4000)
    }, [])

    const refreshHistory = useCallback((capabilities) => {
        if (!capabilities?.includes('personality.history')) return
        getPersonalityHistory(8).then(({ status, data }) => {
            if (status === 200 && Array.isArray(data?.history)) setHistory(data.history)
        })
    }, [])

    useEffect(() => {
        let cancelled = false
        getPanelSummary().then(({ status, data }) => {
            if (cancelled) return
            if (status === 200 && data?.contract === 'windy.panel.v1') {
                setSummary(data)
                setSliders(data.personality?.sliders || {})
                setPhase('ready')
                getSlidersInfo().then(({ status: s2, data: d2 }) => {
                    if (!cancelled && s2 === 200 && d2?.sliders) setInfo(d2.sliders)
                })
                refreshHistory(data.capabilities)
            } else if (status === 404 && data?.error === 'no_agent') {
                setPhase('no_agent')
            } else {
                setPhase('error')
            }
        })
        return () => { cancelled = true; clearTimeout(toastTimer.current) }
    }, [refreshHistory])

    const capabilities = summary?.capabilities || []
    const agent = summary?.agent
    const agentName = agent?.agent_name || 'your agent'

    const handleChange = useCallback(async (name, value, updatedBy) => {
        let previous
        setSliders(prev => { previous = prev[name] ?? 5; return { ...prev, [name]: value } })
        setSaving(name)
        const { status } = await putSlider(name, value, updatedBy)
        setSaving(s => (s === name ? null : s))
        if (status !== 200) {
            // Honest failure: revert the slider and say so (the old dashboard
            // swallowed this silently — a lie grandma can't debug).
            setSliders(prev => ({ ...prev, [name]: previous }))
            showToast(`Couldn't save ${(info[name]?.label || name)} — please try again.`)
            return false
        }
        refreshHistory(capabilities)
        return true
    }, [info, showToast, refreshHistory, capabilities])

    const applyPreset = useCallback(async (preset) => {
        const values = PRESETS[preset]
        if (!values) return
        for (const [name, value] of Object.entries(values)) {
            // Sequential PUTs, same as the local gateway's save flow.
            await handleChange(name, value, `preset:${preset}`)
        }
        showToast(`${agentName} is now in ${preset} mode.`)
    }, [handleChange, showToast, agentName])

    // ── Loading ──
    if (phase === 'loading') {
        return (
            <div className="panel">
                <PanelHeader />
                <div className="panel-card"><p style={{ color: '#64748B', fontSize: 14 }}>Checking on your agent…</p></div>
            </div>
        )
    }

    // ── No agent yet: hatch CTA (mirrors the mobile fly-tab state) ──
    if (phase === 'no_agent') {
        return (
            <div className="panel">
                <PanelHeader />
                <div className="panel-card">
                    <div className="panel-card-title">No agent yet</div>
                    <p style={{ fontSize: 14, color: '#94A3B8', margin: '8px 0 16px' }}>
                        You haven't hatched an agent yet. It takes about a minute — you pick a name, we do the rest.
                    </p>
                    <button className="panel-btn" onClick={() => navigate('/hatch')}>Hatch my agent</button>
                </div>
            </div>
        )
    }

    // ── Panel unreachable: honest error, never a broken panel ──
    if (phase === 'error') {
        return (
            <div className="panel">
                <PanelHeader />
                <div className="panel-card">
                    <div className="panel-card-title">Control panel unreachable</div>
                    <p style={{ fontSize: 14, color: '#94A3B8', margin: '8px 0 16px' }}>
                        We couldn't reach your agent's control panel just now. Your agent itself may be fine — try again in a moment.
                    </p>
                    <button className="panel-btn panel-btn-secondary" onClick={() => window.location.reload()}>Try again</button>
                </div>
            </div>
        )
    }

    const status = STATUS_UI[agent?.status] || STATUS_UI.unknown
    const currentPreset = presetFor(sliders)

    return (
        <div className="panel">
            <PanelHeader subtitle={`${agentName} — settings & soul`} />

            {/* Status card */}
            <div className="panel-card">
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="panel-stat">
                        <span className="panel-stat-value">{agentName}</span>
                    </div>
                    <span className={`panel-badge ${status.badge}`}>{status.label}</span>
                    {agent?.passport_number && (
                        <span style={{ fontSize: 12, color: '#64748B', fontFamily: 'monospace' }}>{agent.passport_number}</span>
                    )}
                </div>
                <p style={{ fontSize: 13, color: '#64748B', marginTop: 8 }}>
                    {agentName} {status.help}
                    {' '}Want to talk? <button className="fly-link" onClick={() => navigate('/app/chat')}>Open the Chat tab</button>.
                </p>
            </div>

            {/* Tabs */}
            <div className="fly-tabs">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className={`fly-tab ${tab === t.id ? 'fly-tab-active' : ''}`}
                        onClick={() => setTab(t.id)}
                    >{t.label}</button>
                ))}
            </div>

            {tab === 'personality' && (capabilities.includes('sliders') ? (
                <>
                    {/* Preset chips — the one-tap way to set a whole personality */}
                    <div className="panel-card">
                        <div className="panel-card-title">Personality presets</div>
                        <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 12px' }}>
                            One tap sets all the dials below. Move any dial afterwards to make it your own.
                        </p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {Object.keys(PRESETS).map(p => (
                                <button
                                    key={p}
                                    className={`fly-preset ${currentPreset === p ? 'fly-preset-active' : ''}`}
                                    onClick={() => applyPreset(p)}
                                >{p}</button>
                            ))}
                        </div>
                    </div>

                    {/* Sliders — render whatever /sliders/info returns */}
                    <div className="panel-card">
                        <div className="panel-card-title">Personality dials</div>
                        {Object.keys(info).length === 0 && (
                            <p style={{ color: '#64748B', fontSize: 13 }}>Loading the dials…</p>
                        )}
                        {Object.entries(info).map(([name, meta]) => {
                            const value = sliders[name] ?? meta.value ?? 5
                            return (
                                <div key={name} className="fly-slider-row">
                                    <div className="fly-slider-head">
                                        <span className="fly-slider-label">{meta.label || name.replace(/_/g, ' ')}</span>
                                        {saving === name && <span className="fly-saving">saving…</span>}
                                        <span className="fly-slider-value">{value}</span>
                                    </div>
                                    {meta.description && <p className="fly-slider-desc">{meta.description}</p>}
                                    <input
                                        type="range" min={0} max={10} step={1} value={value}
                                        aria-label={meta.label || name}
                                        onChange={e => handleChange(name, Number(e.target.value))}
                                        className="fly-slider"
                                    />
                                    <div className="fly-slider-ends">
                                        <span title={meta.impact_low}>{meta.impact_low}</span>
                                        <span title={meta.impact_high}>{meta.impact_high}</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Recent changes */}
                    {capabilities.includes('personality.history') && history.length > 0 && (
                        <div className="panel-card">
                            <div className="panel-card-title">Recent changes</div>
                            {history.map(h => (
                                <div key={h.id} className="fly-history-row">
                                    <span>{(info[h.key]?.label || h.key.replace(/_/g, ' '))}: {h.old_value ?? '—'} → {h.new_value}</span>
                                    <span className="fly-history-meta">
                                        {h.changed_by.startsWith('preset:') ? `${h.changed_by.slice(7)} preset` : 'you'}
                                        {' · '}{new Date(h.created_at).toLocaleString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <EmptyState text={EMPTY_STATES.local_only} />
            ))}

            {tab === 'memory' && (capabilities.includes('memory')
                ? null /* future: real memory view when the capability lights up */
                : <EmptyState title="Memory" text={EMPTY_STATES.memory} />)}
            {tab === 'skills' && (capabilities.includes('skills')
                ? null
                : <EmptyState title="Skills" text={EMPTY_STATES.skills} />)}
            {tab === 'costs' && (capabilities.includes('costs')
                ? null
                : <EmptyState title="Costs" text={EMPTY_STATES.costs} />)}

            {toast && <div className="fly-toast" role="status">{toast}</div>}
        </div>
    )
}

function PanelHeader({ subtitle }) {
    return (
        <div className="panel-header">
            <span className="panel-emoji">{'🪰'}</span>
            <div>
                <h1 className="panel-title">Windy Fly</h1>
                <p className="panel-subtitle">{subtitle || 'Your AI agent — its soul, in your hands'}</p>
            </div>
        </div>
    )
}

function EmptyState({ title, text }) {
    return (
        <div className="panel-card">
            {title && <div className="panel-card-title">{title}</div>}
            <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 8 }}>{text}</p>
        </div>
    )
}
