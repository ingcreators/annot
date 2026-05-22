# @ingcreators/annot-core

## 0.2.1

### Patch Changes

- f485646: **Expose `./xmp-bytes` subpath on the published tarball.**
  The workspace `package.json#exports` declared
  `"./xmp-bytes": "./src/xmp/xmp-bytes.ts"` from day one, but
  `publishConfig.exports` only declared `.` + `./styles/*` —
  so every workspace subpath (`./headless`, `./editor/*`,
  `./xmp-bytes`, etc.) was stripped from the published
  tarball.

  This patch unblocks the `./xmp-bytes` subpath specifically.
  `@ingcreators/annot-product-docs-astro@0.2.1`'s playwright
  fixture imports `@ingcreators/annot-core/xmp-bytes` (via
  the bundled `writePngWithTagsOnly` helper); without this
  patch, any consumer doing
  `import { test } from "@ingcreators/annot-product-docs-astro/playwright"`
  hits `Package subpath './xmp-bytes' is not defined`.

  ## Fix

  `vite.config.ts` switches to multi-entry library mode:

  ```ts
  lib: {
    entry: {
      index: resolve(__dirname, "src/index.ts"),
      "xmp-bytes": resolve(__dirname, "src/xmp/xmp-bytes.ts"),
    },
    formats: ["es"],
  },
  ```

  `package.json#publishConfig.exports` gains the matching
  `./xmp-bytes` entry:

  ```json
  "./xmp-bytes": {
    "types": "./dist/xmp/xmp-bytes.d.ts",
    "default": "./dist/xmp-bytes.js"
  }
  ```

  Bundle landing in the tarball:

  ```
  dist/xmp-bytes.js          7.55 kB │ gzip: 2.67 kB
  dist/xmp/xmp-bytes.d.ts    declarations colocated by the dts plugin
  ```

  ## Other subpaths still missing

  The workspace `exports` map declares 17+ subpaths (`./headless`,
  `./editor`, `./editor/*`, `./icons`, `./xmp`, `./zip`,
  `./utils`, `./desktop-bridge`, `./storage`, `./encode/*`,
  `./auto-capture-options`, …). Most are Tier C (browser-only)
  and shouldn't ship as standalone published bundles — Tier C
  code lives in `@ingcreators/annot-editor` / `-render` for
  npm consumers. The few Tier A subpaths that DO make sense
  on npm (`./headless`, `./storage`, `./utils`, `./zip`,
  `./zip-bytes`) can ship in a separate follow-up patch
  when a concrete downstream consumer needs them.

  ## After this PR republishes

  `@ingcreators/annot-product-docs-astro` needs a `0.2.2`
  republish that bumps its `@ingcreators/annot-core` dep
  from `0.2.0` to `^0.2.1` so the playwright fixture can
  finally resolve `./xmp-bytes` at consumer install time.
  Once both land, the `examples/workflow-app/` tour can
  migrate from the hybrid `captureScreen + page.screenshot`
  pair to the unified `page.screenshot({ annot: { mdx } })`
  single call.

## 0.2.0

### Minor Changes

- 2e8d397: Switch the client-capture PNG-8 default quantizer to the pure-TS
  Median Cut at `@ingcreators/annot-core/encode/quantize-median-cut`.
  `DEFAULT_ENCODE_OPTIONS.quantizer` is now `"median-cut"`. The
  `@ingcreators/annot-imagequant` WASM import and the `ensureWasm()`
  initialisation path are removed from `@ingcreators/annot-core/encode`.
  The `quantizer: "wasm"` value on `EncodeOptions` is retained for
  back-compat (now resolves to the same Median Cut implementation)
  so consumers that persisted `quantizer: "wasm"` to localStorage
  keep working unchanged.

  Phase 2 of `docs/plans/replace-libimagequant-with-median-cut.md`.
  Phase 3 retires the annotator / MCP dynamic-import path; Phase 4
  deletes the workspace package and deprecates the published
  `@ingcreators/annot-imagequant@0.1.0` on npm.

- df1a429: **`@ingcreators/annot-annotator` — new `Annotator.toEditablePng()`
  method** that returns a re-editable PNG. The bytes carry the same
  visible pixels as `toPng()` plus the original un-annotated capture +
  the annotations SVG embedded in the PNG's XMP / custom `svGo` chunk.
  Re-opening the file in the Annot editor (or `annot.work/app/`)
  restores the annotations as selectable / movable / restylable
  objects rather than a flat bitmap.

  ```ts
  const annotator = createAnnotator();
  const editablePng = annotator.toEditablePng({
    originalDataUrl,
    annotationsSvg,
    width,
    height,
    tags: {
      source: "playwright-fixture",
      capturedAt: new Date().toISOString(),
    },
  });
  await writeFile("shot.png", editablePng);
  ```

  Image viewers that don't know about the custom chunks display the
  rasterised pixels verbatim — no compatibility loss vs `toPng()`.

  The existing `toPng()` / `toSvg()` / `toEncoded()` methods are
  unchanged — `toEditablePng()` is purely additive.

  **`@ingcreators/annot-core` — new `/xmp-bytes` Tier-A subpath**
  exposing the pure-bytes XMP encode / decode primitives that used to
  live (Blob-wrapped) inside `/xmp`:
  - `createEditablePngBytes(opts) -> Uint8Array` — write a re-editable
    PNG. Takes raw PNG bytes for both the rasterised image and the
    original capture; no `Blob` / `FileReader` dependency. The
    function the new `Annotator.toEditablePng()` is built on.
  - `readEditablePngBytes(data) -> AnnotMetadata | null` — PNG-only
    reader.
  - `readEditableImage(data) -> AnnotMetadata | null` — dual PNG /
    JPEG reader (moved here from `/xmp`, also re-exported from `/xmp`
    for source-compat).
  - `WELL_KNOWN_TAG_KEYS` — soft-convention key names for the
    optional `tags` field (`source` / `screen` / `capturedAt` /
    `commit`).

  Existing `@ingcreators/annot-core/xmp` consumers stay working
  without source changes — `xmp-browser.ts` re-exports the Tier-A
  surface alongside its Blob-wrapped `createEditableImage`.

- 5e74421: Add `quantizeMedianCut` — a pure-TS Median Cut + Floyd–Steinberg
  dither quantizer at `@ingcreators/annot-core/encode/quantize-median-cut`
  — and an opt-in `quantizer?: "wasm" | "median-cut"` field on
  `EncodeOptions`. Default stays `"wasm"` (libimagequant via the
  existing GPL-3.0 WASM dependency) so production behaviour is
  unchanged. Phase 1 of
  `docs/plans/replace-libimagequant-with-median-cut.md`; Phase 2
  will flip the default to `"median-cut"` and Phase 4 will retire
  the `"wasm"` branch entirely.
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

### Patch Changes

- 780985d: Remove the `@ingcreators/annot-imagequant` workspace dependency
  graph entirely. The package's GPL-3.0 WASM was replaced by the
  pure-TS Median Cut quantizer in Phases 1–3 of
  `docs/plans/_done/replace-libimagequant-with-median-cut.md`;
  Phase 4 deletes the workspace package itself + the `verify-wasm`
  CI job + the Cargo dependabot watch + the issue-template option +
  the published 0.1.0 on npm (via the `npm deprecate` operator
  action documented in the Phase 4 PR description).

## 0.1.0

### Minor Changes

- 408791f: Initial public release — headless annotator + Playwright fixture + SDK.
