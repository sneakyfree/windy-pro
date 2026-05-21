/**
 * Local-machine vitals collector for the Control Panel / Echo HQ view.
 *
 * Mirrors the shape of account-server's /api/v1/system-info route so the
 * renderer can use the same EchoHQView component regardless of source.
 * Runs in the Electron main process via ipcMain.handle('system-info').
 */
const os = require('node:os');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

function sumCpuTimes(times) {
    return times.user + times.nice + times.sys + times.idle + times.irq;
}

async function readDiskUsage() {
    try {
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

async function countProcesses() {
    try {
        const { stdout } = await execAsync('ps -A | wc -l');
        const n = parseInt(stdout.trim(), 10);
        return Number.isFinite(n) ? n - 1 : null;
    } catch {
        return null;
    }
}

// Map raw machine identifiers to friendly names. Apple's `hw.model`
// returns codes like "iMac18,3" — humans expect "iMac 27&quot; 5K (2017)".
const APPLE_MODEL_NAMES = {
    'iMac18,3': 'iMac 27" 5K (2017)',
    'iMac19,1': 'iMac 27" 5K (2019)',
    'iMac20,1': 'iMac 27" 5K (2020, i5)',
    'iMac20,2': 'iMac 27" 5K (2020, i9)',
    'iMac21,1': 'iMac 24" (M1, 2021)',
    'MacBookPro15,1': 'MacBook Pro 15" (2018/19)',
    'MacBookPro16,1': 'MacBook Pro 16" (2019)',
    'MacBookPro17,1': 'MacBook Pro 13" (M1, 2020)',
    'MacBookPro18,1': 'MacBook Pro 16" (M1 Pro/Max, 2021)',
    'MacBookPro18,3': 'MacBook Pro 14" (M1 Pro/Max, 2021)',
    'Macmini8,1': 'Mac mini (2018)',
    'Macmini9,1': 'Mac mini (M1, 2020)',
};

async function readMachineModel() {
    try {
        if (process.platform === 'darwin') {
            const { stdout } = await execAsync('sysctl -n hw.model');
            const raw = stdout.trim();
            return APPLE_MODEL_NAMES[raw] || raw || null;
        }
        if (process.platform === 'linux') {
            const { stdout } = await execAsync('cat /sys/class/dmi/id/product_name 2>/dev/null');
            return stdout.trim() || null;
        }
        if (process.platform === 'win32') {
            const { stdout } = await execAsync('wmic computersystem get model /value');
            const match = stdout.match(/Model=(.+)/);
            return match ? match[1].trim() : null;
        }
    } catch {
        return null;
    }
    return null;
}

function readPrimaryIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const addr of ifaces[name] || []) {
            if (addr.family === 'IPv4' && !addr.internal) return addr.address;
        }
    }
    return null;
}

async function collect() {
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

    const [disk, procs, model] = await Promise.all([
        readDiskUsage(),
        countProcesses(),
        readMachineModel(),
    ]);

    return {
        host: {
            hostname: os.hostname(),
            platform: os.platform(),
            release: os.release(),
            uptime_seconds: os.uptime(),
            arch: os.arch(),
            model,
            ip: readPrimaryIp(),
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
        source: 'electron-local',
    };
}

module.exports = { collect };
