// Node-side counterpart to `@ingcreators/annot-render`'s
// `renderImageRecord`. The browser version (see
// `packages/render/src/render-image-record.ts`) builds an SVG
// string and rasterises via `new Image()` + `<canvas>` +
// `URL.createObjectURL`. None of that runs in Node.
//
// This module reproduces the SVG-string construction (a string-
// level operation, fully portable) and swaps the rasterisation
// path for `@resvg/resvg-js` — a NAPI binding around Mozilla
// resvg that is a pure `(svg: string) => Buffer` function.
//
// Phase 0 spike — see `docs/plans/headless-annotator-spike.md`.
// The simplifications below are deliberate; Phase 1 hardens
// them when the package becomes public.

import {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
} from "@ingcreators/annot-core/editor/svg-format";
import { Resvg } from "@resvg/resvg-js";

/**
 * Build the rasterise-ready SVG string for a Node-side render.
 *
 * Mirrors the browser-side `renderImageRecord`'s SVG construction:
 * - outer `<svg>` with the standard Annot version stamp
 * - base bitmap embedded as `<image>` at the viewport
 * - annotations inserted as inner content
 *
 * `annotationsInnerXml` is the inner content of the editor's saved
 * `<svg>` wrapper — NOT a full `<svg>...</svg>` document. The spike
 * test passes a small hand-built fragment; Phase 1 will accept the
 * editor's saved wrapper and do the proper DOM-walking
 * (defs sanitisation, base-image deduplication, ui-overlay skip)
 * via a Node XML parser instead of `DOMParser`.
 */
export function buildHeadlessSvg(
  originalDataUrl: string,
  annotationsInnerXml: string,
  width: number,
  height: number,
): string {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";

  return (
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK}" ` +
    `${ANNOT_SVG_VERSION_ATTR}="${ANNOT_SVG_VERSION}" ` +
    `width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<image href="${originalDataUrl}" width="${width}" height="${height}"/>` +
    annotationsInnerXml +
    "</svg>"
  );
}

/**
 * Rasterise an `ImageRecord`-shaped input to PNG bytes, in Node.
 *
 * Returns raw PNG `Uint8Array`. Callers can wrap in `Buffer.from(...)`
 * or write straight to disk. JPEG output is intentionally NOT
 * supported in the spike — resvg-js is PNG-only; piping through
 * `sharp` is a Phase 1 decision documented in `SPIKE_REPORT.md`.
 *
 * Fonts: this function does NOT register any system fonts. The
 * `loadSystemFonts` flag is left at the resvg-js default. Text
 * elements with `font-family` set to CJK fonts will fall back to
 * resvg's default font on stock CI images. See SPIKE_REPORT.md
 * for the documented gap.
 */
export function renderImageRecordToPngBytes(
  originalDataUrl: string,
  annotationsInnerXml: string,
  width: number,
  height: number,
): Uint8Array {
  const svgString = buildHeadlessSvg(originalDataUrl, annotationsInnerXml, width, height);
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0, 0, 0, 0)",
  });
  return resvg.render().asPng();
}
