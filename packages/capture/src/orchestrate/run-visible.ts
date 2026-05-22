/**
 * `runVisibleCapture` — capture the currently-visible viewport.
 *
 * Returns a single `CaptureFrame`. The caller (extension
 * service-worker, future desktop Browse-window renderer) does the
 * IDB / DesktopStore save and any "open the editor on this record"
 * routing.
 */

import type { CaptureHost } from "../host.js";
import { beginCapturePrep, endCapturePrep } from "./capture-prep.js";
import { delay, POST_HIDE_PAINT_MS } from "./constants.js";
import { withEmulatedViewport } from "./emulation.js";
import type { CaptureFrame, CaptureResult } from "./frame.js";

export async function runVisibleCapture(host: CaptureHost): Promise<CaptureResult | null> {
  const target = await host.resolveTarget();
  if (!target) {
    host.log(
      "warn",
      "[visible-area] no capturable tab found (devtools / chrome:// pages cannot be captured)",
    );
    return null;
  }
  const settings = await host.loadSettings();
  await host.injectContentScript(target);

  return withEmulatedViewport(host, target, settings, async () => {
    await beginCapturePrep(host, target, "visible", settings, 0);
    // Give the browser a chance to paint the scrollbar-hiding /
    // sticky-hiding style that beginCapturePrep just injected.
    // Without this, captureViewport can fire on the STALE frame
    // (scrollbar still rendered, stickies still visible), baking
    // them into the screenshot. The scroll / per-page paths already
    // waited via POST_HIDE_PAINT_MS; visible was missing it.
    await delay(POST_HIDE_PAINT_MS);
    try {
      const captured = await host.captureViewport(target);
      const [encoded] = await host.encodeBatch([
        {
          pngDataUrl: captured.pngDataUrl,
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
      // Snapshot ElementTree AFTER capture (so
      // `content-visibility: auto` descendants are laid out) but
      // BEFORE endCapturePrep below (stickies stay hidden, so
      // their descendants are filtered out — the tree's element
      // list 1:1 matches the screenshot pixels).
      const tree = await host.requestElementTree(target);
      const frame: CaptureFrame = {
        dataUrl: encoded?.dataUrl ?? captured.pngDataUrl,
        // Width / height stay 0 here — the caller probes the
        // image bitmap to fill them in. This matches the legacy
        // extension flow where `openEditor` did the dimension
        // probe via createImageBitmap.
        width: 0,
        height: 0,
        elementTree: tree ?? undefined,
      };
      return { target, frames: [frame], kind: "visible" };
    } finally {
      await endCapturePrep(host, target);
    }
  });
}
