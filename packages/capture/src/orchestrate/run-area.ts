/**
 * `runAreaCapture` — drag-select an area inside the captured page,
 * then capture + crop that rect.
 *
 * The orchestrator subscribes to `area-selected` / `area-cancelled`
 * via `host.onContentMessage` and tells the content side to start
 * area selection via `host.sendToContent({type: "start-area-select"})`.
 */

import type { CaptureRect } from "@ingcreators/annot-core/utils/types";
import type { CaptureHost, CaptureTargetRef } from "../host.js";
import { beginCapturePrep, endCapturePrep } from "./capture-prep.js";
import { delay, POST_HIDE_PAINT_MS } from "./constants.js";
import { withEmulatedViewport } from "./emulation.js";
import type { CaptureFrame, CaptureResult } from "./frame.js";

export async function runAreaCapture(host: CaptureHost): Promise<CaptureResult | null> {
  const target = await host.resolveTarget();
  if (!target) {
    host.log("warn", "[select-region] no capturable tab found");
    return null;
  }
  const settings = await host.loadSettings();
  await host.injectContentScript(target);

  // Area selection must happen under the emulated viewport so the
  // user drags on the actually-rendered content. Wrap everything.
  return withEmulatedViewport(host, target, settings, async () => {
    const rect = await waitForAreaSelection(host, target);
    if (!rect) return { target, frames: [], kind: "area" };

    await beginCapturePrep(host, target, "area", settings, 0);
    await delay(POST_HIDE_PAINT_MS);

    try {
      const captured = await host.captureViewport(target);
      // Metadata snapshot AFTER captureViewport (forces paint of
      // `content-visibility: auto` descendants) but BEFORE
      // endCapturePrep below (stickies remain hidden, so their
      // descendants are filtered out of metadata to match the
      // screenshot pixels exactly).
      const areaMeta = await host.requestPageMetadata(target, rect.rect);
      // DPR-from-host (Phase 2 of `desktop-browser-mode.md`): the
      // crop math scales the CSS-pixel rect to physical pixels in
      // the captured PNG. `captured.dpr` is the host-authoritative
      // capture-time DPR; `rect.dpr` was the click-time DPR
      // reported by the area-selector overlay. The two only differ
      // when the DPR drifted between drag-end and capture (window
      // moved between displays mid-flow). Trust the capture-time
      // value so the crop hits the right pixels.
      const dpr = captured.dpr;
      const cropped = await host.cropRect(captured.pngDataUrl, rect.rect, dpr);
      const [encoded] = await host.encodeBatch([
        {
          pngDataUrl: cropped,
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
      const croppedW = Math.round(rect.rect.width * dpr);
      const croppedH = Math.round(rect.rect.height * dpr);
      const frame: CaptureFrame = {
        dataUrl: encoded?.dataUrl ?? cropped,
        width: croppedW,
        height: croppedH,
        pageMetadata: areaMeta ?? undefined,
      };
      return { target, frames: [frame], kind: "area" };
    } finally {
      await endCapturePrep(host, target);
    }
  });
}

interface AreaPick {
  rect: CaptureRect;
  dpr: number;
}

function waitForAreaSelection(
  host: CaptureHost,
  target: CaptureTargetRef,
): Promise<AreaPick | null> {
  return new Promise<AreaPick | null>((resolve) => {
    const unsubscribe = host.onContentMessage((msg) => {
      if (msg.type === "area-selected") {
        unsubscribe();
        resolve({ rect: msg.rect, dpr: msg.dpr });
      } else if (msg.type === "area-cancelled") {
        unsubscribe();
        resolve(null);
      }
    });
    // Start the drag-select overlay AFTER the listener is in place.
    void host.sendToContent(target, { type: "start-area-select" }).catch(() => {
      /* content side may have been re-injected mid-flight; ignore */
    });
  });
}
