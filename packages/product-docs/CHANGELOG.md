# @ingcreators/annot-product-docs

## 0.3.0

### Minor Changes

- 5778902: **MDX resolver moves home + auto-registers into the screenshot
  patch** — Phase 2 of
  `docs/plans/playwright-screenshot-fixture-relayer.md`. The
  MDX-aware annotation pipeline that powers
  `page.screenshot({ annot: { mdx: { id, path } } })` now lives in
  `@ingcreators/annot-product-docs` (the package that already owns
  MDX parsing + the `screen.capture()` fixture). Calls go through
  annot-playwright's generic patch + the new
  `annotSourceResolvers` hook registry, so consumers no longer
  need an Astro peer dep for the dogfood tour pattern:

  ```ts
  // Was: @ingcreators/annot-product-docs-astro/playwright
  import { test } from "@ingcreators/annot-product-docs";

  test("docs tour", async ({ page }) => {
    await page.goto(APP_URL);
    await page.screenshot({
      path: "shots/app-overview.png",
      annot: {
        mdx: { id: "app-overview", path: "src/content/docs/app/index.mdx" },
        tags: { source: "docs-tour", screen: "app-overview" },
      },
    });
  });
  ```

  The `annot: { mdx }` resolver fires in two stages:
  1. `prepare()` — calls `captureScreen(page, { id, mdxPath })`
     internally, refreshing the MDX's `annot:snapshot` +
     `annot:attributes` blocks against the live page BEFORE the
     raw screenshot is taken.
  2. `resolveAnnotations(dims)` — reads the freshly-written
     `annot:snapshot` block + `<Overlay match>` entries and
     returns page-space `BboxNumberedBadgeAnnotation[]` which
     annot-playwright merges with any caller-supplied
     `annot.overlays` before rebasing onto the clipped image.

  **New public surface**
  - `resolveMdxAnnotations({ mdxPath, screenId, dims, cwd? })` —
    pure-data resolver used by both the Playwright hook and the
    Astro Image Service (Phase 4 of the relayer plan switches
    product-docs-astro's `renderAnnotatedScreen` to consume it).
  - `parseSnapshotBoxes(yaml)` / `buildBadgeAnnotations(overlays,
boxed, dims)` — exposed for callers that want to drive
    annotation production from custom snapshot pipelines.
  - `svgFromBboxAnnotations(annotations)` /
    `svgFromBadges(badges)` / `emptyAnnotationsSvg()` — single-root
    `<svg>` wrappers that the headless annotator's `annotationsSvg`
    input expects.
  - `BoxedEntry` type — parsed aria-snapshot YAML entry with
    `[ref=…]` + `[box=…]` markers.

  **Compatibility**
  - Module augmentation extends annot-playwright's
    `AnnotScreenshotOptions` with the `mdx?: { id, path }` field
    via `declare module "@ingcreators/annot-playwright"`. Imports
    from `@ingcreators/annot-product-docs/fixture` or the package
    root register the resolver via side-effect.
  - The existing
    `@ingcreators/annot-product-docs-astro/playwright` subpath
    continues to work unchanged (it ships its own duplicate
    augmentation + patch — Phase 4 of the plan converts that subpath
    into a deprecated re-export pointing here).
  - `packages/docs-site/tests/docs/annot-app.spec.ts` — the
    dogfood tour spec swaps `import { test } from
"@ingcreators/annot-product-docs-astro/playwright"` to
    `"@ingcreators/annot-product-docs"`. PNG output stays
    byte-identical (same patch → same composer → same encoder).

### Patch Changes

- 96e7625: **`screen` fixture → `productDocs`, `capture` method → `sync`** —
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
    - `getting-started/product-docs.mdx` +
      `api/product-docs.mdx` + `concepts.mdx` +
      `recipes/living-product-docs.mdx` — all example snippets
      updated to the new names.
  - `packages/product-docs/README.md` — quickstart updated.

  **Test of the back-compat surface** — a new
  `fixture.test.ts` case asserts `captureScreen === syncProductDocs`
  so the alias contract is enforced by CI; any future refactor
  that breaks the reference equality fails the build.

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

- Updated dependencies [f979374]
- Updated dependencies [85d40e6]
  - @ingcreators/annot-playwright@0.4.0

## 0.2.0

### Minor Changes

- 2e92c97: First publish of the living-product-docs package family. Phases
  1-5 + 7 of `docs/plans/living-product-docs.md` landed across
  PRs 876-899; this entry flips the three packages from
  `private: true` to publishable and stamps `0.1.0`.

  ### `@ingcreators/annot-product-docs`
  - MDX parser (`parseMdx` / `parseMdxFile`) — Remark / unified
    pipeline that walks `.mdx` files with `annot:` frontmatter
    and extracts `<Screen>` / `<Overlay>` / `<Transition>` /
    `<HistoryEntry>` / `<ScreenList>` JSX components.
  - Match resolver (`parseSnapshot` / `resolveMatch` /
    `resolveOverlays`) for the Playwright `aria-snapshot`
    YAML, honouring `match.under` disambiguation and emitting
    `not-found` / `ambiguous` / `renamed` / `role-changed` /
    `live-mismatch` diagnostics.
  - `screen` fixture extending `@ingcreators/annot-playwright`
    with `screen.capture({ id, mdxPath })` that re-syncs
    `annot:snapshot` + `annot:attributes` MDX comment blocks
    in place.
  - Drift detector (`detectDrift` / `detectDriftFromYaml`) — six
    finding kinds (added / removed / renamed / role-changed /
    duplicated / attribute-drift) with severity buckets.
  - `annot-docs` CLI (`init` / `sync` / `lint`) with `--json`
    / `--ci` / `--fix` flags + a sample GitHub Actions workflow
    emitting GitHub annotations on PR diff views.

  ### `@ingcreators/annot-product-docs-astro`
  - `productDocsIntegration()` Astro 5.x integration factory.
  - 7 docs components: `<Screen>`, `<Overlay>`, `<Transition>`,
    `<TransitionTable>`, `<HistoryEntry>`, `<ScreenList>`,
    `<TransitionGraph>`. Shipped as `.astro` source under
    `./components/*.astro` exports.
  - Image Service (`renderAnnotatedScreen` + SHA-keyed
    `createFileCache` / `createMemoryCache`) that composes the
    base screenshot with overlay callouts at build time.

  ### `@ingcreators/annot-product-docs-xlsx`
  - MDX → normalised bundle extractor; per-role default layout
    (cover / history / list / screen / reference); customer-
    template support with `{var}` placeholder substitution
    (including `{annot:date}` special vars + `{name:format}`
    date formatting); Excel Named Range writers
    (`annotImage` / `annotItemTable` / `annotHistory` /
    `annotList` / `annotSnapshot` / `annotAttributes`).
  - `annot-docs-xlsx render` CLI with multi-book emit + per-book
    template config.

### Patch Changes

- 657a685: **Republish with `dist/` included.** The `0.1.0` tarballs of all
  three packages shipped to npm without their `dist/` directory —
  the `publish.yml` workflow's pre-pack `pnpm build` step had only
  filtered four other packages, so `pnpm pack` packed the three
  `product-docs*` packages against empty `dist/`s. The
  `publishConfig.main` (`./dist/index.js`) consequently pointed at
  a missing file, breaking `npm install` for every consumer.

  The source fix landed in
  [#947](https://github.com/ingcreators/annot/pull/947) with two
  defences:
  1. Three new `--filter` lines in the workflow's build step so
     all seven publishable packages get built before pack.
  2. A per-package `prepack` script (`pnpm run build`) so even a
     misconfigured workflow (or a manual `pnpm pack` / `pnpm
publish`) refreshes `dist/` before packing.

  No source-code changes in any of the three packages — only the
  packaging is fixed. This patch publish exists solely to deliver
  working tarballs to the registry; the public API surface is
  byte-identical to `0.1.0`.

  Verified locally:

  ```
  $ pnpm --filter @ingcreators/annot-product-docs pack --dry-run
  Tarball Contents
    bin/annot-docs.mjs
    dist/cli.d.ts
    dist/config.d.ts
    dist/drift.d.ts
    dist/fixture.d.ts
    dist/index.d.ts
    dist/index.js
    dist/mdx.d.ts
    dist/resolver.d.ts
    dist/types-config.d.ts
    dist/types.d.ts
    LICENSE
    package.json
    README.md
  ```

  Before the fix the same command produced 4 files (LICENSE +
  README + package.json + bin/annot-docs.mjs), no compiled code.

- Updated dependencies [806badc]
- Updated dependencies [df1a429]
  - @ingcreators/annot-annotator@0.5.0
  - @ingcreators/annot-playwright@0.3.1
