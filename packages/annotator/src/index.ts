// `@ingcreators/annot-annotator` — headless annotator API.
//
// Two public surfaces:
//
//   1. `createAnnotator(options) → { toPng, toSvg }` — rasterise
//      an SVG annotation overlay onto a base image bitmap. The
//      core API since v0.1.0.
//
//   2. Annotation DSL (since v0.2.0) — a JSON-shaped vocabulary
//      that describes overlays without forcing callers to
//      assemble SVG strings by hand. `bboxAnnotationsToSvg()`
//      converts a `BboxAnnotation[]` to the fragment string
//      `toPng` / `toSvg` accept as `annotationsSvg`. Shared by
//      `@ingcreators/annot-playwright` (test runtime) and
//      `@ingcreators/annot-mcp` (MCP server) — locator-flavour
//      extensions live in `@ingcreators/annot-mcp` since they
//      need a live browser `Page`.

export {
  type Annotator,
  type AnnotatorInput,
  type AnnotatorOptions,
  createAnnotator,
  type EditableInput,
} from "./annotator.js";

// ─── Encode pipeline (since 0.3.0) ─────────────────────────────
//
// Standalone `encodeRgba()` for callers who already have RGBA
// bytes (e.g. from a Playwright screenshot + manual decode) and
// want the smart / saveSize / jpeg decision tree without going
// through `createAnnotator`. Use `annotator.toEncoded()` when
// you're rasterising an annotated SVG.

export { decodeAndEncodeImage, encodeRgba } from "./encode/encode.js";
export {
  type BrowserEncodeResult,
  computeResizeTarget,
  DEFAULT_ENCODE_OPTIONS,
  type EncodeFormat,
  type EncodeOptions,
  type EncodeResult,
  SAVE_SIZE_LABEL,
  SAVE_SIZE_MAX_WIDTH,
  type SaveSizePreset,
} from "./encode/options.js";
export { isPhotoHeavy } from "./encode/quantize.js";

// ─── Redact burn (since 0.6.0 — relocated from @ingcreators/annot-mcp) ───
//
// Tier A Node-side raster utility — destructively paint solid /
// mosaic / blur over PNG regions. The function is pure
// (`pngBytes + regions → pngBytes`) and ships here so non-MCP
// callers (`@ingcreators/annot-product-docs-astro`'s Phase 3
// follow-up Image Service, Playwright fixtures, custom test
// reporters, …) can consume it without dragging the MCP server's
// dep footprint. MCP keeps its existing public API via a
// re-export from this entry point.

export { burnRedactions, type RedactRegion } from "./redact-burn.js";

// ─── Pixel diff (Phase 3i — relocated from @ingcreators/annot-mcp) ───
//
// Tier A Node-side raster utility — pixelmatch-driven PNG
// comparison with contiguous-region bbox aggregation. Same
// rationale as the redact burn: pure `pngBytes + pngBytes →
// DiffResult`, no MCP-specific surface. Ships here so non-MCP
// callers (Playwright visual regression fixtures, Astro pixel
// drift CI, custom test reporters, editor before/after preview)
// can consume it without the MCP server's dep footprint.

export {
  type DiffOptions,
  type DiffResult,
  DimensionMismatchError,
  diffScreenshots,
} from "./diff.js";
export { aggregateDiffRegions } from "./diff-aggregate.js";

// ─── DSL (since 0.2.0) ──────────────────────────────────────────

export {
  BBOX_ANNOTATION_SCHEMA,
  BBOX_REDACT_REGION_SCHEMA,
  SHARED_DEFS,
} from "./dsl/schema.js";
export {
  type ArrowOptions,
  arrowBetween,
  type BoundingBox,
  type RectOptions,
  rectForBoundingBox,
  type TextOptions,
  textAt,
} from "./dsl/svg-primitives.js";
export { bboxAnnotationsToSvg } from "./dsl/to-svg.js";
export type {
  AnnotationStyle,
  BadgePlacement,
  BBox,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxFocusMaskAnnotation,
  BboxFreehandAnnotation,
  BboxNumberedBadgeAnnotation,
  BboxRectAnnotation,
  BboxRedactRegion,
  BboxTextAnnotation,
  Intent,
  Point,
  RawAnnotation,
  RedactStyle,
} from "./dsl/types.js";
