/**
 * Chrome MV3 implementation of `CaptureHost`. The orchestrators
 * (`runVisibleCapture` / `runAreaCapture` / `runScrollCapture` /
 * `runPerPageCapture`) drive the extension via this adapter; the
 * adapter owns every `chrome.*` interaction so the orchestrators
 * never see a chrome global.
 *
 * Phase 1B of `docs/plans/desktop-browser-mode.md`.
 */

import {
  type ElementTreeWalkerRegion,
  walkElementTree,
} from "@ingcreators/annot-capture/content/element-tree-walker";
import type { BatchItem } from "@ingcreators/annot-capture/encode";
import type {
  CapturedViewport,
  CaptureEncodeResult,
  CaptureHost,
  CaptureTargetRef,
} from "@ingcreators/annot-capture/host";
import {
  computeChromeDelta,
  computeDesiredWindowSize,
  computeOuterSizeCorrection,
  delay,
  EMULATION_INNER_SETTLE_MS,
  EMULATION_STATE_TRANSITION_MS,
  MIN_WINDOW_DIMENSION,
  pixelToCssSize,
  type Size,
} from "@ingcreators/annot-capture/orchestrate";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  Settings,
} from "@ingcreators/annot-capture/shared";
import type { ElementTree } from "@ingcreators/annot-core";
import { encodeCapture as encodeOne } from "@ingcreators/annot-core/encode";
import type {
  CaptureRect,
  CaptureSegment,
  PageDimensions,
} from "@ingcreators/annot-core/utils/types";
import { logger } from "../logger.js";
import { loadSettings, onSettingsChange, saveSettings } from "../shared/settings.js";
import { isCapturableUrl } from "./service-worker-helpers.js";

interface SavedGeometry {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  state: chrome.windows.WindowState;
}

const savedGeometryByWindow = new Map<number, SavedGeometry>();

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

/**
 * Find the most plausible tab to capture from. We must avoid
 * `devtools://`, `chrome://`, `chrome-extension://`, etc. —
 * `captureVisibleTab` cannot read those without elevated permissions
 * and will throw an opaque error.
 *
 * Priority: active in current window → active in last-focused window
 * → any active tab → first http/https/file tab.
 */
