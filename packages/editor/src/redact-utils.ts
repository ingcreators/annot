/**
 * Redact family utilities — identify and convert between the three
 * Redact variants (mosaic / solid / blur).
 *
 * All variants share the purpose of hiding sensitive content inside
 * a rectangular region. They differ in HOW the content is hidden:
 *
 *   mosaic → block-averaged pixelation baked into a PNG snapshot
 *   solid  → opaque colored rectangle covering the region entirely
 *   blur   → gaussian-blurred PNG snapshot of the underlying pixels
 *
 * The mosaic / blur variants are rendered as <image> elements
 * carrying a baked-in data URL — the annotation is SELF-CONTAINED
 * (no reference to the source image), so the redaction survives
 * any subsequent edit to the base image.
 *
 * Each redact element carries a `data-redact-style` attribute so the
 * PropertyPanel can dispatch correctly and the selection manager
 * can treat it as a redaction rather than a generic shape.
 */

import type { RedactStyle } from "@ingcreators/annot-core/editor/tool-options";
import {
  MOSAIC_BLOCK_SIZE,
  REDACT_BLUR_RADIUS,
  REDACT_SOLID_COLOR,
} from "@ingcreators/annot-core/utils";
import type { CanvasManager } from "./canvas-manager.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface RedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Classify an SVG element as a redact variant, or null if not a
 *  redaction. Uses `data-redact-style` as the source of truth. */
export function detectRedactStyle(el: SVGElement): RedactStyle | null {
  const s = el.getAttribute("data-redact-style");
  if (s === "mosaic" || s === "solid" || s === "blur") return s;
  return null;
}

/** Read an existing redact element's bounding box (works for both
 *  <rect> solid and <image> mosaic/blur). */
export function redactRect(el: SVGElement): RedactRect {
  return {
    x: Number.parseFloat(el.getAttribute("x") || "0"),
    y: Number.parseFloat(el.getAttribute("y") || "0"),
    width: Number.parseFloat(el.getAttribute("width") || "0"),
    height: Number.parseFloat(el.getAttribute("height") || "0"),
  };
}

/** Create a solid-fill <rect> redact element. Cheap, synchronous. */
export function renderSolidRedact(rect: RedactRect, color = REDACT_SOLID_COLOR): SVGRectElement {
  const el = document.createElementNS(SVG_NS, "rect");
  el.setAttribute("x", String(rect.x));
  el.setAttribute("y", String(rect.y));
  el.setAttribute("width", String(rect.width));
  el.setAttribute("height", String(rect.height));
  el.setAttribute("fill", color);
  el.setAttribute("data-redact-style", "solid");
  return el;
}

/** Render the mosaic variant — samples the underlying image pixels,
 *  replaces each MOSAIC_BLOCK_SIZE×MOSAIC_BLOCK_SIZE block with its
 *  center pixel, returns an <image> element with the result baked in. */
export async function renderMosaicRedact(
  rect: RedactRect,
  canvas: CanvasManager,
): Promise<SVGImageElement> {
  const dataUrl = await sampleBlockAveragePng(canvas, rect, MOSAIC_BLOCK_SIZE);
  return buildImageRedact(rect, dataUrl, "mosaic");
}

/** Render the blur variant — uses Canvas 2D's `filter: blur()` over
 *  the extracted region. Returns an <image> element with the blurred
 *  PNG baked in (self-contained, no reference to the base image). */
export async function renderBlurRedact(
  rect: RedactRect,
  canvas: CanvasManager,
): Promise<SVGImageElement> {
  const dataUrl = await renderBlurPng(canvas, rect, REDACT_BLUR_RADIUS);
  return buildImageRedact(rect, dataUrl, "blur");
}

/**
 * Convert a redact element from one style to another. Preserves the
 * rectangle, generates new content for the target style, and replaces
 * the old element in the DOM. Returns the new element so callers can
 * update selection references.
 */
