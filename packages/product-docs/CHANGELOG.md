# @ingcreators/annot-product-docs

## 0.5.1

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @ingcreators/annot-annotator@0.7.0
  - @ingcreators/annot-core@0.4.0
  - @ingcreators/annot-playwright@0.5.0

## 0.5.0

### Minor Changes

- **Breaking:** removed the deprecated Phase-3 back-compat aliases
  (`Screen`, `ScreenCaptureOptions`, `captureScreen`, and the
  `screen` fixture with its `.capture()` method), per the
  deprecation window announced in the 0.3.x rename. Migrate to
  `ProductDocs` / `ProductDocsSyncOptions` / `syncProductDocs` /
  the `productDocs` fixture's `.sync()` — same behaviour, new
  names only.

## 0.4.1

### Patch Changes

- Updated dependencies [b47d896]
  - @ingcreators/annot-core@0.3.1
  - @ingcreators/annot-annotator@0.6.0
  - @ingcreators/annot-playwright@0.4.2

## 0.4.0

### Minor Changes

- b5d52f6: **Annotation palette composes onto the annotated PNG** — Phase 3c
  of `docs/plans/living-spec-authoring-roadmap.md`. The Astro Image
  Service's `renderAnnotatedScreen` now reads the Phase 3a yaml
  `annotations[]` section and bakes the full visual palette
  (rect / circle / arrow / text / callout / freehand / redact /
  focusMask) onto the base PNG, layered underneath the existing
  numbered-badge overlays.

  ### New public surface — `@ingcreators/annot-product-docs`

  `buildShapeAnnotationsFromYaml(annotations, boxed, dims) →
BboxAnnotation[]` maps each Phase 3a `AnnotationSpec` against the
  page's `BoxedEntry[]` (from snapshot YAML or PNG XMP ElementTree)
  and produces `BboxAnnotation` shapes the headless annotator's
  `bboxAnnotationsToSvg` consumes. Per-variant resolution:
  - **`rect`** — `match` / `coversElements[]` / `bbox`. `coversElements`
    unions the per-element bboxes into one.
  - **`circle`** — match-anchored circles centre on the element bbox
    with radius defaulting to half the longer axis; `center` + `radius`
    is the free-coord form.
  - **`arrow`** — endpoints can be `{ match }` (centre-to-centre) or
    `{ point }`.
  - **`text`** — `anchor.position` (above / below / left / right /
    center) offsets a centred / left- / right-anchored label by 8 px
    outside the element bbox.
  - **`callout`** — target = match-resolved or free-coord bbox; `at`
    is the caption position.
  - **`freehand`** — passes through verbatim.
  - **`redact`** — style: `solid` renders as a filled rect (default
    fill `#222222`, no stroke); `fill` / `stroke` overrides honoured.
  - **`focusMask`** — cutout expands by `padding` (match-anchored);
    outer rect collapses to the supplied image dims.

  Intent mapping mirrors the existing badge path
  (`required → error`, `action → warning`, others pass through).

  Match resolution failures are silently skipped — the drift
  detector (Phase 3d) surfaces them upstream so the build keeps
  producing a useful PNG even when the snapshot has drifted.

  ### Behaviour change — `renderAnnotatedScreen`

  When `<Screen annotations="…">` resolves to a yaml carrying
  `annotations[]`, the renderer composes shapes (underneath) + badges
  (on top) into one SVG fragment via `svgFromBboxAnnotations`. The
  cache key already includes the annotations-yaml source from
  Phase 2b, so edits to the yaml bust the cached PNG without extra
  bookkeeping. Pre-Phase-3 yaml files (no `annotations` key) parse
  - render unchanged.

  ### Compatibility

  Additive. Existing callers that only use `overlays[]` see no
  behaviour change. The new `buildShapeAnnotationsFromYaml` export
  is opt-in.

