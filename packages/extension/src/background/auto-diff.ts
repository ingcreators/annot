/**
 * Service-worker-side bridge to the offscreen document's
 * `offscreen-diff` handler. Used by the Auto Capture interaction-
 * probe path to gate frame saves on a pixel-level change check.
 *
 * The service worker can't decode PNGs directly (no `Image`, no
 * reliable `createImageBitmap` for dataUrls in every Chrome
 * version), so we round-trip through the offscreen document that
 * already exists for stitch / crop / mosaic / encode-batch.
 */

import type { DiffResult } from "@ingcreators/annot-capture/diff";

/** Comparison canvas width used by the offscreen diff. Matches the
 *  default the web `AutoCaptureEngine` uses; keep both in sync if you
 *  change one — the per-pixel delta + cursor-only bbox thresholds in
 *  `diff-detection.ts` were tuned for ~320 px-wide canvases. */
const DIFF_COMPARISON_WIDTH = 320;

export interface OffscreenDiffResult {
  meaningful: boolean;
  cursorOnly: boolean;
  diff: DiffResult;
}

async function ensureOffscreen(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["BLOBS"],
      justification: "Image processing (stitch, crop, mosaic, diff)",
    });
  }
}

/**
 * Compare two PNG data URLs via the offscreen document. Returns a
 * `meaningful` flag (changed-pixel ratio crossed the threshold AND
 * not classified as cursor-only) plus the raw diff metrics for
 * logging.
 */
export async function diffFramesViaOffscreen(
  a: string,
  b: string,
  threshold: number,
  ignoreCursorOnly: boolean,
): Promise<OffscreenDiffResult> {
  await ensureOffscreen();
  const result = (await chrome.runtime.sendMessage({
    type: "offscreen-diff",
    a,
    b,
    comparisonWidth: DIFF_COMPARISON_WIDTH,
    threshold,
    ignoreCursorOnly,
  })) as (OffscreenDiffResult & { error?: string }) | undefined;
  if (!result) {
    throw new Error("[auto-diff] offscreen diff returned no result");
  }
  if (result.error) {
    throw new Error(`[auto-diff] offscreen diff failed: ${result.error}`);
  }
  return result;
}
