import {
  computeDiffScore,
  type DiffResult,
  isCursorOnly,
  isMeaningfulChange,
} from "@ingcreators/annot-capture/diff";
import {
  applyMosaic,
  type BatchItem,
  createEncodeWorkerPool,
  cropRect,
  stitchSegments,
} from "@ingcreators/annot-capture/encode";
import { logger } from "../logger.js";

// `new URL("./encode-worker.ts", import.meta.url)` resolves to the
// extension's bundled worker chunk. The worker entry just imports
// `@ingcreators/annot-capture/encode/encode-worker` (which has the
// `self.onmessage` body); keeping a local entry file is what lets
// Vite emit a chunk co-located with this offscreen entry.
const pool = createEncodeWorkerPool({
  spawnWorker: () => new Worker(new URL("./encode-worker.ts", import.meta.url), { type: "module" }),
  log: logger.debug,
});

// Message handler
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "offscreen-stitch": {
        const dataUrl = await stitchSegments(msg.segments, msg.width, msg.height);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-crop": {
        const dataUrl = await cropRect(msg.dataUrl, msg.rect, msg.dpr);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-mosaic": {
        const dataUrl = await applyMosaic(msg.dataUrl, msg.rect, msg.blockSize);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-encode-batch": {
        try {
          const items = msg.items as BatchItem[];
          const results = await pool.encodeBatch(items);
          sendResponse({ results });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          sendResponse({ error: message });
        }
        break;
      }
      case "offscreen-diff": {
        try {
          const result = await diffPngDataUrls(
            msg.a,
            msg.b,
            msg.comparisonWidth,
            msg.threshold,
            msg.ignoreCursorOnly,
          );
          sendResponse(result);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          sendResponse({ error: message });
        }
        break;
      }
    }
  })();
  return true;
});

/**
 * Decode two PNG data URLs into `ImageData` at a common downscaled
 * resolution and run the `diff-detection` heuristics.
 *
 * Downscaling happens on an `OffscreenCanvas` here because the
 * service worker can't construct one (no `OffscreenCanvas` in the SW
 * global on some Chrome versions) and `createImageBitmap` is the only
 * fully-cross-context PNG decoder available in MV3. Comparing on the
 * downscaled bitmap also matches the threshold defaults baked into
 * `diff-detection.ts` (designed for ~320 px-wide comparison canvases).
 */
async function diffPngDataUrls(
  a: string,
  b: string,
  comparisonWidth: number,
  threshold: number,
  ignoreCursorOnly: boolean,
): Promise<{ meaningful: boolean; cursorOnly: boolean; diff: DiffResult }> {
  const [bitmapA, bitmapB] = await Promise.all([dataUrlToBitmap(a), dataUrlToBitmap(b)]);
  // Use bitmapA's aspect ratio for the comparison canvas. If the
  // probe frame disagrees on dimensions (e.g. viewport resize between
  // captures), the rescale to the shared comparison size still gives
  // a meaningful — and "this looks different" — result.
  const width = Math.max(1, Math.min(comparisonWidth, bitmapA.width));
  const height = Math.max(1, Math.round((bitmapA.height / bitmapA.width) * width));
  const imageA = await drawToImageData(bitmapA, width, height);
  const imageB = await drawToImageData(bitmapB, width, height);
  const diff = computeDiffScore(imageA, imageB);
  const cursorOnly = ignoreCursorOnly && isCursorOnly(diff);
  const meaningful = isMeaningfulChange(diff, threshold) && !cursorOnly;
  return { meaningful, cursorOnly, diff };
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

async function drawToImageData(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<ImageData> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[offscreen-diff] OffscreenCanvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
