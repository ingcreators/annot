/// <reference path="../types/chrome-extras.d.ts" />

import { newIdB58 } from "@ingcreators/annot-core/utils";
import { logger } from "../logger.js";
import { encodeCapture } from "../shared/encode.js";
import {
  loadSettings,
  parseSelectorList,
  resolveEmulation,
  type Settings,
  shouldHideOverlaysFor,
} from "../shared/settings.js";
// Static import of IDB store — used by external message API
import * as idbStore from "../storage/idb-store.js";
import {
  computeChromeDelta,
  computeDesiredWindowSize,
  DEFAULT_MAX_PAGES,
  DEFAULT_MIN_LAST_PAGE_CONTENT_PX,
  planPerPageStep,
  planScrollSegments,
} from "./capture-strategy.js";
import {
  ANNOTATION_URL,
  buildEditUrl,
  CLICK_CAPTURE_MAX_FRAMES,
  CLICK_CAPTURE_MIN_INTERVAL_MS,
  delay,
  HOTKEY_CAPTURE_MIN_INTERVAL_MS,
  IDB_MAX_AGE_MS,
  isCapturableUrl,
  MAX_CANVAS_DIMENSION,
  POST_HIDE_PAINT_MS,
  urlTags,
} from "./service-worker-helpers.js";

type CaptureKind = "visible" | "area" | "scroll" | "perPage" | "click" | "hotkey";

/**
 * Send hide/restore directives to the content script. `segmentIndex`
 * matters for scroll / perPage captures with `keepFirstSegment` enabled:
 * segment 0 keeps overlays visible (natural page top) while segments 1+
 * hide them to avoid repeating fixed headers in the stitched / per-page
 * output. Returns the loaded settings so callers can read timing / quality.
 */
async function beginCapturePrep(
  tabId: number,
  kind: CaptureKind,
  segmentIndex = 0,
  preloaded?: Settings,
): Promise<Settings> {
  const settings = preloaded ?? (await loadSettings());
  const hideOverlays = shouldHideOverlaysFor(
    kind,
    settings.overlays.mode,
    segmentIndex,
    settings.overlays.keepFirstSegment,
  );
  const hideScrollbars = settings.scrollbars.hide;
  // Always send the message so the content script tracks the CURRENT state.
  // In particular, transitioning from segment 0 (overlays shown) to
  // segment 1 (overlays hidden) requires an explicit hide call.
  try {
    await sendToTab(tabId, {
      type: "hide-for-capture",
      overlays: hideOverlays,
      preservedSelectors: parseSelectorList(settings.overlays.preservedSelectors),
      scrollbars: hideScrollbars,
    });
  } catch {
    /* content script may not be ready — ignore */
  }
  return settings;
}

async function endCapturePrep(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: "restore-after-capture" });
  } catch (err) {
    logger.debug("[capture-prep] restore-after-capture failed (tab gone or navigated):", err);
  }
}

async function showProgress(tabId: number | undefined, text: string): Promise<void> {
  if (tabId == null) return;
  try {
    await sendToTab(tabId, { type: "show-progress", text });
  } catch (err) {
    logger.debug("[capture-prep] show-progress failed:", err);
  }
}

async function hideProgress(tabId: number | undefined): Promise<void> {
  if (tabId == null) return;
  try {
    await sendToTab(tabId, { type: "hide-progress" });
  } catch (err) {
    logger.debug("[capture-prep] hide-progress failed:", err);
  }
}

/**
 * Run `fn` after physically resizing the browser window so the captured
 * tab renders at the user's chosen target viewport size. Restores the
 * original window geometry when `fn` completes (or throws). When
 * emulation is disabled or the preset is "native", runs `fn` as-is.
 *
 * Uses only `chrome.windows.update` + existing `tabs` permission — no
 * `debugger` permission (which Chrome forbids as optional) required.
 * Trade-offs vs. DevTools-based emulation:
 *   - Can't exceed the monitor's available screen area (clamp).
 *   - No DPR override (captures at the display's native pixel ratio).
 *   - No mobile UA / touch-event emulation.
 *   - The user sees their window briefly resize / move.
 */
async function withWindowResize<T>(
  tabId: number,
  windowId: number,
  settings: Settings,
  fn: () => Promise<T>,
): Promise<T> {
  const targetVp = resolveEmulation(settings);
  if (!targetVp) return fn();

  // Snapshot the current window so we can restore after.
  let originalWindow: chrome.windows.Window | null = null;
  try {
    originalWindow = await chrome.windows.get(windowId);
  } catch (e) {
    console.warn("[emulation] couldn't read window geometry — capturing at native size:", e);
    return fn();
  }

  // Measure the current viewport + DPR so we can:
  //   1. Compute the browser-chrome delta (tab bar + toolbar + scrollbar …)
  //   2. Convert the user's target (pixel) size into a CSS-viewport size
  //      by dividing by the device pixel ratio. Without this step, a
  //      display at DPR 1.5 would produce a 2880×1620 image for a Full HD
  //      target because `captureVisibleTab` delivers physical pixels.
  // The arithmetic itself lives in `./capture-strategy.ts` so it can
  // be unit-tested without `chrome.windows.*`.
  let dpr = 1;
  let chromeDelta = { width: 0, height: 0 };
  try {
    const dims: PageDimensions = await sendToTab(tabId, { type: "get-page-dimensions" });
    dpr = dims.devicePixelRatio || 1;
    chromeDelta = computeChromeDelta(
      { width: originalWindow.width, height: originalWindow.height },
      { width: dims.viewportWidth, height: dims.viewportHeight },
    );
  } catch {
    /* fall back to zero deltas / dpr=1 */
  }

  const desired = computeDesiredWindowSize(
    { width: targetVp.width, height: targetVp.height },
    dpr,
    chromeDelta,
  );

  let didResize = false;
  try {
    // `chrome.windows.update` clamps to the monitor's available work area,
    // so if the target exceeds the screen we'll capture at max-available.
    await chrome.windows.update(windowId, {
      width: desired.width,
      height: desired.height,
      state: "normal", // in case the window was maximized — forces explicit size
    });
    didResize = true;
    // Give the page time to reflow. Lazy images / media queries / flex
    // reflows commonly need 300–500 ms to settle.
    await delay(400);
    return await fn();
  } finally {
    if (didResize && originalWindow) {
      try {
        await chrome.windows.update(windowId, {
          width: originalWindow.width,
          height: originalWindow.height,
          left: originalWindow.left,
          top: originalWindow.top,
          state: originalWindow.state || "normal",
        });
      } catch {
        /* ignore — best effort restore */
      }
    }
  }
}

// Auto-cleanup: delete images older than 7 days on startup
(async () => {
  try {
    const images = await idbStore.listImages("");
    const cutoff = Date.now() - IDB_MAX_AGE_MS;
    for (const img of images) {
      const created = new Date(img.createdAt).getTime();
      if (created < cutoff) {
        await idbStore.deleteImage(img.path);
      }
    }
  } catch {
    /* ignore on startup */
  }
})();

interface CaptureSegment {
  dataUrl: string;
  offsetY: number;
}

interface PageDimensions {
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

// --- Helpers ---

// chrome.tabs.sendMessage / sendResponse payloads are method-specific
// JSON envelopes; the service worker is the receiver as well as a
// sender, so the boundary is fundamentally untyped. Keep `any`
// at the wire and let each individual handler narrow.
function sendToTab(tabId: number, msg: any): Promise<any> {
  return chrome.tabs.sendMessage(tabId, msg);
}

async function ensureOffscreen(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["BLOBS"],
      justification: "Image processing (stitch, crop, mosaic)",
    });
  }
}


