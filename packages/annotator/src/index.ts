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
} from "./annotator.js";

// ─── Encode pipeline (since 0.3.0) ─────────────────────────────
//
// Standalone `encodeRgba()` for callers who already have RGBA
// bytes (e.g. from a Playwright screenshot + manual decode) and
// want the smart / saveSize / jpeg decision tree without going
// through `createAnnotator`. Use `annotator.toEncoded()` when
// you're rasterising an annotated SVG.

export { encodeRgba } from "./encode/encode.js";
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
export { isImagequantAvailable, isPhotoHeavy } from "./encode/quantize.js";

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
} from "./dsl/types.js";
