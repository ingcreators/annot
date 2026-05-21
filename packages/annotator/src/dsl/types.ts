// Annotation DSL — agent / test-runtime friendly JSON shapes that
// describe an overlay without forcing the caller to assemble SVG
// strings.
//
// Lifted into `@ingcreators/annot-annotator` so both
// `@ingcreators/annot-playwright` (fixture-driven tests) and
// `@ingcreators/annot-mcp` (Model Context Protocol server) can
// share the same vocabulary. `bboxAnnotationsToSvg` (in the
// sibling `to-svg.ts`) converts a `BboxAnnotation[]` to a fragment
// the annotator's `toPng` / `toSvg` accept as `annotationsSvg`.
//
// **Locator-flavoured annotations** (`LocatorAnnotation`) live in
// `@ingcreators/annot-mcp` because their resolution requires a
// live browser `Page`. Playwright-test users already hold a `Page`
// and resolve locator → bbox via `await locator.boundingBox()`,
// so they pass the resulting bbox into a `BboxAnnotation` here.

/** Axis-aligned bounding box. Coordinates are page pixels. */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Point in page pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Semantic colour shorthand. Resolves to the Annot design system's
 * matching token (e.g. `intent: "error"` → `--annot-color-error`).
 * Explicit `stroke` / `color` / `fill` on an annotation override
 * the intent-derived defaults.
 */
export type Intent = "info" | "warning" | "error" | "success" | "neutral";

/** Style overrides shared across most annotation shapes. */
export interface AnnotationStyle {
  intent?: Intent;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  color?: string;
}

// ─── BboxAnnotation flavour ─────────────────────────────────────

export type BboxRectAnnotation = AnnotationStyle & {
  type: "rect";
  bbox: BBox;
};

export type BboxCircleAnnotation = AnnotationStyle & {
  type: "circle";
  center: Point;
  radius: number;
};

export type BboxArrowAnnotation = AnnotationStyle & {
  type: "arrow";
  from: Point;
  to: Point;
};

export type BboxTextAnnotation = AnnotationStyle & {
  type: "text";
  at: Point;
  content: string;
  fontSize?: number;
  anchor?: "start" | "middle" | "end";
};

export type BboxCalloutAnnotation = AnnotationStyle & {
  type: "callout";
  at: Point;
  targetBbox: BBox;
  content: string;
};

/**
 * Which corner of the target bbox the badge sits at. The badge
 * is centred on the corner — half inside the rect, half outside —
 * so the legend number remains readable against either light or
 * dark target content. `"auto"` (the default) picks the corner
 * that's furthest from the supplied image edge so the badge
 * never clips off the screenshot.
 */
export type BadgePlacement = "auto" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * Numbered legend badge — target rect outline plus a filled
 * intent-coloured circle at one corner with a bold white number
 * inside. The visual idiom for "this is item N in a step-by-step
 * legend over a screenshot."
 *
 * Differs from `callout` in two ways:
 * 1. No caption arrow — the badge sits ON the target, not next to it.
 * 2. The number renders inside a sized circle, not as bare `<text>`,
 *    so it stays readable when the screenshot is scaled down in
 *    docs / slides.
 *
 * When `imageWidth` / `imageHeight` are supplied alongside
 * `placement: "auto"`, the renderer picks the corner furthest
 * from the image edge so the badge never clips. Without those,
 * `"auto"` falls back to `"topRight"`.
 */
export type BboxNumberedBadgeAnnotation = AnnotationStyle & {
  type: "numberedBadge";
  bbox: BBox;
  number: number;
  /** Override the corner. Default `"auto"`. */
  placement?: BadgePlacement;
  /** Badge diameter in image pixels. Default `40`. */
  badgeSize?: number;
  /**
   * Image dimensions in page pixels — used by `placement: "auto"`
   * to pick the corner furthest from the image edge. When omitted,
   * `"auto"` resolves to `"topRight"`.
   */
  imageWidth?: number;
  imageHeight?: number;
};

export interface RawAnnotation {
  type: "raw";
  svgFragment: string;
}

export type BboxAnnotation =
  | BboxRectAnnotation
  | BboxCircleAnnotation
  | BboxArrowAnnotation
  | BboxTextAnnotation
  | BboxCalloutAnnotation
  | BboxNumberedBadgeAnnotation
  | RawAnnotation;

// ─── Redact regions ─────────────────────────────────────────────
//
// Same flavour split — the bbox region lives here; the locator
// variant lives in `@ingcreators/annot-mcp` where it can use the
// MCP server's `playwright-core` browser pool to resolve.

export type RedactStyle = "solid" | "mosaic" | "blur";

export interface BboxRedactRegion {
  bbox: BBox;
  style?: RedactStyle;
  /** CSS colour, applied only when `style` is `"solid"`. */
  color?: string;
}