- fa712fd: **Annotation palette drift + xlsx coverage (Phase 3d)** — closes
  Phase 3 of `docs/plans/living-spec-authoring-roadmap.md`.

  ### Drift detector — `yamlAnnotations` opt-in

  `detectDrift` / `detectDriftFromYaml` / `detectDriftFromElementTree`
  gain an optional `yamlAnnotations: readonly AnnotationSpec[]`
  field. When set, the detector walks the match keys reachable from
  each Phase 3a `AnnotationSpec` (via the new
  `collectMatchKeysFromAnnotation(spec) → MatchKey[]` helper) and
  runs them through the same match-cycle as overlays — emitting
  `removed` / `renamed` / `role-changed` / `duplicated` findings
  with the annotation `id` referenced in the message.

  Free-coord variants (`bbox`-only rect / `point`-only arrow
  endpoint / `at`-only text / `bbox`-only callout target /
  freehand / `bbox`-only redact / `bbox`-only focusMask cutout)
  contribute zero keys and pass through silently.

  `annotations[]` IDs are NEVER referenced from `<AnnotCallout for>`
  (overlays[] owns that contract), so no
  `description-missing` / `description-orphan` findings fire for
  this source.

  ### Excel adapter — yaml-driven rows for migrated screens

  `@ingcreators/annot-product-docs-xlsx`'s `extractFromParsed`
  gains an optional `annotationsYamlByPath` context map. When a
  `<Screen>` carries `annotations="…"` and the matching yaml is in
  the map, the item-table rows are sourced from the yaml's
  `overlays[]` (each row's body cross-referenced from
  `screen.callouts` by id). `extractMdxFile` loads each
  referenced yaml file from disk automatically — missing files are
  a loud failure on the same "explicit reference, but file gone"
  reasoning the Astro Image Service uses.

  `annotations[]` entries in the yaml are deliberately NOT
  surfaced as rows. The Astro Image Service composes them onto
  the annotated PNG; the Excel adapter renders the resulting image
  in the spreadsheet's picture column while the items table stays
  scoped to overlays.

  ### workflow-app dogfood

  `examples/workflow-app/docs/books/operation-manual/OM-001-login.mdx`
  migrates from inline `<Overlay>` to the
  `<Screen annotations="./OM-001-login.annotations.yaml">` +
  `<AnnotCallout for>` form. The companion yaml ships three
  overlays plus three `annotations[]` entries exercising
  `rect` + `arrow` + `focusMask` — the full Phase 3 palette
  end-to-end through the workflow-app's docs build.

  ### Compatibility

  Additive. Existing drift callers see no behaviour change unless
  they opt in to `yamlAnnotations`. Existing xlsx callers see no
  behaviour change unless they migrate a screen to the yaml form;
  inline-`<Overlay>` screens continue to drive rows as before.

- f09a6b1: **Annotation yaml `redact.style` accepts `mosaic` / `blur`** —
  Phase 3f of `docs/plans/living-spec-authoring-roadmap.md`
  (Phase 3 follow-up).

  The Phase 3a parser shipped `redact.style: "solid"` only; mosaic
  / blur were explicitly rejected with a "reserved for follow-up"
  message. Phase 3f widens the enum to all three (`solid` /
  `mosaic` / `blur`) so authoring tools and the Astro Image
  Service can use the values end-to-end.

  ### Parser behaviour

  ```yaml
  # Phase 3a: accepted
  annotations:
    - id: redact-1
      kind: redact
      bbox: { x: 0, y: 0, width: 100, height: 30 }
      style: solid

  # Phase 3f: NEW — both accepted
  annotations:
    - id: redact-2
      kind: redact
      match: { role: textbox, name: Reason }
      style: mosaic
    - id: redact-3
      kind: redact
      bbox: { x: 421, y: 269, width: 438, height: 40 }
      style: blur
  ```

  Unknown style values still error with an updated message:
  `redact.style must be one of "solid" / "mosaic" / "blur"`.

  ### Render behaviour (transitional)

  Between 3f (this PR) and 3g (Astro Image Service raster
  pre-processing), `mosaic` and `blur` redact entries are
  parser-accepted but the Image Service still routes them
  through the SVG-fragment filled-rect path — so they LOOK
  identical to `solid` until 3g lands. 3g wires the raster
  pass that gives `mosaic` / `blur` their distinct visual
  output.

  ### New public type

  `RedactAnnotationStyle` (the `"solid" | "mosaic" | "blur"` union)
  is exported from `@ingcreators/annot-product-docs` so callers
  can reference it directly.

  ### Compatibility

  Additive within v1. Pre-3f files (no redact entries, or
  `style: solid` only) parse identically. Files authored with
  `style: "mosaic" | "blur"` are rejected by the pre-3f parser
  (loud failure pointing at the unsupported style) — consumers
  on older `@ingcreators/annot-product-docs` upgrade to consume
  the new files.

