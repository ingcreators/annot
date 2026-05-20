// Annotation DSL types — the agent-facing shape that flows through
// `annot_annotate_*` and `annot_redact_*` MCP tool calls.
//
// Two flavours:
//
//   - `BboxAnnotation` is consumed by `_screenshot` tools. Each
//     annotation carries an explicit bounding box (or point /
//     line endpoints). The agent has already resolved positions
//     before the call.
//
//   - `LocatorAnnotation` is consumed by `_url` tools. Positions
//     can be expressed as Playwright locator strings
//     (`button:has-text("Submit")`, `[data-testid="email"]`,
//     `role=button[name="Sign in"]`) AND/OR explicit coordinates;
//     the `_url` tool resolves locators to bboxes via
//     `page.locator(s).boundingBox()` before delegating to the
//     bbox-flavour SVG conversion path.
//
// Phase 1 of `docs/plans/agent-mcp-integration.md`. The
// LocatorAnnotation union is authored upfront so the JSON Schema
// is complete from day 1, but the resolution path lands in
// Phase 3a.

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

// ─── BboxAnnotation flavour (used by `_screenshot` tools) ────────

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

// ─── LocatorAnnotation flavour (used by `_url` tools) ────────────

/**
 * Playwright locator string. Follows the standard locator grammar:
 * CSS selectors (`button.primary`), text engines (`text=Submit`,
 * `button:has-text("Submit")`), ARIA roles (`role=button[name="Sign in"]`),
 * test ids (`[data-testid="email"]`), and chained `>>` operators.
 */
export type Locator = string;

export type LocatorRectAnnotation = AnnotationStyle & {
  type: "rect";
  /** Exactly one of `bbox` / `locator` is required. */
  bbox?: BBox;
  locator?: Locator;
};

export type LocatorCircleAnnotation = AnnotationStyle & {
  type: "circle";
  /** Coordinate path. */
  center?: Point;
  radius?: number;
  /** Locator path. Radius derives from `min(width, height) / 2`. */
  locator?: Locator;
};

export type LocatorArrowAnnotation = AnnotationStyle & {
  type: "arrow";
  /** Exactly one of `from` / `fromLocator` is required. */
  from?: Point;
  fromLocator?: Locator;
  /** Exactly one of `to` / `toLocator` is required. */
  to?: Point;
  toLocator?: Locator;
};

export type LocatorTextAnnotation = AnnotationStyle & {
  type: "text";
  /** Coordinate path. */
  at?: Point;
  /**
   * Locator path. `at` becomes the bbox top-left, with the text
   * placed directly above the bbox.
   */
  locator?: Locator;
  content: string;
  fontSize?: number;
  anchor?: "start" | "middle" | "end";
};

export type LocatorCalloutAnnotation = AnnotationStyle & {
  type: "callout";
  /** Coordinate path for the caption anchor. */
  at?: Point;
  atLocator?: Locator;
  /** Coordinate path for the targeted region. */
  targetBbox?: BBox;
  targetLocator?: Locator;
  content: string;
};

export type LocatorAnnotation =
  | LocatorRectAnnotation
  | LocatorCircleAnnotation
  | LocatorArrowAnnotation
  | LocatorTextAnnotation
  | LocatorCalloutAnnotation
  | RawAnnotation;

// ─── Redact regions (for `annot_redact_*` tools) ─────────────────

export type RedactStyle = "solid" | "mosaic" | "blur";

export interface BboxRedactRegion {
  bbox: BBox;
  style?: RedactStyle;
  /** CSS colour, applied only when `style` is `"solid"`. */
  color?: string;
}

export type LocatorRedactRegion = {
  bbox?: BBox;
  locator?: Locator;
  style?: RedactStyle;
  color?: string;
};
