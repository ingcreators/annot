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

import { MOSAIC_BLOCK_SIZE, REDACT_BLUR_RADIUS, REDACT_SOLID_COLOR } from "@ingcreators/annot-core/utils";
import type { CanvasManager } from "./canvas-manager.js";
import type { RedactStyle } from "@ingcreators/annot-core/editor/tool-options";

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
  return el;
}

async function sampleBlockAveragePng(
  canvas: CanvasManager,
  rect: RedactRect,
  blockSize: number,
): Promise<string> {
  const { x, y, width, height } = rect;
  const baseImage = await loadImage(canvas.imageEl.getAttribute("href") || "");

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d")!;
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
