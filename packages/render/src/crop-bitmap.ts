/**
 * Crop a base bitmap to an axis-aligned sub-rectangle.
 *
 * Tier C-render counterpart to {@link burnRedactionsIntoBitmap} —
 * the destructive-crop sibling of the destructive-redact pipeline.
 * `EditorShell.applyCrop` calls this helper to produce the new
 * bitmap bytes, replaces `imageEl.href` + `ImageRecord.originalDataUrl`
 * with the result, and shifts the annotation tree by `(-x, -y)` so
 * the visible crop is permanently baked into the document state.
 *
 * Pure data-driven `(base, x, y, w, h) → blob`. No `CanvasManager`,
 * no live editor session, no `annot-editor` dependency. Same package
 * boundary discipline as `redact-burn.ts` so storage backends and a
 * future Node / Playwright headless export path can both pull this
 * without dragging the editor into their bundle.
 *
 * The cropped region is clamped to the base's natural dimensions so
 * a slightly-out-of-bounds drag (a user dragging past the edge
 * during the gesture, picked up by happy-dom hit-testing rounding)
 * never produces a bitmap with transparent pixels at the edge. A
 * fully out-of-bounds rect throws — that's a programming error, not
 * a user gesture, and silently producing an empty bitmap would mask
 * the bug.
 */
export async function cropBitmap(
  base: HTMLImageElement | ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<Blob> {
  const baseW = naturalWidth(base);
  const baseH = naturalHeight(base);
  if (baseW <= 0 || baseH <= 0) {
    throw new Error(`cropBitmap: base bitmap has zero dimension (${baseW}×${baseH})`);
  }

  // Clamp the crop rect into the base dimensions. Floor / ceil so the
  // resulting bitmap is integer-sized — non-integer canvas dims are
  // legal but cause subpixel blurring on most browsers.
  const cx = Math.max(0, Math.floor(x));
  const cy = Math.max(0, Math.floor(y));
  const cwRaw = Math.min(baseW - cx, Math.ceil(width));
  const chRaw = Math.min(baseH - cy, Math.ceil(height));
  if (cwRaw <= 0 || chRaw <= 0) {
    throw new Error(
      "cropBitmap: crop rect is fully outside the base bitmap " +
        `(rect=${x},${y},${width},${height}; base=${baseW}×${baseH})`,
    );
  }

  const off = document.createElement("canvas");
  off.width = cwRaw;
  off.height = chRaw;
  const ctx = off.getContext("2d");
  if (!ctx) {
    throw new Error("cropBitmap: 2D canvas context unavailable");
  }

  // Draw the cropped region of the base at the offscreen canvas's
  // origin. The 9-arg drawImage form is the source-rect → dest-rect
  // copy: (src x, src y, src w, src h, dst x, dst y, dst w, dst h).
  ctx.drawImage(base, cx, cy, cwRaw, chRaw, 0, 0, cwRaw, chRaw);

  // Preserve the source format when possible — JPEG bases stay JPEG
  // (smaller bytes for screenshots that don't need an alpha
  // channel), everything else lands as PNG. Detection mirrors
  // `BrowserStore.saveImage`'s data-URL prefix sniff so JPEG
  // captures coming through the extension stay JPEG end-to-end.
  const srcSrc = "src" in base ? base.src : "";
  const isJpeg = typeof srcSrc === "string" && srcSrc.startsWith("data:image/jpeg");
  const mime = isJpeg ? "image/jpeg" : "image/png";

  return new Promise<Blob>((resolve, reject) => {
    off.toBlob((blob) => {
      if (!blob) {
        reject(new Error("cropBitmap: canvas.toBlob produced null"));
        return;
      }
      resolve(blob);
    }, mime);
  });
}

function naturalWidth(b: HTMLImageElement | ImageBitmap): number {
  return "naturalWidth" in b ? b.naturalWidth : b.width;
}

function naturalHeight(b: HTMLImageElement | ImageBitmap): number {
  return "naturalHeight" in b ? b.naturalHeight : b.height;
}
