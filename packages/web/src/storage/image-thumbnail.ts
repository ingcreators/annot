/**
 * Single source of truth for thumbnail generation across every
 * `StorageProvider` implementation that has no server-side thumbnail
 * facility (Browser / GitHub / Device / Drive). The pipeline:
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
 * copies — its public `generateThumbnail` and the inner
 * `#ensureThumbnail`) and subsequently picked up by Device / Drive /
 * Browser to eliminate ~45 LOC of duplicated resize code across the
 * 4 stores.
 *
 * Browser previously used `<img>` + `<canvas>`; the divergence was
 * historical accident, not an environmental constraint. Every store
 * runs in the same PWA main-thread context, both APIs work there,
 * and the `createImageBitmap` path has fewer edge cases (no
 * synthetic onload / onerror bugs, no document-mutation cost,
 * worker-compatible by default).
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