/** Snapshot DOM-element metadata by injecting a self-contained
 *  walker into the TARGET PAGE'S MAIN world (NOT the content
 *  script's isolated world).
 *
 *  Why MAIN world: empirically, `getBoundingClientRect()` calls in
 *  the isolated world return 0×0 for descendants of cards using
 *  `content-visibility: auto` — even after `captureVisibleTab`
 *  forces a paint of the visible viewport, even after a per-element
 *  `getBoundingClientRect()` pre-walk in the isolated world. Page-
 *  side diagnostics (run in MAIN world via DevTools) on the SAME
 *  page state at the SAME viewport returned 1326 interactive
 *  elements; the isolated-world content script returned 0.
 *  Running the walker in MAIN world bypasses whatever Chrome
 *  isolation boundary causes that — page-world DOM access on cv:auto
 *  descendants returns real bboxes.
 *
 *  `area` (when set, in viewport CSS pixels) narrows the captureRect
 *  so area / per-page / scroll-stitch captures don't surface
 *  off-frame elements in the editor. Returns null if the injection
 *  fails (e.g. the URL isn't injectable). Failures are non-fatal —
 *  capture continues without metadata. */
async function requestPageMetadata(
  tabId: number,
  area?: { x: number; y: number; width: number; height: number },
): Promise<import("@ingcreators/annot-core").PageMetadata | null> {
  // chrome-types' `executeScript` overload pins `func` to `() => void`
  // and doesn't model the `args` -> `func` parameter relationship; cast
  // the call to bypass the overhead of writing a typed wrapper that
  // wouldn't gain anything at runtime.
  try {
    const results = await (
      chrome.scripting.executeScript as unknown as (
        i: Record<string, unknown>,
      ) => Promise<unknown[]>
    )({
      target: { tabId },
      world: "MAIN",
      // Args are structured-cloned into the page; no closure.
      args: [area ?? null],
      // Keep the full walker logic inline — chrome.scripting.executeScript
      // requires the function to be self-contained.
      func: (
        regionArg: { x: number; y: number; width: number; height: number } | null,
      ): import("@ingcreators/annot-core").PageMetadata => {
        const MAX_ELEMENTS = 2000;
        const MIN_AREA = 16;
        const region = regionArg ?? undefined;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const captureRect = region
          ? {
              x: region.x + scrollX,
              y: region.y + scrollY,
              width: region.width,
              height: region.height,
            }
          : {
              x: scrollX,
              y: scrollY,
              width: window.innerWidth,
              height: window.innerHeight,
            };

        function isInteresting(el: Element): boolean {
          const tag = el.tagName.toLowerCase();
          switch (tag) {
            case "button":
            case "a":
            case "input":
            case "select":
            case "textarea":
            case "label":
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
              return true;
          }
          const role = el.getAttribute("role");
          if (
            role &&
            /^(button|link|tab|menuitem|checkbox|radio|switch|textbox|combobox|searchbox|option|treeitem|slider|spinbutton)$/.test(
              role,
            )
          )
            return true;
          if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") return true;
          if (
            (el as HTMLElement).isContentEditable &&
            el.getAttribute("contenteditable") !== "inherit"
          )
            return true;
          return false;
        }

        function isVisuallyOnScreen(el: HTMLElement): boolean {
          try {
            if (el.getAttribute("aria-hidden") === "true") return false;
            const cv = (el as { checkVisibility?: (opts: object) => boolean }).checkVisibility;
            if (typeof cv === "function") {
              if (!cv.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
            } else {
              const style = window.getComputedStyle(el);
              if (style.display === "none") return false;
              if (style.visibility === "hidden" || style.visibility === "collapse") return false;
              if (Number.parseFloat(style.opacity || "1") <= 0.05) return false;
            }
            const r = el.getBoundingClientRect();
            if (r.width * r.height < MIN_AREA) return false;
            const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
            const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
            if (r.right < -5000 || r.left > docW + 5000) return false;
            if (r.bottom < -5000 || r.top > docH + 5000) return false;
            return true;
          } catch {
            return true;
          }
        }

        function implicitRole(el: Element): string | null {
          switch (el.tagName.toLowerCase()) {
            case "button":
              return "button";
            case "a":
              return (el as HTMLAnchorElement).href ? "link" : null;
            case "input": {
              const t = (el as HTMLInputElement).type;
              if (t === "button" || t === "submit" || t === "reset") return "button";
              if (t === "checkbox") return "checkbox";
              if (t === "radio") return "radio";
              if (t === "range") return "slider";
              if (t === "search") return "searchbox";
              return "textbox";
            }
            case "textarea":
              return "textbox";
            case "select":
              return "combobox";
            case "label":
              return null;
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
              return "heading";
          }
          return null;
        }

        function labelTextFor(el: HTMLElement): string | null {
          const id = el.id;
          if (id) {
            const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (lab?.textContent) return lab.textContent.trim().replace(/\s+/g, " ");
          }
          const closest = el.closest("label");
          if (closest?.textContent) return closest.textContent.trim().replace(/\s+/g, " ");
          return null;
        }

        function extractText(el: HTMLElement): string | undefined {
          const tag = el.tagName.toLowerCase();
          if (tag === "input") {
            const inp = el as HTMLInputElement;
            if (inp.type === "submit" || inp.type === "button" || inp.type === "reset") {
              return inp.value || undefined;
            }
            return labelTextFor(el) || undefined;
          }
          if (tag === "textarea") return labelTextFor(el) || undefined;
          if (tag === "select") {
            const sel = el as HTMLSelectElement;
            return sel.options[sel.selectedIndex]?.text || labelTextFor(el) || undefined;
          }
          const text = (el.textContent || "").trim().replace(/\s+/g, " ");
          if (!text) return undefined;
          return text.length > 120 ? `${text.slice(0, 117)}…` : text;
        }

        function cssSelector(el: Element): string {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const parts: string[] = [];
          let cur: Element | null = el;
          while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
            let part = cur.tagName.toLowerCase();
            const testId =
              cur.getAttribute("data-testid") || cur.getAttribute("data-test-id");
            if (testId) {
              part += `[data-testid="${CSS.escape(testId)}"]`;
              parts.unshift(part);
              break;
            }
            if (cur.parentElement) {
              const sibs = Array.from(cur.parentElement.children).filter(
                (c) => c.tagName === cur!.tagName,
              );
              if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
            }
            parts.unshift(part);
            cur = cur.parentElement;
          }
          return parts.join(" > ") || el.tagName.toLowerCase();
        }

        const elements: import("@ingcreators/annot-core").PageElement[] = [];
        let id = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (node) => {
            const el = node as Element;
            if (el.hasAttribute("data-annot-ui")) return NodeFilter.FILTER_REJECT;
            const tag = el.tagName.toLowerCase();
            if (
              tag === "script" ||
              tag === "style" ||
              tag === "noscript" ||
              tag === "link" ||
              tag === "meta"
            )
              return NodeFilter.FILTER_REJECT;
            return isInteresting(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          },
        });

        let node: Node | null;
        while ((node = walker.nextNode()) !== null && elements.length < MAX_ELEMENTS) {
          const el = node as HTMLElement;
          if (!isVisuallyOnScreen(el)) continue;
          const r = el.getBoundingClientRect();
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || implicitRole(el) || undefined;
          const text = extractText(el);
          const ariaLabel = el.getAttribute("aria-label") || undefined;
          const domId = el.id || undefined;
          const selector = cssSelector(el);
          let inputType: string | undefined;
          let placeholder: string | undefined;
          if (tag === "input") {
            inputType = (el as HTMLInputElement).type || "text";
            placeholder = (el as HTMLInputElement).placeholder || undefined;
          } else if (tag === "textarea") {
            placeholder = (el as HTMLTextAreaElement).placeholder || undefined;
          }
          let href: string | undefined;
          if (tag === "a") href = (el as HTMLAnchorElement).href || undefined;
          elements.push({
            id: `e${id++}`,
            tag,
            role,
            text,
            ariaLabel,
            inputType,
            placeholder,
            href,
            domId,
            bbox: [
              Math.round(r.left + scrollX),
              Math.round(r.top + scrollY),
              Math.round(r.width),
              Math.round(r.height),
            ],
            selector,
            visible: true,
          });
        }

        return {
          version: 1,
          url: location.href,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio || 1,
          scrollOffset: { x: scrollX, y: scrollY },
          captureRect,
          capturedAt: new Date().toISOString(),
          elements,
        };
      },
    });
    const result = (results?.[0] as { result?: unknown } | undefined)?.result;
    if (
      result &&
      typeof result === "object" &&
      Array.isArray((result as { elements?: unknown }).elements)
    ) {
      return result as import("@ingcreators/annot-core").PageMetadata;
    }
    return null;
  } catch (err) {
    console.warn("[annot] page metadata MAIN-world injection failed:", err);
    return null;
  }
}

