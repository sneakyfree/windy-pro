// Re-exports for `@windy/control-panel-host-web`.
//
// Most callers will use `createHost` from the root export. The subpath
// exports (`/protocol`, `/host`) are available for advanced consumers
// (e.g. a custom test harness that needs to construct envelopes
// directly) and to keep tree-shaking ergonomic.
export { createHost, DEFAULT_BUNDLE_ORIGIN, DEFAULT_IFRAME_TITLE, } from "./host.js";
export { MSG_READY, MSG_RENDERED, MSG_ERROR, MSG_DATA_UPDATE, MSG_MOCK_DATA, ReadyMessageSchema, RenderedMessageSchema, ErrorMessageSchema, DataUpdateMessageSchema, MockDataMessageSchema, FromChildMessageSchema, FromParentMessageSchema, buildDataUpdate, parseFromChildMessage, } from "./protocol.js";
