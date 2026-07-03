# @ingcreators/annot-playwright

## 0.4.0

### Minor Changes

- f979374: **`page.screenshot({ annot: { … } })` patch relocated to
  annot-playwright** — Phase 1 of
  `docs/plans/playwright-screenshot-fixture-relayer.md`. The
  prototype patch that lets Playwright tests emit annotated PNGs by
  adding a nested `annot:` option to `page.screenshot()` /
  `locator.screenshot()` lives here now (it shipped first in
  `@ingcreators/annot-product-docs-astro/playwright` but is not
  Astro-specific). VRT / marketing-screenshot / AI-agent flows pick
  up the API without taking an Astro dependency.

  ```ts
  import { test, expect } from "@ingcreators/annot-playwright";

  test("login form callouts", async ({ page }) => {
    await page.goto("/login");
    await page.screenshot({
      path: "login.png",
      annot: {
        overlays: [
          {
            type: "rect",
            bbox: { x: 10, y: 10, width: 200, height: 30 },
            intent: "warning",
          },
          {
            type: "numberedBadge",
            bbox: { x: 10, y: 10, width: 24, height: 24 },
            number: 1,
          },
        ],
        tags: { source: "vrt-failure", testId: "login" },
        // editable: true is the default → output PNG is re-editable
        //   in Annot Cloud.
      },
    });
  });
  ```

  Three independent contributions compose into the output PNG:
  - `overlays: BboxAnnotation[]` — inline annotations (rect /
    circle / arrow / text / callout / numberedBadge / raw SVG).
  - `tags: Record<string, string>` — provenance metadata
    serialised into the PNG's XMP (or iTXt sidecar when no
    overlays are present).
  - `editable: boolean` (default `true`) — re-editable wrap
    (annotations + original capture in XMP) vs. flat baked PNG.

  `Locator.prototype.screenshot` and `Page.prototype.screenshot({
clip })` both go through the same pipeline; page-space overlay
  coordinates are automatically rebased into the clipped image's
  coordinate space. Overlays whose bbox falls outside the clip are
  dropped with a warning annotation on `test.info()`.

  **Extension hook registry** — `annotSourceResolvers` is a
  module-level array of resolvers that downstream packages push
  into to claim extra `annot.*` fields:

  ```ts
  import { annotSourceResolvers } from "@ingcreators/annot-playwright";

  annotSourceResolvers.push(async ({ annot, page }) => {
    if (!annot.figma) return null;
    return {
      prepare: () => refreshFigmaCache(annot.figma),
      resolveAnnotations: (dims) => readFigmaOverlays(annot.figma, dims),
    };
  });
  ```

  The resolver's `prepare()` hook fires before the raw screenshot
  is taken (so MDX-aware adapters can refresh `annot:snapshot`
  blocks against the live DOM); `resolveAnnotations(dims)` runs
  after with the page-space dimensions and returns
  `BboxAnnotation[]` to merge into the output. annot-playwright
  stays MDX-unaware — the matching MDX resolver moves into
  `@ingcreators/annot-product-docs` in Phase 2 of the parent plan.

  **Coordinate-rebase API** — `rebaseAnnotations` /
  `describeAnnotation` / `Clip` / `RebaseResult` exported for
  callers who want to rebase annotations themselves without going
  through the patch (e.g. building custom test reporters):

  ```ts
  import { rebaseAnnotations } from "@ingcreators/annot-playwright";

  const { kept, dropped } = rebaseAnnotations(annotations, clip);
  ```

  **Compatibility** — additive. The existing
  `@ingcreators/annot-product-docs-astro/playwright` subpath stays
  working unchanged for this release; Phase 4 of the parent plan
  converts it into a deprecated re-export.

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

## 0.3.1

### Patch Changes

- Updated dependencies [806badc]
- Updated dependencies [df1a429]
  - @ingcreators/annot-annotator@0.5.0

## 0.3.0

### Minor Changes

