// Vendored, Zod-free slim port of @windy/control-panel-host-web/protocol.
// Source of truth: sneakyfree/windy-control-panel/packages/host-web/src/protocol.ts.
// The canonical package validates envelopes with Zod; here we hand-
// validate the 3 child-direction message types (ready/rendered/error)
// to keep the renderer bundler-free. The wire protocol is identical.

export const MSG_READY = "ready";
export const MSG_DATA_UPDATE = "data-update";
export const MSG_MOCK_DATA = "mock-data";
export const MSG_RENDERED = "rendered";
export const MSG_ERROR = "error";

export function buildDataUpdate(vitals, fleet) {
  return { type: MSG_DATA_UPDATE, payload: { vitals, fleet } };
}

// Returns the typed message on a valid envelope, null otherwise.
// Closed match against the 3 child→parent shapes; extra keys reject
// (parity with the canonical Zod .strict() rule).
export function parseFromChildMessage(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (data.type === MSG_READY && keys.length === 1) return { type: MSG_READY };
  if (data.type === MSG_RENDERED && keys.length === 1) return { type: MSG_RENDERED };
  if (
    data.type === MSG_ERROR &&
    keys.length === 2 &&
    typeof data.error === "string"
  ) {
    return { type: MSG_ERROR, error: data.error };
  }
  return null;
}