async function openEditor(
  dataUrl: string,
  width?: number,
  height?: number,
  pageMetadata?: import("@ingcreators/annot-core").PageMetadata | null,
): Promise<void> {
  // Get source URL from the capture target (skips devtools / chrome:// tabs).
  let sourceUrl = "";
  let captureTabId: number | undefined;
  try {
    const tab = await findCaptureTarget();
    if (tab?.url) sourceUrl = tab.url;
    captureTabId = tab?.id ?? undefined;
  } catch (err) {
    logger.debug("[openEditor] findCaptureTarget failed:", err);
  }

  // Detect dimensions from image if not provided
  let w = width || 0;
  let h = height || 0;
  if (!w || !h) {
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      w = bmp.width;
      h = bmp.height;
      bmp.close();
    } catch (err) {
      logger.debug("[openEditor] image dimension probe failed:", err);
    }
  }

  // Auto-generate URL tags + per-image unique id
  const tags: Record<string, string> = { ...urlTags(sourceUrl), captureId: newIdB58() };

  // Fetch DOM metadata (one shot per capture) — only if not already
  // supplied by the caller. Some capture paths (scroll stitch) build
  // their own metadata across scroll positions so they pass it in.
  let meta = pageMetadata;
  if (meta === undefined && captureTabId !== undefined) {
    meta = await requestPageMetadata(captureTabId);
  }

  // Save to IndexedDB
  const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);
  const now = new Date().toISOString();
  const path = await idbStore.saveImage({
    originalDataUrl: dataUrl,
    thumbnailDataUrl,
    annotationsSvg: "",
    width: w,
    height: h,
    sourceUrl,
    tags,
    folderPath: "",
    createdAt: now,
    updatedAt: now,
    pageMetadata: meta ?? undefined,
  });

  const extId = chrome.runtime.id;
  const targetUrl = buildEditUrl(path, extId);

  const existing = await findAnnotTab();
  if (existing?.id) {
    // Send message to existing tab via executeScript (preserves in-memory
    // state like the FS handle, selected folder, etc.)
    try {
      await chrome.windows.update(existing.windowId!, { focused: true }).catch(() => {});
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.scripting.executeScript({
        target: { tabId: existing.id },
        // chrome-types declares `func: () => void` without a generic for
        // args, so we cast. Chrome passes `args` at runtime regardless.
        func: ((editPath: string, extId: string) => {
          window.dispatchEvent(
            new CustomEvent("annot-capture", {
              detail: { editPath, extId },
            }),
          );
        }) as () => void,
        args: [path, extId],
      });
      logger.debug("[openEditor] reused existing tab", existing.id, existing.url);
    } catch (e) {
      console.warn("[openEditor] executeScript failed, opening new tab:", e);
      chrome.tabs.create({ url: targetUrl });
    }
  } else {
    logger.debug("[openEditor] no existing Annot tab found, opening new");
    chrome.tabs.create({ url: targetUrl });
  }
}

/**
 * Reuse an existing Annot tab if one is open, otherwise create a new one.
 * Uses the given `extId` as a query param so the app can transfer pending
 * Extension IDB images to local storage on load (or in an existing tab,
 * triggers the same transfer via popstate).
 */
async function openOrReuseAnnotTab(extId: string, sessionId?: string): Promise<void> {
  const existing = await findAnnotTab();
  if (existing?.id) {
    try {
      await chrome.windows.update(existing.windowId!, { focused: true }).catch(() => {});
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.scripting.executeScript({
        target: { tabId: existing.id },
        func: ((extId: string, sessionId: string | null) => {
          const url = new URL(location.href);
          url.searchParams.set("extId", extId);
          if (sessionId) url.searchParams.set("session", sessionId);
          history.replaceState({}, "", url.toString());
          window.dispatchEvent(new PopStateEvent("popstate"));
        }) as () => void,
        args: [extId, sessionId ?? null],
      });
      logger.debug("[openOrReuseAnnotTab] reused tab", existing.id, "session=", sessionId);
      return;
    } catch (e) {
      console.warn("[openOrReuseAnnotTab] executeScript failed, opening new tab:", e);
    }
  }
  const params = new URLSearchParams({ extId });
  if (sessionId) params.set("session", sessionId);
  chrome.tabs.create({ url: `${ANNOTATION_URL}?${params.toString()}` });
}

/**
 * Find the most plausible tab to capture from. We must avoid `devtools://`,
 * `chrome://`, `chrome-extension://`, etc. — `captureVisibleTab` cannot read
 * those without elevated permissions and will throw an opaque error.
 *
 * Priority: active in current window → active in last-focused window →
 * any active tab → first http/https/file tab. The result is always a
 * capturable URL, or `undefined` if nothing usable is open.
 */

async function findCaptureTarget(): Promise<chrome.tabs.Tab | undefined> {
  // chrome-types doesn't export the query-info shape as a named type,
  // so widen via Parameters<...> against the function signature.
  type TabsQueryInfo = Parameters<typeof chrome.tabs.query>[0];
  const queries: TabsQueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { active: true },
  ];
  for (const q of queries) {
    try {
      const results = await chrome.tabs.query(q);
      const usable = results.find((t) => t.id != null && isCapturableUrl(t.url));
      if (usable) return usable;
    } catch {
      /* try next */
    }
  }
  // Last resort: any tab with a capturable URL, prefer most-recently-accessed
  const all = await chrome.tabs.query({});
  const candidates = all
    .filter((t) => t.id != null && isCapturableUrl(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0];
}

/** Locate an open Annot tab. Relaxed status check — even a loading tab is fine. */
async function findAnnotTab(): Promise<chrome.tabs.Tab | undefined> {
  // `tabs.query` with url filter requires `tabs` permission (we have it).
  try {
    const results = await chrome.tabs.query({ url: `${ANNOTATION_URL}/*` });
    if (results.length > 0) {
      // Prefer the most-recently-active tab
      results.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      return results.find((t) => t.id != null);
    }
  } catch (e) {
    console.warn("[findAnnotTab] filtered query failed, falling back:", e);
  }
  // Fallback: full scan + manual filter
  const all = await chrome.tabs.query({});
  return (
    all.find((t) => t.id && t.url?.startsWith(`${ANNOTATION_URL}/`)) ||
    all.find((t) => t.id != null && t.url === ANNOTATION_URL) ||
    all.find((t) => t.id != null && t.url?.startsWith(ANNOTATION_URL))
  );
}

async function openGallery(): Promise<void> {
  await openOrReuseAnnotTab(chrome.runtime.id);
}

/**
 * Vertically crop a PNG data URL: keep `keepHeight` rows starting at
 * source y = `srcY`, full original width. Used by per-page capture to
 * extract the exact slice of the captured viewport that corresponds to
 * the current page's content (the browser may clamp scroll-to past the
 * document bottom, so we can't rely on the requested scroll position).
 */