- b3e8e53: Both packages now accept an optional `encode` option that flows through to `@ingcreators/annot-annotator@0.3.0`'s `toEncoded()` / `decodeAndEncodeImage()` pipeline. Achieves feature parity with the Chrome extension's "Save size" + "Format smart" capture settings for AI-agent (`annot-mcp`) and Playwright-test (`annot-playwright`) flows.

  ## `annot-playwright`

  ```ts
  await annotator.annotateScreenshot(page, {
    annotations: [...],
    encode: { format: "smart", saveSizePreset: "standard" },
  });
  ```

  Returned bytes shrink to PNG-8 / JPEG / resized PNG-32 per the smart heuristic; default behaviour when `encode` is omitted matches v0.2.x (raw PNG-32 from the annotator).

  ## `annot-mcp`

  All five tools (`annot_annotate_screenshot`, `annot_annotate_url`, `annot_redact_screenshot`, `annot_redact_url`, `annot_compare_screenshots`) accept the same `encode` shape on their MCP `inputSchema`. Agents can specify any subset:

  ```jsonc
  {
    "url": "https://...",
    "annotations": [...],
    "encode": {
      "format": "smart",
      "saveSizePreset": "light",
      "smartFallback": "jpeg"
    }
  }
  ```

  `format`: `"smart"` (default — PNG-8 for UI / PNG / JPEG for photos) / `"png"` / `"jpeg"`.
  `saveSizePreset`: `"light"` 1280px / `"standard"` 1920px / `"highQuality"` 2560px / `"original"` no resize.
  `smartFallback`, `smartColorThreshold`, `jpegPercent` all configurable.

  Output `mimeType` flips to `image/jpeg` when the chosen path emits JPEG, so MCP clients render inline correctly. The text confirmation when `output` is set now includes the chosen format and any `reason` (`png-8` / `photo-fallback-jpeg` / `imagequant-missing` / …) for observability.

  Backwards-compatible: when `encode` is omitted, all tools emit PNG-32 bytes verbatim (no decode/encode round-trip, same as v0.1.x / v0.2.x).

### Patch Changes

- Updated dependencies [86d0853]
  - @ingcreators/annot-annotator@0.3.0

## 0.2.0

### Minor Changes

- 35e3ad7: `annotateScreenshot()` now accepts the annotation DSL added in `@ingcreators/annot-annotator@0.2.0`:

  ```ts
  import {
    test,
    expect,
    type BboxAnnotation,
  } from "@ingcreators/annot-playwright";

  test("login form", async ({ page, annotator }, testInfo) => {
    const submit = page.getByRole("button", { name: "Sign in" });
    const box = (await submit.boundingBox())!;
    const annotated = await annotator.annotateScreenshot(page, {
      annotations: [
        { type: "rect", bbox: box, intent: "error" },
        {
          type: "callout",
          at: { x: 50, y: 50 },
          targetBbox: box,
          content: "Failing",
        },
      ] satisfies BboxAnnotation[],
    });
    await testInfo.attach("failure.png", { body: annotated });
  });
  ```

  The existing `annotationsSvg: string` shape still works; the new `annotations: BboxAnnotation[]` is an additive overload. `intent` shorthand (`"info"` / `"warning"` / `"error"` / `"success"` / `"neutral"`) maps to the Annot design system's semantic colours so callers no longer think in raw hex values, and `callout` composes the rect + arrow + caption in a single entry.

  `rectForBoundingBox` / `arrowBetween` / `textAt` are now thin re-exports from `@ingcreators/annot-annotator` rather than local helpers. Cosmetic delta: `arrowBetween`'s marker id prefix changed from `annot-pw-arrow-N` to `annot-arrow-N`; snapshot-on-SVG tests should expect this.

  Also re-exports the bbox-flavour DSL types (`BboxAnnotation`, `BBox`, `Point`, `Intent`, `AnnotationStyle`, `BboxRedactRegion`, `RedactStyle`, …) from `@ingcreators/annot-annotator` so callers keep a single import line.

### Patch Changes

- Updated dependencies [92378f9]
  - @ingcreators/annot-annotator@0.2.0

## 0.1.0

### Minor Changes

- 408791f: Initial public release — headless annotator + Playwright fixture + SDK.

### Patch Changes

- Updated dependencies [408791f]
  - @ingcreators/annot-annotator@0.1.0
