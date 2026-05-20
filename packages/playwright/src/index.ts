// `@ingcreators/annot-playwright` — Playwright fixture for the
// headless annotator.
//
// Drop-in replacement for `@playwright/test`'s `test` import:
//
//     import { test, expect } from "@ingcreators/annot-playwright";
//
// Every test gets an `annotator` fixture for annotated-screenshot
// helpers; everything else (the `expect`, the `test.describe`,
// the `test.beforeEach`, etc.) passes straight through.
//
// See `docs/plans/annot-playwright-fixture.md` for the design.

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
// Annotation DSL — added in 0.2.0. Re-exported here so callers
// who only depend on `@ingcreators/annot-playwright` still see
// the full surface.
export { bboxAnnotationsToSvg } from "@ingcreators/annot-annotator";
export { expect } from "@playwright/test";
export {
  type AnnotateScreenshotOptions,
  annotateScreenshot,
  type PageLike,
  type PlaywrightAnnotator,
  test,
} from "./fixture.js";
// SVG primitives — back-compat re-exports from
// `@ingcreators/annot-annotator` (where they live since 0.2.0).
// Prefer the DSL path (`{ type: "rect", bbox, intent: "error" }`)
// for new code.
export {
  type ArrowOptions,
  arrowBetween,
  type BoundingBox,
  type RectOptions,
  rectForBoundingBox,
  type TextOptions,
  textAt,
} from "./helpers.js";