async function cropPngVertical(
  pngDataUrl: string,
  srcY: number,
  keepHeight: number,
): Promise<string> {
  const blob = await (await fetch(pngDataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const yClamped = Math.max(0, Math.min(srcY, bmp.height));
  const h = Math.max(0, Math.min(keepHeight, bmp.height - yClamped));
  if (h <= 0) {
    bmp.close();
    return pngDataUrl;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, yClamped, w, h, 0, 0, w, h);
  bmp.close();
  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(outBlob);
  });
}


// --- Capture visible area ---

async function captureVisible(): Promise<void> {
  try {
    const tab = await findCaptureTarget();
    if (!tab?.id || tab.windowId == null) {
      console.warn(
        "[capture-visible] no capturable tab found (devtools / chrome:// pages cannot be captured)",
      );
      return;
    }
    const settings = await loadSettings();
    await injectContentScript(tab.id);
    await withWindowResize(tab.id, tab.windowId, settings, async () => {
      await beginCapturePrep(tab.id!, "visible", 0, settings);
      // Give the browser a chance to paint the scrollbar-hiding /
      // sticky-hiding style that beginCapturePrep just injected.
      // Without this, captureVisibleTab can fire on the STALE frame
      // (scrollbar still rendered, stickies still visible), baking
      // them into the screenshot. The scroll / per-page paths already
      // waited via POST_HIDE_PAINT_MS; visible was missing it.
      await delay(POST_HIDE_PAINT_MS);
      try {
        const pngDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, {
          format: "png",
        });
        const encoded = await encodeCapture(pngDataUrl, settings);
        // Snapshot DOM metadata AFTER `captureVisibleTab` but BEFORE
        // `endCapturePrep` (in the `finally` below). This ordering is
        // load-bearing on two axes:
        //
        //  1. captureVisibleTab forces the browser to commit a paint
        //     of the visible viewport. That paint lays out any
        //     `content-visibility: auto` descendants currently on
        //     screen (modern news / feed pages put `content-visibility:
        //     auto` on every card so off-screen rows don't pay layout
        //     cost). Without that commit, `getBoundingClientRect()`
        //     on a skipped descendant returns 0×0 and serializeElement
        //     filters every interactive element out as "too small".
        //     Empirically: b.hatena.ne.jp returned 0 elements with the
        //     metadata snapshotted BEFORE captureVisibleTab; with this
        //     ordering, ~950 elements survive.
        //
        //  2. Stickies are STILL hidden at metadata time (they're
        //     restored by endCapturePrep below, after this snapshot).
        //     `visibility: hidden` cascades to descendants, so
        //     checkVisibility correctly filters out sticky-header /
        //     fixed-overlay descendants — exactly the elements that
        //     are also hidden in the screenshot pixels. The metadata's
        //     element list therefore matches the screenshot's
        //     contents 1:1; no "Element panel surfaces a sticky row
        //     that's not in the image" mismatch.
        const meta = await requestPageMetadata(tab.id!);
        openEditor(encoded.dataUrl, undefined, undefined, meta);
      } finally {
        await endCapturePrep(tab.id!);
      }
    });
  } catch (err) {
    console.error("Annot: captureVisible failed", err);
  }
}

// --- Capture selected area ---

async function captureArea(): Promise<void> {
  const tab = await findCaptureTarget();
  if (!tab?.id || tab.windowId == null) {
    console.warn("[capture-area] no capturable tab found");
    return;
  }

  await injectContentScript(tab.id);
  const settings = await loadSettings();

  // Area selection must happen under the emulated viewport so the user
  // drags on the actually-rendered content. Wrap everything.
  await withWindowResize(
    tab.id,
    tab.windowId,
    settings,
    () =>
      new Promise<void>((resolve) => {
        // chrome.runtime listener payloads are untyped on the wire.
        const handler = (msg: any): undefined => {
          if (msg.type === "area-selected") {
            chrome.runtime.onMessage.removeListener(handler);
            (async () => {
              await beginCapturePrep(tab.id!, "area", 0, settings);
              // Paint delay so the scrollbar-hiding / sticky-hiding styles
              // injected by beginCapturePrep are reflected in the captured
              // frame. Without it, captureVisibleTab can read the stale
              // pre-hide frame and bake the scrollbar / fixed elements
              // into the screenshot.
              await delay(POST_HIDE_PAINT_MS);
              try {
                const pngDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, {
                  format: "png",
                });
                // Metadata snapshot AFTER captureVisibleTab (forces
                // paint of `content-visibility: auto` descendants) but
                // BEFORE endCapturePrep below (stickies remain hidden,
                // so their descendants are filtered out of metadata to
                // match the screenshot pixels exactly). See
                // captureVisible for the full rationale.
                const areaMeta = await requestPageMetadata(tab.id!, {
                  x: msg.rect.x,
                  y: msg.rect.y,
                  width: msg.rect.width,
                  height: msg.rect.height,
                });
                await ensureOffscreen();
                const result = await chrome.runtime.sendMessage({
                  type: "offscreen-crop",
                  dataUrl: pngDataUrl,
                  rect: msg.rect,
                  dpr: msg.dpr,
                });
                if (result?.dataUrl) {
                  const encoded = await encodeCapture(result.dataUrl, settings);
                  const croppedW = Math.round(msg.rect.width * msg.dpr);
                  const croppedH = Math.round(msg.rect.height * msg.dpr);
                  openEditor(encoded.dataUrl, croppedW, croppedH, areaMeta);
                }
              } catch (err) {
                console.error("Annot: captureArea failed", err);
              } finally {
                await endCapturePrep(tab.id!);
              }
              resolve();
            })();
          } else if (msg.type === "area-cancelled") {
            chrome.runtime.onMessage.removeListener(handler);
            resolve();
          }
          return undefined;
        };
        chrome.runtime.onMessage.addListener(handler);
        sendToTab(tab.id!, { type: "start-area-select" });
      }),
  );
}

// --- Capture full page (scroll stitch) ---

async function captureFullPage(): Promise<void> {
  const tab = await findCaptureTarget();
  if (!tab?.id || tab.windowId == null) {
    console.warn("[capture-full] no capturable tab found");
    return;
  }

  await injectContentScript(tab.id);
  const settings = await loadSettings();

  await withWindowResize(tab.id, tab.windowId, settings, () =>
    captureFullPageInner(tab as CaptureTab, settings),
  );
}

type CaptureTab = chrome.tabs.Tab & { id: number; windowId: number };

