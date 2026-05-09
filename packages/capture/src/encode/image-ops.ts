/**
 * Pure-canvas image operations the host's offscreen document (extension)
 * or main renderer (Electron Browse window) calls into. None of these
 * functions touch `chrome.*` or `window.electronAPI` — they're plain
 * `OffscreenCanvas` work that runs in any modern Chromium realm.
 */

import { MOSAIC_BLOCK_SIZE } from "@ingcreators/annot-core/utils";
import type { CaptureRect } from "@ingcreators/annot-core/utils/types";

export interface StitchSegment {
  dataUrl: string;
  offsetY: number;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function canvasToDataUrl(
  canvas: OffscreenCanvas,
  format: string,
  quality: number,
): Promise<string> {
  return canvas.convertToBlob({ type: format, quality }).then((blob) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  });
}

/**
 * Vertically stack the captured viewport segments produced by a scroll
 * stitch, drawing each at its corresponding `offsetY`. Output is a
 * lossless PNG — the caller's `encodeCapture()` then applies the user's
 * chosen final format (JPEG / PNG / PNG-8).
 */
export async function stitchSegments(
  segments: StitchSegment[],
  width: number,
  height: number,
): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  for (const seg of segments) {
    const img = await loadImage(seg.dataUrl);
    ctx.drawImage(img, 0, seg.offsetY);
  }
  return canvasToDataUrl(canvas, "image/png", 1);
}

/**
 * Crop a `CaptureRect` (in CSS pixels) out of a full-viewport PNG. `dpr`
 * scales the rect to the capture's physical-pixel coordinate system.
 * Output is a lossless PNG — the caller re-encodes via `encodeCapture()`.
 */
export async function cropRect(dataUrl: string, rect: CaptureRect, dpr: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToDataUrl(canvas, "image/png", 1);
}

/**
 * Apply a mosaic / pixelation effect to the given rect inside `dataUrl`.
 * The rect coords are PHYSICAL pixels (already DPR-scaled by the caller);
 * `blockSize` is the side length of each mosaic cell. Output is a
 * lossless PNG.
 */
export async function applyMosaic(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  blockSize: number,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const imageData = ctx.getImageData(0, 0, rect.width, rect.height);
  const data = imageData.data;
  const bs = blockSize || MOSAIC_BLOCK_SIZE;
  for (let y = 0; y < rect.height; y += bs) {
    for (let x = 0; x < rect.width; x += bs) {
      const sampleX = Math.min(x + Math.floor(bs / 2), rect.width - 1);
      const sampleY = Math.min(y + Math.floor(bs / 2), rect.height - 1);
      const idx = (sampleY * rect.width + sampleX) * 4;
      // `data` is `Uint8ClampedArray` of `width * height * 4`; the
      // sample coords are clamped to [0, dim-1] above.
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const a = data[idx + 3]!;
      for (let by = y; by < Math.min(y + bs, rect.height); by++) {
        for (let bx = x; bx < Math.min(x + bs, rect.width); bx++) {
          const i = (by * rect.width + bx) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToDataUrl(canvas, "image/png", 1);
}
