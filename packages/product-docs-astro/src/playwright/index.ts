// `@ingcreators/annot-product-docs-astro/playwright` — deprecated
// re-export.
//
// Phase 4 of `docs/plans/playwright-screenshot-fixture-relayer.md`
// completes the move started by Phases 1–3:
//
// - The generic `page.screenshot({ annot })` patch + hook
//   registry + coordinate-rebase helpers live in
//   `@ingcreators/annot-playwright`.
// - The MDX-aware resolver + the renamed `productDocs` fixture
//   live in `@ingcreators/annot-product-docs`.
//
// This subpath now re-exports those packages' surfaces so any
// caller still importing from
// `@ingcreators/annot-product-docs-astro/playwright` keeps
// compiling — but should migrate. Removal is scheduled for
// version 0.5.0 per the parent plan's OQ-2 decision (b).
//
// @deprecated since 0.3.0 — see the JSDoc on each re-export
// below for the right replacement import.

/**
 * @deprecated Import `AnnotScreenshotOptions` from
 * `@ingcreators/annot-playwright` — that package owns the
 * canonical interface; `@ingcreators/annot-product-docs` augments
 * it with `mdx`. Re-exporting here is back-compat only and will
 * be removed in `@ingcreators/annot-product-docs-astro@0.5.0`.
 */
/**
 * @deprecated Import the rebase helpers (`Clip`, `RebaseResult`,
 * `describeAnnotation`, `rebaseAnnotations`) from
 * `@ingcreators/annot-playwright`. Re-exporting here is
 * back-compat only and will be removed in
 * `@ingcreators/annot-product-docs-astro@0.5.0`.
 */
export type { AnnotScreenshotOptions, Clip, RebaseResult } from "@ingcreators/annot-playwright";
/**
 * @deprecated Import `patchScreenshot` from
 * `@ingcreators/annot-playwright`. Re-exporting here is
 * back-compat only and will be removed in
 * `@ingcreators/annot-product-docs-astro@0.5.0`.
 */
export {
  describeAnnotation,
  patchScreenshot,
  rebaseAnnotations,
} from "@ingcreators/annot-playwright";
/**
 * @deprecated Import `test` from `@ingcreators/annot-product-docs`
 * (with MDX support) or `@ingcreators/annot-playwright` (without).
 * Re-exporting here is back-compat only and will be removed in
 * `@ingcreators/annot-product-docs-astro@0.5.0`.
 */
export { test } from "@ingcreators/annot-product-docs";
/**
 * @deprecated Import `expect` from `@ingcreators/annot-playwright`
 * or `@playwright/test` directly. Re-exporting here is back-compat
 * only and will be removed in
 * `@ingcreators/annot-product-docs-astro@0.5.0`.
 */
export { expect } from "@playwright/test";

// One-time runtime deprecation breadcrumb. Loaded at import time
// so downstream callers see the warning in their CI logs once
// per worker process. The check on `process.emitWarning` is a
// defensive guard for non-Node runtimes (e.g. browsers loading
// this subpath via bundlers); in pure Node the conditional is
// always true.
if (
  typeof process !== "undefined" &&
  typeof process.emitWarning === "function" &&
  !(globalThis as { __annotProductDocsAstroPlaywrightWarned?: true })
    .__annotProductDocsAstroPlaywrightWarned
) {
  (
    globalThis as { __annotProductDocsAstroPlaywrightWarned?: true }
  ).__annotProductDocsAstroPlaywrightWarned = true;
  process.emitWarning(
    "@ingcreators/annot-product-docs-astro/playwright is deprecated. " +
      "Import from @ingcreators/annot-product-docs (with MDX support) or " +
      "@ingcreators/annot-playwright (without). This subpath will be " +
      "removed in @ingcreators/annot-product-docs-astro@0.5.0.",
    "DeprecationWarning",
  );
}