async function captureFullPageInner(tab: CaptureTab, settings: Settings): Promise<void> {
  // Re-measure AFTER emulation is applied (viewport may differ).
  const dims: PageDimensions = await sendToTab(tab.id!, { type: "get-page-dimensions" });

  // Pure layout decisions (segment count, per-segment scrollY, stitch
  // canvas size + truncation flag) live in `./capture-strategy.ts`
  // so they can be exercised without `chrome.*`.
  const plan = planScrollSegments(dims, MAX_CANVAS_DIMENSION);
  if (plan.capped) {
    console.warn(
      `Page height ${dims.scrollHeight * dims.devicePixelRatio}px exceeds max canvas size. Capping.`,
    );
  }
  const originalScrollY = dims.scrollY;
  const segments: CaptureSegment[] = [];

  for (const seg of plan.segments) {
    await showProgress(tab.id, `Capturing ${seg.index + 1}/${plan.segments.length}…`);

    // Scroll first, let the page's scroll handlers fire (which is often
    // when sites add/toggle `position: fixed` on nav bars, FABs, etc.),
    // THEN hide overlays so the mutation catches the post-scroll state.
    await sendToTab(tab.id, { type: "scroll-to", x: 0, y: seg.scrollY });
    await delay(settings.timing.scrollSettleMs);
    // Hide directives may change between segment 0 and segment 1 when
    // `keepFirstSegment` is enabled, so refresh every iteration.
    await beginCapturePrep(tab.id, "scroll", seg.index, settings);
    // Tiny extra delay so the DOM mutation is painted before capture.
    await delay(POST_HIDE_PAINT_MS);

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });

    segments.push({
      dataUrl,
      offsetY: Math.round(seg.scrollY * dims.devicePixelRatio),
    });

    await delay(settings.timing.interSegmentMs);
  }

  // Snapshot DOM metadata for the WHOLE stitched document AFTER the
  // last `captureVisibleTab` (the most recently-visible
  // `content-visibility: auto` descendants are laid out) but BEFORE
  // `endCapturePrep` (stickies stay hidden, matching the screenshots
  // taken throughout the loop). The `area` argument rewrites
  // `captureRect` in document coords to span the entire stitched
  // image: `region` is viewport-relative, so we offset by the
  // CURRENT scroll (= last segment's scrollY) to make
  // `captureRect.y` land at 0 in document coords.
  const dimsAtEnd: PageDimensions = await sendToTab(tab.id, {
    type: "get-page-dimensions",
  });
  const stitchedMeta = await requestPageMetadata(tab.id, {
    x: -dimsAtEnd.scrollX,
    y: -dimsAtEnd.scrollY,
    width: dimsAtEnd.scrollWidth,
    height: dimsAtEnd.scrollHeight,
  });

  await endCapturePrep(tab.id);
  await sendToTab(tab.id, { type: "scroll-to", x: 0, y: originalScrollY });

  await showProgress(tab.id, `Stitching ${segments.length} segments…`);
  await ensureOffscreen();

  const result = await chrome.runtime.sendMessage({
    type: "offscreen-stitch",
    segments,
    width: plan.stitchWidth,
    height: plan.stitchHeight,
  });

  if (result?.dataUrl) {
    await showProgress(tab.id, "Compressing full-page image…");
    const encoded = await encodeCapture(result.dataUrl, settings);
    await showProgress(tab.id, "Saving…");
    await saveAsScrollSession(
      encoded.dataUrl,
      plan.stitchWidth,
      plan.stitchHeight,
      tab.url || "",
      stitchedMeta ?? undefined,
    );
  }
  await hideProgress(tab.id);
}

/**
 * Save a Scroll-Capture result as a session with one frame, then open Annot
 * in Split Editor mode. Users can split the tall capture into multiple
 * page-sized images.
 */
async function saveAsScrollSession(
  dataUrl: string,
  width: number,
  height: number,
  sourceUrl: string,
  pageMetadata?: import("@ingcreators/annot-core").PageMetadata,
): Promise<void> {
  const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);
  const now = new Date().toISOString();
  const sessionId = newIdB58();
  await idbStore.saveImage({
    originalDataUrl: dataUrl,
    thumbnailDataUrl,
    annotationsSvg: "",
    width,
    height,
    sourceUrl,
    tags: {
      ...urlTags(sourceUrl),
      captureId: newIdB58(),
      session: sessionId,
      sessionKind: "scroll",
      sessionIndex: "0",
      sessionTotal: "1",
      page: "1",
    },
    folderPath: "",
    createdAt: now,
    updatedAt: now,
    pageMetadata,
  });
  await openOrReuseAnnotTab(chrome.runtime.id, sessionId);
}

// --- Capture per-page (each viewport as separate image) ---

async function capturePages(): Promise<void> {
  const tab = await findCaptureTarget();
  if (!tab?.id || tab.windowId == null) {
    console.warn("[capture-pages] no capturable tab found");
    return;
  }

  await injectContentScript(tab.id);
  const settings = await loadSettings();

  await withWindowResize(tab.id, tab.windowId, settings, () =>
    capturePagesInner(tab as CaptureTab, settings),
  );
}

async function capturePagesInner(tab: CaptureTab, settings: Settings): Promise<void> {
  // Re-measure AFTER emulation (viewport may have changed).
  const dims: PageDimensions = await sendToTab(tab.id, { type: "get-page-dimensions" });

  const vpHeight = dims.viewportHeight;
  const originalScrollY = dims.scrollY;
  const sourceUrl = tab.url || "";

  const dpr = dims.devicePixelRatio;
  const fullHeightPx = Math.round(vpHeight * dpr);

  // ---- Phase 1: Scroll + capture everything as raw PNGs ----
  // The "what should we do this iteration?" decision (capture vs stop,
  // and the slice geometry when capturing) lives in `./capture-strategy`'s
  // `planPerPageStep`. The orchestrator here owns the I/O: scroll the
  // page, hide overlays, sleep, capture, push the raw PNG.
  interface RawPage {
    pngDataUrl: string;
    srcYpx: number;
    sliceHeightPx: number;
    /** Per-page DOM metadata snapshotted while stickies are still
     *  hidden — sticky-cascade filters their descendants out so the
     *  metadata's elements list 1:1 matches the screenshot pixels. */
    pageMetadata?: import("@ingcreators/annot-core").PageMetadata;
  }
  const rawPages: RawPage[] = [];
  let nextDocTop = 0;
  let pageIndex = 0;
  let lastActualScrollY = -1;

  while (pageIndex < DEFAULT_MAX_PAGES) {
    await showProgress(tab.id, `Capturing page ${pageIndex + 1}…`);

    await sendToTab(tab.id, { type: "scroll-to", x: 0, y: nextDocTop });
    await delay(settings.timing.scrollSettleMs);
    await beginCapturePrep(tab.id, "perPage", pageIndex, settings);
    await delay(POST_HIDE_PAINT_MS);

    const after: PageDimensions = await sendToTab(tab.id, { type: "get-page-dimensions" });
    const decision = planPerPageStep({
      pageIndex,
      nextDocTop,
      viewportHeight: vpHeight,
      scrollHeight: after.scrollHeight,
      actualScrollY: after.scrollY,
      devicePixelRatio: dpr,
      lastActualScrollY,
      minLastPageContentPx: DEFAULT_MIN_LAST_PAGE_CONTENT_PX,
    });

    if (decision.action === "stop") {
      logger.debug(`[capture-pages] ${decision.reason} at page ${pageIndex + 1}, stopping`);
      break;
    }
    lastActualScrollY = after.scrollY;

    const pngDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    // Snapshot per-page DOM metadata AFTER captureVisibleTab forced
    // a paint of this viewport (lays out `content-visibility: auto`
    // descendants currently on screen) but BEFORE the next iteration
    // restores stickies. The `area` argument narrows captureRect to
    // the slice this page contributes to the final image, so the
    // editor's Elements panel filters off-frame elements correctly.
    const dprNow = after.devicePixelRatio || dpr;
    const pageMeta = await requestPageMetadata(tab.id, {
      x: 0,
      y: decision.slice.srcYpx / dprNow,
      width: dims.viewportWidth,
      height: decision.slice.sliceHeightPx / dprNow,
    });
    rawPages.push({
      pngDataUrl,
      srcYpx: decision.slice.srcYpx,
      sliceHeightPx: decision.slice.sliceHeightPx,
      pageMetadata: pageMeta ?? undefined,
    });

    pageIndex += 1;
    nextDocTop = decision.slice.nextDocTopAfter;
    if (decision.slice.doneAfter) break;
    await delay(settings.timing.interSegmentMs);
  }

  // Scroll restored / overlays restored BEFORE we start the long compression
  // phase — the user's browser returns to normal right away.
  await endCapturePrep(tab.id);
  await sendToTab(tab.id, { type: "scroll-to", x: 0, y: originalScrollY });

  // ---- Phase 2: Parallel crop + encode via offscreen worker pool ----
  await showProgress(
    tab.id,
    `Compressing ${rawPages.length} page${rawPages.length === 1 ? "" : "s"} in parallel…`,
  );
  await ensureOffscreen();
  const encodeOpts = {
    format: settings.quality.format,
    smartFallback: settings.quality.smartFallback,
    smartColorThreshold: settings.quality.smartColorThreshold,
    jpegPercent: settings.quality.jpegPercent,
  };
  const batchItems = rawPages.map((rp) => ({
    pngDataUrl: rp.pngDataUrl,
    cropSrcY: rp.srcYpx,
    cropHeight: rp.sliceHeightPx,
    fullHeight: fullHeightPx,
    options: encodeOpts,
  }));

  let batchResults: Array<{ dataUrl: string }> = [];
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "offscreen-encode-batch",
      items: batchItems,
    });
    if (resp?.error) throw new Error(resp.error);
    batchResults = resp?.results || [];
  } catch (e) {
    console.warn("[capture-pages] parallel encode failed, falling back to serial:", e);
    // Fallback: encode one by one in the service worker
    batchResults = [];
    for (let i = 0; i < rawPages.length; i++) {
      await showProgress(tab.id, `Compressing ${i + 1}/${rawPages.length}…`);
      const { pngDataUrl, srcYpx, sliceHeightPx } = rawPages[i]!;
      let url = pngDataUrl;
      if (srcYpx > 0 || sliceHeightPx < fullHeightPx) {
        try {
          url = await cropPngVertical(pngDataUrl, srcYpx, sliceHeightPx);
        } catch (err) {
          logger.debug("[capture-pages] serial-fallback crop failed, using uncropped slice:", err);
        }
      }
      const encoded = await encodeCapture(url, settings);
      batchResults.push({ dataUrl: encoded.dataUrl });
    }
  }

  const pages: {
    dataUrl: string;
    height: number;
    pageMetadata?: import("@ingcreators/annot-core").PageMetadata;
  }[] = batchResults.map((r, i) => ({
    dataUrl: r.dataUrl,
    height: rawPages[i]!.sliceHeightPx,
    pageMetadata: rawPages[i]!.pageMetadata,
  }));

  await showProgress(tab.id, `Saving ${pages.length} page${pages.length === 1 ? "" : "s"}…`);

  const width = Math.round(dims.viewportWidth * dims.devicePixelRatio);
  const fullHeight = Math.round(dims.viewportHeight * dims.devicePixelRatio);

  const baseTags: Record<string, string> = { ...urlTags(sourceUrl) };
  const sessionId = newIdB58();
  const total = pages.length;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const thumbnailDataUrl = await idbStore.generateThumbnail(page.dataUrl);
    const now = new Date().toISOString();
    await idbStore.saveImage({
      originalDataUrl: page.dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width,
      // Last page may be shorter than the viewport (cropped to remove the
      // blank tail below the document).
      height: page.height || fullHeight,
      sourceUrl,
      tags: {
        ...baseTags,
        page: String(i + 1),
        captureId: newIdB58(),
        session: sessionId,
        sessionKind: "perPage",
        sessionIndex: String(i),
        sessionTotal: String(total),
      },
      folderPath: "",
      createdAt: now,
      updatedAt: now,
      pageMetadata: page.pageMetadata,
    });
  }

  await hideProgress(tab.id);

  // Open the Annot tab in Bulk Editor mode for this session.
  await openOrReuseAnnotTab(chrome.runtime.id, sessionId);
}

