// Control Panel renderer — WD-31 Phase 3b.
//
// Reads the user's selected drop from window.windyDropLibrary (Phase 3a
// IPC plumbing) and mounts that drop's iframe. Built-in Echo HQ loads
// from the bundled file://; installed drops load from the registry CDN
// (drops.windydrops.com).
//
// Sequence:
//   1. Resolve auth + account-server config (windyAuth, windyConfig).
//   2. Resolve selected drop + bundleOrigin from windyDropLibrary.
//   3. createHost() → mount() → push initial Vitals+Fleet on "ready".
//   4. Tick Vitals every 1000ms, Fleet every 30s. Pause when hidden.
//   5. When selection changes (windyDropLibrary.onSelectionChanged),
//      unmount the current host + mount a new one with the new drop.
//      Vitals + fleet timers + caches are reused — only the iframe
//      flips.

import { createHost } from "./vendor/host-web/host.js";

const FLEET_REFRESH_MS = 30_000;
const VITALS_REFRESH_MS = 1_000;
const BUILTIN_ECHO_HQ_ID = "windy-echo-hq";

const statusEl = document.getElementById("status");
const hostEl = document.getElementById("frame-host");
const dropCurrentBtn = document.getElementById("drop-current");
const dropCurrentName = document.getElementById("drop-current-name");
const dropMenu = document.getElementById("drop-menu");
const topbarCta = document.getElementById("topbar-cta");
const marketEl = document.getElementById("marketplace");
const marketBodyEl = document.getElementById("market-body");
const marketBackBtn = document.getElementById("market-back");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

function setCurrentName(name) {
  if (dropCurrentName) dropCurrentName.textContent = name;
}

function closeDropMenu() {
  if (dropMenu) dropMenu.classList.remove("open");
  if (dropCurrentBtn) dropCurrentBtn.setAttribute("aria-expanded", "false");
}

function openDropMenu() {
  if (dropMenu) dropMenu.classList.add("open");
  if (dropCurrentBtn) dropCurrentBtn.setAttribute("aria-expanded", "true");
}

function isDropMenuOpen() {
  return dropMenu && dropMenu.classList.contains("open");
}

