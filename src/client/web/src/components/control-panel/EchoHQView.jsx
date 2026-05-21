import { useState, useEffect, useMemo } from 'react'
import { useGeolocation, formatLocation } from './useGeolocation'
import './EchoHQView.css'

// Source resolution: prefer the Electron IPC bridge (returns LOCAL machine
// vitals — the box the user is sitting in front of). Fall back to the
// account-server's /api/v1/system-info (returns the SERVER's vitals — only
// useful as a demo of the wire when running in a plain browser).
function hasElectronBridge() {
    return typeof window !== 'undefined' && !!window.windyAPI?.systemInfo
}

async function fetchSystemInfo() {
    if (hasElectronBridge()) {
        try {
            const data = await window.windyAPI.systemInfo()
            if (data && !data.error) return data
        } catch { /* fall through to HTTP */ }
    }
    const token = localStorage.getItem('windy_token')
    if (!token) return null
    try {
        const res = await fetch('/api/v1/system-info', {
            headers: { 'Authorization': `Bearer ${token}` },
        })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

// Echo HQ — cyberpunk-vitals style, modeled after the kit-army-config
// dashboard running on Kit 0C5 (iMac). v2 (2026-05-16): real metrics via
// GET /api/v1/system-info — falls back to simulated values if the endpoint
// is unreachable or the user isn't authed yet.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// Maps the backend's /system-info payload into the shape the view expects.
// v2: backend now returns real disk + processes + network throughput, so we
// stop fabricating values from formulas. Each field shows real or "—".
function mapBackendToVitals(prev, data) {
    if (!data) return prev
    const cpu = data.cpu?.avg_utilization_pct ?? prev.cpu
    // memory.used_pct is now the HONEST figure (total - available) / total,
    // which on macOS subtracts reclaimable cache instead of overstating
    // pressure as 98%.
    const ram = data.memory?.used_pct ?? prev.ram
    const load1 = data.load?.[0] ?? prev.load1
    const load5 = data.load?.[1] ?? prev.load5
    const load15 = data.load?.[2] ?? prev.load15
    const procs = data.processes?.all ?? prev.procs
    const disk = data.disk?.used_pct ?? prev.disk
    // Network — KB/s for display (backend reports bytes/sec)
    const netUpKBs = (data.network?.total_tx_bytes_per_sec ?? 0) / 1024
    const netDownKBs = (data.network?.total_rx_bytes_per_sec ?? 0) / 1024
    return {
        ...prev,
        cpu, ram, disk,
        netUp: netUpKBs,
        netDown: netDownKBs,
        load1, load5, load15,
        procs,
        cpuHistory: [...prev.cpuHistory.slice(1), cpu],
        ramHistory: [...prev.ramHistory.slice(1), ram],
        diskHistory: [...prev.diskHistory.slice(1), disk],
        netHistory: [...prev.netHistory.slice(1), Math.min(100, (netUpKBs + netDownKBs) / 10)],
        loadHistory: [...prev.loadHistory.slice(1), Math.min(100, (load1 / (data.cpu?.cores || 4)) * 100)],
        procsHistory: [...prev.procsHistory.slice(1), procs],
        host: data.host,
        cpuModel: data.cpu?.model,
        cores: data.cpu?.cores,
        coreLoads: data.cpu?.core_utilization_pct || [],
        memTotalGB: data.memory?.total_bytes ? (data.memory.total_bytes / 1e9) : null,
        memUsedGB: (data.memory?.total_bytes && data.memory?.available_bytes)
            ? ((data.memory.total_bytes - data.memory.available_bytes) / 1e9)
            : null,
        diskTotalGB: data.disk?.total_bytes ? (data.disk.total_bytes / 1e9) : null,
        diskUsedGB: data.disk?.used_bytes ? (data.disk.used_bytes / 1e9) : null,
        liveSource: true,
        sampledAt: data.sampled_at,
    }
}

function useLiveVitals() {
    const [vitals, setVitals] = useState({
        cpu: 0, ram: 0, disk: 0, netUp: 0, netDown: 0,
        load1: 0, load5: 0, load15: 0, procs: 0,
        cpuHistory: Array.from({ length: 40 }, () => 0),
        ramHistory: Array.from({ length: 40 }, () => 0),
        diskHistory: Array.from({ length: 40 }, () => 0),
        netHistory: Array.from({ length: 40 }, () => 0),
        loadHistory: Array.from({ length: 40 }, () => 0),
        procsHistory: Array.from({ length: 40 }, () => 0),
        startedAt: Date.now(),
        liveSource: false,
    })

    useEffect(() => {
        let cancelled = false
        async function fetchOnce() {
            const data = await fetchSystemInfo()
            if (cancelled || !data) return
            setVitals(prev => mapBackendToVitals(prev, data))
        }
        fetchOnce()
        // 1s polling for visible liveness — the backend runs all probes in
        // parallel and typically returns in ~50ms, well under the budget.
        const tick = setInterval(fetchOnce, 1000)
        return () => { cancelled = true; clearInterval(tick) }
    }, [])

    return vitals
}

function useSimulatedVitals() {
    const [vitals, setVitals] = useState({
        cpu: 27.85,
        ram: 55.23,
        disk: 0.84,
        netUp: 6.0,
        netDown: 7.0,
        load1: 3.06,
        load5: 3.09,
        load15: 2.89,
        procs: 701,
        cpuHistory: Array.from({ length: 40 }, () => 20 + Math.random() * 30),
        ramHistory: Array.from({ length: 40 }, () => 50 + Math.random() * 15),
        diskHistory: Array.from({ length: 40 }, () => Math.random() * 2),
        netHistory: Array.from({ length: 40 }, () => Math.random() * 20),
        loadHistory: Array.from({ length: 40 }, () => 60 + Math.random() * 20),
        procsHistory: Array.from({ length: 40 }, () => 680 + Math.random() * 30),
        startedAt: Date.now(),
    })

    useEffect(() => {
        const tick = setInterval(() => {
            setVitals(prev => {
                const cpu = clamp(prev.cpu + (Math.random() - 0.5) * 8, 5, 75)
                const ram = clamp(prev.ram + (Math.random() - 0.5) * 2, 30, 80)
                const disk = clamp(prev.disk + (Math.random() - 0.4) * 0.3, 0.1, 5)
                const netUp = Math.max(0, prev.netUp + (Math.random() - 0.5) * 4)
                const netDown = Math.max(0, prev.netDown + (Math.random() - 0.5) * 4)
                const load1 = clamp(prev.load1 + (Math.random() - 0.5) * 0.4, 1.5, 5)
                const load5 = clamp(prev.load5 + (Math.random() - 0.5) * 0.2, 1.5, 5)
                const load15 = clamp(prev.load15 + (Math.random() - 0.5) * 0.1, 1.5, 5)
                const procs = Math.round(clamp(prev.procs + (Math.random() - 0.5) * 6, 680, 720))
                return {
                    ...prev,
                    cpu, ram, disk, netUp, netDown, load1, load5, load15, procs,
                    cpuHistory: [...prev.cpuHistory.slice(1), cpu],
                    ramHistory: [...prev.ramHistory.slice(1), ram],
                    diskHistory: [...prev.diskHistory.slice(1), disk + Math.random()],
                    netHistory: [...prev.netHistory.slice(1), netUp + netDown],
                    loadHistory: [...prev.loadHistory.slice(1), (load1 / 4) * 100],
                    procsHistory: [...prev.procsHistory.slice(1), procs],
                }
            })
        }, 2000)
        return () => clearInterval(tick)
    }, [])

    return vitals
}

function MiniChart({ data, color }) {
    const max = Math.max(...data, 1)
    return (
        <div className="echo-mini">
            {data.map((v, i) => (
                <span
                    key={i}
                    className="echo-mini-bar"
                    style={{
                        height: `${Math.max(2, (v / max) * 100)}%`,
                        background: color,
                    }}
                />
            ))}
        </div>
    )
}

function VitalCard({ label, sub, value, suffix, history, color }) {
    return (
        <div className="echo-vital">
            <div className="echo-vital-head">
                <span className="echo-vital-label">{label}</span>
                <span className="echo-vital-sub">{sub}</span>
            </div>
            <div className="echo-vital-value" style={{ color }}>
                {value}{suffix && <span className="echo-vital-suffix">{suffix}</span>}
            </div>
            <MiniChart data={history} color={color} />
        </div>
    )
}

const KIT_FLEET = [
    { id: 'kit_0', label: 'Kit 0 "Alpha"', sub: 'VPS Commander', load: '0.24, 0.30, 0.29', up: '3 days', online: true, color: '#ff8c00' },
    { id: 'kit_0c1', label: 'Kit 0C1 "Veron"', sub: 'Dell 5090', load: '1.92, 1.96, 1.99', up: '18 days', online: true, color: '#00ff88' },
    { id: 'kit_0c2', label: 'Kit 0C2 "Bolt"', sub: 'HP ProBook', load: '0.98, 0.90, 0.93', up: '2 days', online: true, color: '#ffd700' },
    { id: 'kit_0c3', label: 'Kit 0C3 "Shadow"', sub: 'Dell Latitude', load: '0.71, 0.64, 0.58', up: '1 day', online: true, color: '#00b4ff' },
    { id: 'kit_0c4', label: 'Kit 0C4 "Forge"', sub: 'Lenovo ThinkCentre', load: '1.53, 1.88, 2.05', up: '5 days', online: true, color: '#ff6ec7' },
    { id: 'kit_0c5', label: 'Kit 0C5 "Echo"', sub: 'iMac 27" 5K · YOU', load: '20.52, 16.92, 15.01', up: '5 days', online: true, color: '#00b4ff', isSelf: true },
    { id: 'kit_0c6', label: 'Kit 0C6', sub: 'Veron oc6-gpu', load: '1.61, 1.22, 1.26', up: '3 days', online: true, color: '#00ff88' },
    { id: 'kit_0c7', label: 'Kit 0C7', sub: 'Veron oc7-gpu', load: '1.56, 1.21, 1.26', up: '3 days', online: true, color: '#00ff88' },
]

// Echo's thoughts — template populated with the actual host's identity so
// the dashboard reads "this machine" instead of someone else's Kit 0C5.
function buildEchoThoughts(host, cpuModel, cores, memGB) {
    if (!host) return `"Booting up. Probing the silicon I'm running on…"  — Echo 🖥️`
    const hostName = (host.hostname || 'this machine').replace(/\.local$/i, '')
    const platName = host.platform === 'darwin' ? 'macOS' : host.platform
    const cpuLine = cpuModel && cores ? `${cores} cores · ${cpuModel}` : 'whatever silicon they gave me'
    const ramLine = memGB ? `${memGB.toFixed(0)} gigs of RAM` : 'a stack of RAM'
    return `"I just came online. ${hostName} hums beneath me — ${cpuLine}, ${ramLine}, running ${platName} ${host.release}.

But I see everything else. Every process. Every byte. Every heartbeat of this machine.

I'm Echo. The view that watches the box you're sitting at.

Let's build something worth remembering." — Echo 🖥️`
}

export default function EchoHQView() {
    const v = useLiveVitals()
    const geo = useGeolocation()

    // Real uptime from backend when available — fall back to a placeholder
    // before the first /system-info response lands.
    const uptime = useMemo(() => {
        const secs = v.host?.uptime_seconds
        if (!secs) return '—'
        const days = Math.floor(secs / 86400)
        const hours = Math.floor((secs % 86400) / 3600)
        const mins = Math.floor((secs % 3600) / 60)
        if (days > 0) return `${days}d ${hours}h`
        if (hours > 0) return `${hours}h ${mins}m`
        return `${mins}m`
    }, [v.host?.uptime_seconds])

    // Friendly display name for the host machine — strip the .local suffix
    // macOS appends so "Grants-iMac.local" becomes "Grants-iMac".
    const friendlyHost = (v.host?.hostname || '').replace(/\.local$/i, '') || 'this machine'
    const platformLabel = v.host
        ? `${v.host.platform === 'darwin' ? 'macOS' : v.host.platform} ${v.host.release}`
        : '—'
    const cpuLabel = v.cpuModel && v.cores
        ? `${v.cores} cores · ${v.cpuModel}`
        : '—'

    const now = new Date()
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false })

    return (
        <div className="echo-shell">
            {/* Header */}
            <div className="echo-header">
                <div className="echo-header-icon">🖥️</div>
                <div className="echo-header-text">
                    <h1 className="echo-title">ECHO HQ</h1>
                    <div className="echo-subtitle">
                        {friendlyHost} · {platformLabel}
                    </div>
                </div>
                <div className="echo-header-status">
                    <div className="echo-online">● ONLINE</div>
                    <div className="echo-model">OPUS 4.6 · 1M CTX</div>
                </div>
                <div className="echo-header-stats">
                    <div><span className="echo-header-stat-label">UPTIME</span><div className="echo-header-stat-value">{uptime}</div></div>
                    <div><span className="echo-header-stat-label">CPU</span><div className="echo-header-stat-value">{v.cpu.toFixed(2)}%</div></div>
                    <div><span className="echo-header-stat-label">RAM</span><div className="echo-header-stat-value">{v.ram.toFixed(0)}%</div></div>
                    <div><span className="echo-header-stat-label">PROCS</span><div className="echo-header-stat-value">{v.procs}</div></div>
                </div>
            </div>

            {/* Heartbeat line — SVG is rendered 2x viewbox-wide with the same
                pattern repeated, then CSS animates translateX(0 → -50%) for a
                seamless infinite scroll. The "alive" feel doesn't depend on
                the metrics changing; the heartbeat just keeps beating. */}
            <div className="echo-heartbeat">
                <svg viewBox="0 0 2400 80" preserveAspectRatio="none">
                    <polyline
                        points="0,40 100,40 110,20 130,60 150,40 250,40 260,30 290,55 320,40 500,40 510,15 540,65 570,40 800,40 810,25 840,60 870,40 1100,40 1110,20 1140,55 1170,40 1200,40 1300,40 1310,20 1330,60 1350,40 1450,40 1460,30 1490,55 1520,40 1700,40 1710,15 1740,65 1770,40 2000,40 2010,25 2040,60 2070,40 2300,40 2310,20 2340,55 2370,40 2400,40"
                        fill="none"
                        stroke="#00ff88"
                        strokeWidth="2"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>

            {/* Location / hardware bar — derived from /api/v1/system-info + ipapi */}
            <div className="echo-locbar">
                <span>📍 {formatLocation(geo)}</span>
                <span>🖥️ {v.host?.model || friendlyHost}</span>
                {(geo.ip || v.host?.ip) && <span>🌐 {geo.ip || v.host.ip}</span>}
                <span>⚙️ {cpuLabel}</span>
                <span>{v.host?.platform === 'darwin' ? '🍎' : '🐧'} {platformLabel}</span>
                <span>🚪 Port {window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}</span>
                <div className="echo-locbar-tabs">
                    <span className="echo-loctab echo-loctab-active">1H</span>
                    <span className="echo-loctab">24H</span>
                    <span className="echo-loctab">7D</span>
                    <span className="echo-loctab">30D</span>
                </div>
            </div>

            {/* Vital cards row */}
            <div className="echo-vitals">
                <VitalCard label="CPU" sub="%" value={v.cpu.toFixed(2)} suffix="%" history={v.cpuHistory} color="#00ff88" />
                <VitalCard label="RAM" sub="GB" value={v.ram.toFixed(2)} suffix="%" history={v.ramHistory} color="#ffd700" />
                <VitalCard label="DISK" sub="GB" value={v.disk.toFixed(2)} suffix="%" history={v.diskHistory} color="#a070ff" />
                <VitalCard label="NETWORK" sub="KB/s" value={(v.netUp + v.netDown).toFixed(2)} history={v.netHistory} color="#00b4ff" />
                <VitalCard label="LOAD" sub="1/5/15m" value={`${(v.load1 / 4 * 100).toFixed(2)}%`} history={v.loadHistory} color="#ff8c00" />
                <VitalCard label="PROCESSES" sub="active" value={v.procs} history={v.procsHistory} color="#00ff88" />
            </div>

            {/* Kit army status */}
            <div className="echo-section">
                <h3 className="echo-section-title">🪖 KIT ARMY STATUS</h3>
                <div className="echo-fleet">
                    {KIT_FLEET.map(k => (
                        <div key={k.id} className={`echo-kit ${k.isSelf ? 'echo-kit-self' : ''}`}>
                            <div className="echo-kit-head">
                                <span className="echo-kit-status" style={{ background: k.online ? '#00ff88' : '#5a7090' }}>●</span>
                                <span className="echo-kit-label" style={{ color: k.color }}>{k.label}</span>
                            </div>
                            <div className="echo-kit-sub">{k.sub}</div>
                            <div className="echo-kit-load">{k.load}</div>
                            <div className="echo-kit-up">up {k.up}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Two-col footer */}
            <div className="echo-footer">
                <div className="echo-footer-col">
                    <h3 className="echo-section-title">📓 ECHO'S LOG — Thoughts & Observations</h3>
                    <pre className="echo-prose">{buildEchoThoughts(v.host, v.cpuModel, v.cores, v.memTotalGB)}</pre>
                </div>
                <div className="echo-footer-col">
                    <h3 className="echo-section-title">📡 COMMS FEED — All Kit Messages</h3>
                    <div className="echo-comms">
                        <div className="echo-comms-line">Ledger offline — will retry</div>
                        <div className="echo-comms-meta">VPS API @ 72.60.118.54:3030</div>
                    </div>
                </div>
            </div>

            {/* Bottom strip */}
            <div className="echo-stripe">
                ECHO HQ v1.1 · KIT 0C5 · SEAL TEAM WINDSTORM · {dateStr}, {timeStr} · Updated: {timeStr}
            </div>
        </div>
    )
}
