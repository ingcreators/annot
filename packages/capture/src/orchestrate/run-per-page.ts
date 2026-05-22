/**
 * `runPerPageCapture` — scroll the page in viewport-sized steps and
 * record each step as its own image. Returns N `CaptureFrame`s.
 *
 * Per-page mode re-measures the page on every iteration to handle
 * lazy-loaded content that changes scrollHeight as the user scrolls
 * past trigger points, so unlike scroll-stitch, the loop is planned
 * one iteration at a time via `planPerPageStep`.
 */

import type { ElementTree } from "@ingcreators/annot-core";
import type { PageDimensions } from "@ingcreators/annot-core/utils/types";
import type { CaptureHost } from "../host.js";
import {
  beginCapturePrep,
  endCapturePrep,
  sendHideProgress,
  sendShowProgress,
} from "./capture-prep.js";
import { delay, POST_HIDE_PAINT_MS } from "./constants.js";
import { withEmulatedViewport } from "./emulation.js";
import type { CaptureFrame, CaptureResult } from "./frame.js";
import {
  DEFAULT_MAX_PAGES,
  DEFAULT_MIN_LAST_PAGE_CONTENT_PX,
  planPerPageStep,
} from "./strategy.js";

export async function runPerPageCapture(host: CaptureHost): Promise<CaptureResult | null> {
  const target = await host.resolveTarget();
  if (!target) {
    host.log("warn", "[whole-page-per-screen] no capturable tab found");
    return null;
  }
  const settings = await host.loadSettings();
  await host.injectContentScript(target);

  return withEmulatedViewport(host, target, settings, async () => {
    // Re-measure AFTER emulation (viewport may have changed).
    const dims = await host.sendToContent<PageDimensions>(target, {
      type: "get-page-dimensions",
    });

    const vpHeight = dims.viewportHeight;
    const originalScrollY = dims.scrollY;
    const dpr = dims.devicePixelRatio;
    const fullHeightPx = Math.round(vpHeight * dpr);

    // ---- Phase 1: Scroll + capture everything as raw PNGs ----
    interface RawPage {
      pngDataUrl: string;
      srcYpx: number;
      sliceHeightPx: number;
      elementTree?: ElementTree;
    }
    const rawPages: RawPage[] = [];
    let nextDocTop = 0;
    let pageIndex = 0;
    let lastActualScrollY = -1;

    while (pageIndex < DEFAULT_MAX_PAGES) {
      await sendShowProgress(host, target, `Capturing page ${pageIndex + 1}…`);

      await host.sendToContent(target, { type: "scroll-to", x: 0, y: nextDocTop });
      await delay(settings.timing.scrollSettleMs);
      await beginCapturePrep(host, target, "perPage", settings, pageIndex);
      await delay(POST_HIDE_PAINT_MS);

      const after = await host.sendToContent<PageDimensions>(target, {
        type: "get-page-dimensions",
      });
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
        host.log(
          "debug",
          `[whole-page-per-screen] ${decision.reason} at page ${pageIndex + 1}, stopping`,
        );
        break;
      }
      lastActualScrollY = after.scrollY;

      const captured = await host.captureViewport(target);
      // Snapshot per-page ElementTree AFTER captureViewport forced
      // a paint of this viewport (lays out `content-visibility: auto`
      // descendants currently on screen) but BEFORE the next iteration
      // restores stickies. The `area` argument narrows the captured
      // tree's bounding rect to the slice this page contributes to
      // the final image, so the editor's Elements panel filters off-
      // frame elements correctly.
      //
      // DPR-from-host (Phase 2 of `desktop-browser-mode.md`): the
      // area math converts physical-pixel slice offsets back to CSS
      // pixels for the walker. Trust the capture-time DPR returned
      // by `captureViewport` so the area lines up with the actual
      // pixel data, even if `after.devicePixelRatio` (read
      // post-scroll, pre-capture) drifted.
      const dprNow = captured.dpr || after.devicePixelRatio || dpr;
      const pageTree = await host.requestElementTree(target, {
        x: 0,
        y: decision.slice.srcYpx / dprNow,
        width: dims.viewportWidth,
        height: decision.slice.sliceHeightPx / dprNow,
      });
      rawPages.push({
        pngDataUrl: captured.pngDataUrl,
        srcYpx: decision.slice.srcYpx,
        sliceHeightPx: decision.slice.sliceHeightPx,
        elementTree: pageTree ?? undefined,
      });

      pageIndex += 1;
      nextDocTop = decision.slice.nextDocTopAfter;
      if (decision.slice.doneAfter) break;
      await delay(settings.timing.interSegmentMs);
    }

    // Scroll restored / overlays restored BEFORE we start the long
    // compression phase — the user's browser returns to normal right
    // away.
    await endCapturePrep(host, target);
    await host.sendToContent(target, { type: "scroll-to", x: 0, y: originalScrollY });

    // ---- Phase 2: Parallel crop + encode ----
    await sendShowProgress(
      host,
      target,
      `Compressing ${rawPages.length} page${rawPages.length === 1 ? "" : "s"} in parallel…`,
    );
    const encodeOpts = {
      format: settings.quality.format,
      smartFallback: settings.quality.smartFallback,
      smartColorThreshold: settings.quality.smartColorThreshold,
      jpegPercent: settings.quality.jpegPercent,
      saveSizePreset: settings.quality.saveSizePreset,
    };
    const batchItems = rawPages.map((rp) => ({
      pngDataUrl: rp.pngDataUrl,
      cropSrcY: rp.srcYpx,
      cropHeight: rp.sliceHeightPx,
      fullHeight: fullHeightPx,
      options: encodeOpts,
    }));

    const encoded = await host.encodeBatch(batchItems);
    const width = Math.round(dims.viewportWidth * dims.devicePixelRatio);
    const fullHeight = Math.round(dims.viewportHeight * dims.devicePixelRatio);

    await sendShowProgress(
      host,
      target,
      `Saving ${rawPages.length} page${rawPages.length === 1 ? "" : "s"}…`,
    );

    const frames: CaptureFrame[] = encoded.map((r, i) => {
      const raw = rawPages[i]!;
      // Last page may be shorter than the viewport (cropped to remove
      // the blank tail below the document).
      const height = raw.sliceHeightPx || fullHeight;
      return {
        dataUrl: r.dataUrl,
        width,
        height,
        elementTree: raw.elementTree,
      };
    });

    await sendHideProgress(host, target);
    return { target, frames, kind: "perPage" };
  });
}
