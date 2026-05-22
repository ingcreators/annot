// Asserts the deprecated `@ingcreators/annot-product-docs-astro/playwright`
// subpath re-exports keep working with reference-equal identities to
// the new canonical homes. Phase 4 of
// `docs/plans/playwright-screenshot-fixture-relayer.md`.
//
// External callers gradually migrate from
// `@ingcreators/annot-product-docs-astro/playwright` to
// `@ingcreators/annot-product-docs` (with MDX) or
// `@ingcreators/annot-playwright` (without). Reference equality
// matters when callers identity-check `test` / `patchScreenshot`
// across the rename boundary (e.g. fixture-chain extension via
// `base.extend(...)`).

import * as canonicalPlaywright from "@ingcreators/annot-playwright";
import * as canonical from "@ingcreators/annot-product-docs";
import { describe, expect, it } from "vitest";

import * as deprecated from "./index.js";

describe("@ingcreators/annot-product-docs-astro/playwright (deprecated re-export)", () => {
  it("re-exports `test` from @ingcreators/annot-product-docs (same identity)", () => {
    expect(deprecated.test).toBe(canonical.test);
  });

  it("re-exports `expect` from @playwright/test (matches canonical surface)", () => {
    // annot-playwright re-exports the same `expect` so reference
    // equality against the canonical higher-level package suffices
    // for back-compat callers.
    expect(deprecated.expect).toBe(canonicalPlaywright.expect);
  });

  it("re-exports `patchScreenshot` from @ingcreators/annot-playwright (same identity)", () => {
    expect(deprecated.patchScreenshot).toBe(canonicalPlaywright.patchScreenshot);
  });

  it("re-exports `rebaseAnnotations` from @ingcreators/annot-playwright (same identity)", () => {
    expect(deprecated.rebaseAnnotations).toBe(canonicalPlaywright.rebaseAnnotations);
  });

  it("re-exports `describeAnnotation` from @ingcreators/annot-playwright (same identity)", () => {
    expect(deprecated.describeAnnotation).toBe(canonicalPlaywright.describeAnnotation);
  });
});
