---
"@ingcreators/annot-docs-site": patch
"@ingcreators/annot-product-docs": patch
"@ingcreators/annot-product-docs-astro": patch
"@ingcreators/annot-playwright": patch
---

**Docs + CLAUDE.md + plan archive** — Phase 5 (final) of
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
