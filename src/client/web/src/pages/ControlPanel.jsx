import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import EchoHQView from '../components/control-panel/EchoHQView'
import AlphaPanelView from '../components/control-panel/AlphaPanelView'
import './ControlPanel.css'

// View registry — adding a new view = (a) write the component, (b) add row here.
// Future views can be added without touching the picker logic.
const VIEW_REGISTRY = [
    {
        key: 'echo_hq',
        label: 'Echo HQ',
        tagline: 'Real-time vitals + kit-army roll call + Echo\'s prose log',
        accent: '#00b4ff',
        component: EchoHQView,
    },
    {
        key: 'alpha_panel',
        label: 'Alpha Control Panel',
        tagline: 'Identity matrix + machine vitals + CPU core map',
        accent: '#ffd700',
        component: AlphaPanelView,
    },
    // Placeholders for "more views later" — render disabled cards in the picker
    // so the user can see what's coming without clicking through to a stub.
    {
        key: 'compact',
        label: 'Compact Strip',
        tagline: 'Single-row vitals for dashboard embedding',
        accent: '#00ff88',
        component: null,
        comingSoon: true,
    },
    {
        key: 'fleet',
        label: 'Fleet Mosaic',
        tagline: 'All kit-army machines at a glance',
        accent: '#ff6ec7',
        component: null,
        comingSoon: true,
    },
]

const STORAGE_KEY = 'windy_control_panel_view'

export default function ControlPanel() {
    // Remember the last view across reloads. Default = no view chosen → picker.
    const [selectedKey, setSelectedKey] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
    })

    useEffect(() => {
        if (selectedKey) {
            try { localStorage.setItem(STORAGE_KEY, selectedKey) } catch {}
        }
    }, [selectedKey])

    const selected = VIEW_REGISTRY.find(v => v.key === selectedKey && v.component)

    if (selected) {
        const ViewComponent = selected.component
        return (
            <div className="cp-shell">
                <div className="cp-shell-topbar">
                    <Link to="/dashboard" className="cp-link">← Dashboard</Link>
                    <span className="cp-view-switcher-label">View:</span>
                    <select
                        className="cp-view-switcher"
                        value={selected.key}
                        onChange={(e) => setSelectedKey(e.target.value)}
                    >
                        {VIEW_REGISTRY.filter(v => v.component).map(v => (
                            <option key={v.key} value={v.key}>{v.label}</option>
                        ))}
                    </select>
                    <button
                        className="cp-link cp-link-btn"
                        onClick={() => setSelectedKey(null)}
                    >
                        All views
                    </button>
                </div>
                <ViewComponent />
            </div>
        )
    }

    return (
        <div className="cp-picker">
            <div className="cp-picker-header">
                <Link to="/dashboard" className="cp-link">← Dashboard</Link>
                <h1 className="cp-picker-title">Control Panel</h1>
                <p className="cp-picker-subtitle">
                    Pick a view. More layouts coming.
                </p>
            </div>

            <div className="cp-picker-grid">
                {VIEW_REGISTRY.map(v => (
                    <button
                        key={v.key}
                        className={`cp-picker-card ${v.comingSoon ? 'cp-picker-card-soon' : ''}`}
                        style={{ '--accent': v.accent }}
                        onClick={() => v.component && setSelectedKey(v.key)}
                        disabled={v.comingSoon}
                    >
                        <div className="cp-picker-card-accent" />
                        <div className="cp-picker-card-label">{v.label}</div>
                        <div className="cp-picker-card-tagline">{v.tagline}</div>
                        {v.comingSoon && (
                            <div className="cp-picker-card-badge">Coming soon</div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    )
}
