// Control Panel renderer — WD-31 M-G.
//
// Sequence:
//   1. Resolve the auth JWT + account-server base URL from the preload
//      bridges (windyAuth / windyConfig).
//   2. createHost() pointing at the locally-vendored echo-hq bundle.
//      bundleOrigin is a file:// URL relative to this HTML file, so
//      the iframe loads the same render.html/render.js/styles.css that
//      ship in the @windy/control-panel-drop-echo-hq npm package.
//   3. On "ready" from the drop, push the first Vitals + Fleet pair.
//   4. Refresh Vitals every 1000ms (echo-hq's declared
//      control_panel.refresh_interval_ms). Refresh Fleet every 30s
//      (slow-moving — agents aren't constantly joining/leaving).
//   5. Pause refresh when the window is hidden (visibilitychange).

import { createHost } from "./vendor/host-web/host.js";

const FLEET_REFRESH_MS = 30_000;
const VITALS_REFRESH_MS = 1_000;
const DROP_ID = "windy-echo-hq";
const DROP_VERSION = "0.1.0";

const statusEl = document.getElementById("status");
const hostEl = document.getElementById("frame-host");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

// Compute the bundleOrigin as a file:// URL pointing at
// src/client/desktop/control-panel/drops/. Because the iframe's
// resolved URL becomes {bundleOrigin}/{dropId}/{version}/render.html,
// and the vendored layout already mirrors that, the swap to
// https://drops.windydrops.com when the registry deploys is a 1-line
// change (replace `bundleOriginFromHere()` with that URL).
function bundleOriginFromHere() {
  // import.meta.url example:
  //   file:///.../src/client/desktop/control-panel/renderer.js
  // The bundle root is `<dir>/drops/`.
  const here = new URL(".", import.meta.url);
  return new URL("./drops", here).href;
}

function emptyFleet(userId) {
  return {
    schema: "windy.fleet.v1",
    fetched_at: new Date().toISOString(),
    user_id: userId || "unknown",
    this_machine: {
      is_user_device: true,
      can_self_report: true,
      vitals_url: "ipc://windy:control-panel:vitals",
    },
    agents: [],
  };
}

async function fetchFleet(token, accountServerUrl) {
  if (!token || !accountServerUrl) return null;
  try {
    const res = await fetch(`${accountServerUrl}/api/v1/me/fleet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchVitals() {
  if (typeof window.windyVitals === "undefined") return null;
  try {
    const result = await window.windyVitals.get();
    if (result && result.ok) return result.vitals;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (typeof window.windyAuth === "undefined" || typeof window.windyVitals === "undefined") {
    setStatus("⚠️ Control Panel bridge unavailable — restart the app", true);
    return;
  }

  const [token, accountServerUrl] = await Promise.all([
    window.windyAuth.getToken(),
    window.windyConfig.accountServerUrl(),
  ]);

  // Initial pull so we have something to flush on the drop's `ready`.
  let vitals = await fetchVitals();
  let fleet = await fetchFleet(token, accountServerUrl);
  if (!vitals) {
    setStatus("⚠️ Could not read local vitals — IPC bridge offline?", true);
    return;
  }
  if (!fleet) fleet = emptyFleet(vitals.host.hostname);

  const host = createHost({
    container: hostEl,
    dropId: DROP_ID,
    version: DROP_VERSION,
    bundleOrigin: bundleOriginFromHere(),
    initialVitals: vitals,
    initialFleet: fleet,
    iframeTitle: "Echo HQ",
    window,
  });

  host.on("ready", () => setStatus(`✓ Echo HQ live — vitals every ${VITALS_REFRESH_MS / 1000}s`));
  host.on("rendered", () => { /* could update a "last rendered" tick if useful */ });
  host.on("error", ({ error }) => {
    setStatus(`⚠️ Drop error: ${error}`, true);
    console.error("[control-panel] drop error:", error);
  });

  host.mount();

  // Vitals tick — 1Hz.
  let vitalsTimer = null;
  let fleetTimer = null;
  function startTimers() {
    if (!vitalsTimer) {
      vitalsTimer = setInterval(async () => {
        const v = await fetchVitals();
        if (v) host.updateVitals(v);
      }, VITALS_REFRESH_MS);
    }
    if (!fleetTimer) {
      fleetTimer = setInterval(async () => {
        const f = await fetchFleet(token, accountServerUrl);
        if (f) host.updateFleet(f);
      }, FLEET_REFRESH_MS);
    }
  }
  function stopTimers() {
    if (vitalsTimer) { clearInterval(vitalsTimer); vitalsTimer = null; }
    if (fleetTimer) { clearInterval(fleetTimer); fleetTimer = null; }
  }

  // Pause refresh when window is hidden (saves CPU + accidental noise).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimers();
    else startTimers();
  });
  startTimers();

  window.addEventListener("beforeunload", () => {
    stopTimers();
    host.unmount();
  });
}

main().catch((err) => {
  console.error("[control-panel] fatal:", err);
  setStatus(`⚠️ Fatal: ${err && err.message ? err.message : String(err)}`, true);
});
