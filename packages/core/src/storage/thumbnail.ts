/**
 * Shared thumbnail rendering helper.
 *
 * The gallery card is a fixed 16:9 tile. Scaling a short/wide source image
 * up to fill that tile (as `object-fit: cover` would do) makes the image
 * blurry. Instead, every storage provider's `generateThumbnail()` draws
 * onto a fixed-aspect (16:9) canvas with the following rules:
 *
 *   - Never upscale. If the source is smaller than the canvas, it stays
 *     at natural size and the gaps are filled with the `bgColor`.
 *   - For source wider than 16:9 (or exactly 16:9): fit width,
 *     letterbox vertically when shorter than the canvas height.
 *   - For source taller than 16:9 (portrait screenshots, scrollshots):
 *     fit width, take only the top portion so the canvas shows the
 *     "head" of the page — matching typical screenshot gallery UX.
 *
 * Works with both `HTMLCanvasElement` (main-thread web) and
 * `OffscreenCanvas` (service worker / fs-store). Caller passes in the
 * source's natural width/height so we don't assume an `HTMLImageElement`.
 */

export interface ThumbCanvasLike {
  width: number;
  height: number;
}

export type ThumbImageSource = HTMLImageElement | CanvasImageSource;

/**
 * Configure `canvas` size, clear the background, and draw `source` onto it
 * following the rules above. The canvas ends up exactly `targetW × targetH`
 * where targetW = maxWidth and targetH = round(targetW * 9/16).
 */
export function drawToThumbCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvas: ThumbCanvasLike,
  source: ThumbImageSource,
  srcW: number,
  srcH: number,
  maxWidth = 480,
  bgColor = "#111",
): void {
  const targetW = maxWidth;
  const targetH = Math.max(1, Math.round((targetW * 9) / 16));
  canvas.width = targetW;
  canvas.height = targetH;

  // Solid background (no transparency — thumbnails are JPEG).
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, targetW, targetH);

  if (srcW <= 0 || srcH <= 0) return;

  const srcAspect = srcW / srcH;
  const dstAspect = targetW / targetH;

  if (srcAspect >= dstAspect) {
    // Source is at least as wide as the card: fit width, letterbox vertically.
    // Never upscale past natural width.
    const finalW = Math.min(srcW, targetW);
    const finalH = Math.round((finalW * srcH) / srcW);
    const x = Math.round((targetW - finalW) / 2);
    const y = Math.round((targetH - finalH) / 2);
    // Use full source bounds → destination rect
    ctx.drawImage(source as CanvasImageSource, 0, 0, srcW, srcH, x, y, finalW, finalH);
  } else {
    // Source is taller than the card: take only the TOP portion so the
    // screenshot's header/first content is visible. Fit width (no upscale).
    const finalW = Math.min(srcW, targetW);
    const scale = finalW / srcW;
    // Source slice height to fill the canvas height at this scale — but
    // never exceed the actual source height.
    const srcSliceH = Math.min(targetH / scale, srcH);
    const finalH = Math.round(srcSliceH * scale);
    const x = Math.round((targetW - finalW) / 2);
    ctx.drawImage(source as CanvasImageSource, 0, 0, srcW, srcSliceH, x, 0, finalW, finalH);
  }
}
