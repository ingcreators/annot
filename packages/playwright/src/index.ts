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

export { expect } from "@playwright/test";

export {
  annotateScreenshot,
  type PageLike,
  type PlaywrightAnnotator,
  test,
} from "./fixture.js";

export {
  type ArrowOptions,
  arrowBetween,
  type BoundingBox,
  type Point,
  type RectOptions,
  rectForBoundingBox,
  type TextOptions,
  textAt,
} from "./helpers.js";
