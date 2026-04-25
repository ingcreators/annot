// Tier B — pure viewport / zoom math used by CanvasManager and any
// future headless viewport simulator. No DOM access; takes plain
// numbers + (optionally) a 2D affine matrix as a six-tuple.
//
// Extracted from `@ingcreators/annot-editor/canvas-manager` so the zoom
// clamping, fit-to-view scale and screen-to-SVG point math can be
// unit-tested without standing up a real `<svg>` element. CanvasManager
// keeps its DOM responsibilities (setViewBox, attribute writes,
// getScreenCTM lookup) and delegates the arithmetic here.

/**
 * Default minimum / maximum zoom levels mirroring the historical
 * `setZoom()` clamp inside `CanvasManager`. Exported so callers can
 * stay aligned with the editor's published behavior.
 */
export const DEFAULT_MIN_ZOOM = 0.1;
export const DEFAULT_MAX_ZOOM = 5;

/**
 * Padding (in CSS pixels) the editor reserves around the canvas when
 * computing "Fit to window". Matches the historical magic number in
 * CanvasManager.fitToView.
 */
export const FIT_VIEW_PADDING = 40;

/**
 * Clamp `z` into the supported zoom range. Pure replacement for the
 * inline `Math.max(min, Math.min(z, max))` previously embedded in
 * `CanvasManager.setZoom`.
 */
export function clampZoom(
  z: number,
  min: number = DEFAULT_MIN_ZOOM,
  max: number = DEFAULT_MAX_ZOOM,
): number {
  return Math.max(min, Math.min(z, max));
}

/**
 * Compute the "Fit to window" zoom factor for an image of the given
 * intrinsic size against a container. Padding is subtracted from the
 * container dimensions before fitting (matching the historical
 * editor behavior); the result is capped at `maxZoom` so a small
 * image never scales above 1× in fit mode.
 *
 * Returns 0 when either container dimension would be ≤ 0 after
 * padding, signalling "container not yet laid out — caller should
 * skip this fit pass". This matches the legacy behavior of
 * `Math.min(negativeNumber, 1)` becoming a non-positive scale that
 * the editor effectively ignored when the surrounding container had
 * not been measured yet.
 */
export function computeFitZoom(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = FIT_VIEW_PADDING,
  maxZoom = 1,
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 0;
  const cw = containerWidth - padding;
  const ch = containerHeight - padding;
  if (cw <= 0 || ch <= 0) return 0;
  return Math.min(cw / imageWidth, ch / imageHeight, maxZoom);
}

/**
 * Compute the rendered pixel size of the canvas at a given zoom,
 * rounding to integer device pixels (matching what CanvasManager
 * writes into the `<svg>` element's width/height attributes).
 */
export function computeRenderedSize(
  imageWidth: number,
  imageHeight: number,
  zoom: number,
): { width: number; height: number } {
  return {
    width: Math.round(imageWidth * zoom),
    height: Math.round(imageHeight * zoom),
  };
}

/**
 * 2D affine matrix expressed as a six-tuple `[a, b, c, d, e, f]`,
 * applying the transform `(x, y) → (a*x + c*y + e, b*x + d*y + f)`.
 *
 * This matches the layout of `DOMMatrix` / `SVGMatrix` in the
 * browser, so callers can populate it from `getScreenCTM()` via
 * `[m.a, m.b, m.c, m.d, m.e, m.f]` and feed it to `applyInverse`
 * without needing a real `DOMMatrix` instance under jsdom / Node.
 */
export type AffineMatrix = readonly [number, number, number, number, number, number];

/**
 * Apply the inverse of a 2D affine matrix to a client-space point,
 * yielding the corresponding SVG-space point. This is the pure-math
 * core of `CanvasManager.svgPoint(e)`:
 *   1. Read the live `getScreenCTM()` (browser-only, in CanvasManager).
 *   2. Pass its components to `applyInverseAffine` along with the
 *      pointer's `clientX/clientY` (here).
 *
 * Throws if the matrix is singular (det ≈ 0); the editor never
 * encounters this in practice because an unrendered `<svg>` returns
 * `null` from `getScreenCTM()` and CanvasManager skips the call.
 */
export function applyInverseAffine(
  matrix: AffineMatrix,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (det === 0) {
    throw new Error("applyInverseAffine: matrix is singular");
  }
  // Closed-form 2D inverse-affine application:
  //   inv(M) · (clientX, clientY)
  //   = ((d*cx - c*cy + (c*f - d*e)) / det,
  //      (-b*cx + a*cy + (b*e - a*f)) / det)
  const x = (d * clientX - c * clientY + (c * f - d * e)) / det;
  const y = (-b * clientX + a * clientY + (b * e - a * f)) / det;
  return { x, y };
}
