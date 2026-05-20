// LocatorAnnotation flavour DSL — agent-facing JSON shape that lets
// annotation positions be expressed as Playwright locator strings.
//
// The bbox-flavour types (`BBox`, `Point`, `Intent`,
// `AnnotationStyle`, `BboxAnnotation`, `RawAnnotation`,
// `RedactStyle`, `BboxRedactRegion`) live in
// `@ingcreators/annot-annotator` since v0.2.0 — they're useful in
// any context (Playwright fixture, agent, plugin) that has a bbox
// already. We re-export them so callers who only depend on
// `@ingcreators/annot-mcp` still see the full DSL via one import.
//
// The **Locator-flavoured** annotations + redact regions stay
// here because resolving a Playwright locator string to a bbox
// requires a live browser `Page`, which only the MCP server
// provides (via its `playwright-core` browser pool).

import type { AnnotationStyle, BBox, Point } from "@ingcreators/annot-annotator";

// Re-export the shared bbox-flavour types so MCP consumers can
// keep `import { BboxAnnotation } from "@ingcreators/annot-mcp"`
// working unchanged.
export type {
  AnnotationStyle,
  BBox,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxRectAnnotation,
  BboxRedactRegion,
  BboxTextAnnotation,
  Intent,
  Point,
  RawAnnotation,
  RedactStyle,
} from "@ingcreators/annot-annotator";

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
  | { type: "raw"; svgFragment: string };

// ─── Locator redact region ──────────────────────────────────────

export type LocatorRedactRegion = {
  bbox?: BBox;
  locator?: Locator;
  style?: import("@ingcreators/annot-annotator").RedactStyle;
  color?: string;
};
