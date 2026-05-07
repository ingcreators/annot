/**
 * `<webview>` content-script preload.
 *
 * Phase 4A of `docs/plans/desktop-browser-mode.md`: the Electron
 * Browse window's `<webview>` runs this preload before any page
 * script. It bridges the capture-package's `ContentBus` over
 * Electron IPC so the chrome-side `DesktopCaptureHost` can drive
 * the same DOM-helper code (`sticky-handler`, `scroll-controller`,
 * `area-selector`, `progress-overlay`) the chrome extension uses.
 *
 * Wire format:
 *
 *   - `annot.host.request` (chrome → preload)
 *     Payload: `{ reqId, msg }`. The preload dispatches `msg.type`
 *     to the matching capture-package helper and posts an
 *     `annot.content.response` with the same `reqId` carrying
 *     `{ ok, result?, error? }`.
 *
 *   - `annot.content.response` (preload → chrome)
 *     Sent via `ipcRenderer.sendToHost`. The chrome side
 *     correlates by `reqId` to settle the matching pending
 *     `host.sendToContent` promise.
 *
 *   - `annot.content.event` (preload → chrome)
 *     One-shot events the orchestrator subscribes to via
 *     `host.onContentMessage` (area-selected / area-cancelled /
 *     click-detected). No reqId — fire-and-forget.
 *
 * The preload runs in an isolated context with `ipcRenderer` from
 * Electron AND the page's DOM. JS globals are isolated from the
 * page's so we don't pollute its window namespace.
 */

// Electron preload context — `electron` is provided at runtime even
// without `contextIsolation: false`. The capture content modules
// are bundled inline.
import { ipcRenderer } from "electron";
import {
  type ContentBus,
  hideForCapture,
  hideProgress,
  hideStickies,
  getPageDimensions,
  restoreAfterCapture,
  restoreStickies,
  scrollTo,
  showProgress,
  startAreaSelection,
} from "@ingcreators/annot-capture/content";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
} from "@ingcreators/annot-capture/shared";

const HOST_REQUEST_CHANNEL = "annot.host.request";
const CONTENT_RESPONSE_CHANNEL = "annot.content.response";
const CONTENT_EVENT_CHANNEL = "annot.content.event";

/** Bus the capture content modules (e.g. `area-selector`) post
 *  one-shot events on. The chrome side subscribes via
 *  `webview.addEventListener("ipc-message", ...)` filtered to
 *  `CONTENT_EVENT_CHANNEL`. */
const bus: ContentBus = {
  send(msg: ContentToBackgroundMessage): void {
    try {
      ipcRenderer.sendToHost(CONTENT_EVENT_CHANNEL, msg);
    } catch {
      // Host webContents may have torn down (window close mid-
      // capture). Silently drop — content modules can't
      // recover anyway.
    }
  },
};

interface RequestEnvelope {
  reqId: string;
  msg: BackgroundToContentMessage;
}

interface ResponseEnvelope {
  reqId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

ipcRenderer.on(HOST_REQUEST_CHANNEL, (_evt, envelope: RequestEnvelope) => {
  void handleHostRequest(envelope);
});

async function handleHostRequest(envelope: RequestEnvelope): Promise<void> {
  const { reqId, msg } = envelope;
  let response: ResponseEnvelope;
  try {
    const result = await dispatch(msg);
    response = { reqId, ok: true, result };
  } catch (err: unknown) {
    response = {
      reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    ipcRenderer.sendToHost(CONTENT_RESPONSE_CHANNEL, response);
  } catch {
    /* host webContents gone — nothing to do */
  }
}

async function dispatch(msg: BackgroundToContentMessage): Promise<unknown> {
  switch (msg.type) {
    case "ping":
      // Health-check used by the host's `injectContentScript`
      // probe (no-op in Phase 4A; reserved so future re-injection
      // logic can ping without changing the wire format).
      return { ok: true };

    case "start-area-select":
      // Returns `true` synchronously — the actual
      // `area-selected` / `area-cancelled` event arrives later
      // via `bus.send(...)`. Same protocol shape as the chrome
      // extension's content script.
      startAreaSelection({ bus });
      return true;

    case "get-page-dimensions":
      return getPageDimensions();

    case "scroll-to":
      // Awaited so the orchestrator's `await` resolves only
      // after the requestAnimationFrame double-rAF that
      // `scrollTo` uses to wait for repaint.
      await scrollTo(msg.x, msg.y);
      return { type: "scroll-done" };

    case "hide-stickies":
      hideStickies();
      return true;

    case "restore-stickies":
      restoreStickies();
      return true;

    case "hide-for-capture":
      hideForCapture({
        overlays: msg.overlays,
        preservedSelectors: msg.preservedSelectors,
        scrollbars: msg.scrollbars,
      });
      return true;

    case "restore-after-capture":
      restoreAfterCapture();
      return true;

    case "show-progress":
      showProgress(msg.text);
      return true;

    case "hide-progress":
      hideProgress();
      return true;

    case "click-capture-enable":
    case "click-capture-disable":
    case "get-capture-context":
      // Phase 4B wires these into the click / hotkey flows.
      // Phase 4A returns a benign value so the orchestrator's
      // visible / area / scroll / per-page paths don't accidentally
      // exercise them.
      return null;

    default: {
      // Exhaustiveness fallback — a new message type added to
      // the capture package without a matching dispatch entry
      // here surfaces as an explicit error rather than silent
      // no-op. The cast tells TS we've covered every case
      // above; if a new variant lands, that line errors.
      const _exhaustive: never = msg;
      throw new Error(`[content-preload] unknown message type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}