- 0d19345: **Astro Image Service bakes mosaic / blur redacts onto the base
  PNG** — Phase 3g of `docs/plans/living-spec-authoring-roadmap.md`
  (Phase 3 follow-up).

  When a screen's `annotations[]` yaml carries
  `redact { style: "mosaic" | "blur" }` entries, the renderer now
  calls `burnRedactions` from `@ingcreators/annot-annotator` on
  the base PNG before SVG-fragment composition. `style: solid`
  redacts continue to flow through the existing SVG filled-rect
  path — avoiding an unnecessary PNG round-trip for the common
  solid case.

  ### New public surface

  `buildRasterRedactRegionsFromYaml(annotations, boxed) →
BboxRedactRegion[]` (exported from
  `@ingcreators/annot-product-docs`) walks `annotations[]` for
  raster-style redact entries, resolves each cutout to a bbox,
  and emits regions ready for `burnRedactions`. Match-anchored
  entries whose `match` doesn't resolve are skipped silently —
  the drift detector (Phase 3d) surfaces them upstream so the
  build keeps producing a useful PNG while the snapshot
  catches up.

  ### `renderAnnotatedScreen` flow

  ```
  load base PNG bytes
     ↓
  read element-tree bboxes
     ↓
  walk annotations[] → split into:
     • raster redacts (mosaic / blur) → burnRedactions(base, regions)
     • SVG annotations (rect / circle / arrow / text / callout
       / freehand / solid-redact / focusMask / numberedBadge)
     ↓
  compose SVG fragments on top of the (possibly burned) base PNG
     ↓
  emit final PNG (flat or editable)
  ```

  ### `mapRedact` change

  `mapRedact` in `mdx-annotations.ts` now returns `null` for
  `style: "mosaic" | "blur"` so those entries don't double-bake
  as a filled rect on top of the already-pixelated bitmap. Solid
  redacts continue to produce a `BboxRectAnnotation` for the SVG
  path.

  ### `hadBoundingBoxes` semantics

  The flag flips true when raster redacts resolved through bbox
  data, even when no SVG annotations composed on top. This
  matches the flag's intent ("we used the snapshot's bbox data
  to produce a useful render") — a screen with only a mosaic
  redact still benefited from the bbox tour.

  ### Caching

  The cache key already includes the annotations-yaml source
  bytes (Phase 2b), so editing a yaml `style: mosaic` → `style:
blur` value busts the cached PNG without additional
  bookkeeping.

  ### Compatibility

  Additive. Existing screens (no `annotations[]`, or
  `annotations[]` with no raster-style redacts) render
  byte-identical. mosaic / blur redacts that were parser-accepted
  in 3f but rendered as solid rects now render as their proper
  raster effect.

### Patch Changes

- Updated dependencies [6124d59]
- Updated dependencies [0c7ac26]
- Updated dependencies [64dc6e8]
- Updated dependencies [691bec5]
- Updated dependencies [9697f27]
- Updated dependencies [266b05a]
  - @ingcreators/annot-annotator@0.6.0
  - @ingcreators/annot-core@0.3.0
  - @ingcreators/annot-playwright@0.4.1

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
