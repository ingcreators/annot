// Convert a `BboxAnnotation[]` into an SVG fragment string. The
// result is fed into `createAnnotator({ ... }).toPng({
// annotationsSvg })`, or — once the same overload lands in
// `@ingcreators/annot-playwright` 0.2.0 — passed through the
// fixture's `annotateScreenshot()` automatically.
//
// Locator-flavoured annotations (`LocatorAnnotation` in
// `@ingcreators/annot-mcp`) get resolved to bbox form by the MCP
// server's browser pool first, then handed to this same path.

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
// Values mirror the design-system tokens documented in
// `docs/design-system.md`. Inlined here rather than imported from
// `@ingcreators/annot-editor` because that package is Tier C
// (live-browser-only); this converter runs in pure Node.

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
 * `annotationsSvg` payload for `createAnnotator(...).toPng()` /
 * `.toSvg()`.
 *
 * Emits bare fragments (no outer `<svg>` wrapper); the annotator's
 * sanitiser wraps them at rasterise time.
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
  // Z-order matters: text on top so it sits above any fill on the
  // rect.
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
 * Clamps the caption coordinates to the bbox range — outside the
 * bbox the clamp picks the closest perimeter point; inside the
 * bbox the clamp is a no-op (degenerate zero-length arrow,
 * visually acceptable).
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
