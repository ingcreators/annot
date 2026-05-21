// `@ingcreators/annot-product-docs-astro/playwright` — extended
// Playwright `test` fixture with `page.screenshot({ annot: { … } })`
// interception. See `docs/plans/_done/playwright-screenshot-annot-fixture.md`.

// Re-export Playwright's `expect` so callers can use one import
// for the whole spec-writing surface.
export { expect } from "@playwright/test";
export type { AnnotScreenshotOptions } from "./fixture.js";
export { patchScreenshot, test } from "./fixture.js";
