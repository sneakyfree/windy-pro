/**
 * Vitals v1 collector — server-side companion to the Electron-local
 * collector in `@windy/control-panel-host-electron/collect`.
 *
 * Two implementations, one contract. Both produce payloads that pass
 * the same `VitalsV1Schema`. This one reports the SERVER process's
 * host with `source: "account-server"`; the renderer surfaces that as
 * "📡 Server demo" so users know it's not their own machine.
 *
 * WD-31 M-D; ADR-054.
 */
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import {
    type VitalsV1,
    type HostPlatform,
    VITALS_V1_SCHEMA_ID,
    HOST_PLATFORMS,
} from '../contracts/control-panel';

const execAsync = promisify(exec);

const ALLOWED_PLATFORMS = new Set<HostPlatform>(HOST_PLATFORMS);

function sumCpuTimes(times: os.CpuInfo['times']): number {
    return times.user + times.nice + times.sys + times.idle + times.irq;
}

function mapHostPlatform(p: NodeJS.Platform): HostPlatform {
    return ALLOWED_PLATFORMS.has(p as HostPlatform)
        ? (p as HostPlatform)
        : 'unknown';
}

type DiskUsage = { total_bytes: number; used_bytes: number; used_pct: number };

async function readDiskUsage(): Promise<DiskUsage> {
    const empty: DiskUsage = { total_bytes: 0, used_bytes: 0, used_pct: 0 };
    try {
        const { stdout } = await execAsync('df -kP /');
        const lines = stdout.trim().split('\n');
        const last = lines[lines.length - 1];
        if (!last) return empty;
        const parts = last.trim().split(/\s+/);
        const totalKb = parseInt(parts[1] ?? '', 10);
        const usedKb = parseInt(parts[2] ?? '', 10);
        const usedPct = parseFloat((parts[4] ?? '').replace('%', ''));
        if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb)) return empty;
        return {
            total_bytes: totalKb * 1024,
            used_bytes: usedKb * 1024,
            used_pct: Number.isFinite(usedPct)
                ? Math.max(0, Math.min(100, usedPct))
                : 0,
        };
    } catch {
        return empty;
    }
}

async function countProcesses(): Promise<number> {
    try {
        const { stdout } = await execAsync('ps -A | wc -l');
        const n = parseInt(stdout.trim(), 10);
        return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
    } catch {
        return 0;
    }
}

function readPrimaryIp(): string | null {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const addr of ifaces[name] ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) return addr.address;
        }
    }
    return null;
}

/**
 * Sample THIS server process's vitals and return a Vitals v1 payload
 * with `source: "account-server"`. Reports the host running account-server
 * itself, not the calling user's machine.
 */
export async function collectServerVitals(): Promise<VitalsV1> {
    const cpu1 = os.cpus();
    await new Promise((r) => setTimeout(r, 100));
    const cpu2 = os.cpus();

    const coreUtilization = cpu1.map((c, i) => {
        const c2 = cpu2[i];
        if (!c2) return 0;
        const totalDelta = sumCpuTimes(c2.times) - sumCpuTimes(c.times);
        const idleDelta = c2.times.idle - c.times.idle;
        if (totalDelta <= 0) return 0;
        return Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta)));
    });
    const avgUtilization = coreUtilization.length
        ? coreUtilization.reduce((a, b) => a + b, 0) / coreUtilization.length
        : 0;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsedPct = totalMem > 0 ? 100 * (1 - freeMem / totalMem) : 0;

    const [disk, procsAll] = await Promise.all([
        readDiskUsage(),
        countProcesses(),
    ]);

    const [m1 = 0, m5 = 0, m15 = 0] = os.loadavg();

    return {
        schema: VITALS_V1_SCHEMA_ID,
        sampled_at: new Date().toISOString(),
        source: 'account-server',
        host: {
            hostname: os.hostname(),
            // Server hosts don't have user-friendly model names exposed
            // via portable tooling — cloud instance type isn't worth the
            // EC2-metadata round trip here. Null is honest.
            model: null,
            platform: mapHostPlatform(process.platform),
            release: os.release(),
            arch: os.arch(),
            ip: readPrimaryIp(),
            uptime_seconds: Math.max(0, os.uptime()),
            location: null,
        },
        cpu: {
            model: cpu1[0]?.model ?? 'unknown',
            cores: cpu1.length,
            avg_utilization_pct: Math.max(0, Math.min(100, avgUtilization)),
            core_utilization_pct: coreUtilization,
            temperature_c: null,
        },
        gpu: null,
        memory: {
            total_bytes: totalMem,
            available_bytes: freeMem,
            used_pct: Math.max(0, Math.min(100, memUsedPct)),
        },
        disk,
        network: {
            total_tx_bytes_per_sec: 0,
            total_rx_bytes_per_sec: 0,
        },
        load: [Math.max(0, m1), Math.max(0, m5), Math.max(0, m15)],
        processes: {
            all: procsAll,
            running: null,
            sleeping: null,
        },
        thermal: null,
    };
}
