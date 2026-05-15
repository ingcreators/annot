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
 * Phase 4B grows the preload's protocol with click-capture
 * tracking, hotkey-context probing, and a `contextmenu` listener
 * that lets the chrome render an in-app capture menu near the
 * right-click point. The wire format below stays a strict
 * superset of 4A's so chrome ↔ preload version skew tolerates
 * incremental rollouts.
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
 *     click-detected / context-menu-request). No reqId —
 *     fire-and-forget.
 *
 * The preload runs in an isolated context with `ipcRenderer` from
 * Electron AND the page's DOM. JS globals are isolated from the
 * page's so we don't pollute its window namespace.
 */

import {
  type ContentBus,
  getPageDimensions,
  hideForCapture,
  hideProgress,
  hideStickies,
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
// Electron preload context — `electron` is provided at runtime even
// without `contextIsolation: false`. The capture content modules
// are bundled inline.
import { ipcRenderer } from "electron";

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
      enableClickCapture();
      return true;

    case "click-capture-disable":
      disableClickCapture();
      return true;

    case "get-capture-context":
      return getCaptureContext();

    case "auto-capture-enable":
    case "auto-capture-disable":
      // Auto Capture (DOM-mutation-driven) is a Chrome-extension-only
      // surface today (Phase 2 of
      // `docs/plans/browser-extension-web-optimized-pudding.md`). The
      // desktop Browse window hasn't wired it yet — the host should
      // never send these messages here, but exhaustive narrowing
      // requires us to acknowledge them. Future Browse-window
      // support would install a MutationObserver on the page DOM
      // and post `auto-capture-signal` events via the
      // `annot.content.event` channel.
      return true;

    default: {
      const _exhaustive: never = msg;
      throw new Error(
        `[content-preload] unknown message type: ${(_exhaustive as { type: string }).type}`,
      );
    }
  }
}

// ---- Mouse / focus tracking (for Hotkey Capture) ----
//
// Mirrors `packages/extension/src/content/index.ts`'s same listener
// — the orchestrator side pulls via `get-capture-context` to
// resolve the cursor / focused-element context just before a
// hotkey shot, so the captured image is annotated against the
// correct target.

let lastMouseX = -1;
let lastMouseY = -1;
let lastMouseAt = 0;

document.addEventListener(
  "mousemove",
  (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    lastMouseAt = Date.now();
  },
  { passive: true, capture: true },
);

function pickMeaningfulAncestor(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const tag = cur.tagName;
    const role = cur.getAttribute("role");
    if (
      tag === "A" ||
      tag === "BUTTON" ||
      tag === "INPUT" ||
      tag === "LABEL" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      role === "button" ||
      role === "link" ||
      role === "tab" ||
      role === "menuitem"
    )
      return cur;
    cur = cur.parentElement;
  }
  return el;
}

function getCaptureContext(): {
  mouse?: { x: number; y: number };
  rect?: { x: number; y: number; width: number; height: number };
  target: string;
  url: string;
  title: string;
  dpr: number;
} {
  const now = Date.now();
  const mouseFresh = lastMouseX >= 0 && now - lastMouseAt < 5000; // ≤5s old

  let el: HTMLElement | null = null;
  if (mouseFresh) {
    el = document.elementFromPoint(lastMouseX, lastMouseY) as HTMLElement | null;
  }
  if (!el && document.activeElement && document.activeElement !== document.body) {
    el = document.activeElement as HTMLElement;
  }
  const meaningful = pickMeaningfulAncestor(el);

  let rect: { x: number; y: number; width: number; height: number } | undefined;
  try {
    const r = meaningful?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
  } catch {
    /* ignore */
  }

  return {
    mouse: mouseFresh ? { x: lastMouseX, y: lastMouseY } : undefined,
    rect,
    target: meaningful?.tagName || "",
    url: location.href,
    title: document.title,
    dpr: window.devicePixelRatio || 1,
  };
}

// ---- Click capture ----
//
// Mirrors `packages/extension/src/content/index.ts` byte-for-byte
// (modulo the bus transport). The chrome side toggles the
// listener via `click-capture-enable` / `click-capture-disable`;
// while active, every click on the page emits a `click-detected`
// event the chrome's `clickState` machine consumes.

let clickListenerActive = false;

function onClickCapture(e: MouseEvent): void {
  // Ignore clicks from our own content-script UI overlays
  if ((e.target as HTMLElement)?.closest?.("[data-annot-ui]")) return;

  const target = e.target as HTMLElement | null;

  // Capture the bounding rect of the clicked element. Walk up to
  // find a "meaningful" ancestor so that clicking an inner <span>
  // inside a <button> highlights the button (which is usually what
  // the user intends to mark).
  let rectEl: HTMLElement | null = target;
  while (rectEl && rectEl !== document.body) {
    const tag = rectEl.tagName;
    if (
      tag === "A" ||
      tag === "BUTTON" ||
      tag === "INPUT" ||
      tag === "LABEL" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      rectEl.getAttribute("role") === "button" ||
      rectEl.getAttribute("role") === "link" ||
      rectEl.getAttribute("role") === "tab" ||
      rectEl.getAttribute("role") === "menuitem"
    )
      break;
    rectEl = rectEl.parentElement;
  }
  if (!rectEl || rectEl === document.body) rectEl = target;

  let rect: { x: number; y: number; width: number; height: number } | undefined;
  try {
    const r = rectEl?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
  } catch {
    /* ignore */
  }

  bus.send({
    type: "click-detected",
    x: e.clientX,
    y: e.clientY,
    pageX: e.pageX,
    pageY: e.pageY,
    dpr: window.devicePixelRatio || 1,
    target: rectEl?.tagName || target?.tagName || "",
    url: location.href,
    title: document.title,
    rect,
  });
}

function enableClickCapture(): void {
  if (clickListenerActive) return;
  clickListenerActive = true;
  // Capture-phase to beat any stopPropagation in page code
  document.addEventListener("click", onClickCapture, true);
}

function disableClickCapture(): void {
  if (!clickListenerActive) return;
  clickListenerActive = false;
  document.removeEventListener("click", onClickCapture, true);
}

// ---- In-app context menu request ----
//
// Right-click anywhere in the embedded page suppresses the OS-
// native context menu and posts a `context-menu-request` event.
// The chrome's renderer positions an in-app menu (six capture
// modes) near the cursor. The chrome extension uses Chrome's
// runtime context-menu API for the same UX; here we render
// host-side so the menu's options match the toolbar's exactly.

document.addEventListener(
  "contextmenu",
  (e) => {
    // Don't consume right-clicks in our own content-script
    // overlays (the area-selector overlay, progress overlay) —
    // those should keep their default behavior (no menu, no
    // request).
    if ((e.target as HTMLElement)?.closest?.("[data-annot-ui]")) return;
    e.preventDefault();
    bus.send({
      type: "context-menu-request",
      x: e.clientX,
      y: e.clientY,
    });
  },
  { capture: true },
);
