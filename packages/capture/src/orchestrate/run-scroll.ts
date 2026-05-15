/**
 * `runScrollCapture` — vertically scroll-stitch the entire page into
 * one tall PNG.
 *
 * Returns one stitched `CaptureFrame` with whole-document metadata
 * (the editor's Elements panel surfaces every interactive element
 * across the stitched image, not just the last viewport).
 */

import type { CaptureSegment, PageDimensions } from "@ingcreators/annot-core/utils/types";
import type { CaptureHost } from "../host.js";
import {
  beginCapturePrep,
  endCapturePrep,
  sendHideProgress,
  sendShowProgress,
} from "./capture-prep.js";
import { delay, MAX_CANVAS_DIMENSION, POST_HIDE_PAINT_MS } from "./constants.js";
import { withEmulatedViewport } from "./emulation.js";
import type { CaptureFrame, CaptureResult } from "./frame.js";
import { planScrollSegments } from "./strategy.js";

export async function runScrollCapture(host: CaptureHost): Promise<CaptureResult | null> {
  const target = await host.resolveTarget();
  if (!target) {
    host.log("warn", "[capture-full] no capturable tab found");
    return null;
  }
  const settings = await host.loadSettings();
  await host.injectContentScript(target);

  return withEmulatedViewport(host, target, settings, async () => {
    // Re-measure AFTER emulation is applied (viewport may differ).
    const dims = await host.sendToContent<PageDimensions>(target, {
      type: "get-page-dimensions",
    });

    const plan = planScrollSegments(dims, MAX_CANVAS_DIMENSION);
    if (plan.capped) {
      host.log(
        "warn",
        `Page height ${dims.scrollHeight * dims.devicePixelRatio}px exceeds max canvas size. Capping.`,
      );
    }
    const originalScrollY = dims.scrollY;
    const segments: CaptureSegment[] = [];

    for (const seg of plan.segments) {
      await sendShowProgress(host, target, `Capturing ${seg.index + 1}/${plan.segments.length}…`);

      // Scroll first, let the page's scroll handlers fire (which is often
      // when sites add/toggle `position: fixed` on nav bars, FABs, etc.),
      // THEN hide overlays so the mutation catches the post-scroll state.
      await host.sendToContent(target, { type: "scroll-to", x: 0, y: seg.scrollY });
      await delay(settings.timing.scrollSettleMs);
      // Hide directives may change between segment 0 and segment 1 when
      // `keepFirstSegment` is enabled, so refresh every iteration.
      await beginCapturePrep(host, target, "scroll", settings, seg.index);
      await delay(POST_HIDE_PAINT_MS);

      const captured = await host.captureViewport(target);
      segments.push({
        dataUrl: captured.pngDataUrl,
        offsetY: Math.round(seg.scrollY * dims.devicePixelRatio),
      });

      await delay(settings.timing.interSegmentMs);
    }

    // Snapshot DOM metadata for the WHOLE stitched document AFTER the
    // last `captureViewport` (the most recently-visible
    // `content-visibility: auto` descendants are laid out) but BEFORE
    // `endCapturePrep` (stickies stay hidden, matching the screenshots
    // taken throughout the loop). The `area` argument rewrites
    // `captureRect` in document coords to span the entire stitched
    // image: `region` is viewport-relative, so we offset by the
    // CURRENT scroll (= last segment's scrollY) to make
    // `captureRect.y` land at 0 in document coords.
    const dimsAtEnd = await host.sendToContent<PageDimensions>(target, {
      type: "get-page-dimensions",
    });
    const stitchedMeta = await host.requestPageMetadata(target, {
      x: -dimsAtEnd.scrollX,
      y: -dimsAtEnd.scrollY,
      width: dimsAtEnd.scrollWidth,
      height: dimsAtEnd.scrollHeight,
    });

    await endCapturePrep(host, target);
    await host.sendToContent(target, { type: "scroll-to", x: 0, y: originalScrollY });

    await sendShowProgress(host, target, `Stitching ${segments.length} segments…`);
    const stitchedDataUrl = await host.stitchSegments(
      segments,
      plan.stitchWidth,
      plan.stitchHeight,
    );

    await sendShowProgress(host, target, "Compressing full-page image…");
    const [encoded] = await host.encodeBatch([
      {
        pngDataUrl: stitchedDataUrl,
        cropSrcY: 0,
        cropHeight: 0,
        fullHeight: 0,
        options: {
          format: settings.quality.format,
          smartFallback: settings.quality.smartFallback,
          smartColorThreshold: settings.quality.smartColorThreshold,
          jpegPercent: settings.quality.jpegPercent,
          saveSizePreset: settings.quality.saveSizePreset,
        },
      },
    ]);
    await sendShowProgress(host, target, "Saving…");

    const frame: CaptureFrame = {
      dataUrl: encoded?.dataUrl ?? stitchedDataUrl,
      width: plan.stitchWidth,
      height: plan.stitchHeight,
      pageMetadata: stitchedMeta ?? undefined,
    };
    await sendHideProgress(host, target);
    return { target, frames: [frame], kind: "scroll" };
  });
}
