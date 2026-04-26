/**
 * Shared thumbnail-generation helpers used by storage backends that
 * have no server-side thumbnail facility (GitHub, Device, Drive).
 * Each store needs the same "scale into JPEG, return data URL" pipeline:
 *
 *     blob ──► createImageBitmap ──► OffscreenCanvas (resize)
 *                                         │
 *                                         ▼
 *                                   convertToBlob (JPEG, q=0.85)
 *                                         │
 *                                         ▼
 *                                  blobToDataUrl
 *
 * Lifted out of `github-store.ts` (which had two near-identical
 * copies — its public `generateThumbnail` and the inner `#ensureThumbnail`)
 * so the resize pipeline has a single source of truth and unit tests.
 *
 * `BrowserStore` keeps its own `<img>`-based variant because it runs
 * in the main thread + DOM document and depends on `<img>` rather
 * than `createImageBitmap`. That divergence is intentional; the
 * helpers here are for the workerable path the other three stores share.
 */

import { drawToThumbCanvas } from "@ingcreators/annot-core/storage";
import { blobToDataUrl } from "./github-helpers.js";

/** Default longest-edge target (in CSS pixels) for gallery cards. */
export const DEFAULT_THUMBNAIL_WIDTH = 480;

/** JPEG quality the resize step emits. Matches the historical
 *  GitHubStore / DeviceStore / GoogleDriveStore literal. */
export const THUMBNAIL_JPEG_QUALITY = 0.85;

/**
 * Generate a JPEG-encoded thumbnail data URL from a `Blob`.
 *
 * `maxWidth` clamps the longest edge while preserving aspect via
 * `drawToThumbCanvas`. Errors are swallowed and produce an empty
 * string so the gallery falls back to its placeholder UI rather
 * than throwing during scroll.
 */
export async function generateThumbnailFromBlob(
  blob: Blob,
  maxWidth: number = DEFAULT_THUMBNAIL_WIDTH,
): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawToThumbCanvas(ctx, canvas, bmp, bmp.width, bmp.height, maxWidth);
    bmp.close();
    const outBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: THUMBNAIL_JPEG_QUALITY,
    });
    return blobToDataUrl(outBlob);
  } catch {
    return "";
  }
}

/**
 * Generate a JPEG-encoded thumbnail data URL from a source `data:` URL.
 * Wraps {@link generateThumbnailFromBlob} after the round-trip
 * through `fetch(dataUrl).blob()`.
 */
export async function generateThumbnailFromDataUrl(
  dataUrl: string,
  maxWidth: number = DEFAULT_THUMBNAIL_WIDTH,
): Promise<string> {
  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return generateThumbnailFromBlob(blob, maxWidth);
  } catch {
    return "";
  }
}
