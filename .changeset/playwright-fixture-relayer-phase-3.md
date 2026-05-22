---
"@ingcreators/annot-product-docs": patch
---

**`screen` fixture → `productDocs`, `capture` method → `sync`** —
Phase 3 of `docs/plans/playwright-screenshot-fixture-relayer.md`.
The fixture's old name reads like a Playwright built-in and
collides with `@testing-library/react`'s `screen`; `capture`
implies a screenshot but the method actually synchronizes MDX
comment blocks. The rename aligns with the established
`annotator` convention from `@ingcreators/annot-annotator`.

```ts
// Was:
test("login", async ({ page, screen }) => {
  await screen.capture({ id: "login", mdxPath: "..." });
});

// Now:
test("login", async ({ page, productDocs }) => {
  await productDocs.sync({ id: "login", mdxPath: "..." });
});
```

**Back-compat — old names keep working**:

- Fixture: `test.extend({ screen })` is preserved alongside
  `productDocs`. Both expose the same `.sync()` method (the
  deprecated `.capture()` method on `screen` aliases `.sync()`).
- Standalone helper: `captureScreen` re-exports the new
  `syncProductDocs` implementation. `captureScreen ===
  syncProductDocs` is true — reference-equal so callers that
  identity-check the function across the rename boundary keep
  working.
- Types: `Screen` aliases `ProductDocs`, `ScreenCaptureOptions`
  aliases `ProductDocsSyncOptions`. Both flagged
  `@deprecated` in JSDoc; deletion is scheduled for the
  deprecation window noted in
  `living-spec-authoring-roadmap.md` OQ-08.

**In-tree consumers migrated**:

- `packages/product-docs/src/cli.ts` — `annot docs sync` /
  `annot docs lint --fix` call `syncProductDocs` directly. The
  `init` scaffold's sample tour uses `productDocs.sync(...)`.
- `packages/product-docs-astro/src/playwright/fixture.ts` —
  imports `syncProductDocs` (was `captureScreen`).
- `packages/docs-site/src/content/docs/product-docs/playwright-tour.mdx`
  + `getting-started/product-docs.mdx` +
  `api/product-docs.mdx` + `concepts.mdx` +
  `recipes/living-product-docs.mdx` — all example snippets
  updated to the new names.
- `packages/product-docs/README.md` — quickstart updated.

**Test of the back-compat surface** — a new
`fixture.test.ts` case asserts `captureScreen === syncProductDocs`
so the alias contract is enforced by CI; any future refactor
that breaks the reference equality fails the build.
