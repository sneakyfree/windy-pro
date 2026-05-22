// Vendored, Zod-free slim copy of @windy/control-panel-protocols.
// Source of truth: sneakyfree/windy-control-panel/packages/protocols/.
// The canonical package ships full Zod schemas; this vendored copy
// exposes only the constants the in-app host loaders need at runtime,
// so the Electron renderer doesn't have to pull Zod through a bundler.
// See feedback_vendor_drift_guard_pattern in auto-memory.

export const VITALS_V1_SCHEMA_ID = "windy.vitals.v1";
export const FLEET_V1_SCHEMA_ID = "windy.fleet.v1";

export const VITALS_SOURCES = [
  "electron-local",
  "agent-vps",
  "account-server",
  "mobile",
  "cloud-aggregator",
];

export const HOST_PLATFORMS = [
  "darwin",
  "linux",
  "win32",
  "ios",
  "android",
  "unknown",
];

export const AGENT_STATUSES = ["online", "offline", "unknown"];
export const AGENT_AUTH_TYPES = ["cf-access", "bearer", "none"];
export const THERMAL_STATES = ["ok", "fair", "serious", "critical"];