// --- Content script injection ---

async function injectContentScript(tabId: number): Promise<void> {
  try {
    // Probe: ping the existing content script. If it responds, the
    // listener is alive and we can skip re-injection.
    //
    // The previous flag-based probe (`window.__anno_injected ===
    // true`) was wrong in two cases:
    //
    //   1. After an extension reload without page F5: the OLD content
    //      script's listener is orphaned (chrome.runtime is dead) but
    //      `window.__anno_injected` is still true — probe returned
    //      true, no re-inject, and `chrome.tabs.sendMessage` to the
    //      orphaned listener silently failed.
    //
    //   2. After a build update where the IIFE wrapper's
    //      `globalThis.__anno_content_loaded` flag persisted from a
    //      previous version: the new content.js's IIFE early-
    //      returned, the inner listener-registration code never ran,
    //      and `window.__anno_injected` stayed `undefined`. Probe
    //      returned false → re-injection ran → SAME early-return →
    //      no listener was ever registered. Silent failure.
    //
    // A ping that EXPECTS a response from the listener catches both
    // cases — orphaned listeners can't respond (chrome.runtime is
    // dead), and missing listeners can't respond (nothing handles
    // the message). Either way the catch fires, we clear the flags,
    // and force-reinject.
    let alive = false;
    try {
      const res: { ok?: boolean } | undefined = await chrome.tabs.sendMessage(tabId, {
        type: "ping",
      });
      alive = res?.ok === true;
    } catch {
      alive = false;
    }
    if (alive) return;
    // Clear both guard flags so the IIFE wrapper + inner code
    // re-register fresh. After page F5 the flags are naturally gone;
    // this handles the "extension was reloaded but page wasn't F5'd"
    // / "previous build's flag persisted" cases.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          delete (globalThis as { __anno_content_loaded?: boolean }).__anno_content_loaded;
        } catch {
          /* may be non-configurable in strict cases — ignore */
        }
        try {
          delete (window as { __anno_injected?: boolean }).__anno_injected;
        } catch {
          /* same */
        }
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /Cannot access (?:contents of )?(?:url|chrome:\/\/|chrome-extension:\/\/)/.test(message) ||
      /The extensions gallery cannot be scripted/.test(message)
    ) {
      logger.debug("[injectContentScript] non-injectable URL:", message);
    } else {
      console.error("[injectContentScript] failed:", message, err);
    }
  }
}

// --- Message listener ---

// chrome.runtime listener payloads are untyped on the wire — every
// concrete handler narrows by `msg.type` below.
chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  switch (msg.type) {
    case "capture-visible":
      captureVisible();
      break;
    case "capture-area":
      captureArea();
      break;
    case "capture-full":
      captureFullPage();
      break;
    case "capture-pages":
      capturePages();
      break;
    case "open-gallery":
      openGallery();
      break;

    // ---- Click Capture ----
    case "click-capture-start":
      startClickCapture();
      break;
    case "click-capture-stop":
      stopClickCapture();
      break;
    case "click-capture-status":
      sendResponse(getClickCaptureStatus());
      return false;
    case "click-detected":
      handleClickDetected(msg, sender);
      break;

    // ---- Hotkey Capture ----
    case "hotkey-capture-start":
      startHotkeyCapture();
      break;
    case "hotkey-capture-stop":
      stopHotkeyCapture();
      break;
  }
  return undefined;
});

// --- Keyboard shortcut commands ---

chrome.commands.onCommand.addListener((command, tab) => {
  logger.debug("[cmd]", command, "tab:", tab?.id, tab?.url);
  switch (command) {
    case "capture-visible":
      captureVisible();
      break;
    case "capture-pages":
      capturePages();
      break;
    case "capture-area":
      captureArea();
      break;
    case "capture-full":
      captureFullPage();
      break;
    case "hotkey-capture":
      hotkeyCaptureShot(tab);
      break;
  }
});

// --- External message API (for annotating.work / noting.work) ---

chrome.runtime.onMessageExternal.addListener(
  // External callers post arbitrary JSON over `runtime.sendMessage`;
  // the dispatch below validates `msg.action` before doing anything.
  (msg: any, _sender, sendResponse: (response: any) => void) => {
    if (!msg || typeof msg.action !== "string") {
      sendResponse({ error: "Invalid message" });
      return true;
    }
    handleExternalMessage(msg)
      .then(sendResponse)
      .catch((e) => {
        sendResponse({ error: String(e) });
      });
    return true; // keep channel open for async response
  },
);