async function findCaptureTarget(): Promise<chrome.tabs.Tab | undefined> {
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
  const all = await chrome.tabs.query({});
  const candidates = all
    .filter((t) => t.id != null && isCapturableUrl(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0];
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    // Probe: ping the existing content script. If it responds, the
    // listener is alive and we can skip re-injection. (Pre-existing
    // chrome-quirk handling: orphaned listeners after extension
    // reload without page F5; stale `__annot_content_loaded` flag
    // after a build update. Both produce silent failures unless we
    // PING before deciding to skip.)
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
    // re-register fresh.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          delete (globalThis as { __annot_content_loaded?: boolean }).__annot_content_loaded;
        } catch {
          /* may be non-configurable in strict cases — ignore */
        }
        try {
          delete (window as { __annot_injected?: boolean }).__annot_injected;
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

async function requestElementTreeChrome(
  tabId: number,
  area: CaptureRect | undefined,
): Promise<ElementTree | null> {
  try {
    // chrome-types' `executeScript` overload pins `func` to `() => void`
    // and doesn't model the `args` -> `func` parameter relationship; cast
    // the call to bypass the overhead of writing a typed wrapper that
    // wouldn't gain anything at runtime.
    const region: ElementTreeWalkerRegion = area
      ? { x: area.x, y: area.y, width: area.width, height: area.height }
      : null;
    const results = await (
      chrome.scripting.executeScript as unknown as (
        i: Record<string, unknown>,
      ) => Promise<unknown[]>
    )({
      target: { tabId },
      world: "MAIN",
      // Args are structured-cloned into the page; no closure.
      args: [region],
      // The walker is exported as a plain function from the capture
      // package and has no module-level references in its body, so
      // chrome.scripting can serialize via toString() and run it in
      // MAIN world.
      func: walkElementTree,
    });
    const result = (results?.[0] as { result?: unknown } | undefined)?.result;
    if (result && typeof result === "object" && (result as { root?: unknown }).root !== undefined) {
      return result as ElementTree;
    }
    return null;
  } catch (err) {
    console.warn("[annot] ElementTree MAIN-world injection failed:", err);
    return null;
  }
}

/** Build the chrome-side `CaptureHost`. The instance shares
 *  `savedGeometryByWindow` and the content-listener bridge as
 *  module-level state — there's one service-worker per extension
 *  install, so per-instance vs. module-level doesn't matter for
 *  correctness; module-level keeps the bridge a singleton (one
 *  `chrome.runtime.onMessage.addListener` registration regardless
 *  of how many hosts are constructed). */
export function createChromeCaptureHost(): CaptureHost {
  installContentBridgeOnce();

  return {
    async resolveTarget() {
      const tab = await findCaptureTarget();
      if (!tab?.id || tab.windowId == null) return null;
      return {
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url ?? "",
        title: tab.title,
      };
    },

    async captureViewport(target): Promise<CapturedViewport> {
      if (target.windowId == null) {
        throw new Error("[host] captureViewport requires a windowId");
      }
      const pngDataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
        format: "png",
      });
      // Derive DPR from the captured image vs. the reported viewport.
      // Done lazily (on a best-effort sendToContent probe) so we don't
      // pay the round-trip on every visible-mode capture; orchestrators
      // that need DPR do their own probe via `get-page-dimensions`.
      // Phase 2 of `desktop-browser-mode.md` will tighten this so the
      // host always returns DPR alongside the PNG.
      let dpr = 1;
      try {
        const dims = (await chrome.tabs.sendMessage(target.id, {
          type: "get-page-dimensions",
        })) as PageDimensions | undefined;
        if (dims?.devicePixelRatio) dpr = dims.devicePixelRatio;
      } catch {
        /* content script may be unavailable; fall back to dpr=1 */
      }
      return { pngDataUrl, dpr };
    },

    async setEmulatedViewport(target, size) {
      if (target.windowId == null) return;
      if (size === null) {
        // Restore mode.
        //
        // `chrome.windows.update` documents that "minimized",
        // "maximized" and "fullscreen" states cannot be combined
        // with `left`, `top`, `width` or `height`. So when the user
        // started with a maximized / fullscreen window (the common
        // case post-#727 pre-normalize), we can't restore in a
        // single update — Chrome rejects the request and nothing
        // happens, leaving the window stuck at the emulated size.
        //
        // Two-step restore for non-normal saved states:
        //   1. Restore size + position with `state: "normal"`. This
        //      gives the window its pre-maximize bounds, which is
        //      the natural "previous normal size" the user would
        //      see after un-maximizing manually.
        //   2. Re-apply the saved state ("maximized" / "fullscreen")
        //      WITHOUT bounds. Chrome accepts state-only updates,
        //      and the saved state takes the window back to its
        //      pre-emulation appearance.
        // For an originally-"normal" save, the single-update path
        // works fine and we skip step 2.
        const saved = savedGeometryByWindow.get(target.windowId);
        if (!saved) return;
        savedGeometryByWindow.delete(target.windowId);
        const restoreState = saved.state || "normal";
        try {
          await chrome.windows.update(target.windowId, {
            width: saved.width,
            height: saved.height,
            left: saved.left,
            top: saved.top,
            state: "normal",
          });
          if (restoreState !== "normal") {
            await chrome.windows.update(target.windowId, { state: restoreState });
          }
        } catch {
          /* ignore — best effort restore */
        }
        return;
      }

      // Apply mode. Snapshot the current window geometry so we can
      // restore later, then read DPR + chrome-delta to translate the
      // CSS-pixel target into an outer window size.
      let originalWindow: chrome.windows.Window | null = null;
      try {
        originalWindow = await chrome.windows.get(target.windowId);
      } catch (e) {
        console.warn("[emulation] couldn't read window geometry — capturing at native size:", e);
        return;
      }
      // Save the ORIGINAL geometry (maximized / fullscreen state and
      // all) for the restore branch. Subsequent measurements run on
      // a possibly-normalized window, but restore needs to put the
      // user back where they started.
      savedGeometryByWindow.set(target.windowId, {
        width: originalWindow.width,
        height: originalWindow.height,
        left: originalWindow.left,
        top: originalWindow.top,
        state: originalWindow.state || "normal",
      });
      // ── Pre-normalize state transition ───────────────────────────
      // The maximized→normal state change leaves Chrome's chrome
      // decoration at a fractional CSS height that's 1 CSS px taller
      // than the value it settles at when the window starts in normal
      // state. Empirically (Win 11 + 4K @ 150% scale): maximized
      // window → state-change-while-resizing in one update call →
      // chrome = 95 CSS (= 142.5 phys, non-integer). Already-normal
      // window → no state change → chrome = 94 CSS (= 141 phys,
      // integer). The 1 CSS px difference makes target inner CSS =
      // 720 reachable in the second case (outer 814) and UNREACHABLE
      // in the first (would need outer 815, but `chrome.windows.update`
      // snaps to even-CSS heights on this OS / DPR combo).
      //
      // Fix: transition to "normal" state FIRST (no resize) and let
      // the chrome decoration settle, THEN measure. The subsequent
      // resize stays in normal state, so the chrome decoration we
      // measured is the one we'll capture with.
      const needsNormalize =
        originalWindow.state === "maximized" || originalWindow.state === "fullscreen";
      if (needsNormalize) {
        try {
          await chrome.windows.update(target.windowId, { state: "normal" });
          // Long settle: state transition can run an OS-level
          // animation (Win 11 Aero, Chrome fullscreen-exit) that
          // outlasts a typical paint tick.
          await delay(EMULATION_STATE_TRANSITION_MS);
          // Re-read after the transition so chromeDelta is computed
          // against the now-stable normal-state outer dims.
          try {
            originalWindow = await chrome.windows.get(target.windowId);
          } catch {
            /* keep the original; subsequent steps degrade gracefully */
          }
        } catch {
          /* state transition failed; fall through with original window */
        }
      }
      // The chrome-delta probe sends a `get-page-dimensions` message
      // to the content script. The extension's manifest declares NO
      // `content_scripts` — every injection is programmatic via
      // `chrome.scripting.executeScript`. The one-shot capture paths
      // inject before calling `withEmulatedViewport`, but the
      // session paths historically did emulation BEFORE injection,
      // leaving chromeDelta=0 → inner viewport short by the full
      // chrome height. Inject here so every caller gets the same
      // accurate probe; idempotent (ping-first).
      try {
        await injectContentScript(target.id);
      } catch {
        /* non-injectable URL or transient failure — probe falls back to zero deltas */
      }
      let dpr = 1;
      let chromeDelta = { width: 0, height: 0 };
      try {
        const dims = (await chrome.tabs.sendMessage(target.id, {
          type: "get-page-dimensions",
        })) as PageDimensions | undefined;
        if (dims) {
          dpr = dims.devicePixelRatio || 1;
          chromeDelta = computeChromeDelta(
            { width: originalWindow.width, height: originalWindow.height },
            { width: dims.viewportWidth, height: dims.viewportHeight },
          );
        }
      } catch {
        /* fall back to zero deltas / dpr=1 */
      }
      const pixelTarget = { width: size.width, height: size.height };
      const targetCss = pixelToCssSize(pixelTarget, dpr);
      const desired = computeDesiredWindowSize(pixelTarget, dpr, chromeDelta);
      // `chrome.windows.update` clamps to the monitor's available
      // work area, so if the target exceeds the screen we'll capture
      // at max-available. We omit `state` here when we already
      // pre-normalized — the window is in normal state and including
      // state in the update can re-trigger the chrome-decoration
      // shift this whole flow exists to avoid.
      await chrome.windows.update(target.windowId, {
        width: desired.width,
        height: desired.height,
        ...(needsNormalize ? {} : { state: "normal" as const }),
      });

      // ── Iterative corrective pass ────────────────────────────────
      // Safety net for the rare case where the chrome decoration
      // shifts subtly between probe and capture (DPR-fraction CSS
      // rounding, mid-session page reflow). With pre-normalization
      // above the first-pass should usually land exactly on target
      // and this loop converges on iter 0; max 2 iterations is
      // enough room for an outlier to settle without paying for an
      // open-ended retry budget.
      const MAX_CORRECTIVE_ITERATIONS = 2;
      let currentOuter: Size = desired;
      let bestRequest: Size = currentOuter;
      let bestResidualSum = Number.POSITIVE_INFINITY;
      const seenInner = new Set<string>();
      try {
        for (let i = 0; i < MAX_CORRECTIVE_ITERATIONS; i++) {
          await delay(EMULATION_INNER_SETTLE_MS);
          const dimsAfter = (await chrome.tabs.sendMessage(target.id, {
            type: "get-page-dimensions",
          })) as PageDimensions | undefined;
          if (!dimsAfter) break;
          const dw = targetCss.width - dimsAfter.viewportWidth;
          const dh = targetCss.height - dimsAfter.viewportHeight;
          const residualSum = Math.abs(dw) + Math.abs(dh);
          // Track best (smallest residual). Ties favor the LATEST
          // iteration so re-running the same request a second time
          // doesn't matter, but a genuinely-equal-residual rebound
          // after oscillation lets the loop pick whichever side it
          // settled on last — symmetric, no built-in over/under bias.
          if (residualSum <= bestResidualSum) {
            bestResidualSum = residualSum;
            bestRequest = currentOuter;
          }
          if (residualSum === 0) break; // exact match
          // Oscillation: same inner viewport observed twice means
          // further iteration can't make progress (Chrome's snap
          // grid is bracketing the target). Bail with the best.
          const innerKey = `${dimsAfter.viewportWidth}x${dimsAfter.viewportHeight}`;
          if (seenInner.has(innerKey)) break;
          seenInner.add(innerKey);
          const correction = computeOuterSizeCorrection(currentOuter, targetCss, {
            width: dimsAfter.viewportWidth,
            height: dimsAfter.viewportHeight,
          });
          if (correction === null) break;
          const next = {
            width: Math.max(MIN_WINDOW_DIMENSION, correction.width),
            height: Math.max(MIN_WINDOW_DIMENSION, correction.height),
          };
          await chrome.windows.update(target.windowId, {
            width: next.width,
            height: next.height,
            state: "normal",
          });
          currentOuter = next;
        }
        // If iteration ended on a non-best request (we drifted past
        // the optimum chasing exact match), restore the best.
        if (
          bestRequest.width !== currentOuter.width ||
          bestRequest.height !== currentOuter.height
        ) {
          await chrome.windows.update(target.windowId, {
            width: bestRequest.width,
            height: bestRequest.height,
            state: "normal",
          });
        }
      } catch {
        /* best-effort correction; the latest applied size stands */
      }
    },

    async sendToContent<T = unknown>(
      target: CaptureTargetRef,
      msg: BackgroundToContentMessage,
    ): Promise<T> {
      return chrome.tabs.sendMessage(target.id, msg) as Promise<T>;
    },

    onContentMessage(handler) {
      contentListenersAll.add(handler);
      return () => {
        contentListenersAll.delete(handler);
      };
    },

    async injectContentScript(target) {
      await injectContentScript(target.id);
    },

    async requestElementTree(target, area) {
      return requestElementTreeChrome(target.id, area);
    },

    async stitchSegments(segments: CaptureSegment[], width, height) {
      await ensureOffscreen();
      const result = (await chrome.runtime.sendMessage({
        type: "offscreen-stitch",
        segments,
        width,
        height,
      })) as { dataUrl?: string } | undefined;
      if (!result?.dataUrl) {
        throw new Error("[host] offscreen stitch returned no dataUrl");
      }
      return result.dataUrl;
    },

    async cropRect(dataUrl, rect, dpr) {
      await ensureOffscreen();
      const result = (await chrome.runtime.sendMessage({
        type: "offscreen-crop",
        dataUrl,
        rect,
        dpr,
      })) as { dataUrl?: string } | undefined;
      if (!result?.dataUrl) {
        throw new Error("[host] offscreen crop returned no dataUrl");
      }
      return result.dataUrl;
    },

    async encodeBatch(items: BatchItem[]): Promise<CaptureEncodeResult[]> {
      // Every encode — single-item OR batch — routes through the
      // offscreen worker pool. The single-item carve-out that ran
      // the encode directly on the SW thread was correct when the
      // quantizer was libimagequant WASM (microsecond-class), but
      // after the swap to pure-TS Median Cut the per-encode wall
      // clock landed in the hundreds of ms to seconds, blocking
      // every subsequent `chrome.runtime.*` callback in the
      // capture-completion handshake. The worker-pool round-trip is
      // ~10 ms of overhead in exchange for keeping the SW
      // responsive. The SW-side serial path below stays as the
      // recovery branch when the offscreen document fails to start.
      // See `docs/plans/_done/quantizer-nearest-palette-acceleration.md`.
      try {
        await ensureOffscreen();
        const resp = (await chrome.runtime.sendMessage({
          type: "offscreen-encode-batch",
          items,
        })) as { results?: CaptureEncodeResult[]; error?: string } | undefined;
        if (resp?.error) throw new Error(resp.error);
        if (resp?.results) return resp.results;
        throw new Error("[host] offscreen encode-batch returned no results");
      } catch (e) {
        console.warn("[host] parallel encode failed, falling back to serial:", e);
        const results: CaptureEncodeResult[] = [];
        for (const item of items) {
          let url = item.pngDataUrl;
          if (item.cropSrcY > 0 || (item.cropHeight > 0 && item.cropHeight < item.fullHeight)) {
            try {
              url = await cropPngVerticalSerial(item.pngDataUrl, item.cropSrcY, item.cropHeight);
            } catch (err) {
              logger.debug("[host] serial-fallback crop failed, using uncropped slice:", err);
            }
          }
          const r = await encodeOne(url, item.options);
          results.push(r);
        }
        return results;
      }
    },

    async loadSettings(): Promise<Settings> {
      return loadSettings();
    },

    async saveSettings(s) {
      return saveSettings(s);
    },

    onSettingsChange(cb) {
      return onSettingsChange(cb);
    },

    log(level, ...args) {
      logger[level](...args);
    },
  };
}

