// Convert a `BboxAnnotation[]` into an SVG fragment string. The
// result is fed into `@ingcreators/annot-annotator`'s
// `createAnnotator({ annotationsSvg })` pipeline at tool-call time
// (Phase 2 onwards).
//
// Composes the in-tree primitives in `svg-primitives.ts` (which
// mirror the shape of `@ingcreators/annot-playwright`'s helpers so
// the agent-facing and test-engineer-facing surfaces produce
// visually consistent output). Adds the circle / callout / raw
// shapes the primitives don't cover.
//
// `LocatorAnnotation`-flavour input lands in Phase 3b — that path
// resolves locators to bboxes and then delegates here. Phase 1
// only implements the bbox flavour.

import { arrowBetween, rectForBoundingBox, textAt } from "./svg-primitives.js";

import type {
  AnnotationStyle,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxRectAnnotation,
  BboxTextAnnotation,
  Intent,
  Point,
  RawAnnotation,
} from "./types.js";

// ─── Intent → colour resolution ─────────────────────────────────
//
// The values mirror the design-system tokens documented in
// `docs/design-system.md`. They're inlined here rather than
// imported from `@ingcreators/annot-editor` because that package
// is Tier C (live-browser-only) and this conversion runs in
// pure Node (Tier A).
//
// If the design tokens move, regenerate this table from the same
// source. The CI invariant in `to-svg.test.ts` snapshots the
// generated SVG, so a drift here will surface as a snapshot diff
// rather than a silent visual regression.

const INTENT_COLOURS: Record<Intent, { stroke: string; fill: string; text: string }> = {
  info: { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.12)", text: "#1e40af" },
  warning: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.12)", text: "#92400e" },
  error: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.12)", text: "#991b1b" },
  success: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.12)", text: "#065f46" },
  neutral: { stroke: "#6b7280", fill: "rgba(107, 114, 128, 0.12)", text: "#374151" },
};

const DEFAULT_INTENT: Intent = "error";

function resolveColours(style: AnnotationStyle): {
  stroke: string;
  fill: string;
  text: string;
} {
  const intent = style.intent ?? DEFAULT_INTENT;
  const base = INTENT_COLOURS[intent];
  return {
    stroke: style.stroke ?? base.stroke,
    fill: style.fill ?? "none",
    text: style.color ?? base.text,
  };
}

// ─── Public entry point ─────────────────────────────────────────

/**
 * Convert a list of bbox-flavour annotations into a single SVG
 * fragment string. The fragment is suitable as the
 * `annotationsSvg` payload for `@ingcreators/annot-annotator`.
 *
 * Phase 1 emits the bare fragments only (no `<svg>` wrapper); the
 * annotator's sanitiser handles wrapping at rasterise time.
 */
export function bboxAnnotationsToSvg(annotations: readonly BboxAnnotation[]): string {
  return annotations.map(bboxAnnotationToSvg).join("");
}

function bboxAnnotationToSvg(annotation: BboxAnnotation): string {
  switch (annotation.type) {
    case "rect":
      return rectFragment(annotation);
    case "circle":
      return circleFragment(annotation);
    case "arrow":
      return arrowFragment(annotation);
    case "text":
      return textFragment(annotation);
    case "callout":
      return calloutFragment(annotation);
    case "raw":
      return rawFragment(annotation);
  }
}

// ─── Per-shape builders ─────────────────────────────────────────

function rectFragment(annotation: BboxRectAnnotation): string {
  const colours = resolveColours(annotation);
  return rectForBoundingBox(annotation.bbox, {
    stroke: colours.stroke,
    strokeWidth: annotation.strokeWidth ?? 2,
    fill: colours.fill,
  });
}

function circleFragment(annotation: BboxCircleAnnotation): string {
  const colours = resolveColours(annotation);
  const strokeWidth = annotation.strokeWidth ?? 2;
  return (
    `<circle cx="${annotation.center.x}" cy="${annotation.center.y}" ` +
    `r="${annotation.radius}" ` +
    `fill="${escapeAttr(colours.fill)}" ` +
    `stroke="${escapeAttr(colours.stroke)}" ` +
    `stroke-width="${strokeWidth}"/>`
  );
}

function arrowFragment(annotation: BboxArrowAnnotation): string {
  const colours = resolveColours(annotation);
  return arrowBetween(annotation.from, annotation.to, {
    color: colours.stroke,
    strokeWidth: annotation.strokeWidth ?? 2,
  });
}

function textFragment(annotation: BboxTextAnnotation): string {
  const colours = resolveColours(annotation);
  return textAt(annotation.at, annotation.content, {
    color: colours.text,
    fontSize: annotation.fontSize ?? 14,
    anchor: annotation.anchor ?? "start",
  });
}

function calloutFragment(annotation: BboxCalloutAnnotation): string {
  // A callout composes three drawn elements in this order:
  //   1. Rect around the target bbox.
  //   2. Arrow from the caption anchor to the nearest edge of the
  //      target bbox.
  //   3. Text at the caption anchor.
  // Z-order matters: text on top so it can sit above the arrow's
  // tail / a possible fill on the rect.
  const colours = resolveColours(annotation);
  const target = annotation.targetBbox;
  const arrowEnd = nearestEdgePoint(target, annotation.at);
  return (
    rectForBoundingBox(target, {
      stroke: colours.stroke,
      strokeWidth: annotation.strokeWidth ?? 2,
      fill: colours.fill,
    }) +
    arrowBetween(annotation.at, arrowEnd, {
      color: colours.stroke,
      strokeWidth: 2,
    }) +
    textAt(annotation.at, annotation.content, {
      color: colours.text,
      fontSize: 14,
      anchor: "start",
    })
  );
}

function rawFragment(annotation: RawAnnotation): string {
  return annotation.svgFragment;
}

// ─── Geometry helpers ───────────────────────────────────────────

/**
 * Project a point onto the nearest point of a bbox's perimeter.
 * Used by callout to pick the natural visual landing point for the
 * arrow head — if the caption is to the left of the bbox, the
 * arrow hits the left edge midpoint; if above, the top edge; etc.
 *
 * The algorithm clamps the caption coordinates to the bbox's
 * range, which automatically picks the nearest perimeter point
 * for any caption position outside the bbox. If the caption is
 * inside the bbox the clamp is a no-op and the arrow is a zero-
 * length line — a degenerate but visually acceptable case (the
 * marker still renders).
 */
function nearestEdgePoint(bbox: BboxLike, point: Point): Point {
  const x = clamp(point.x, bbox.x, bbox.x + bbox.width);
  const y = clamp(point.y, bbox.y, bbox.y + bbox.height);
  return { x, y };
}

interface BboxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
