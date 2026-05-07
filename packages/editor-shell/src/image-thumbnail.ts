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

/** Local copy of `blobToDataUrl` (matches the helpers in
 *  `packages/web/src/storage/github-helpers.ts` and
 *  `packages/core/src/encode/index.ts`). Kept inline so editor-shell
 *  doesn't reach back into annot-web — preserves the host-boundary
 *  invariant captured in `editor-shell/src/host-boundary.test.ts`. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

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

/**
 * Single-decode helper that returns BOTH the thumbnail data URL
 * AND the source's natural dimensions. Used by `ThumbnailManager`
 * to populate the cache's `width` / `height` fields from the same
 * `createImageBitmap` decode the thumbnail render already does —
 * one decode, two outputs.
 *
 * On any failure (decode, no `OffscreenCanvas`, JPEG encode), the
 * result has `dataUrl: ""` and dimensions zeroed; the manager
 * treats that as "skip caching" and the gallery falls back to its
 * placeholder UI.
 */
export async function renderThumbnailWithDims(
  blob: Blob,
  maxWidth: number = DEFAULT_THUMBNAIL_WIDTH,
): Promise<{ dataUrl: string; width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const srcW = bmp.width;
    const srcH = bmp.height;
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return { dataUrl: "", width: 0, height: 0 };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawToThumbCanvas(ctx, canvas, bmp, srcW, srcH, maxWidth);
    bmp.close();
    const outBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: THUMBNAIL_JPEG_QUALITY,
    });
    const dataUrl = await blobToDataUrl(outBlob);
    return { dataUrl, width: srcW, height: srcH };
  } catch {
    return { dataUrl: "", width: 0, height: 0 };
  }
}