// External JSON dispatcher; each `case` reads only the fields it needs.
async function handleExternalMessage(msg: any): Promise<any> {
  switch (msg.action) {
    // Images (path-based)
    case "listImages":
      return idbStore.listImages(msg.folderPath ?? "");
    case "getImage":
      return idbStore.getImage(msg.path);
    case "saveImage":
      return idbStore.saveImage(msg.data, msg.opts);
    case "updateImage":
      return idbStore.updateImage(msg.path, msg.updates);
    case "moveImage":
      return idbStore.moveImage(msg.path, msg.newFolderPath ?? "");
    case "renameImage":
      return idbStore.renameImage(msg.path, msg.name);
    case "deleteImage":
      return idbStore.deleteImage(msg.path);

    // Folders (path-based)
    case "listFolders":
      return idbStore.listFolders(msg.parentPath ?? "");
    case "getFolder":
      return idbStore.getFolder(msg.path);
    case "createFolder":
      return idbStore.createFolder(msg.parentPath ?? "", msg.name);
    case "renameFolder":
      return idbStore.renameFolder(msg.path, msg.name);
    case "moveFolder":
      return idbStore.moveFolder(msg.path, msg.newParentPath ?? "");
    case "deleteFolder":
      return idbStore.deleteFolder(msg.path);
    case "getBreadcrumb":
      return idbStore.getBreadcrumb(msg.path ?? "");

    // Thumbnail
    case "generateThumbnail":
      return idbStore.generateThumbnail(msg.dataUrl, msg.maxWidth);

    // Ping — check extension is alive
    case "ping":
      return { ok: true, version: "2.0.0" };

    default:
      return { error: `Unknown action: ${msg.action}` };
  }
}

// ---- Click Capture ----

interface ClickCaptureState {
  active: boolean;
  count: number;
  /** Timestamp of last capture — used to debounce rapid clicks. */
  lastCaptureAt: number;
  /** uuid7-base58 session id; set at start, reused for every capture. */
  sessionId: string;
}

const clickState: ClickCaptureState = { active: false, count: 0, lastCaptureAt: 0, sessionId: "" };
const hotkeyState: ClickCaptureState = { active: false, count: 0, lastCaptureAt: 0, sessionId: "" };


function getClickCaptureStatus(): ClickCaptureState & {
  hotkeyActive: boolean;
  hotkeyCount: number;
} {
  return { ...clickState, hotkeyActive: hotkeyState.active, hotkeyCount: hotkeyState.count };
}

function updateBadge(): void {
  const anyActive = clickState.active || hotkeyState.active;
  if (anyActive) {
    chrome.action.setBadgeBackgroundColor({ color: "#e44" });
    const total = clickState.count + hotkeyState.count;
    chrome.action.setBadgeText({ text: String(total) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

async function broadcastClickCapture(enable: boolean): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const msgType = enable ? "click-capture-enable" : "click-capture-disable";
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    if (!/^https?:|^file:/.test(t.url)) continue;
    try {
      // Ensure content script is present for http(s) pages
      if (enable) await injectContentScript(t.id);
      await chrome.tabs.sendMessage(t.id, { type: msgType }).catch(() => {});
    } catch (err) {
      logger.debug("[click-capture] broadcast to tab failed:", t.id, err);
    }
  }
}

async function startClickCapture(): Promise<void> {
  if (clickState.active) return;
  clickState.active = true;
  clickState.count = 0;
  clickState.lastCaptureAt = 0;
  clickState.sessionId = newIdB58();
  await chrome.storage.local.set({
    clickCaptureActive: true,
    clickCaptureSession: clickState.sessionId,
  });
  updateBadge();
  await broadcastClickCapture(true);
}

async function stopClickCapture(): Promise<void> {
  if (!clickState.active) return;
  clickState.active = false;
  await chrome.storage.local.set({ clickCaptureActive: false });
  await broadcastClickCapture(false);
  const finalCount = clickState.count;
  clickState.sessionId = "";
  updateBadge();

  // Open Annot so user can review + transfer captured frames.
  // Click-capture sessions carry session tags for future grouping features
  // but currently land on the gallery (no auto-opened editor).
  if (finalCount > 0) {
    await openOrReuseAnnotTab(chrome.runtime.id);
  }
}

/** Handle a click reported by a content script: capture + save. */
async function handleClickDetected(
  msg: {
    x: number;
    y: number;
    pageX: number;
    pageY: number;
    dpr: number;
    target: string;
    url: string;
    title: string;
    rect?: { x: number; y: number; width: number; height: number };
  },
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  if (!clickState.active) return;
  if (clickState.count >= CLICK_CAPTURE_MAX_FRAMES) {
    console.warn("[click-capture] max frames reached, auto-stopping");
    stopClickCapture();
    return;
  }

  const now = Date.now();
  if (now - clickState.lastCaptureAt < CLICK_CAPTURE_MIN_INTERVAL_MS) return;
  clickState.lastCaptureAt = now;

  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId == null || windowId == null) return;

  const settings = await beginCapturePrep(tabId, "click");

  // Wait for UI to settle after the click (tooltips/menus/animations)
  await delay(settings.timing.clickSettleMs);

  if (!clickState.active) {
    await endCapturePrep(tabId);
    return;
  }

  try {
    const pngDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    await endCapturePrep(tabId);
    const encoded = await encodeCapture(pngDataUrl, settings);
    const dataUrl = encoded.dataUrl;
    const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);

    // Dimensions from image
    let w = 0;
    let h = 0;
    try {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      w = bmp.width;
      h = bmp.height;
      bmp.close();
    } catch (err) {
      logger.debug("[click-capture] image dimension probe failed:", err);
    }

    // Re-query the tab AFTER the settle delay so the recorded URL/title
    // reflects the captured page (post-navigation), not the page the click
    // was dispatched on. The pre-click URL/title is kept separately in
    // `click.from*` tags for reference.
    let capturedUrl = msg.url;
    let capturedTitle = msg.title;
    try {
      const updated = await chrome.tabs.get(tabId);
      if (updated?.url) capturedUrl = updated.url;
      if (updated?.title) capturedTitle = updated.title;
    } catch {
      /* ignore — fall back to click-time values */
    }

    // Did the page navigate between click and capture? If so, click
    // coordinates/rect are on a different layout and would draw a misplaced
    // marker on the captured image — omit them.
    const navigated = !!msg.url && msg.url !== capturedUrl;

    const ts = new Date().toISOString();
    const tags: Record<string, string> = {
      "click.target": msg.target,
      "click.seq": String(clickState.count + 1).padStart(3, "0"),
      // URL/title at capture time (matches the image)
      "click.url": capturedUrl,
      "click.title": capturedTitle.slice(0, 120),
      captureId: newIdB58(),
      session: clickState.sessionId,
      sessionKind: "click",
      sessionIndex: String(clickState.count),
    };
    if (!navigated) {
      tags["click.x"] = String(Math.round(msg.x * msg.dpr));
      tags["click.y"] = String(Math.round(msg.y * msg.dpr));
      tags["click.pageX"] = String(Math.round(msg.pageX * msg.dpr));
      tags["click.pageY"] = String(Math.round(msg.pageY * msg.dpr));
      if (msg.rect) {
        tags["click.rect.x"] = String(Math.round(msg.rect.x * msg.dpr));
        tags["click.rect.y"] = String(Math.round(msg.rect.y * msg.dpr));
        tags["click.rect.w"] = String(Math.round(msg.rect.width * msg.dpr));
        tags["click.rect.h"] = String(Math.round(msg.rect.height * msg.dpr));
      }
    } else {
      // Page navigated — record the originating URL/title for traceability
      tags["click.fromUrl"] = msg.url;
      tags["click.fromTitle"] = msg.title.slice(0, 120);
    }
    // Add host / path / query / fragment — now reflecting the captured page
    Object.assign(tags, urlTags(capturedUrl));

    // Snapshot DOM metadata while the page state matches the
    // screenshot (same scroll, same hidden stickies). Click capture
    // doesn't open the editor immediately, but the user opens these
    // later from the gallery — at that point the Elements sidebar
    // is useful.
    const meta = await requestPageMetadata(tabId);

    await idbStore.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: w,
      height: h,
      sourceUrl: capturedUrl,
      tags,
      folderPath: "",
      createdAt: ts,
      updatedAt: ts,
      pageMetadata: meta ?? undefined,
    });

    clickState.count += 1;
    updateBadge();
  } catch (e) {
    console.error("[click-capture] capture failed:", e);
    await endCapturePrep(tabId);
  }
}

