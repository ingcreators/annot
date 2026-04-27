import { logger } from "../logger.js";
import type { BackgroundToContentMessage } from "../shared/messages.js";
import { startAreaSelection } from "./area-selector.js";
import { capturePageMetadata } from "./page-metadata.js";
import { hideProgress, showProgress } from "./progress-overlay.js";
import { getPageDimensions, scrollTo } from "./scroll-controller.js";
import {
  hideForCapture,
  hideStickies,
  restoreAfterCapture,
  restoreStickies,
} from "./sticky-handler.js";

// Guard against double injection
if ((window as any).__anno_injected) {
  // Already injected, skip
  logger.debug("[annot] content script reinjected — guard active");
} else {
  (window as any).__anno_injected = true;
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
        startAreaSelection();
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

      case "get-page-metadata":
        // Runs synchronously — capture is O(interactive elements),
        // typically a few ms. The optional `area` (viewport coords)
        // narrows the captureRect for area / region screenshots so
        // the editor doesn't list elements outside the captured
        // region with garbage coordinates.
        try {
          const meta = capturePageMetadata(msg.area);
          logger.debug(
            "[annot] sending metadata:",
            meta.elements.length,
            "elements, captureRect:",
            meta.captureRect,
          );
          sendResponse(meta);
        } catch (err) {
          // Never let a metadata failure derail capture. Log + send
          // null so the caller uses the "no metadata" fallback path.
          console.warn("[annot] page metadata capture failed", err);
          sendResponse(null);
        }
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
    if ((e.target as HTMLElement)?.closest?.("[data-anno-ui]")) return;

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

    try {
      chrome.runtime.sendMessage({
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
    } catch {
      // Service worker may have been reloaded; ignore
    }
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
