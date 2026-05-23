/**
 * postMessage dispatcher for the embed-protocol's `inline`
 * transport. Wraps `window.postMessage` /
 * `addEventListener("message")` with origin validation +
 * payload type-narrowing + listener-cleanup so the docs-site
 * host (`<AnnotEditorIframeModal>`, Phase 5e) and the cloud
 * editor (`/embed` route, annot-cloud's Phase 5y) both speak
 * the same typed protocol.
 *
 * Phase 5c of `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * Two factories — one for each side of the pipe:
 *
 * - `createEmbedHostMessenger({ frame, expectedOrigin, onEvent })`
 *   runs on the docs-site side. Listens for `message` events
 *   whose `source` matches `frame.contentWindow` and whose
 *   `origin` matches `expectedOrigin`, then forwards typed
 *   `EmbedEvent` payloads to `onEvent`. `sendEvent` posts back
 *   to the iframe's content window.
 *
 * - `createEmbedClientMessenger({ parentOrigin, onEvent })`
 *   runs on the cloud-editor side. Listens for `message`
 *   events from `window.parent` whose origin matches the
 *   configured parent. `sendEvent` posts up to the parent.
 *
 * Both return an `EmbedMessenger` handle with `sendEvent` +
 * `cleanup`. Cleanup is idempotent — calling it twice is safe.
 *
 * Tier A — uses DOM globals (`window`, `MessageEvent`,
 * `HTMLIFrameElement`) but happy-dom-compatible, so the
 * package's `target: "es2022"` build stays browser-friendly
 * without pulling Node's DOM-shim deps in.
 */

import { type EmbedEvent, isEmbedEvent } from "./events.js";

/**
 * Common shape returned by both messenger factories.
 */
export interface EmbedMessenger {
  /** Post a typed event to the peer window. Throws if called
   *  after cleanup. */
  readonly sendEvent: (event: EmbedEvent) => void;
  /** Tear down the message listener. Idempotent — calling twice
   *  is a no-op (a `<annot-editor-iframe-modal>`-style host
   *  might cleanup on both `disconnectedCallback` and the
   *  user-dismissed-modal handler; both should be safe). */
  readonly cleanup: () => void;
}

/**
 * Configuration for the docs-site-side messenger. The host
 * mounts the iframe + creates one of these to relay editor
 * events back to the page's UI.
 */
export interface EmbedHostMessengerOptions {
  /** The iframe element hosting the embedded editor. */
  readonly frame: HTMLIFrameElement;
  /** Expected origin of the editor — postMessages from other
   *  origins are dropped silently. Pass the same value used to
   *  build the iframe `src` via
   *  `encodeEmbedRequestUrl({ cloudUrl, … })`. */
  readonly expectedOrigin: string;
  /** Called when a typed `EmbedEvent` arrives from the
   *  editor's content window. Non-EmbedEvent payloads + cross-
   *  origin / cross-source messages are dropped before calling
   *  this. */
  readonly onEvent: (event: EmbedEvent) => void;
  /** Optional window override. Defaults to the global
   *  `window`. Tests pass a happy-dom-supplied window so
   *  multiple parallel messengers don't trample each other. */
  readonly window?: Window;
}

/**
 * Configuration for the editor-side (annot-cloud) messenger.
 * Exposed in this package so annot-cloud's `/embed` route can
 * `import { createEmbedClientMessenger } from
 * "@ingcreators/annot-embed-protocol"` rather than maintain its
 * own copy.
 */
export interface EmbedClientMessengerOptions {
  /** Expected origin of the parent docs site. */
  readonly parentOrigin: string;
  /** Called when a typed `EmbedEvent` arrives from the parent. */
  readonly onEvent: (event: EmbedEvent) => void;
  /** Optional window override. Defaults to the global
   *  `window`. */
  readonly window?: Window;
}

class CleanupAfterDestroyError extends Error {
  constructor() {
    super("EmbedMessenger.sendEvent called after cleanup");
    this.name = "CleanupAfterDestroyError";
  }
}

/**
 * Creates a messenger for the docs-site host (the page that
 * embeds the cloud editor in an iframe).
 *
 * @throws Error if `frame.contentWindow` is null at construction
 * time. The host should call this after the iframe has loaded
 * (e.g. inside the iframe's `load` event handler) so the
 * content window is reachable.
 */
export function createEmbedHostMessenger(options: EmbedHostMessengerOptions): EmbedMessenger {
  const win = options.window ?? globalThis.window;
  if (!win) {
    throw new Error("createEmbedHostMessenger requires a window");
  }
  const contentWindow = options.frame.contentWindow;
  if (!contentWindow) {
    throw new Error(
      "createEmbedHostMessenger: frame.contentWindow is null — wait for the iframe's `load` event before constructing",
    );
  }

  let active = true;
  const listener = (rawEvent: MessageEvent): void => {
    if (!active) return;
    if (rawEvent.source !== contentWindow) return;
    if (rawEvent.origin !== options.expectedOrigin) return;
    if (!isEmbedEvent(rawEvent.data)) return;
    options.onEvent(rawEvent.data);
  };
  win.addEventListener("message", listener);

  return {
    sendEvent(event: EmbedEvent): void {
      if (!active) throw new CleanupAfterDestroyError();
      contentWindow.postMessage(event, options.expectedOrigin);
    },
    cleanup(): void {
      if (!active) return;
      active = false;
      win.removeEventListener("message", listener);
    },
  };
}

/**
 * Creates a messenger for the cloud-editor side (the page
 * loaded inside the docs-site's iframe). Posts to
 * `window.parent`; rejects messages whose source isn't the
 * parent.
 */
export function createEmbedClientMessenger(options: EmbedClientMessengerOptions): EmbedMessenger {
  const win = options.window ?? globalThis.window;
  if (!win) {
    throw new Error("createEmbedClientMessenger requires a window");
  }
  const parent = win.parent;
  // In happy-dom + jsdom, `window.parent === window` when not
  // actually embedded. Reject construction in that case so
  // tests catch the "ran as top-level page" misconfiguration
  // loudly rather than producing a silently-non-functional
  // messenger.
  if (parent === win) {
    throw new Error(
      "createEmbedClientMessenger: window.parent === window — not embedded in an iframe",
    );
  }

  let active = true;
  const listener = (rawEvent: MessageEvent): void => {
    if (!active) return;
    if (rawEvent.source !== parent) return;
    if (rawEvent.origin !== options.parentOrigin) return;
    if (!isEmbedEvent(rawEvent.data)) return;
    options.onEvent(rawEvent.data);
  };
  win.addEventListener("message", listener);

  return {
    sendEvent(event: EmbedEvent): void {
      if (!active) throw new CleanupAfterDestroyError();
      parent.postMessage(event, options.parentOrigin);
    },
    cleanup(): void {
      if (!active) return;
      active = false;
      win.removeEventListener("message", listener);
    },
  };
}
