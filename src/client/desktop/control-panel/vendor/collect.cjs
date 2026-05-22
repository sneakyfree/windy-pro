// CJS port of @windy/control-panel-host-electron/collect for use from
// the Electron main process (which is CommonJS in windy-pro). The
// canonical ESM version lives at
//   sneakyfree/windy-control-panel/packages/host-electron/src/collect.ts
// Behavior MUST match — both produce Vitals v1 payloads with
// source="electron-local".
//
// See feedback_vendor_drift_guard_pattern in auto-memory.

const os = require("node:os");
const { exec } = require("node:child_process");
const { promisify } = require("node:util");

const execAsync = promisify(exec);

const VITALS_V1_SCHEMA_ID = "windy.vitals.v1";

const HOST_PLATFORM_ALLOWED = new Set([
  "darwin",
  "linux",
  "win32",
  "ios",
  "android",
  "unknown",
]);

const APPLE_MODEL_NAMES = {
  "iMac18,3": 'iMac 27" 5K (2017)',
  "iMac19,1": 'iMac 27" 5K (2019)',
  "iMac20,1": 'iMac 27" 5K (2020, i5)',
  "iMac20,2": 'iMac 27" 5K (2020, i9)',
  "iMac21,1": 'iMac 24" (M1, 2021)',
  "MacBookPro15,1": 'MacBook Pro 15" (2018/19)',
  "MacBookPro16,1": 'MacBook Pro 16" (2019)',
  "MacBookPro17,1": 'MacBook Pro 13" (M1, 2020)',
  "MacBookPro18,1": 'MacBook Pro 16" (M1 Pro/Max, 2021)',
  "MacBookPro18,3": 'MacBook Pro 14" (M1 Pro/Max, 2021)',
  "Macmini8,1": "Mac mini (2018)",
  "Macmini9,1": "Mac mini (M1, 2020)",
};

function sumCpuTimes(t) {
  return t.user + t.nice + t.sys + t.idle + t.irq;
}

function mapHostPlatform(p) {
  return HOST_PLATFORM_ALLOWED.has(p) ? p : "unknown";
}

async function readDiskUsage() {
  const empty = { total_bytes: 0, used_bytes: 0, used_pct: 0 };
  try {
    const { stdout } = await execAsync("df -kP /");
    const lines = stdout.trim().split("\n");
    const last = lines[lines.length - 1];
    if (!last) return empty;
    const parts = last.trim().split(/\s+/);
    const totalKb = parseInt(parts[1] ?? "", 10);
    const usedKb = parseInt(parts[2] ?? "", 10);
    const usedPct = parseFloat((parts[4] ?? "").replace("%", ""));
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

async function countProcesses() {
  try {
    const { stdout } = await execAsync("ps -A | wc -l");
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
  } catch {
    return 0;
  }
}

async function readMachineModel() {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execAsync("sysctl -n hw.model");
      const raw = stdout.trim();
      return APPLE_MODEL_NAMES[raw] ?? raw ?? null;
    }
    if (process.platform === "linux") {
      const { stdout } = await execAsync(
        "cat /sys/class/dmi/id/product_name 2>/dev/null",
      );
      return stdout.trim() || null;
    }
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        "wmic computersystem get model /value",
      );
      const match = stdout.match(/Model=(.+)/);
      return match ? (match[1]?.trim() ?? null) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readPrimaryIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
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

  const [disk, procsAll, model] = await Promise.all([
    readDiskUsage(),
    countProcesses(),
    readMachineModel(),
  ]);

  return {
    schema: VITALS_V1_SCHEMA_ID,
    sampled_at: new Date().toISOString(),
    source: "electron-local",
    host: {
      hostname: os.hostname(),
      model,
      platform: mapHostPlatform(process.platform),
      release: os.release(),
      arch: os.arch(),
      ip: readPrimaryIp(),
      uptime_seconds: Math.max(0, os.uptime()),
      location: null,
    },
    cpu: {
      model: cpu1[0]?.model ?? "unknown",
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
    load: (() => {
      const [m1 = 0, m5 = 0, m15 = 0] = os.loadavg();
      return [Math.max(0, m1), Math.max(0, m5), Math.max(0, m15)];
    })(),
    processes: {
      all: procsAll,
      running: null,
      sleeping: null,
    },
    thermal: null,
  };
}

module.exports = { collect, VITALS_V1_SCHEMA_ID };
