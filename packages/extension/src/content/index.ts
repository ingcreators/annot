/**
 * Chrome extension's content-script entry. Wires
 * `chrome.runtime.onMessage` / `chrome.runtime.sendMessage` to the
 * host-neutral helpers in `@ingcreators/annot-capture/content`.
 *
 * Phase 1A of `docs/plans/desktop-browser-mode.md`: the DOM-/canvas-
 * side capture helpers (sticky-handler, scroll-controller,
 * area-selector, progress-overlay) moved into the shared package and
 * this file became a thin chrome adapter. The package never imports
 * `chrome.*` itself; the `ContentBus` adapter below is the seam.
 */

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
import { logger } from "../logger.js";

const chromeContentBus: ContentBus = {
  send(msg: ContentToBackgroundMessage): void {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      // Service worker may have been reloaded; ignore.
    }
  },
};

// Guard against double injection
const guardWindow = window as Window & { __annot_injected?: boolean };
if (guardWindow.__annot_injected) {
  // Already injected, skip
  logger.debug("[annot] content script reinjected — guard active");
} else {
  guardWindow.__annot_injected = true;
  logger.debug("[annot] content script loaded");

  chrome.runtime.onMessage.addListener((msg: BackgroundToContentMessage, _sender, sendResponse) => {
    switch (msg.type) {
      // Health-check: lets the service worker's `injectContentScript`
      // distinguish "listener alive" from "no listener" / "orphaned
      // listener" cases. See the comment block on `injectContentScript`
      // in the service worker for the full rationale.
      case "ping":
        sendResponse({ ok: true });
        return false;

      case "start-area-select":
        startAreaSelection({ bus: chromeContentBus, log: logger.debug });
        break;

      case "get-page-dimensions":
        sendResponse(getPageDimensions());
        return false;

      case "scroll-to":
        scrollTo(msg.x, msg.y).then(() => sendResponse({ type: "scroll-done" }));
        return true; // async response

      case "hide-stickies":
        hideStickies();
        sendResponse(true);
        break;

      case "restore-stickies":
        restoreStickies();
        sendResponse(true);
        break;

      case "hide-for-capture":
        hideForCapture({
          overlays: msg.overlays,
          preservedSelectors: msg.preservedSelectors,
          scrollbars: msg.scrollbars,
        });
        sendResponse(true);
        break;

      case "restore-after-capture":
        restoreAfterCapture();
        sendResponse(true);
        break;

      case "show-progress":
        showProgress(msg.text);
        sendResponse(true);
        break;

      case "hide-progress":
        hideProgress();
        sendResponse(true);
        break;

      case "click-capture-enable":
        enableClickCapture();
        break;

      case "click-capture-disable":
        disableClickCapture();
        break;

      case "get-capture-context":
        sendResponse(getCaptureContext());
        return false;
    }

    return false;
  });

  // ---- Mouse / focus tracking (for Hotkey Capture) ----

  let lastMouseX = -1;
  let lastMouseY = -1;
  let lastMouseAt = 0;

  // Passive, throttled by the browser's internal mousemove coalescing.
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

    // Prefer the element under the cursor (if we have one), else activeElement.
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

  let clickListenerActive = false;

  function onClickCapture(e: MouseEvent) {
    // Ignore clicks from our own content-script UI overlays
    if ((e.target as HTMLElement)?.closest?.("[data-annot-ui]")) return;

    const target = e.target as HTMLElement | null;

    // Capture the bounding rect of the clicked element. Walk up to find a
    // "meaningful" ancestor so that clicking an inner <span> inside a <button>
    // highlights the button (which is usually what the user intends to mark).
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

    chromeContentBus.send({
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

  // On initial injection, read state from storage so we pick up an in-progress session
  try {
    chrome.storage.local.get(["clickCaptureActive"], (res) => {
      if (res.clickCaptureActive) enableClickCapture();
    });
  } catch {
    // storage may be unavailable in some contexts
  }
} // end guard
