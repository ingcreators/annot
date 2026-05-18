// Pure SVG-fragment builders. No Playwright dependency; useful as
// standalone helpers for callers who want to assemble custom
// annotations without learning the full SVG syntax. Each helper
// returns a fragment that composes with others via string
// concatenation:
//
//   const svg = [
//     rectForBoundingBox(bbox, { stroke: "red" }),
//     arrowBetween({ x: 100, y: 100 }, { x: bbox.x, y: bbox.y }),
//     textAt({ x: 100, y: 90 }, "expected enabled"),
//   ].join("");
//
// The helpers are intentionally narrow — they cover the
// most-common test-failure annotation patterns. Anything more
// complex, callers compose with raw SVG strings.

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RectOptions {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface ArrowOptions {
  color?: string;
  strokeWidth?: number;
}

export interface TextOptions {
  color?: string;
  fontSize?: number;
  anchor?: "start" | "middle" | "end";
}

/**
 * Outline a bounding box (e.g. from `locator.boundingBox()`) with
 * an SVG `<rect>`. Defaults: red stroke, 2px width, no fill.
 */
export function rectForBoundingBox(bbox: BoundingBox, opts: RectOptions = {}): string {
  const stroke = opts.stroke ?? "red";
  const strokeWidth = opts.strokeWidth ?? 2;
  const fill = opts.fill ?? "none";
  return (
    `<rect x="${bbox.x}" y="${bbox.y}" ` +
    `width="${bbox.width}" height="${bbox.height}" ` +
    `fill="${escapeAttr(fill)}" ` +
    `stroke="${escapeAttr(stroke)}" ` +
    `stroke-width="${strokeWidth}"/>`
  );
}

/**
 * Draw an arrow from `from` to `to`. Inlines a unique-id `<marker>`
 * definition so the helper is self-contained — call it twice and
 * each call produces a distinct arrowhead marker (no collision
 * across uses on the same SVG).
 *
 * Defaults: red color, 2px stroke.
 */
export function arrowBetween(from: Point, to: Point, opts: ArrowOptions = {}): string {
  const color = opts.color ?? "red";
  const strokeWidth = opts.strokeWidth ?? 2;
  const markerId = `annot-pw-arrow-${nextMarkerId()}`;
  return (
    "<defs>" +
    `<marker id="${markerId}" viewBox="0 0 10 10" ` +
    `refX="9" refY="5" markerWidth="6" markerHeight="6" ` +
    `orient="auto" markerUnits="strokeWidth">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeAttr(color)}"/>` +
    "</marker>" +
    "</defs>" +
    `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ` +
    `stroke="${escapeAttr(color)}" stroke-width="${strokeWidth}" ` +
    `marker-end="url(#${markerId})"/>`
  );
}

/**
 * Drop a text label at a position. Defaults: red, 14px,
 * start-anchored.
 */
export function textAt(at: Point, content: string, opts: TextOptions = {}): string {
  const color = opts.color ?? "red";
  const fontSize = opts.fontSize ?? 14;
  const anchor = opts.anchor ?? "start";
  return (
    `<text x="${at.x}" y="${at.y}" ` +
    `fill="${escapeAttr(color)}" ` +
    `font-size="${fontSize}" ` +
    `text-anchor="${anchor}">` +
    escapeText(content) +
    "</text>"
  );
}

// ─── internals ──────────────────────────────────────────────────

let markerIdCounter = 0;
function nextMarkerId(): number {
  markerIdCounter = (markerIdCounter + 1) | 0;
  return markerIdCounter;
}

/** Escape an attribute value. Conservative — handles the five XML
 *  special chars; anything more exotic the caller can escape
 *  themselves. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Escape text content. Same rules as attrs minus the quote
 *  classes (text content can carry quote chars freely). */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
