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
