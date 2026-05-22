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
// ElementTree adapter — Phase 1b of
// `docs/plans/living-spec-authoring-roadmap.md`. Converts
// Playwright's `ariaSnapshot({ mode: "ai", boxes: true })` YAML into
// the canonical `ElementTree` model from
// `@ingcreators/annot-core/element-tree`. `attachAttributes` walks
// the resulting tree and fills per-node HTML attributes via
// `locator.evaluate`. Purely additive in 1b; existing `parseSnapshot`
// / `collectAttributesYaml` paths in `@ingcreators/annot-product-docs`
// stay untouched until Phase 1e wires this adapter into
// `productDocs.sync` and 1i removes the legacy helpers.
export {
  type AttachAttributesLocator,
  type AttachAttributesOptions,
  type AttachAttributesPage,
  attachAttributes,
  type PlaywrightYamlToElementTreeOptions,
  playwrightYamlToElementTree,
} from "./element-tree-adapter.js";
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
// Coordinate-rebase helpers — added in 0.4.0 alongside the
// `page.screenshot({ annot })` patch. Exported for callers that
// want to rebase annotations themselves without going through the
// patch (e.g. running rebases against an arbitrary clip for
// downstream tools). The patch invokes the same functions
// internally for `locator.screenshot()` and
// `page.screenshot({ clip })`.
export {
  type Clip,
  describeAnnotation,
  type RebaseResult,
  rebaseAnnotations,
} from "./rebase.js";
// `page.screenshot({ annot })` prototype patch + extension hooks.
// Added in 0.4.0 as Phase 1 of
// `docs/plans/playwright-screenshot-fixture-relayer.md`. Downstream
// packages register MDX / Figma / Sentry / … resolvers into
// `annotSourceResolvers`; annot-playwright stays MDX-unaware.
export {
  ANNOT_PATCHED,
  type AnnotScreenshotOptions,
  type AnnotSourceContext,
  type AnnotSourceContribution,
  type AnnotSourceResolver,
  annotSourceResolvers,
} from "./screenshot-hooks.js";
export { patchScreenshot } from "./screenshot-patch.js";
