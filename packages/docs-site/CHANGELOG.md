# @ingcreators/annot-docs-site

## 0.0.7

### Patch Changes

- @ingcreators/annot-product-docs@0.5.1
- @ingcreators/annot-product-docs-astro@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [0179c4c]
  - @ingcreators/annot-product-docs-astro@0.4.0
  - @ingcreators/annot-product-docs@0.4.1

## 0.0.5

### Patch Changes

- Updated dependencies [b5d52f6]
- Updated dependencies [fa712fd]
- Updated dependencies [f09a6b1]
- Updated dependencies [0d19345]
  - @ingcreators/annot-product-docs@0.4.0
  - @ingcreators/annot-product-docs-astro@0.3.1

## 0.0.4

### Patch Changes

- 85d40e6: **Docs + CLAUDE.md + plan archive** — Phase 5 (final) of
  `docs/plans/_done/playwright-screenshot-fixture-relayer.md`.
  Refreshes the doc surfaces, the operational CLAUDE.md notes,
  and archives the relayer plan into `_done/`.

  ## Doc surface updates
  - `packages/docs-site/src/content/docs/product-docs/playwright-fixture.mdx`
    — recommended import paths updated; new "Choosing your import"
    section covers the `@ingcreators/annot-product-docs` (MDX)
    vs. `@ingcreators/annot-playwright` (no MDX) split; companion
    helpers section now imports from the canonical homes; codegen
    workflow example swapped to `@ingcreators/annot-product-docs`.
  - `packages/docs-site/src/content/docs/api/create-annotator.mdx`
    — "From a Playwright test" example imports from the canonical
    home; mentions the no-MDX alternative.
  - `packages/playwright/README.md` — adds the
    `page.screenshot({ annot: { … } })` (recommended) section
    above the existing `annotator.annotateScreenshot(...)` flow;
    documents the `annotSourceResolvers` extension hook + the
    coordinate-rebase helpers.
  - `packages/product-docs/README.md` — adds a `page.screenshot({
annot })` Playwright fixture section explaining the
    productDocs.sync + MDX-resolver bundle.
  - `packages/product-docs-astro/README.md` — replaces the
    Playwright fixture section with a Migration note pointing at
    the canonical homes; documents the `0.5.0` removal target.

  ## CLAUDE.md monorepo layout
  - `playwright/` entry now describes the canonical
    `page.screenshot({ annot })` patch + `annotSourceResolvers`
    extension hook. Version bumped to 0.4.0.
  - `product-docs/` entry mentions the `productDocs` fixture
    rename + the MDX-aware resolver registration via the hook
    registry. Version bumped to 0.3.0.
  - `product-docs-astro/` entry calls out the deprecated
    `/playwright` re-export shim + 0.5.0 removal target.
    `@playwright/test` no longer a peer dep. Version bumped to
    0.3.0.

  ## Plan archive
  - `docs/plans/playwright-screenshot-fixture-relayer.md` →
    `docs/plans/_done/playwright-screenshot-fixture-relayer.md`.
    Status header switched to `Done` with the four landing PRs
    enumerated. Internal `./_done/...` link paths updated to
    `./...` (the plan is itself inside `_done/` now).
  - `docs/plans/README.md` — removed the active entry, added a
    "Recently landed plans" row pointing at the archived plan
    with a multi-phase summary covering all four landing PRs.
  - `docs/plans/living-spec-authoring-roadmap.md` — three link
    references updated to point at the archived path; the "How
    this relates" line switched from "Already Draft" to "Landed
    2026-05-22 (PRs #962 / #963 / #964 / #966)".

  No source code changes; verified via `pnpm -r typecheck`,
  `pnpm test`, `pnpm lint` regardless to confirm the doc/comment
  edits parse cleanly.

- Updated dependencies [5778902]
- Updated dependencies [96e7625]
- Updated dependencies [f5dc7cb]
- Updated dependencies [85d40e6]
  - @ingcreators/annot-product-docs@0.3.0
  - @ingcreators/annot-product-docs-astro@0.3.0

## 0.0.3

### Patch Changes

- @ingcreators/annot-product-docs-astro@0.2.2

## 0.0.2

### Patch Changes

- Updated dependencies [87a8bad]
  - @ingcreators/annot-product-docs-astro@0.2.1

## 0.0.1

### Patch Changes

- Updated dependencies [2e92c97]
- Updated dependencies [4768855]
- Updated dependencies [49b5585]
- Updated dependencies [730fab7]
- Updated dependencies [657a685]
  - @ingcreators/annot-product-docs@0.2.0
  - @ingcreators/annot-product-docs-astro@0.2.0
