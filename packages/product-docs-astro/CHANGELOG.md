# @ingcreators/annot-product-docs-astro

## 0.5.0

### Minor Changes

- **Breaking:** removed the deprecated `./playwright` re-export
  subpath (announced via the import-time `DeprecationWarning`
  shipped since 0.4.0). Import `test` / `expect` /
  `patchScreenshot` from `@ingcreators/annot-product-docs` (MDX
  support) or `@ingcreators/annot-playwright` (without) instead.

## 0.4.0

### Minor Changes

- 0179c4c: **Astro 7 support** — the `astro` peer range widens from
  `^5.0.0 || ^6.0.0` to `^5.0.0 || ^6.0.0 || ^7.0.0`.

  No code changes were required: the integration only uses the
  stable `astro:config:setup` hook + `updateConfig({ vite })`,
  and the Image Service (`renderAnnotatedScreen`) is a plain
  build-time renderer with no `astro:assets` dependency, so the
  Astro 7 breaking changes (Vite 8, Rust compiler, Sätteri
  Markdown pipeline) don't touch this package's surface.

  Astro 5 and 6 consumers are unaffected — the range is purely
  additive. Verified against `astro@7.0.6` +
  `@astrojs/starlight@0.41.2` via the dogfooded
  `@ingcreators/annot-docs-site` build.

### Patch Changes

- Updated dependencies [b47d896]
  - @ingcreators/annot-core@0.3.1
  - @ingcreators/annot-annotator@0.6.0
  - @ingcreators/annot-playwright@0.4.2
  - @ingcreators/annot-product-docs@0.4.1

## 0.3.1

### Patch Changes

- Updated dependencies [6124d59]
- Updated dependencies [b5d52f6]
- Updated dependencies [fa712fd]
- Updated dependencies [0c7ac26]
- Updated dependencies [f09a6b1]
- Updated dependencies [0d19345]
- Updated dependencies [64dc6e8]
- Updated dependencies [691bec5]
- Updated dependencies [9697f27]
- Updated dependencies [266b05a]
  - @ingcreators/annot-annotator@0.6.0
  - @ingcreators/annot-product-docs@0.4.0
  - @ingcreators/annot-core@0.3.0
  - @ingcreators/annot-playwright@0.4.1

## 0.3.0

### Minor Changes

- f5dc7cb: **`@ingcreators/annot-product-docs-astro/playwright` becomes a
  deprecated re-export** — Phase 4 of
  `docs/plans/playwright-screenshot-fixture-relayer.md`. The fixture
  that originally lived here moved to `@ingcreators/annot-playwright`
  (generic patch) + `@ingcreators/annot-product-docs` (MDX resolver)
  in Phases 1–3 of the plan. Phase 4 deletes the duplicate code
  from this package and converts the `/playwright` subpath into a
  shim that re-exports the canonical surface so existing callers
  keep compiling.

  ```ts
  // Was:
  import { test } from "@ingcreators/annot-product-docs-astro/playwright";

  // Now (recommended):
  import { test } from "@ingcreators/annot-product-docs"; // with MDX
  // or
  import { test } from "@ingcreators/annot-playwright"; // without MDX
  ```

  The deprecated subpath emits a one-time
  `process.emitWarning("DeprecationWarning", …)` at import time so
  the migration prompt shows up in CI logs. **Reference equality
  preserved** — `test`, `expect`, `patchScreenshot`,
  `rebaseAnnotations`, `describeAnnotation` are reference-equal to
  their canonical homes; a new
  `packages/product-docs-astro/src/playwright/index.test.ts`
  asserts this.

  **Removal target**: `@ingcreators/annot-product-docs-astro@0.5.0`,
  matching the OQ-2 decision (b) in the parent plan — visible
  deprecation, known sunset.

  ## render.ts switches to the canonical helpers

  `renderAnnotatedScreen()` previously carried its own copies of
  `resolveMdxAnnotations` / `parseSnapshotBoxes` /
  `buildBadgeAnnotations` / `svgFromBadges` / `svgFromBboxAnnotations`
  / `emptyAnnotationsSvg`. Phase 2 of the plan moved the canonical
  home into `@ingcreators/annot-product-docs`; this PR deletes the
  duplicates from `product-docs-astro/render.ts` and consumes the
  ones in product-docs going forward.

  `resolveMdxAnnotations` + `svgFromBboxAnnotations` are re-exported
  from `render.ts` for one deprecation cycle so existing callers
  that imported them from `@ingcreators/annot-product-docs-astro`
  keep compiling. `parseSnapshotBoxes` is dropped from the public
  surface — new code should import it from
  `@ingcreators/annot-product-docs` directly.

  ## peerDependencies cleanup

  `@playwright/test` is removed from `peerDependencies` (and from
  `peerDependenciesMeta`). The package no longer has a Playwright
  relationship to advertise — the `/playwright` subpath is purely
  a re-export shim, and its types flow through the
  `@ingcreators/annot-product-docs` workspace dep transitively.
  This matches the OQ-3 decision (b) in the parent plan.

  ## Verified
  - `pnpm -r typecheck` — 20 packages, all pass.
  - `pnpm test` — 252 files, 3641 tests, 0 failures. New
    `playwright/index.test.ts` (5 reference-equality assertions)
    passes; the deprecation `process.emitWarning` fires on
    import (visible in vitest output) but does not break anything.
  - `pnpm lint` — exit 0; 29 pre-existing warnings unchanged.
  - `pnpm --filter @ingcreators/annot-product-docs-astro build` —
    emits `dist/index.js` (3.96 kB / 1.71 kB gzip) +
    `dist/playwright/index.js` (0.85 kB / 0.39 kB gzip) — the
    shrunken subpath bundle reflects the re-export-only shape.

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

