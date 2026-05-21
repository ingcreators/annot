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
  BadgePlacement,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxNumberedBadgeAnnotation,
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
    case "numberedBadge":
      return numberedBadgeFragment(annotation);
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

/**
 * Default badge diameter in image pixels. Sized so the number
 * stays legible when the screenshot is scaled to 50 % in a
 * documentation column.
 */
const DEFAULT_BADGE_SIZE = 40;

function numberedBadgeFragment(annotation: BboxNumberedBadgeAnnotation): string {
  const colours = resolveColours(annotation);
  const badgeSize = annotation.badgeSize ?? DEFAULT_BADGE_SIZE;
  const placement = resolvePlacement(annotation, badgeSize);

  // 1. Target outline — same shape as a bare `rect` annotation,
  //    but always intent-stroked + transparent fill so the user
  //    can see what the badge is pointing at.
  const rect = rectForBoundingBox(annotation.bbox, {
    stroke: colours.stroke,
    strokeWidth: annotation.strokeWidth ?? 3,
    fill: annotation.fill ?? "none",
  });

  // 2. Badge: filled intent-coloured circle, white inner ring for
  //    contrast against any underlying screenshot content.
  const center = badgeCenter(annotation.bbox, placement);
  const r = badgeSize / 2;
  const circle =
    `<circle cx="${center.x}" cy="${center.y}" r="${r}" ` +
    `fill="${colours.stroke}" stroke="#ffffff" stroke-width="${Math.max(2, r * 0.12)}" />`;

  // 3. The number — bold, white, vertically + horizontally
  //    centred via `text-anchor` + `dominant-baseline`. Font size
  //    scales with the badge so a custom `badgeSize` reads as
  //    intended.
  const fontSize = Math.round(r * 1.1);
  const number =
    `<text x="${center.x}" y="${center.y}" ` +
    `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="#ffffff" ` +
    `text-anchor="middle" dominant-baseline="central">` +
    `${escapeAttr(String(annotation.number))}` +
    "</text>";

  return rect + circle + number;
}

function resolvePlacement(
  annotation: BboxNumberedBadgeAnnotation,
  badgeSize: number,
): Exclude<BadgePlacement, "auto"> {
  if (annotation.placement && annotation.placement !== "auto") {
    return annotation.placement;
  }
  // `auto`: pick the corner of the target bbox that's furthest
  // from the image edge. Falls back to `topRight` when image
  // dims are unknown.
  if (annotation.imageWidth === undefined || annotation.imageHeight === undefined) {
    return "topRight";
  }
  const r = badgeSize / 2;
  const corners: Array<{ kind: Exclude<BadgePlacement, "auto">; x: number; y: number }> = [
    { kind: "topLeft", x: annotation.bbox.x, y: annotation.bbox.y },
    {
      kind: "topRight",
      x: annotation.bbox.x + annotation.bbox.width,
      y: annotation.bbox.y,
    },
    {
      kind: "bottomLeft",
      x: annotation.bbox.x,
      y: annotation.bbox.y + annotation.bbox.height,
    },
    {
      kind: "bottomRight",
      x: annotation.bbox.x + annotation.bbox.width,
      y: annotation.bbox.y + annotation.bbox.height,
    },
  ];
  // Score = min distance to ANY image edge after the badge's
  // half-radius offset is applied. Pick the corner with the
  // highest score (furthest from clipping).
  let best = corners[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    const minDist = Math.min(
      c.x - r, // distance from left edge after badge centred
      c.y - r, // top
      annotation.imageWidth - c.x - r, // right
      annotation.imageHeight - c.y - r, // bottom
    );
    if (minDist > bestScore) {
      bestScore = minDist;
      best = c;
    }
  }
  return best.kind;
}

function badgeCenter(bbox: BboxLike, placement: Exclude<BadgePlacement, "auto">): Point {
  switch (placement) {
    case "topLeft":
      return { x: bbox.x, y: bbox.y };
    case "topRight":
      return { x: bbox.x + bbox.width, y: bbox.y };
    case "bottomLeft":
      return { x: bbox.x, y: bbox.y + bbox.height };
    case "bottomRight":
      return { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
  }
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
