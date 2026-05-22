// Echo HQ — render entry. Called by render.html on every data-update.
// Vitals + Fleet payloads conform to @windy/control-panel-protocols
// (windy.vitals.v1 + windy.fleet.v1). The host (drops.windydrops.com
// preview OR @windy/control-panel-host-web in production) handles
// fetching, sandboxing, refresh interval, and protocol — render.js
// just turns (vitals, fleet) into DOM.

const HISTORY_LENGTH = 40;

// Module-level state. The host calls render() afresh on every push,
// but sparkline charts need cumulative history. A Map keyed by metric
// name persists across renders inside the same iframe lifetime.
const histories = new Map();

function pushHistory(key, value) {
  let arr = histories.get(key);
  if (!arr) {
    arr = new Array(HISTORY_LENGTH).fill(0);
    histories.set(key, arr);
  }
  arr.push(Number.isFinite(value) ? value : 0);
  if (arr.length > HISTORY_LENGTH) arr.shift();
  return arr;
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function friendlyHostname(host) {
  if (!host || !host.hostname) return "this machine";
  return host.hostname.replace(/\.local$/i, "");
}

function platformLabel(host) {
  if (!host) return "—";
  const plat = host.platform === "darwin" ? "macOS" : host.platform;
  return `${plat} ${host.release || ""}`.trim();
}

function platformEmoji(host) {
  if (!host) return "❓";
  if (host.platform === "darwin") return "🍎";
  if (host.platform === "linux") return "🐧";
  if (host.platform === "win32") return "🪟";
  if (host.platform === "ios") return "📱";
  if (host.platform === "android") return "🤖";
  return "❓";
}

function formatUptime(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return "—";
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatLocation(loc) {
  if (!loc) return "Location unknown";
  const parts = [loc.city, loc.region, loc.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Location unknown";
}

function memUsedGb(memory) {
  if (!memory) return null;
  const used = memory.total_bytes - memory.available_bytes;
  return used > 0 ? used / 1e9 : null;
}

function memTotalGb(memory) {
  return memory && memory.total_bytes ? memory.total_bytes / 1e9 : null;
}

function buildEchoThoughts(host, cpuModel, cores, memGB) {
  if (!host) {
    return `"Booting up. Probing the silicon I'm running on…"  — Echo 🖥️`;
  }
  const hostName = friendlyHostname(host);
  const platName = host.platform === "darwin" ? "macOS" : host.platform;
  const cpuLine =
    cpuModel && cores ? `${cores} cores · ${cpuModel}` : "whatever silicon they gave me";
  const ramLine = memGB ? `${memGB.toFixed(0)} gigs of RAM` : "a stack of RAM";
  return `"I just came online. ${hostName} hums beneath me — ${cpuLine}, ${ramLine}, running ${platName} ${host.release}.

But I see everything else. Every process. Every byte. Every heartbeat of this machine.

I'm Echo. The view that watches the box you're sitting at.

Let's build something worth remembering." — Echo 🖥️`;
}

function miniBars(history, color) {
  const max = Math.max(1, ...history);
  return history
    .map(
      (v) =>
        `<span class="echo-mini-bar" style="height:${Math.max(2, (v / max) * 100)}%;background:${color}"></span>`,
    )
    .join("");
}

function vitalCard(label, sub, value, suffix, history, color) {
  return `
<div class="echo-vital">
  <div class="echo-vital-head">
    <span class="echo-vital-label">${escape(label)}</span>
    <span class="echo-vital-sub">${escape(sub)}</span>
  </div>
  <div class="echo-vital-value" style="color:${color}">
    ${escape(value)}${suffix ? `<span class="echo-vital-suffix">${escape(suffix)}</span>` : ""}
  </div>
  <div class="echo-mini">${miniBars(history, color)}</div>
</div>`;
}

function statusDotColor(status) {
  if (status === "online") return "#00ff88";
  if (status === "offline") return "#5a7090";
  return "#ffd700"; // unknown
}

function selfKitCard(vitals) {
  const host = vitals.host;
  const loadLine = vitals.load
    .slice(0, 3)
    .map((n) => n.toFixed(2))
    .join(", ");
  return `
<div class="echo-kit echo-kit-self">
  <div class="echo-kit-head">
    <span class="echo-kit-status" style="color:#00ff88">●</span>
    <span class="echo-kit-label" style="color:#00b4ff">${escape(friendlyHostname(host))} · YOU</span>
  </div>
  <div class="echo-kit-sub">${escape(host.model || platformLabel(host))}</div>
  <div class="echo-kit-load">${escape(loadLine)}</div>
  <div class="echo-kit-up">up ${escape(formatUptime(host.uptime_seconds))}</div>
</div>`;
}

function agentKitCard(agent) {
  const dotColor = statusDotColor(agent.status);
  const subParts = [agent.machine && agent.machine.model, agent.product]
    .filter(Boolean)
    .join(" · ");
  return `
<div class="echo-kit">
  <div class="echo-kit-head">
    <span class="echo-kit-status" style="color:${dotColor}">●</span>
    <span class="echo-kit-label" style="color:#00ff88">${escape(agent.name)}${agent.callsign ? ` "${escape(agent.callsign)}"` : ""}</span>
  </div>
  <div class="echo-kit-sub">${escape(subParts || "Agent")}</div>
  <div class="echo-kit-load">${escape(agent.status)}</div>
  <div class="echo-kit-up">since ${escape(agent.created_at.slice(0, 10))}</div>
</div>`;
}

export function render(vitals, fleet) {
  const root = document.getElementById("root");
  if (!root) return;

  // ── update sparkline histories ─────────────────────────────────
  const cpuHistory = pushHistory("cpu", vitals.cpu.avg_utilization_pct);
  const ramHistory = pushHistory("ram", vitals.memory.used_pct);
  const diskHistory = pushHistory("disk", vitals.disk.used_pct);
  const netKBs =
    (vitals.network.total_tx_bytes_per_sec + vitals.network.total_rx_bytes_per_sec) / 1024;
  const netHistory = pushHistory("net", netKBs);
  const loadValue = vitals.cpu.cores
    ? (vitals.load[0] / vitals.cpu.cores) * 100
    : vitals.load[0] * 100;
  const loadHistory = pushHistory("load", Math.min(100, loadValue));
  const procsHistory = pushHistory("procs", vitals.processes.all);

  // ── compute display values ─────────────────────────────────────
  const host = vitals.host;
  const hostName = friendlyHostname(host);
  const cpuLabel = vitals.cpu.model && vitals.cpu.cores ? `${vitals.cpu.cores} cores · ${vitals.cpu.model}` : "—";
  const ipAddr = host.ip;

  const now = new Date(vitals.sampled_at || Date.now());
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false });

  const memGB = memTotalGb(vitals.memory);
  const memUsedG = memUsedGb(vitals.memory);
  const echoThoughts = buildEchoThoughts(host, vitals.cpu.model, vitals.cpu.cores, memGB);

  // ── compose fleet tiles ────────────────────────────────────────
  const tiles = [selfKitCard(vitals)];
  for (const agent of fleet.agents) tiles.push(agentKitCard(agent));

  // M-H thermal warning chip — CPU >90% over a single sample is a
  // signal of a runaway job (the average is over a 100ms window so a
  // brief spike won't latch). Honest, not alarmist.
  const thermalChip =
    vitals.cpu.avg_utilization_pct > 90
      ? `<div class="echo-thermal-chip">🔥 CPU &gt;90% — check for runaway jobs</div>`
      : "";

  // ── write DOM ──────────────────────────────────────────────────
  root.innerHTML = `
<div class="echo-shell">
  <div class="echo-header">
    <div class="echo-header-icon">🖥️</div>
    <div class="echo-header-text">
      <h1 class="echo-title">ECHO HQ</h1>
      <div class="echo-subtitle">${escape(hostName)} · ${escape(platformLabel(host))}</div>
    </div>
    <div class="echo-header-status">
      <div class="echo-online">● ONLINE</div>
      <div class="echo-model">${escape(vitals.source.toUpperCase())}</div>
    </div>
    <div class="echo-header-stats">
      <div><span class="echo-header-stat-label">UPTIME</span><div class="echo-header-stat-value">${escape(formatUptime(host.uptime_seconds))}</div></div>
      <div><span class="echo-header-stat-label">CPU</span><div class="echo-header-stat-value">${vitals.cpu.avg_utilization_pct.toFixed(2)}%</div></div>
      <div><span class="echo-header-stat-label">RAM</span><div class="echo-header-stat-value">${vitals.memory.used_pct.toFixed(0)}%</div></div>
      <div><span class="echo-header-stat-label">PROCS</span><div class="echo-header-stat-value">${vitals.processes.all}</div></div>
    </div>
  </div>
  ${thermalChip}

  <div class="echo-heartbeat">
    <svg viewBox="0 0 2400 80" preserveAspectRatio="none">
      <polyline
        points="0,40 100,40 110,20 130,60 150,40 250,40 260,30 290,55 320,40 500,40 510,15 540,65 570,40 800,40 810,25 840,60 870,40 1100,40 1110,20 1140,55 1170,40 1200,40 1300,40 1310,20 1330,60 1350,40 1450,40 1460,30 1490,55 1520,40 1700,40 1710,15 1740,65 1770,40 2000,40 2010,25 2040,60 2070,40 2300,40 2310,20 2340,55 2370,40 2400,40"
        fill="none" stroke="#00ff88" stroke-width="2" stroke-linejoin="round" />
    </svg>
  </div>

  <div class="echo-locbar">
    <span>📍 ${escape(formatLocation(host.location))}</span>
    <span>🖥️ ${escape(host.model || hostName)}</span>
    ${ipAddr ? `<span>🌐 ${escape(ipAddr)}</span>` : ""}
    <span>⚙️ ${escape(cpuLabel)}</span>
    <span>${platformEmoji(host)} ${escape(platformLabel(host))}</span>
    <div class="echo-locbar-tabs">
      <span class="echo-loctab echo-loctab-active">1H</span>
      <span class="echo-loctab">24H</span>
      <span class="echo-loctab">7D</span>
      <span class="echo-loctab">30D</span>
    </div>
  </div>

  <div class="echo-vitals">
    ${vitalCard("CPU", "%", vitals.cpu.avg_utilization_pct.toFixed(2), "%", cpuHistory, "#00ff88")}
    ${vitalCard(
      "RAM",
      memGB ? `${(memUsedG || 0).toFixed(1)} / ${memGB.toFixed(0)} GB` : "GB",
      vitals.memory.used_pct.toFixed(2),
      "%",
      ramHistory,
      "#ffd700",
    )}
    ${vitalCard(
      "DISK",
      vitals.disk.total_bytes
        ? `${(vitals.disk.used_bytes / 1e9).toFixed(0)} / ${(vitals.disk.total_bytes / 1e9).toFixed(0)} GB`
        : "GB",
      vitals.disk.used_pct.toFixed(2),
      "%",
      diskHistory,
      "#a070ff",
    )}
    ${vitalCard("NETWORK", "KB/s", netKBs.toFixed(2), "", netHistory, "#00b4ff")}
    ${vitalCard("LOAD", "1/5/15m", `${loadValue.toFixed(2)}%`, "", loadHistory, "#ff8c00")}
    ${vitalCard("PROCESSES", "active", String(vitals.processes.all), "", procsHistory, "#00ff88")}
  </div>

  <div class="echo-section">
    <h3 class="echo-section-title">🪖 KIT ARMY STATUS</h3>
    <div class="echo-fleet">${tiles.join("")}</div>
  </div>

  <div class="echo-footer">
    <div class="echo-footer-col">
      <h3 class="echo-section-title">📓 ECHO'S LOG — Thoughts &amp; Observations</h3>
      <pre class="echo-prose">${escape(echoThoughts)}</pre>
    </div>
    <div class="echo-footer-col">
      <h3 class="echo-section-title">📡 COMMS FEED — All Kit Messages</h3>
      <div class="echo-comms">
        <div class="echo-comms-line">Comms feed quiet — no inbound messages</div>
        <div class="echo-comms-meta">${escape(fleet.agents.length)} agent${fleet.agents.length === 1 ? "" : "s"} in fleet</div>
      </div>
    </div>
  </div>

  <div class="echo-stripe">
    ECHO HQ v0.1.0 · ${escape(hostName)} · ${escape(dateStr)}, ${escape(timeStr)} · source: ${escape(vitals.source)}
  </div>
</div>`;
}