- Updated dependencies [f979374]
- Updated dependencies [5778902]
- Updated dependencies [96e7625]
- Updated dependencies [85d40e6]
  - @ingcreators/annot-playwright@0.4.0
  - @ingcreators/annot-product-docs@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [f485646]
  - @ingcreators/annot-core@0.2.1
  - @ingcreators/annot-annotator@0.5.0

## 0.2.1

### Patch Changes

- 87a8bad: **Fix `./playwright` subpath build.** The published `0.1.0`
  and `0.2.0` tarballs shipped `dist/playwright/*.d.ts` (type
  declarations) but NOT the runtime `dist/playwright/index.js`,
  because `vite.config.ts`'s `lib.entry` was single-entry —
  only the top-level `src/index.ts` got built.

  Multi-entry library mode now emits both bundles:

  ```
  dist/
    index.js                # main entry (re-exports integration + components + render)
    playwright/index.js     # `test`, `expect`, `patchScreenshot`, `rebaseAnnotations`
  ```

  Any consumer doing `import { test } from
"@ingcreators/annot-product-docs-astro/playwright"`
  previously got `Cannot find module ...dist/playwright/index.js`
  at runtime; the `0.2.1` republish makes the subpath actually
  loadable.

  Also marks `@playwright/test` as external in the Rollup
  config (matches the package.json `peerDependencies` shape;
  prevents accidentally bundling Playwright into the playwright
  adapter).

  No public-API change — same exports, same call shapes,
  same TypeScript types. Pure packaging fix.

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

- 4768855: **`@ingcreators/annot-product-docs-astro` — new `/playwright`
  subpath** that re-exports an extended Playwright `test` fixture
  whose `page.screenshot()` accepts a compositional `annot: { … }`
  option:

  ```ts
  import { test } from "@ingcreators/annot-product-docs-astro/playwright";

  test("login flow", async ({ page }) => {
    await page.goto("/login");
    await page.screenshot({
      path: "public/login.png",
      annot: {
        mdx: { id: "login", path: "src/content/docs/login.mdx" },
        tags: { source: "docs-tour", capturedAt: new Date().toISOString() },
      },
    });
  });
  ```

  The `annot` option is compositional — each field is an
  independent contribution to the embedded XMP record:
  - `mdx: { id, path }` — refresh the MDX's `annot:snapshot` block
    against the current page, then resolve `<Overlay match>` blocks
    for the named `<Screen>`.
  - `overlays: BboxAnnotation[]` — caller-supplied annotations
    (same DSL `@ingcreators/annot-annotator` accepts). Merged with
    MDX-derived overlays when both are present.
  - `tags: Record<string, string>` — provenance metadata written
    verbatim into the XMP. No auto-fill — callers write the
    `WELL_KNOWN_TAG_KEYS` they want.
  - `editable: boolean` (default `true`) — toggle between
    "annotations preserved as SVG layer + embedded original"
    (re-editable in Annot Cloud) and "annotations baked into
    visible pixels" (flat PNG, no XMP layer).

  `page.screenshot()` calls WITHOUT `annot` fall through to
  vanilla Playwright byte-for-byte — codegen / DevTools Recorder
  output keeps working unedited.

  Phase 1 of
  `docs/plans/playwright-screenshot-annot-fixture.md`. Phase 2 will
  add the same interception on `locator.screenshot()` with
  coordinate rebasing for sub-region overlays.

  Two helpers also exported from the main `@ingcreators/annot-product-docs-astro`
  entry for callers who want to compose annotations themselves:
  - `resolveMdxAnnotations({ mdxPath, screenId, dims })` — extract
    the MDX's `<Overlay>` blocks into a typed `BboxNumberedBadgeAnnotation[]`
    (the underlying step the fixture uses internally).
  - `svgFromBboxAnnotations(annotations)` — wrap a
    `BboxAnnotation[]` into a single-root `<svg>` ready for
    `Annotator.toEditablePng()` / `toPng()`.

  **`@ingcreators/annot-core` — new `writePngWithTagsOnly`
  helper** exported from `/xmp-bytes` (and re-exported from
  `/xmp`). Writes `tags` into a PNG's XMP iTXt chunk without
  embedding an original capture or annotations layer — for the
  "PNG with provenance metadata sidecar" path (CI failure
  screenshots, VRT references, etc.). The resulting bytes are
  still a valid PNG and the Annot editor treats them as a normal
  PNG (no `<annot:annotations>` element → not editable round-trip;
  opens as fresh canvas).

