// createHost — the framework-agnostic loader for control-panel-template
// drops. Mounts a sandboxed iframe pointed at the bundle's render.html,
// bridges Vitals + Fleet updates via the locked postMessage protocol,
// and surfaces ready/rendered/error events back to the consumer.
import { MSG_READY, MSG_RENDERED, MSG_ERROR, buildDataUpdate, parseFromChildMessage, } from "./protocol.js";
export const DEFAULT_BUNDLE_ORIGIN = "https://drops.windydrops.com";
export const DEFAULT_IFRAME_TITLE = "Windy Control Panel drop";
function joinUrl(origin, dropId, version) {
    const trimmed = origin.endsWith("/") ? origin.slice(0, -1) : origin;
    return `${trimmed}/${encodeURIComponent(dropId)}/${encodeURIComponent(version)}/render.html`;
}
// Per ADR-053 §"Sandbox security model (v1)", the iframe ALWAYS uses
// `sandbox="allow-scripts"` only (no `allow-same-origin`). That forces
// the iframe into a null origin regardless of where its src came from:
//   - messages FROM the iframe arrive with `event.origin === "null"`
//   - messages TO the iframe must use `targetOrigin: "*"` (the spec
//     doesn't allow "null" as a targetOrigin value)
// The actual security boundary is the `event.source === contentWindow`
// check, not the origin string.
const NULL_ORIGIN = "null";
export function createHost(opts) {
    const winMaybe = opts.window ?? globalThis.window;
    if (!winMaybe) {
        throw new Error("createHost: no window available (pass opts.window in non-browser environments)");
    }
    const win = winMaybe;
    const doc = win.document;
    const bundleOrigin = opts.bundleOrigin ?? DEFAULT_BUNDLE_ORIGIN;
    const iframeSrc = joinUrl(bundleOrigin, opts.dropId, opts.version);
    let iframe = null;
    let mounted = false;
    let isReady = false;
    // Latest known payloads. Buffered so the consumer can call
    // updateVitals/updateFleet before `ready` fires, and the host flushes
    // a single `data-update` once the drop signals readiness.
    let latestVitals = opts.initialVitals;
    let latestFleet = opts.initialFleet;
    const listeners = {
        [MSG_READY]: new Set(),
        [MSG_RENDERED]: new Set(),
        [MSG_ERROR]: new Set(),
    };
    function emit(event) {
        for (const listener of listeners[event.type]) {
            try {
                listener(event);
            }
            catch {
                // Listener errors are isolated — one consumer's bad handler
                // can't poison the others.
            }
        }
    }
    function postToChild(message) {
        if (!iframe || !iframe.contentWindow)
            return;
        // Null-origin iframes can only receive postMessage with target
        // "*". The spec doesn't permit "null" as a `targetOrigin` value,
        // and "/" (same-origin as parent) isn't what we want either. "*"
        // sounds permissive, but the `source` check on the receiving side
        // is the real security boundary — sandbox="allow-scripts" without
        // allow-same-origin keeps the iframe from reading parent DOM, and
        // a non-target frame can't intercept a message it has no handle to.
        iframe.contentWindow.postMessage(message, "*");
    }
    function flushIfReady() {
        if (!isReady || !iframe)
            return;
        if (latestVitals === undefined || latestFleet === undefined)
            return;
        postToChild(buildDataUpdate(latestVitals, latestFleet));
    }
    function handleMessage(event) {
        // The contentWindow check is the real security boundary — only the
        // iframe we mounted can send us messages we'll act on. The origin
        // check is a defense-in-depth string match; for the sandbox model
        // ADR-053 locks in (`allow-scripts` only), `event.origin` is the
        // literal string "null".
        if (!iframe || event.source !== iframe.contentWindow)
            return;
        if (event.origin !== NULL_ORIGIN)
            return;
        const msg = parseFromChildMessage(event.data);
        if (!msg)
            return; // silently drop malformed envelopes
        if (msg.type === MSG_READY) {
            isReady = true;
            emit({ type: MSG_READY });
            flushIfReady();
        }
        else if (msg.type === MSG_RENDERED) {
            emit({ type: MSG_RENDERED });
        }
        else if (msg.type === MSG_ERROR) {
            emit({ type: MSG_ERROR, error: msg.error });
        }
        // (DiscriminatedUnion exhaustiveness — TS will flag if FromChildMessage gains a member.)
        const _exhaustive = [];
        void _exhaustive;
        void msg;
    }
    function mount() {
        if (mounted)
            return;
        iframe = doc.createElement("iframe");
        iframe.src = iframeSrc;
        iframe.setAttribute("sandbox", "allow-scripts");
        iframe.setAttribute("referrerpolicy", "no-referrer");
        iframe.setAttribute("loading", "lazy");
        iframe.setAttribute("title", opts.iframeTitle ?? DEFAULT_IFRAME_TITLE);
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "0";
        iframe.style.display = "block";
        win.addEventListener("message", handleMessage);
        opts.container.appendChild(iframe);
        mounted = true;
    }
    function unmount() {
        if (!mounted)
            return;
        win.removeEventListener("message", handleMessage);
        if (iframe && iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
        }
        iframe = null;
        mounted = false;
        isReady = false;
    }
    return {
        mount,
        unmount,
        updateVitals(vitals) {
            latestVitals = vitals;
            flushIfReady();
        },
        updateFleet(fleet) {
            latestFleet = fleet;
            flushIfReady();
        },
        on(event, listener) {
            listeners[event].add(listener);
            return () => listeners[event].delete(listener);
        },
        get iframeSrc() {
            return iframeSrc;
        },
    };
}
