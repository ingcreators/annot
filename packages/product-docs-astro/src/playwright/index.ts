// `@ingcreators/annot-product-docs-astro/playwright` — extended
// Playwright `test` fixture with `page.screenshot({ annot: { … } })`
// interception. See `docs/plans/_done/playwright-screenshot-annot-fixture.md`.

// Re-export Playwright's `expect` so callers can use one import
// for the whole spec-writing surface.
export { expect } from "@playwright/test";
export type { AnnotScreenshotOptions } from "./fixture.js";
export { patchScreenshot, test } from "./fixture.js";
// Coordinate-rebase helpers exported for callers that want to
// compose annotations themselves without going through the
// fixture's `annot` option (e.g. running rebases against an
// arbitrary `clip` for downstream tools). The fixture invokes the
// same functions internally for `locator.screenshot()` and
// `page.screenshot({ clip })`.
export type { Clip, RebaseResult } from "./rebase.js";
export { describeAnnotation, rebaseAnnotations } from "./rebase.js";
