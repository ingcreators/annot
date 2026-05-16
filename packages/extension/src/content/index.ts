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
      case "click-capture-disable":
        // Extension-side Click Capture was retired in
        // `docs/plans/browser-extension-web-optimized-pudding.md`.
        // The shared message types remain because the desktop Browse
        // window still uses them; the chrome service worker no
        // longer sends them, but be tolerant of stragglers from an
        // older service-worker build that hasn't reloaded yet.
        sendResponse(true);
        break;

      case "get-capture-context":
        sendResponse(getCaptureContext());
        return false;

      case "auto-capture-enable":
        enableAutoCapture(msg.stableWaitMs);
        break;

      case "auto-capture-disable":
        disableAutoCapture();
        break;
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

  // ---- Auto Capture (DOM-mutation-driven) ----

  let autoObserver: MutationObserver | null = null;
  let autoStableTimer: number | null = null;
  let autoStableWaitMs = 0;

  // Narrow attribute allowlist for the auto-capture MutationObserver.
  // These are the semantic state attributes modern UI libraries flip
  // when toggling visibility / activation on pre-rendered nodes; the
  // dropdown menus on https://claude.com/product/overview are the
  // motivating example. `class` / `style` are intentionally absent —
  // they fire on every `:hover` / animation frame.
  const AUTO_CAPTURE_ATTRIBUTE_FILTER: string[] = [
    "aria-expanded", // disclosure / dropdown buttons
    "aria-hidden", // overlay show / hide
    "aria-selected", // tab activation
    "aria-current", // breadcrumb / step / pagination
    "data-state", // Radix UI / shadcn / Headless UI
    "hidden", // global HTML hidden boolean
    "open", // <details> / <dialog>
  ];

  /**
   * Install a `MutationObserver` on `document.body` and signal the
   * service worker whenever mutations settle for `stableWaitMs`.
   *
   * Watch options:
   * - `childList: true` — node added/removed (the bulk of meaningful
   *   page change: dialogs open, lists update, navigations swap content).
   * - `subtree: true` — entire descendant tree counts.
   * - `characterData: true` — text-node edits (search-as-you-type,
   *   inline counters, etc.).
   * - `attributes: true` with a narrow `attributeFilter` allowlist —
   *   semantic state attributes that modern UI libraries flip when
   *   toggling visibility / activation. Covers patterns where the
   *   element is pre-rendered and a click only flips `aria-expanded`
   *   / `data-state` / `hidden` (Radix UI, Headless UI, shadcn,
   *   Framer Motion's pre-render-then-animate, native `<details>` /
   *   `<dialog>`). `class` and `style` are intentionally EXCLUDED:
   *   they fire on every `:hover` / `:focus-visible` / animation
   *   frame and would dominate the signal.
   *
   * Throttle / dedupe live service-worker-side so we can keep this
   * end as a thin signal source.
   */
  function enableAutoCapture(stableWaitMs: number): void {
    if (autoObserver) return; // already running — idempotent re-enable
    autoStableWaitMs = Math.max(0, stableWaitMs);
    autoObserver = new MutationObserver(onAutoCaptureMutation);
    autoObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: AUTO_CAPTURE_ATTRIBUTE_FILTER,
    });
    logger.debug("[annot] auto-capture observer installed, stableWait=", autoStableWaitMs);
  }

  function disableAutoCapture(): void {
    if (!autoObserver) return;
    autoObserver.disconnect();
    autoObserver = null;
    if (autoStableTimer !== null) {
      window.clearTimeout(autoStableTimer);
      autoStableTimer = null;
    }
    logger.debug("[annot] auto-capture observer removed");
  }

  function onAutoCaptureMutation(records: MutationRecord[]): void {
    // Skip mutations confined to our own UI overlays (progress
    // banner, area selector, etc.) — they're page-state plumbing,
    // not user-meaningful page change.
    if (records.every((r) => isAnnotUiNode(r.target))) return;

    if (autoStableTimer !== null) window.clearTimeout(autoStableTimer);
    autoStableTimer = window.setTimeout(() => {
      autoStableTimer = null;
      chromeContentBus.send({ type: "auto-capture-signal" });
    }, autoStableWaitMs);
  }

  function isAnnotUiNode(node: Node | null): boolean {
    if (!node) return false;
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : (node.parentElement as Element | null);
    return !!el?.closest?.("[data-annot-ui]");
  }
} // end guard
