/**
 * GET /api/v1/system-info
 *
 * Returns the host machine's vitals in the shape EchoHQView consumes
 * (cpu.avg_utilization_pct, memory.used_pct, load[], processes.all,
 * disk.used_pct, network.total_{tx,rx}_bytes_per_sec, host, sampled_at).
 *
 * Reports the SERVER process's host — for the Electron desktop app
 * a future sidecar will expose the same shape on loopback, and the
 * React view will prefer that when available.
 */
import { Router, Request, Response } from 'express';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { authenticateToken } from '../middleware/auth';
import { makeRateLimiter } from '../services/rate-limiter';

const execAsync = promisify(exec);
const router = Router();

const limiter = makeRateLimiter('system-info', {
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

function sumCpuTimes(times: os.CpuInfo['times']): number {
    return times.user + times.nice + times.sys + times.idle + times.irq;
}

async function readDiskUsage(): Promise<{ used_pct: number | null; total_bytes: number | null; used_bytes: number | null }> {
    try {
        // -P forces POSIX output: `Filesystem 1024-blocks Used Available Capacity Mounted-on`
        // (6 cols, portable). Plain `df -k` adds iused/ifree on macOS, breaking col index.
        const { stdout } = await execAsync('df -kP /');
        const lines = stdout.trim().split('\n');
        const last = lines[lines.length - 1];
        const parts = last.trim().split(/\s+/);
        const totalKb = parseInt(parts[1], 10);
        const usedKb = parseInt(parts[2], 10);
        const usedPct = parseFloat((parts[4] ?? '').replace('%', ''));
        if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb)) {
            return { used_pct: null, total_bytes: null, used_bytes: null };
        }
        return {
            used_pct: Number.isFinite(usedPct) ? usedPct : null,
            total_bytes: totalKb * 1024,
            used_bytes: usedKb * 1024,
        };
    } catch {
        return { used_pct: null, total_bytes: null, used_bytes: null };
    }
}

async function countProcesses(): Promise<number | null> {
    try {
        const { stdout } = await execAsync('ps -A | wc -l');
        const n = parseInt(stdout.trim(), 10);
        return Number.isFinite(n) ? n - 1 : null;
    } catch {
        return null;
    }
}

router.get('/', limiter, authenticateToken, async (_req: Request, res: Response) => {
    const cpu1 = os.cpus();
    await new Promise((r) => setTimeout(r, 100));
    const cpu2 = os.cpus();

    const coreUtilization: number[] = cpu1.map((c, i) => {
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

    const [disk, procs] = await Promise.all([readDiskUsage(), countProcesses()]);

    res.json({
        host: {
            hostname: os.hostname(),
            platform: os.platform(),
            release: os.release(),
            uptime_seconds: os.uptime(),
            arch: os.arch(),
        },
        cpu: {
            avg_utilization_pct: avgUtilization,
            model: cpu1[0]?.model ?? null,
            cores: cpu1.length,
            core_utilization_pct: coreUtilization,
        },
        memory: {
            used_pct: memUsedPct,
            total_bytes: totalMem,
            available_bytes: freeMem,
        },
        load: os.loadavg(),
        processes: { all: procs },
        disk,
        network: {
            total_tx_bytes_per_sec: 0,
            total_rx_bytes_per_sec: 0,
        },
        sampled_at: new Date().toISOString(),
    });
});

export default router;
