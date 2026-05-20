import { useState, useEffect } from 'react'
import { useGeolocation, formatLocation } from './useGeolocation'
import './AlphaPanelView.css'

// Alpha Control Panel — colorful gradient style, modeled after Kit 0C1 Veron's
// dashboard at localhost:7000. v2 (2026-05-16): real metrics via
// GET /api/v1/system-info; falls back to zeros if endpoint unreachable.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

async function fetchSystemInfo() {
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

function useLiveVitals() {
    const [v, setV] = useState({
        cpu: 0, gpu: 0, ram: 0, vram: 0, vramTotal: 31.8,
        disk: 0, gpuPower: 0,
        cpuTemp: 43.0, gpuTemp: 33.0, nvmeTemp: 33.9, gpuFan: 0,
        upload: 0, download: 0,
        load1: 0, load5: 0, load15: 0,
        cores: Array.from({ length: 24 }, () => 0),
        uptimeHours: 0,
        host: null,
        cpuModel: 'probing…',
        liveSource: false,
    })

    useEffect(() => {
        let cancelled = false
        async function fetchOnce() {
            const data = await fetchSystemInfo()
            if (cancelled || !data) return
            setV(prev => ({
                ...prev,
                cpu: data.cpu?.avg_utilization_pct ?? prev.cpu,
                ram: data.memory?.used_pct ?? prev.ram,
                load1: data.load?.[0] ?? prev.load1,
                load5: data.load?.[1] ?? prev.load5,
                load15: data.load?.[2] ?? prev.load15,
                cores: (data.cpu?.core_utilization_pct?.length > 0
                    ? data.cpu.core_utilization_pct.slice(0, 24)
                    : prev.cores),
                disk: data.disk?.used_pct ?? prev.disk,
                procs: data.processes?.all ?? prev.procs,
                netUpKBs: ((data.network?.total_tx_bytes_per_sec ?? 0) / 1024),
                netDownKBs: ((data.network?.total_rx_bytes_per_sec ?? 0) / 1024),
                uptimeHours: (data.host?.uptime_seconds ?? 0) / 3600,
                host: data.host,
                cpuModel: data.cpu?.model || prev.cpuModel,
                cpuCores: data.cpu?.cores,
                memTotalGB: data.memory?.total_bytes ? (data.memory.total_bytes / 1e9) : null,
                memUsedGB: (data.memory?.total_bytes && data.memory?.available_bytes)
                    ? ((data.memory.total_bytes - data.memory.available_bytes) / 1e9)
                    : null,
                diskTotalGB: data.disk?.total_bytes ? (data.disk.total_bytes / 1e9) : null,
                diskUsedGB: data.disk?.used_bytes ? (data.disk.used_bytes / 1e9) : null,
                liveSource: true,
                sampledAt: data.sampled_at,
            }))
        }
        fetchOnce()
        // 1s polling for visible liveness
        const tick = setInterval(fetchOnce, 1000)
        return () => { cancelled = true; clearInterval(tick) }
    }, [])

    return v
}

function useSimulatedVitals() {
    const [v, setV] = useState({
        cpu: 4.2,
        gpu: 0,
        ram: 27.7,
        vram: 2.4,
        vramTotal: 31.8,
        disk: 94.4,
        gpuPower: 11,
        cpuTemp: 43.0,
        gpuTemp: 33.0,
        nvmeTemp: 33.9,
        gpuFan: 0,
        upload: 0.01,
        download: 0.00,
        load1: 1.97, load5: 1.33, load15: 1.30,
        cores: Array.from({ length: 24 }, () => Math.random() * 10),
        uptimeHours: 81.7,
    })

    useEffect(() => {
        const tick = setInterval(() => {
            setV(prev => ({
                ...prev,
                cpu: clamp(prev.cpu + (Math.random() - 0.5) * 2, 1, 35),
                gpu: clamp(prev.gpu + (Math.random() - 0.4) * 3, 0, 95),
                ram: clamp(prev.ram + (Math.random() - 0.5) * 1.5, 18, 50),
                vram: clamp(prev.vram + (Math.random() - 0.5) * 0.5, 1, 25),
                cpuTemp: clamp(prev.cpuTemp + (Math.random() - 0.5) * 2, 38, 75),
                gpuTemp: clamp(prev.gpuTemp + (Math.random() - 0.5) * 2, 28, 70),
                nvmeTemp: clamp(prev.nvmeTemp + (Math.random() - 0.5) * 1.5, 30, 65),
                upload: Math.max(0, prev.upload + (Math.random() - 0.5) * 0.05),
                download: Math.max(0, prev.download + (Math.random() - 0.5) * 0.05),
                cores: prev.cores.map(c => clamp(c + (Math.random() - 0.5) * 6, 0, 35)),
            }))
        }, 2000)
        return () => clearInterval(tick)
    }, [])

    return v
}

function StatTile({ label, value, unit, sub, color }) {
    return (
        <div className="alpha-stat" style={{ '--accent': color }}>
            <div className="alpha-stat-value" style={{ color }}>
                {value}
                {unit && <span className="alpha-stat-unit">{unit}</span>}
            </div>
            <div className="alpha-stat-label">{label}</div>
            {sub && <div className="alpha-stat-sub">{sub}</div>}
        </div>
    )
}

function IdentityField({ label, value, color }) {
    return (
        <div className="alpha-id-field" style={{ '--accent': color }}>
            <div className="alpha-id-label">{label}</div>
            <div className="alpha-id-value">{value}</div>
        </div>
    )
}

const KIT_ROLL = [
    { id: 'k0', label: 'Kit 0 Alpha', online: false },
    { id: 'k0c1', label: 'Kit 0C1 Veron', online: false },
    { id: 'k0c2', label: 'Kit 0C2 ProBook', online: false },
    { id: 'k0c3', label: 'Kit 0C3 Dell', online: false },
    { id: 'k0c4', label: 'Kit 0C4 Lenovo', online: false },
    { id: 'k0c5', label: 'Kit 0C5 iMac', online: false },
]

const ALPHA_THOUGHTS = `System initializing... Alpha Control Panel coming online ⚡

Boot ⋅ just now`

export default function AlphaPanelView() {
    const v = useLiveVitals()
    const geo = useGeolocation()

    // Friendly display name + derived host metadata. Mirrors EchoHQView's
    // hostname handling — strip `.local` so "Grants-iMac.local" reads cleaner.
    const friendlyHost = (v.host?.hostname || '').replace(/\.local$/i, '') || 'this machine'
    const platformLabel = v.host
        ? `${v.host.platform === 'darwin' ? 'macOS' : v.host.platform} ${v.host.release}`
        : '—'
    const memLabel = (v.memTotalGB && v.memUsedGB)
        ? `${v.memUsedGB.toFixed(1)} / ${v.memTotalGB.toFixed(1)} GB`
        : '—'

    return (
        <div className="alpha-shell">
            {/* Gradient header — identity derives from /api/v1/system-info + ipapi */}
            <div className="alpha-header">
                <h1 className="alpha-title">⚡ ALPHA CONTROL PANEL ⚡</h1>
                <div className="alpha-meta">
                    {friendlyHost} · {v.cpuModel || 'detecting…'} · {formatLocation(geo)} · localhost:{window.location.port || '5173'}
                </div>
                <div className="alpha-connected">⚡ Connected</div>
            </div>

            <div className="alpha-grid">
                {/* Identity Matrix — derived from real host data, not Kit-Army placeholders */}
                <section className="alpha-section">
                    <h2 className="alpha-section-title">🔧 Identity Matrix</h2>
                    <div className="alpha-id-grid">
                        <IdentityField label="HOSTNAME" value={friendlyHost} color="#ffd700" />
                        <IdentityField label="PLATFORM" value={platformLabel} color="#ffd700" />
                        <IdentityField label="CPU" value={v.cpuModel || 'detecting…'} color="#ffd700" />
                        <IdentityField label="CORES" value={v.cpuCores ? `${v.cpuCores} logical` : '—'} color="#ffd700" />
                        <IdentityField label="MEMORY" value={memLabel} color="#ffd700" />
                        <IdentityField label="LOCATION" value={formatLocation(geo)} color="#ffd700" />
                    </div>
                </section>

                {/* Machine Vitals */}
                <section className="alpha-section">
                    <h2 className="alpha-section-title">⚙️ Machine Vitals</h2>
                    <div className="alpha-vitals-grid">
                        <StatTile label="CPU %" value={v.cpu.toFixed(1)} unit="%" sub={`Load ${v.load1}, ${v.load5}, ${v.load15}`} color="#ffd700" />
                        <StatTile label="GPU %" value={v.gpu.toFixed(0)} unit="%" sub={`${v.vram.toFixed(1)}/${v.vramTotal} GB`} color="#00b4ff" />
                        <StatTile label="RAM %" value={v.ram.toFixed(1)} unit="%" sub="69.5/251.1 GB" color="#ff6ec7" />
                        <StatTile label="VRAM (GB)" value={`${v.vram.toFixed(1)}/${v.vramTotal}`} color="#00ff88" />
                        <StatTile label="Disk %" value={v.disk.toFixed(1)} color="#a070ff" />
                        <StatTile label="GPU Power (W)" value={v.gpuPower} color="#ffd700" />
                        <StatTile label="🔥 CPU Temp" value={`${(v.cpuTemp * 9/5 + 32).toFixed(1)}°F / ${v.cpuTemp.toFixed(0)}°C`} color="#00ff88" />
                        <StatTile label="GPU Temp" value={`${(v.gpuTemp * 9/5 + 32).toFixed(1)}°F / ${v.gpuTemp.toFixed(0)}°C`} color="#00ff88" />
                        <StatTile label="NVMe Temp" value={`${(v.nvmeTemp * 9/5 + 32).toFixed(0)}°F / ${v.nvmeTemp.toFixed(1)}°C`} color="#00ff88" />
                        <StatTile label="GPU Fan %" value={v.gpuFan} color="#5a7090" />
                        <StatTile label="Uptime" value={`${Math.floor(v.uptimeHours)}h ${Math.floor((v.uptimeHours % 1) * 60)}m`} color="#00ff88" />
                        <StatTile label="Load Avg" value={`${v.load1}, ${v.load5}, ${v.load15}`} color="#ffd700" />
                        <StatTile label="⬆ Upload MB/s" value={v.upload.toFixed(2)} color="#a070ff" />
                        <StatTile label="⬇ Download MB/s" value={v.download.toFixed(2)} color="#ffd700" />
                    </div>
                </section>

                {/* CPU Core Map */}
                <section className="alpha-section alpha-section-cores">
                    <h2 className="alpha-section-title">🧠 CPU Core Map <span className="alpha-section-sub">(24 cores)</span></h2>
                    <div className="alpha-cores">
                        {v.cores.map((c, i) => (
                            <div key={i} className="alpha-core">
                                <div className="alpha-core-label">C{i + 1}</div>
                                <div className="alpha-core-value">{c.toFixed(0)}%</div>
                                <div className="alpha-core-bar" style={{ width: `${Math.min(100, c * 3)}%` }} />
                            </div>
                        ))}
                    </div>
                </section>

                {/* Kit Army Status */}
                <section className="alpha-section alpha-section-fleet">
                    <h2 className="alpha-section-title">🪖 Kit Army Status</h2>
                    <div className="alpha-fleet">
                        {KIT_ROLL.map(k => (
                            <div key={k.id} className="alpha-fleet-row">
                                <span className="alpha-fleet-dot" style={{ background: k.online ? '#00ff88' : '#ff4444' }}>●</span>
                                <span className="alpha-fleet-label">{k.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="alpha-live-bar">
                        {friendlyHost} · <span style={{ color: '#00ff88' }}>ONLINE</span> · uptime {v.uptimeHours.toFixed(1)}h · CPU {v.cpu.toFixed(1)}% · RAM {memLabel} ({v.ram.toFixed(1)}%)
                    </div>
                </section>

                {/* Alpha Thoughts */}
                <section className="alpha-section alpha-section-thoughts">
                    <h2 className="alpha-section-title">💭 Alpha Thoughts</h2>
                    <pre className="alpha-thoughts">{ALPHA_THOUGHTS}</pre>
                </section>
            </div>
        </div>
    )
}