// Auto-inject content script into newly loaded tabs while click capture is active.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!clickState.active) return;
  if (!tab.url || !/^https?:|^file:/.test(tab.url)) return;
  injectContentScript(tabId).then(() => {
    chrome.tabs.sendMessage(tabId, { type: "click-capture-enable" }).catch(() => {});
  });
});

// Restore click-capture state across service-worker restarts.
(async () => {
  try {
    const res = await chrome.storage.local.get([
      "clickCaptureActive",
      "clickCaptureSession",
      "hotkeyCaptureActive",
      "hotkeyCaptureSession",
    ]);
    if (res.clickCaptureActive) {
      clickState.active = true;
      clickState.sessionId = res.clickCaptureSession || newIdB58();
    }
    if (res.hotkeyCaptureActive) {
      hotkeyState.active = true;
      hotkeyState.sessionId = res.hotkeyCaptureSession || newIdB58();
    }
    updateBadge();
  } catch (err) {
    logger.debug("[startup] capture-state restore failed:", err);
  }
})();

// ---- Hotkey Capture ----

async function startHotkeyCapture(): Promise<void> {
  if (hotkeyState.active) return;
  hotkeyState.active = true;
  hotkeyState.count = 0;
  hotkeyState.lastCaptureAt = 0;
  hotkeyState.sessionId = newIdB58();
  await chrome.storage.local.set({
    hotkeyCaptureActive: true,
    hotkeyCaptureSession: hotkeyState.sessionId,
  });
  updateBadge();
}

async function stopHotkeyCapture(): Promise<void> {
  if (!hotkeyState.active) return;
  hotkeyState.active = false;
  await chrome.storage.local.set({ hotkeyCaptureActive: false });
  const finalCount = hotkeyState.count;
  hotkeyState.sessionId = "";
  updateBadge();

  // Hotkey-capture sessions carry session tags for future grouping but
  // currently land on the gallery (no auto-opened editor).
  if (finalCount > 0) {
    await openOrReuseAnnotTab(chrome.runtime.id);
  }
}

/** Triggered by the Alt+Shift+C hotkey. Auto-starts the session on first press. */
async function hotkeyCaptureShot(firedTab?: chrome.tabs.Tab): Promise<void> {
  logger.debug(
    "[hotkey-capture] shot fired, active=",
    hotkeyState.active,
    "firedTab=",
    firedTab?.id,
  );
  if (!hotkeyState.active) {
    await startHotkeyCapture();
  }

  const now = Date.now();
  if (now - hotkeyState.lastCaptureAt < HOTKEY_CAPTURE_MIN_INTERVAL_MS) return;
  hotkeyState.lastCaptureAt = now;

  // Prefer the tab that Chrome reports with the command (MV3 supplies it),
  // then fall back to queries. lastFocusedWindow is more reliable than
  // currentWindow when focus has moved to a non-Chrome app.
  let tab = firedTab;
  if (!tab?.id) {
    const byCurrent = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = byCurrent[0];
  }
  if (!tab?.id) {
    const byLast = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = byLast[0];
  }
  if (!tab?.id) {
    const anyActive = await chrome.tabs.query({ active: true });
    tab = anyActive[0];
  }
  if (!tab?.id || tab.windowId == null) {
    console.warn("[hotkey-capture] no active tab found");
    return;
  }

  // Query content script for mouse / focused-element context (best-effort).
  // Fails silently on pages we can't inject into (chrome://, PDF viewer, etc.)
  interface CaptureContext {
    url?: string;
    title?: string;
    dpr?: number;
    target?: string;
    mouse?: { x: number; y: number };
    rect?: { x: number; y: number; width: number; height: number };
  }
  let context: CaptureContext | null = null;
  const injectable = !!tab.url && /^(https?|file):/.test(tab.url);
  if (injectable) {
    try {
      await injectContentScript(tab.id);
      context = (await chrome.tabs
        .sendMessage(tab.id, { type: "get-capture-context" })
        .catch(() => null)) as CaptureContext | null;
    } catch (e) {
      logger.debug("[hotkey-capture] context query failed:", e);
    }
  }

  const settings = injectable ? await beginCapturePrep(tab.id, "hotkey") : await loadSettings();

  // Small settle delay so menus/hover states render
  await delay(settings.timing.hotkeySettleMs);
  if (!hotkeyState.active) {
    if (injectable) await endCapturePrep(tab.id);
    return;
  }

  try {
    logger.debug("[hotkey-capture] capturing window", tab.windowId);
    const pngDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    if (injectable) await endCapturePrep(tab.id);
    const encoded = await encodeCapture(pngDataUrl, settings);
    const dataUrl = encoded.dataUrl;
    const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);

    let w = 0;
    let h = 0;
    try {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      w = bmp.width;
      h = bmp.height;
      bmp.close();
    } catch (err) {
      logger.debug("[hotkey-capture] image dimension probe failed:", err);
    }

    const ts = new Date().toISOString();
    const url = context?.url || tab.url || "";
    const title = (context?.title || tab.title || "").slice(0, 120);
    const dpr = Number(context?.dpr) || 1;

    const tags: Record<string, string> = {
      "hotkey.seq": String(hotkeyState.count + 1).padStart(3, "0"),
      "click.title": title,
      "click.url": url,
      "click.target": context?.target || "",
      captureId: newIdB58(),
      session: hotkeyState.sessionId,
      sessionKind: "hotkey",
      sessionIndex: String(hotkeyState.count),
    };
    if (context?.mouse) {
      tags["click.x"] = String(Math.round(context.mouse.x * dpr));
      tags["click.y"] = String(Math.round(context.mouse.y * dpr));
    }
    if (context?.rect) {
      tags["click.rect.x"] = String(Math.round(context.rect.x * dpr));
      tags["click.rect.y"] = String(Math.round(context.rect.y * dpr));
      tags["click.rect.w"] = String(Math.round(context.rect.width * dpr));
      tags["click.rect.h"] = String(Math.round(context.rect.height * dpr));
    }
    Object.assign(tags, urlTags(url));

    // Snapshot DOM metadata while page state matches the screenshot.
    // Hotkey captures save silently and the user opens them later
    // from the gallery — Elements sidebar then becomes useful.
    const meta = injectable && tab.id != null ? await requestPageMetadata(tab.id) : null;

    await idbStore.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: w,
      height: h,
      sourceUrl: url,
      tags,
      folderPath: "",
      createdAt: ts,
      updatedAt: ts,
      pageMetadata: meta ?? undefined,
    });

    hotkeyState.count += 1;
    updateBadge();
  } catch (e) {
    console.error("[hotkey-capture] capture failed:", e);
    if (injectable) await endCapturePrep(tab.id);
  }
}
