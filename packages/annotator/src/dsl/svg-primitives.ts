// SVG fragment builders used by `bboxAnnotationsToSvg`. Exported
// publicly because callers occasionally want a single primitive
// without going through the full DSL.
//
// `arrowBetween` inlines a `<marker>` definition per call with a
// unique id (`annot-arrow-N`). This used to be `annot-pw-arrow-N`
// in `@ingcreators/annot-playwright` and `annot-mcp-arrow-N` in
// `@ingcreators/annot-mcp`; the canonical home is now here, so
// the prefix is the package-agnostic `annot-arrow-N`. Snapshot
// tests on the SVG output of those packages will see this minor
// prefix change as part of the 0.2.0 bump.

import type { BBox, Point } from "./types.js";

/**
 * Back-compat alias retained because the original
 * `@ingcreators/annot-playwright` helpers exposed this name.
 * Prefer importing `BBox` from `@ingcreators/annot-annotator`
 * directly.
 */
export type BoundingBox = BBox;

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

/** Outline a bounding box with an SVG `<rect>`. */
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
 * each call produces a distinct arrowhead marker.
 */
export function arrowBetween(from: Point, to: Point, opts: ArrowOptions = {}): string {
  const color = opts.color ?? "red";
  const strokeWidth = opts.strokeWidth ?? 2;
  const markerId = `annot-arrow-${nextMarkerId()}`;
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

/** Drop a text label at a position. */
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

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