export async function convertRedactStyle(
  oldEl: SVGElement,
  newStyle: RedactStyle,
  canvas: CanvasManager,
  solidColor = REDACT_SOLID_COLOR,
): Promise<SVGElement> {
  const parent = oldEl.parentNode;
  if (!parent) throw new Error("convertRedactStyle: detached element");
  const rect = redactRect(oldEl);

  let newEl: SVGElement;
  if (newStyle === "solid") {
    newEl = renderSolidRedact(rect, solidColor);
  } else if (newStyle === "mosaic") {
    newEl = await renderMosaicRedact(rect, canvas);
  } else {
    newEl = await renderBlurRedact(rect, canvas);
  }

  // Preserve any transform (from previous drags) so the redaction
  // doesn't visually jump when the style changes.
  const transform = oldEl.getAttribute("transform");
  if (transform) newEl.setAttribute("transform", transform);

  parent.replaceChild(newEl, oldEl);
  return newEl;
}

// ---- internals ----

function buildImageRedact(
  rect: RedactRect,
  dataUrl: string,
  style: "mosaic" | "blur",
): SVGImageElement {
  const el = document.createElementNS(SVG_NS, "image");
  el.setAttribute("href", dataUrl);
  el.setAttribute("x", String(rect.x));
  el.setAttribute("y", String(rect.y));
  el.setAttribute("width", String(rect.width));
  el.setAttribute("height", String(rect.height));
  el.setAttribute("data-redact-style", style);
  // SVG's `<image>` default is `preserveAspectRatio="xMidYMid meet"`
  // — fit the embedded PNG inside the wrapper without distortion.
  // For a redact `<image>` that means: when the wrapper's aspect
  // ratio diverges from the embedded blur / mosaic PNG's aspect
  // ratio, the difference reads as transparent padding INSIDE the
  // selection bounds, with the underlying screenshot fully visible
  // through the gap. Privacy violation.
  //
  // The aspect ratios diverge during continuous resize: rebake A
  // captures the rect mid-drag, sample-PNG-renders at that
  // (smaller) aspect, then later resizes update the wrapper's
  // x/y/w/h while rebake A is still in flight. By the time
  // rebake A completes, the wrapper is at gesture-N's aspect and
  // the PNG is at gesture-A's aspect — meet padding shows the
  // unredacted screenshot through the difference until the
  // serialised follow-up rebake catches up. Reported by the user
  // as: "blurも連続してサイズ変更していると、オブジェクトとblurの
  // エリアに差異が発生します。"
  //
  // Setting `preserveAspectRatio="none"` makes the embedded image
  // ALWAYS stretch to fill the wrapper, eliminating the gap. The
  // worst transient effect is now a subtly stretched blur instead
  // of a hole — the privacy contract holds throughout the race,
  // and the follow-up rebake rerenders at the final aspect anyway.
  el.setAttribute("preserveAspectRatio", "none");
  return el;
}