function renderDropMenu(drops, selected) {
  if (!dropMenu) return;
  dropMenu.innerHTML = drops
    .map((d) => {
      const isSelected = selected && d.id === selected.id && d.version === selected.version;
      const isBuiltin = d.source === "builtin";
      const sourceLabel = isBuiltin ? "built-in" : "installed";
      // Built-ins can't be removed (always the safe fallback); installed
      // drops get a small × button on hover.
      const removeBtn = isBuiltin
        ? ""
        : `<button class="drop-menu-remove" type="button" data-action="remove"
                   data-drop-id="${escapeAttr(d.id)}"
                   data-drop-name="${escapeAttr(d.name || d.id)}"
                   title="Remove ${escapeAttr(d.name || d.id)} from your library"
                   aria-label="Remove ${escapeAttr(d.name || d.id)}">×</button>`;
      return `
        <div class="drop-menu-item${isSelected ? " selected" : ""}"
             role="option"
             data-drop-id="${escapeAttr(d.id)}"
             data-drop-version="${escapeAttr(d.version)}">
          <div class="drop-menu-item-body">
            <span class="name">${escapeText(d.name || d.id)}</span>
            <span class="source">${sourceLabel}</span>
          </div>
          ${removeBtn}
        </div>
      `;
    })
    .join("");
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
function escapeAttr(s) {
  return String(s).replace(/["&<>]/g, (c) => ({ '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

// Built-in Echo HQ ships with the Pro DMG under
// src/client/desktop/control-panel/drops/<id>/<version>/.
// Computed at runtime from this module's URL so the same code works in
// dev (loaded from src/) and prod (loaded from app.asar).
function builtinBundleOrigin() {
  const here = new URL(".", import.meta.url);
  return new URL("./drops", here).href;
}

function bundleOriginFor(drop) {
  if (drop.id === BUILTIN_ECHO_HQ_ID && drop.source === "builtin") {
    return builtinBundleOrigin();
  }
  // Installed drops carry their bundle_origin from the library service.
  if (drop.bundle_origin) return drop.bundle_origin;
  // Fallback: synthesize the canonical CDN URL.
  return `https://drops.windydrops.com/${encodeURIComponent(drop.id)}/${encodeURIComponent(drop.version)}`;
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

async function resolveSelectedDrop() {
  // windyDropLibrary lands via the Phase 3a preload. If it's missing
  // (older Pro builds, dev shells without the preload), fall back to
  // built-in Echo HQ so the panel always renders something.
  if (typeof window.windyDropLibrary === "undefined") {
    return {
      id: BUILTIN_ECHO_HQ_ID,
      version: "0.1.0",
      name: "Echo HQ",
      source: "builtin",
    };
  }
  const [selRes, listRes] = await Promise.all([
    window.windyDropLibrary.getSelected(),
    window.windyDropLibrary.listInstalled(),
  ]);
  const selected = selRes && selRes.ok ? selRes.selected : null;
  const drops = listRes && listRes.ok ? listRes.drops : [];
  if (!selected) {
    return drops.find((d) => d.id === BUILTIN_ECHO_HQ_ID) || drops[0] || null;
  }
  const match = drops.find((d) => d.id === selected.id && d.version === selected.version);
  return match || drops.find((d) => d.id === BUILTIN_ECHO_HQ_ID) || null;
}

async function main() {
  if (typeof window.windyAuth === "undefined" || typeof window.windyVitals === "undefined") {
    setStatus("⚠️ Control Panel can't reach the app — try restarting Windy Word.", true);
    return;
  }

  const [token, accountServerUrl] = await Promise.all([
    window.windyAuth.getToken(),
    window.windyConfig.accountServerUrl(),
  ]);

  // Cached payloads — survive across drop-selection changes so a fresh
  // iframe gets fed immediately on its first `ready`.
  let latestVitals = await fetchVitals();
  let latestFleet = await fetchFleet(token, accountServerUrl);
  if (!latestVitals) {
    setStatus("⚠️ Couldn't read this computer's health — try restarting Windy Word.", true);
    return;
  }
  if (!latestFleet) latestFleet = emptyFleet(latestVitals.host.hostname);

  // Active host + the drop it's rendering. Both replaced on selection change.
  let activeDrop = null;
  let activeHost = null;

  function unmountActive() {
    if (activeHost) {
      try {
        activeHost.unmount();
      } catch {
        /* idempotent */
      }
      activeHost = null;
    }
  }

  function mountDrop(drop) {
    unmountActive();
    activeDrop = drop;
    setStatus(`⏳ Loading ${drop.name || drop.id}…`);
    activeHost = createHost({
      container: hostEl,
      dropId: drop.id,
      version: drop.version,
      bundleOrigin: bundleOriginFor(drop),
      initialVitals: latestVitals,
      initialFleet: latestFleet,
      iframeTitle: drop.name || drop.id,
      window,
    });
    activeHost.on("ready", () =>
      setStatus(`✓ ${drop.name || drop.id} — updating every ${VITALS_REFRESH_MS / 1000}s`),
    );
    activeHost.on("error", ({ error }) => {
      setStatus(`⚠️ ${drop.name || drop.id} error: ${error}`, true);
      console.error("[control-panel] drop error:", error);
    });
    activeHost.mount();
  }

  const initialDrop = await resolveSelectedDrop();
  if (!initialDrop) {
    setStatus("⚠️ No drops available — restart the app", true);
    return;
  }
  mountDrop(initialDrop);
  setCurrentName(initialDrop.name || initialDrop.id);

  // ─── Top-bar drop selector wiring ─────────────────────────────────
  async function refreshDropMenu() {
    if (typeof window.windyDropLibrary === "undefined") {
      if (dropCurrentBtn) dropCurrentBtn.setAttribute("disabled", "");
      return;
    }
    const [listRes, selRes] = await Promise.all([
      window.windyDropLibrary.listInstalled(),
      window.windyDropLibrary.getSelected(),
    ]);
    const drops = listRes && listRes.ok ? listRes.drops : [];
    const sel = selRes && selRes.ok ? selRes.selected : null;
    renderDropMenu(drops, sel);
  }

  await refreshDropMenu();

  // Toggle the dropdown on the current-drop button.
  if (dropCurrentBtn) {
    dropCurrentBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isDropMenuOpen()) closeDropMenu();
      else openDropMenu();
    });
  }

  // Click handler for the menu — picks a drop OR removes one depending
  // on what was clicked.
  if (dropMenu) {
    dropMenu.addEventListener("click", async (e) => {
      // Remove button: handle first so it doesn't fall through to select.
      const removeBtn = e.target.closest("[data-action='remove']");
      if (removeBtn) {
        e.stopPropagation();
        const dropId = removeBtn.getAttribute("data-drop-id");
        const dropName = removeBtn.getAttribute("data-drop-name") || dropId;
        if (!dropId) return;
        // Confirm with a clear grandma-readable prompt before destructive op.
        const ok = window.confirm(
          `Remove ${dropName} from your library?\n\nYou can always re-install it from "Get more drops".`,
        );
        if (!ok) return;
        closeDropMenu();
        if (typeof window.windyDropLibrary !== "undefined") {
          const res = await window.windyDropLibrary.uninstallDrop(dropId);
          if (res && res.ok && res.removed) {
            setStatus(`✓ Removed ${dropName}.`);
          } else if (res && res.ok && !res.removed) {
            setStatus(`${dropName} wasn't in your library.`);
          } else {
            setStatus(`⚠️ Couldn't remove ${dropName} — try again.`, true);
          }
        }
        return;
      }

      // Select a drop: click anywhere else on the item.
      const item = e.target.closest(".drop-menu-item");
      if (!item) return;
      const dropId = item.getAttribute("data-drop-id");
      const version = item.getAttribute("data-drop-version");
      closeDropMenu();
      if (!dropId || !version) return;
      if (activeDrop && dropId === activeDrop.id && version === activeDrop.version) return;
      const nameEl = item.querySelector(".name");
      const dropName = nameEl ? nameEl.textContent : dropId;
      if (typeof window.windyDropLibrary !== "undefined") {
        const res = await window.windyDropLibrary.selectDrop(dropId, version);
        if (res && res.ok) {
          setStatus(`⏳ Switching to ${dropName}…`);
        } else {
          setStatus(`⚠️ Couldn't switch to ${dropName} — try again.`, true);
        }
      }
    });
  }

  // Click anywhere else = close dropdown.
  document.addEventListener("click", (e) => {
    if (!isDropMenuOpen()) return;
    if (!e.target.closest("#drop-selector")) closeDropMenu();
  });

  // ─── In-window marketplace (Phase 3d) ─────────────────────────────
  // Click "Get more drops" → fetch catalog from registry, render card
  // grid in the marketplace overlay. Each card gets an Install button
  // (or "Installed" / "Built-in" badge depending on state).

  function openMarket() {
    if (!marketEl) return;
    marketEl.classList.add("open");
    refreshMarketCatalog();
  }
  function closeMarket() {
    if (!marketEl) return;
    marketEl.classList.remove("open");
  }
  function isMarketOpen() {
    return marketEl && marketEl.classList.contains("open");
  }

  async function refreshMarketCatalog() {
    if (!marketBodyEl) return;
    if (typeof window.windyDropLibrary === "undefined") {
      marketBodyEl.innerHTML = `<div class="market-state error">⚠️ The marketplace isn't available right now — try restarting Windy Word.</div>`;
      return;
    }
    marketBodyEl.innerHTML = `<div class="market-state">⏳ Loading drops from the marketplace…</div>`;
    const [browseRes, installedRes] = await Promise.all([
      window.windyDropLibrary.browseRegistry({ type: "control-panel-template", limit: 50 }),
      window.windyDropLibrary.listInstalled(),
    ]);
    if (!browseRes || !browseRes.ok) {
      const msg = browseRes && browseRes.error ? browseRes.error : "could not reach the registry";
      marketBodyEl.innerHTML = `<div class="market-state error">⚠️ ${escapeText(msg)}</div><div class="market-state">Tip: check your internet, or try again in a moment.</div>`;
      return;
    }
    const items = Array.isArray(browseRes.items) ? browseRes.items : [];
    const installed = installedRes && installedRes.ok ? installedRes.drops : [];
    if (items.length === 0) {
      marketBodyEl.innerHTML = `<div class="market-state">The marketplace is empty — check back soon.</div>`;
      return;
    }
    marketBodyEl.innerHTML = `
      <div class="market-grid">
        ${items.map((it) => renderMarketCard(it, installed)).join("")}
      </div>
    `;
    // Wire install buttons.
    marketBodyEl.querySelectorAll("button[data-action='install']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-drop-id");
        const item = items.find((i) => i.id === id);
        if (!item) return;
        btn.disabled = true;
        btn.textContent = "⏳ Installing…";
        const res = await window.windyDropLibrary.installDrop({
          id: item.id,
          version: item.current_version,
          name: item.name,
          subtitle: item.subtitle,
          type: item.type,
        });
        if (!res || !res.ok) {
          btn.disabled = false;
          btn.textContent = "Try again";
          setStatus(`⚠️ Couldn't install ${item.name || item.id}. Try again in a moment.`, true);
        }
        // onLibraryChanged → refreshDropMenu + refreshMarketCatalog (below).
      });
    });
  }

  function renderMarketCard(item, installed) {
    const isInstalled = installed.some(
      (i) => i.id === item.id && (i.source !== "builtin" || !i.source),
    );
    const isBuiltin = installed.some((i) => i.id === item.id && i.source === "builtin");
    let actionHtml;
    if (isBuiltin) {
      actionHtml = `<span class="badge builtin">Built-in</span>`;
    } else if (isInstalled) {
      actionHtml = `<span class="badge installed">Installed</span>`;
    } else {
      actionHtml = `<button type="button" data-action="install" data-drop-id="${escapeAttr(item.id)}">+ Install</button>`;
    }
    return `
      <div class="market-card">
        <div class="card-type">${escapeText(item.type || "drop")}</div>
        <div class="card-name">${escapeText(item.name || item.id)}</div>
        <div class="card-subtitle">${escapeText(item.subtitle || "")}</div>
        <div class="card-actions">${actionHtml}</div>
      </div>
    `;
  }

  if (topbarCta) {
    topbarCta.addEventListener("click", openMarket);
  }
  if (marketBackBtn) {
    marketBackBtn.addEventListener("click", closeMarket);
  }
  // ESC closes the marketplace.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isMarketOpen()) closeMarket();
  });

  // Vitals tick — 1Hz. Push to whichever host is currently mounted.
  let vitalsTimer = null;
  let fleetTimer = null;
  function startTimers() {
    if (!vitalsTimer) {
      vitalsTimer = setInterval(async () => {
        const v = await fetchVitals();
        if (v) {
          latestVitals = v;
          if (activeHost) activeHost.updateVitals(v);
        }
      }, VITALS_REFRESH_MS);
    }
    if (!fleetTimer) {
      fleetTimer = setInterval(async () => {
        const f = await fetchFleet(token, accountServerUrl);
        if (f) {
          latestFleet = f;
          if (activeHost) activeHost.updateFleet(f);
        }
      }, FLEET_REFRESH_MS);
    }
  }
  function stopTimers() {
    if (vitalsTimer) {
      clearInterval(vitalsTimer);
      vitalsTimer = null;
    }
    if (fleetTimer) {
      clearInterval(fleetTimer);
      fleetTimer = null;
    }
  }

  // Pause refresh when window is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimers();
    else startTimers();
  });
  startTimers();

  // React to drop selection changes from the library service.
  if (window.windyDropLibrary && typeof window.windyDropLibrary.onSelectionChanged === "function") {
    window.windyDropLibrary.onSelectionChanged(async () => {
      const next = await resolveSelectedDrop();
      if (!next) return;
      if (!activeDrop || next.id !== activeDrop.id || next.version !== activeDrop.version) {
        mountDrop(next);
      }
      setCurrentName(next.name || next.id);
      await refreshDropMenu();
    });
  }
  // React to library changes (install / uninstall) — refresh the menu
  // so newly-installed drops appear without restart, and refresh the
  // marketplace cards so install buttons flip to "Installed" badges.
  if (window.windyDropLibrary && typeof window.windyDropLibrary.onLibraryChanged === "function") {
    window.windyDropLibrary.onLibraryChanged(async () => {
      await refreshDropMenu();
      if (isMarketOpen()) await refreshMarketCatalog();
    });
  }

  window.addEventListener("beforeunload", () => {
    stopTimers();
    unmountActive();
  });
}

main().catch((err) => {
  console.error("[control-panel] fatal:", err);
  setStatus(`⚠️ Fatal: ${err && err.message ? err.message : String(err)}`, true);
});
