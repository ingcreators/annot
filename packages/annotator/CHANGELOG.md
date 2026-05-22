# @ingcreators/annot-annotator

## 0.5.0

### Minor Changes

- 806badc: Retire the `@ingcreators/annot-imagequant` (GPL-3.0) dynamic-import
  boundary that gated PNG-8 output in the headless annotator and the
  MCP server. `Annotator.toEncoded()`'s smart mode now routes PNG-8
  through the pure-TS Median Cut + Floyd–Steinberg dither at
  `@ingcreators/annot-core/encode/quantize-median-cut` directly.

  ### Removed public API
  - `isImagequantAvailable()` is no longer exported from
    `@ingcreators/annot-annotator`. PNG-8 is now unconditionally
    available — callers that previously gated `format: "smart"` on
    this can drop the check.
  - `Annotator.toEncoded()` no longer emits
    `EncodeResult.reason === "imagequant-missing"`. The
    graceful-PNG-32-fallback path that produced this reason is
    unreachable.

  ### Removed dependency
  - `@ingcreators/annot-imagequant` is dropped from
    `@ingcreators/annot-annotator`'s `dependencies`. Consumers
    that previously installed it as a side-effect of installing
    `annot-annotator` will save the WASM payload from their
    `node_modules`. `annot-mcp` inherits the removal transitively.

  Phase 3 of `docs/plans/replace-libimagequant-with-median-cut.md`.
  Phase 4 deletes the `@ingcreators/annot-imagequant` workspace
  package and deprecates the published 0.1.0 on npm.

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

## 0.3.0

### Minor Changes

- 86d0853: `Annotator.toEncoded(input, encodeOptions?)` — new async method that combines rasterise + smart-encode in one step. Achieves feature parity with Chrome extension's "Save size" + "Format smart" capture options for the manual-creation / agent use cases.

  **EncodeOptions** (re-exported from `@ingcreators/annot-core/encode/options`):
  - `format: "smart" | "png" | "jpeg"` — Smart picks PNG-8 for UI-heavy content (via libimagequant) and JPEG / PNG-32 for photo-heavy content per `smartFallback`. PNG / JPEG paths skip the smart heuristic.
  - `saveSizePreset: "light" | "standard" | "highQuality" | "original"` — Max-width caps at 1280 / 1920 / 2560 / no-resize. Aspect-preserving; never upscales.
  - `smartFallback: "png" | "jpeg"` — Photo-heavy fallback format.
  - `smartColorThreshold: number` — Unique-colour count threshold (default 15000). Above this the image is treated as photo-heavy.
  - `jpegPercent: number` — JPEG quality 60–100 (default 92).

  Returns `{ bytes, chosen, reason?, width, height }` so callers can log which format was actually chosen (`"png-8"` / `"photo-fallback-jpeg"` / `"imagequant-missing"` etc.).

  Standalone `encodeRgba(rgba, width, height, options)` also exported for callers who already have raw RGBA bytes (e.g. from a Playwright screenshot fed through their own canvas).

  **New runtime dependencies:**
  - `@napi-rs/canvas` (regular `dependencies`) — native canvas binding for PNG / JPEG encoding + resize. ~20 MB platform-matched binary at install time.
  - `@ingcreators/annot-imagequant` (regular `dependencies`) — GPL-3.0 WASM wrapper around libimagequant for PNG-8 quantization. Loaded via dynamic import; consumers who explicitly uninstall the package to avoid the GPL inclusion get a graceful fallback to PNG-32 (`reason: "imagequant-missing"`).
  - `pako` (regular `dependencies`) — pulled in transitively via the PNG-8 encoder; declared explicitly so consumer installs are deterministic.

  The existing `toPng()` and `toSvg()` methods are unchanged — `toEncoded()` is purely additive.

### Patch Changes

- Updated dependencies [adae49d]
  - @ingcreators/annot-imagequant@0.1.0

## 0.2.0

### Minor Changes

- 92378f9: Public DSL surface (since 0.2.0). The annotation DSL that was previously private to `@ingcreators/annot-mcp` now lives on the annotator package so any Annot consumer (test runtimes, AI agents, plugin authors) can use the same vocabulary.

  New exports:
  - Types: `BBox`, `Point`, `Intent`, `AnnotationStyle`, `BboxAnnotation` (`rect` / `circle` / `arrow` / `text` / `callout` / `raw`), `RawAnnotation`, `BboxRedactRegion`, `RedactStyle`.
  - Converter: `bboxAnnotationsToSvg(annotations)` returns the SVG fragment string `createAnnotator(...).toPng({ annotationsSvg })` accepts.
  - SVG primitives: `rectForBoundingBox`, `arrowBetween`, `textAt`, plus `BoundingBox` / `RectOptions` / `ArrowOptions` / `TextOptions`.
  - JSON Schemas: `SHARED_DEFS`, `BBOX_ANNOTATION_SCHEMA`, `BBOX_REDACT_REGION_SCHEMA` (drop into MCP tool `inputSchema` `$defs` blocks).

  The `intent` shorthand (`"info"` / `"warning"` / `"error"` / `"success"` / `"neutral"`) resolves to the Annot design system's semantic colour tokens automatically — no more thinking in raw hex values.

  Marker id prefix in `arrowBetween` changed from `annot-pw-arrow-N` (previous helper in `@ingcreators/annot-playwright`) / `annot-mcp-arrow-N` (previous helper in `@ingcreators/annot-mcp`) to the package-neutral `annot-arrow-N`. Snapshot-on-SVG tests should expect this minor cosmetic delta.

## 0.1.0

### Minor Changes

- 408791f: Initial public release — headless annotator + Playwright fixture + SDK.