async function sampleBlockAveragePng(
  canvas: CanvasManager,
  rect: RedactRect,
  blockSize: number,
): Promise<string> {
  const { x, y } = rect;
  // Floor the dimensions before they reach the typed-array math
  // below. SelectionManager's resize path computes width/height as
  // `pt.x - x` / `pt.y - y` against the SVG-space pointer, which
  // routinely produces values like `670.0000000000002` after
  // accumulating IEEE-754 rounding through `svgPoint(e)`'s viewport
  // transform on a high-DPI base image (DOM canvas pixel size ÷
  // viewBox isn't an exact ratio). The canvas's `width` setter
  // floors that to 670 internally — but the local `width` /
  // `height` variables stay fractional, and `(sy * width + sx) * 4`
  // then yields non-integer indices into the `Uint8ClampedArray`
  // returned by `getImageData`. Typed-array integer-indexed slots
  // silently reject non-canonical numeric keys: reads return
  // `undefined`, writes are no-ops. Result: only the integer-stride
  // sy=0 row of the loop's writes ever lands; rows 1..N-1 keep the
  // raw `drawImage`'d pixels (the unredacted base content). The
  // mosaic looks "transparent" because the unblocked text shows
  // straight through the failed averaging. Flooring here keeps
  // every index integer so the loop pixelates the entire region.
  // Reported by the user as: "サイズ拡大は透明になる."
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width <= 0 || height <= 0) {
    // Defensive: the resize path clamps to ≥ 10, but a future caller
    // could pass a degenerate rect — return a 1×1 transparent PNG so
    // we don't construct a 0×0 canvas (toDataURL on which is the
    // empty-data-url sentinel and would re-trigger the regression
    // the storage layer flags as "no annotations").
    const off1 = document.createElement("canvas");
    off1.width = 1;
    off1.height = 1;
    return off1.toDataURL("image/png");
  }
  const baseImage = await loadImage(canvas.imageEl.getAttribute("href") || "");

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d")!;
  // Pre-fill with an opaque sentinel BEFORE drawImage so any
  // out-of-base-image region (negative `x` / `y` after dragging the
  // upper-left handle past 0; or `x + width` / `y + height` past
  // the base image's natural dimensions after dragging the lower-
  // right handle off the right / bottom edge) stays opaque rather
  // than transparent. Without this, drawImage clips its source rect
  // to the image bounds AND leaves the destination's out-of-source
  // pixels in their initial transparent state — the block-average
  // loop below then samples alpha=0 from the center pixel of any
  // such block and the redaction becomes a transparent hole that
  // shows whatever sits beneath it (defeating the redact tool's
  // entire purpose). Using REDACT_SOLID_COLOR for the fallback
  // matches the Solid bar variant: where there's no underlying
  // bitmap content, the redaction reads as a solid bar instead of
  // mosaic noise. See user-feedback regression caught after
  // [`_done/redact-burn-into-image.md`](../../../docs/plans/_done/redact-burn-into-image.md)
  // landed.
  ctx.fillStyle = REDACT_SOLID_COLOR;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(baseImage, x, y, width, height, 0, 0, width, height);

  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;
  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      // Use the block's center pixel as the representative color.
      const sx = Math.min(bx + Math.floor(blockSize / 2), width - 1);
      const sy = Math.min(by + Math.floor(blockSize / 2), height - 1);
      const idx = (sy * width + sx) * 4;
      // `px` is a `Uint8ClampedArray` sized at `width * height * 4`;
      // `sx` / `sy` are clamped to their dimensions above, so `idx`
      // and `idx + 0..3` are always within bounds.
      const r = px[idx]!;
      const g = px[idx + 1]!;
      const b = px[idx + 2]!;
      const a = px[idx + 3]!;
      for (let yy = by; yy < Math.min(by + blockSize, height); yy++) {
        for (let xx = bx; xx < Math.min(bx + blockSize, width); xx++) {
          const i = (yy * width + xx) * 4;
          px[i] = r;
          px[i + 1] = g;
          px[i + 2] = b;
          px[i + 3] = a;
        }
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return off.toDataURL("image/png");
}

async function renderBlurPng(
  canvas: CanvasManager,
  rect: RedactRect,
  blurRadius: number,
): Promise<string> {
  const { x, y, width, height } = rect;
  const baseImage = await loadImage(canvas.imageEl.getAttribute("href") || "");

  // Blur leaks pixels from beyond the edges — without a margin, the
  // edge of the blurred rectangle would show a brighter/transparent
  // halo. Pad the sampling rectangle, blur, then crop back to size.
  const pad = Math.ceil(blurRadius * 2);
  const paddedW = width + pad * 2;
  const paddedH = height + pad * 2;
  const padded = document.createElement("canvas");
  padded.width = paddedW;
  padded.height = paddedH;
  const pctx = padded.getContext("2d")!;
  // Pre-fill with the same opaque sentinel as the mosaic path
  // (sampleBlockAveragePng above) so the out-of-base-image region —
  // when the redaction has been dragged or resized so its geometry
  // extends past the base bitmap's bounds — stays opaque instead of
  // bleeding the underlying canvas through the blur. The pre-fill
  // runs BEFORE setting `filter = blur(...)` so the fillRect itself
  // doesn't get blurred; the subsequent drawImage then runs WITH
  // the blur filter active so its source pixels blur cleanly into
  // the solid pre-fill at the boundary. See regression note in
  // sampleBlockAveragePng.
  pctx.fillStyle = REDACT_SOLID_COLOR;
  pctx.fillRect(0, 0, paddedW, paddedH);
  pctx.filter = `blur(${blurRadius}px)`;
  // Draw the surrounding area (clamped to image bounds) so the blur
  // kernel has real pixels to blend.
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(baseImage.naturalWidth, x + width + pad) - sx;
  const sh = Math.min(baseImage.naturalHeight, y + height + pad) - sy;
  pctx.drawImage(baseImage, sx, sy, sw, sh, sx - (x - pad), sy - (y - pad), sw, sh);

  // Crop back to the target rectangle so the returned image is the
  // exact size of the redaction.
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const octx = out.getContext("2d")!;
  octx.drawImage(padded, pad, pad, width, height, 0, 0, width, height);
  return out.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