// ---- Module-level state for the singleton chrome.runtime bridge ----

let contentBridgeInstalled = false;
const contentListenersAll = new Set<(msg: ContentToBackgroundMessage) => void>();

/** One-time install of a `chrome.runtime.onMessage` listener that
 *  forwards content-side events to every subscriber registered via
 *  `host.onContentMessage(...)`. Idempotent — repeated calls no-op
 *  after the first.
 *
 *  We listen for the small set of orchestrator-relevant content-side
 *  events; the service-worker's own `chrome.runtime.onMessage`
 *  listener still handles popup messages (`visible-area`, etc.)
 *  and `click-detected`, which are mode-specific extension wiring
 *  rather than orchestrator events. */
function installContentBridgeOnce(): void {
  if (contentBridgeInstalled) return;
  contentBridgeInstalled = true;
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== "string") return undefined;
    if (
      msg.type === "area-selected" ||
      msg.type === "area-cancelled" ||
      msg.type === "page-dimensions" ||
      msg.type === "scroll-done"
    ) {
      for (const cb of contentListenersAll) {
        try {
          cb(msg as ContentToBackgroundMessage);
        } catch (err) {
          logger.debug("[host] content-listener callback threw:", err);
        }
      }
    }
    return undefined;
  });
}

// ---- Serial-fallback vertical crop ----
//
// Only used inside `encodeBatch` when the offscreen path fails. The
// implementation matches the legacy `cropPngVertical` from
// service-worker.ts byte-for-byte.

async function cropPngVerticalSerial(
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