- 49b5585: **`locator.screenshot({ annot: { … } })` support** — Phase 2 of
  `docs/plans/playwright-screenshot-annot-fixture.md`. The fixture
  now patches `Locator.prototype.screenshot` alongside
  `Page.prototype.screenshot`, and overlay coordinates are
  automatically rebased into the cropped image's coordinate space:

  ```ts
  await page.locator("header").screenshot({
    path: "header.png",
    annot: {
      overlays: [
        // page-space bbox — rebased onto the header-locator's clip
        { type: "rect", bbox: { x: 120, y: 60, width: 50, height: 30 } },
      ],
    },
  });
  ```

  Overlays whose page-space bbox falls outside the locator's
  bounding box are dropped (warning + skip per Open Question 4)
  and surfaced via:
  - `console.warn(...)` to stderr — always
  - `test.info().annotations` as a `warning` entry when running
    under Playwright — best-effort, guarded so vitest unit tests
    don't crash

  `page.screenshot({ clip, annot })` honours `clip` the same way —
  explicit clip + auto rebase. Mirrors vanilla
  `page.screenshot({ clip })` semantics; only the overlay-rebase
  behaviour is annot-specific.

  When the locator has no bounding box (off-screen / hidden), the
  fixture throws a friendly diagnostic asking the caller to use
  a stable selector / `waitFor()`.

  **Coordinate-rebase API** — exported alongside the fixture for
  callers who want to compose annotations themselves:

  ```ts
  import { rebaseAnnotations } from "@ingcreators/annot-product-docs-astro/playwright";
  // Or for direct algorithmic use without the fixture:
  //   import { rebaseAnnotations } from "@ingcreators/annot-product-docs-astro/playwright/rebase";

  const { kept, dropped } = rebaseAnnotations(annotations, clip);
  ```

  Returns `{ kept, dropped }` for each shape in the
  `BboxAnnotation` union (rect / numberedBadge / circle / arrow /
  text / callout). Raw SVG fragments (`type: "raw"`) pass through
  unchanged — the caller is responsible for emitting clip-space
  coords inside arbitrary SVG.

  `numberedBadge`'s `imageWidth` / `imageHeight` are also rebased
  to the clip dimensions so `placement: "auto"` picks the corner
  against the cropped image edge rather than the page edge.

- 730fab7: `renderAnnotatedScreen()` gains an optional `editable?: boolean |
{ tags?: Record<string, string> }` field. Pass `true` (or an
  object) and the function routes through the new
  `Annotator.toEditablePng()` path: the returned PNG carries the
  same visible callouts plus the original capture + the
  annotations SVG embedded in XMP / custom `svGo` chunk, so
  re-opening the file in the Annot editor / Cloud restores the
  overlays as selectable / movable / restylable objects rather
  than a flat bitmap.

  ```ts
  const result = await renderAnnotatedScreen({
    mdxPath: "docs/app/index.mdx",
    screenId: "app-overview",
    basePngBytes,
    editable: {
      tags: {
        source: "docs-tour",
        capturedAt: new Date().toISOString(),
      },
    },
  });
  await writeFile("public/app/shots/app-overview.png", result.bytes);
  ```

  The cache key folds in the `editable` flag, so flat and editable
  variants of the same screen don't collide. Existing flat-raster
  callers are byte-for-byte unaffected — the option defaults to
  `undefined` (flat).

  The `CacheKeyInput` type gains a parallel `editable?: boolean`
  field; pure helpers that compute the cache key directly should
  forward the bit when threading the flag through.

  Internal note: this PR also adds `@ingcreators/annot-core` as a
  devDependency so tests can import `readEditablePngBytes` from
  `/xmp-bytes` for round-trip verification. Runtime dependencies
  are unchanged.

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
- Updated dependencies [2e8d397]
- Updated dependencies [780985d]
- Updated dependencies [df1a429]
- Updated dependencies [2e92c97]
- Updated dependencies [5e74421]
- Updated dependencies [4768855]
- Updated dependencies [657a685]
  - @ingcreators/annot-annotator@0.5.0
  - @ingcreators/annot-core@0.2.0
  - @ingcreators/annot-product-docs@0.2.0
