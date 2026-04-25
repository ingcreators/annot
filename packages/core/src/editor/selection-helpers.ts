/**
 * Pure helpers + constants for the editor selection layer.
 * Extracted from `selection.ts` as Stage 3c-1 of
 * `docs/plans/pre-release-cleanup.md` to start whittling that
 * 2k-line god-module down. None of these reference
 * `SelectionManager`-private state — they're plain helpers
 * over SVG geometry, cursor naming, and arrow / line endpoints.
 */

import {
  readArrowEndpoints,
  refreshArrowPath,
  writeArrowEndpoints,
} from "./arrow-markers.js";

/** Namespace URI for SVG elements — used by `createElementNS`. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** Side length of square resize handles, in screen pixels. */
export const HANDLE_SIZE = 8;

/** Px offset applied per paste — keeps successive pastes from
 *  stacking exactly on top of the source. */
export const PASTE_OFFSET = 20;

/** True when the element is an ArrowTool-produced arrow (outer `<g>`
 *  wrapping stem + head `<path>` children, storing endpoints in
 *  `data-x1/y1/x2/y2` on the group). */
export function isArrowGroup(el: Element): boolean {
  return el.tagName === "g" && el.getAttribute("data-type") === "arrow";
}

/** Read endpoint coordinates off either a classic `<line>` element or
 *  a new `<g data-type="arrow">` wrapper. Arrow groups store their
 *  geometric endpoints in `data-x1/y1/x2/y2` (the children's `d`
 *  attributes are composed strings, not directly readable). */
export function lineEndpointsOf(el: SVGElement): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  if (isArrowGroup(el)) {
    return readArrowEndpoints(el);
  }
  return {
    x1: Number.parseFloat(el.getAttribute("x1") || "0"),
    y1: Number.parseFloat(el.getAttribute("y1") || "0"),
    x2: Number.parseFloat(el.getAttribute("x2") || "0"),
    y2: Number.parseFloat(el.getAttribute("y2") || "0"),
  };
}

/** Write endpoint coordinates to either a `<line>` or an arrow `<g>`. */
export function setLineEndpoints(
  el: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (isArrowGroup(el)) {
    writeArrowEndpoints(el, x1, y1, x2, y2);
    refreshArrowPath(el);
    return;
  }
  el.setAttribute("x1", String(x1));
  el.setAttribute("y1", String(y1));
  el.setAttribute("x2", String(x2));
  el.setAttribute("y2", String(y2));
}

/** Rotate (px, py) around (cx, cy) by `rad` radians. Local copy for
 *  the rotation gesture's snapshot-based update path (transform-utils
 *  has the same formula inside `rotateLineEndpointsBy` but that helper
 *  takes an element + degrees; the gesture operates on a fixed
 *  snapshot, so we keep this tiny helper local). */
export function rotateAround(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rad: number,
): { x: number; y: number } {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + (px - cx) * cos - (py - cy) * sin,
    y: cy + (px - cx) * sin + (py - cy) * cos,
  };
}

/** 8 axis-aligned resize cursor names, indexed by 45° sector starting
 *  from "due east" (right) and walking clockwise. Used to map a
 *  handle's screen-space angle (relative to its element's center) into
 *  an appropriate cursor — so a NW handle on a 45°-rotated rect ends
 *  up showing a north-pointing cursor instead of a NW-pointing one. */
const CURSOR_BY_SECTOR = [
  "ew-resize", // 0 → E (-22.5°..22.5°)
  "nwse-resize", // 1 → SE
  "ns-resize", // 2 → S
  "nesw-resize", // 3 → SW
  "ew-resize", // 4 → W
  "nwse-resize", // 5 → NW
  "ns-resize", // 6 → N
  "nesw-resize", // 7 → NE
];

/** Pick the appropriate axis-aligned cursor for the angle at which
 *  a resize handle sits relative to its element's centre. */
export function cursorForAngle(rad: number): string {
  // Normalize to [0, 2π), then split into 8 equal sectors offset by π/8
  // so cursor "centers" align with E/SE/S/SW/W/NW/N/NE.
  const TAU = Math.PI * 2;
  let a = ((rad % TAU) + TAU) % TAU;
  a += Math.PI / 8;
  if (a >= TAU) a -= TAU;
  const idx = Math.floor(a / (Math.PI / 4));
  // `idx % 8` is in `[0, 7]` and `CURSOR_BY_SECTOR` has 8 entries.
  return CURSOR_BY_SECTOR[idx % 8]!;
}

/** Convert a point in SVG-root coords into an element's local
 *  pre-transform coords. Used to interpret the user's pointer position
 *  for things stored in element-local space (e.g. callout tail tip). */
export function pointToLocal(el: SVGElement, pt: DOMPoint, svg: SVGSVGElement): DOMPoint {
  const ctm = (el as SVGGraphicsElement).getCTM();
  const svgCTM = svg.getCTM();
  if (!ctm || !svgCTM) return pt;
  const m = svgCTM.inverse().multiply(ctm);
  return new DOMPoint(pt.x, pt.y).matrixTransform(m.inverse());
}

/** Map a point in an element's local pre-transform coords back to
 *  SVG-root coords. */
export function localToSvgPoint(el: SVGElement, p: DOMPoint, svg: SVGSVGElement): DOMPoint {
  const ctm = (el as SVGGraphicsElement).getCTM();
  const svgCTM = svg.getCTM();
  if (!ctm || !svgCTM) return p;
  const m = svgCTM.inverse().multiply(ctm);
  return new DOMPoint(p.x, p.y).matrixTransform(m);
}

/** Get bounding box in SVG root coordinate space (accounts for transform) */
export function getWorldBBox(el: SVGElement, svg: SVGSVGElement): DOMRect | null {
  const g = el as SVGGraphicsElement;
  if (!g.getBBox) return null;
  const local = g.getBBox();
  const ctm = g.getCTM();
  const svgCTM = svg.getCTM();
  if (!ctm || !svgCTM) return new DOMRect(local.x, local.y, local.width, local.height);

  // Transform local bbox corners through the element's CTM relative to SVG root
  const inv = svgCTM.inverse();
  const m = inv.multiply(ctm);

  const corners = [
    new DOMPoint(local.x, local.y).matrixTransform(m),
    new DOMPoint(local.x + local.width, local.y).matrixTransform(m),
    new DOMPoint(local.x + local.width, local.y + local.height).matrixTransform(m),
    new DOMPoint(local.x, local.y + local.height).matrixTransform(m),
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}
