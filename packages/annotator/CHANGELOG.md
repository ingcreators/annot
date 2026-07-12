# @ingcreators/annot-annotator

## 0.7.0

### Minor Changes

- `toEditablePng`'s `EditableInput` gains the schema-2.0 provenance
  fields (`sourceUrl` / `createdAt` / `producer` / `dpr`), written
  into the XMP packet as first-class elements. `producer` defaults
  to `"annotator"`. Prefer these over the old `WELL_KNOWN_TAG_KEYS`
  smuggling convention (`source` / `capturedAt` tags).

## 0.6.0

### Minor Changes

- 6124d59: **`BboxAnnotation` palette extensions: `freehand` + `focusMask`** —
  Phase 3b of `docs/plans/living-spec-authoring-roadmap.md`.

  Two new variants on the `BboxAnnotation` union expose the rest of
  the Annot visual palette to `bboxAnnotationsToSvg()` and through
  it to `Annotator.toPng()` / `.toSvg()` / `.toEditablePng()`:

  ```ts
  // Free-form path stroke — `path` is the SVG <path> `d` attribute.
  {
    type: "freehand",
    path: "M100,200 L150,250 L200,210",
    intent: "info",        // optional — defaults to "error"
    strokeWidth: 4,        // optional — defaults to 2
    fill: "#ffeecc",       // optional — defaults to "none"
  }

  // Dim everything except the cutout region. One <path> with
  // fill-rule="evenodd" combines a full-image rect with the
  // cutout — the even-odd rule cancels overlap.
  {
    type: "focusMask",
    cutout: { x: 200, y: 100, width: 80, height: 40 },
    imageWidth: 1280,
    imageHeight: 800,
    dimColor: "rgba(0,0,0,0.5)",   // optional — default same value
  }
  ```

  `@ingcreators/annot-product-docs`'s `<Screen annotations>`
  Image Service composition (Phase 3c) will map yaml
  `AnnotationSpec` entries to these two primitives plus the
  existing `rect` / `circle` / `arrow` / `text` / `callout` /
  `numberedBadge` shapes. Useful standalone for any annotator
  caller (Playwright fixtures, MCP server, custom test reporters)
  without involving yaml or MDX.

  **JSON schemas** — `BBOX_ANNOTATION_SCHEMA.oneOf` gains
  `BBOX_FREEHAND` + `BBOX_FOCUS_MASK` entries so MCP callers can
  validate either kind at the boundary.

  **Out of scope** — redact (mosaic / blur) needs raster pixel
  access and is not implementable as an SVG fragment; it stays
  on the existing destructive `burnRedactions` path in
  `@ingcreators/annot-mcp`. Phase 3a's annotation yaml rejects
  `style: "mosaic" | "blur"` accordingly.

  **Compatibility** — additive. Existing `BboxAnnotation` callers
  keep working; the new variants are opt-in by setting
  `type: "freehand" | "focusMask"`.

- 0c7ac26: **Relocate `burnRedactions` from `@ingcreators/annot-mcp` to
  `@ingcreators/annot-annotator`** — Phase 3e of
  `docs/plans/living-spec-authoring-roadmap.md` (Phase 3 follow-up).

  The destructive raster burn primitive (solid / mosaic / blur over
  a PNG buffer, built on `@napi-rs/canvas`) historically lived in
  `@ingcreators/annot-mcp` because the MCP server's
  `annot_redact_screenshot` tool was the first caller. The function
  itself has no MCP-specific surface — it's pure
  (`pngBytes + regions → pngBytes`). To let non-MCP callers consume
  it without dragging the MCP server's dep footprint (Playwright,
  `@modelcontextprotocol/sdk`, etc.), the primitive moves to
  `@ingcreators/annot-annotator` — the canonical Node-side raster
  home, which already depends on `@napi-rs/canvas` for its encode
  pipeline (so the move adds **zero** transitive deps).

  ### `@ingcreators/annot-annotator` — new public surface

  ```ts
  import {
    burnRedactions,
    type RedactRegion,
  } from "@ingcreators/annot-annotator";

  const out = await burnRedactions(pngBytes, [
    {
      bbox: { x: 10, y: 20, width: 100, height: 30 },
      style: "solid",
      color: "#000000",
    },
    { bbox: { x: 200, y: 100, width: 80, height: 40 }, style: "mosaic" },
    { bbox: { x: 0, y: 0, width: 64, height: 64 }, style: "blur" },
  ]);
  ```

  `RedactRegion` is exposed as an alias of `BboxRedactRegion`
  (structurally identical, already declared in the DSL types) so
  existing MCP-side consumers see no shape change.

  ### `@ingcreators/annot-mcp` — no public API change

  The existing `burnRedactions` + `RedactRegion` re-exports from
  the package root keep working byte-identical, sourced from the
  annotator instead of the old MCP-local file. MCP's
  `annot_redact_screenshot` / `annot_redact_url` tools continue
  to import from `../redact/burn.js`, which is now a one-line
  re-export from annotator.

  ### Compatibility

  Additive on annotator's side; zero behaviour change on MCP's
  side. Tests move with the code (annotator 64 → 71 passed; MCP
  91 → 84 passed — same scenarios at the new home).

  ### Out of scope

  `@napi-rs/canvas` stays as an MCP direct dep — `compare/diff.ts`
  and several other MCP tool tests still use it directly, so
  collapsing it onto a transitive-via-annotator import is a
  separate cleanup.

- 64dc6e8: **Relocate `diffScreenshots` from `@ingcreators/annot-mcp` to
  `@ingcreators/annot-annotator`** — Phase 3i of
  `docs/plans/living-spec-authoring-roadmap.md` (Phase 3
  follow-up #2). Same pattern as 3e's `burnRedactions` relocate.

  The pixelmatch-driven PNG comparison + contiguous-region bbox
  aggregation lived in `@ingcreators/annot-mcp/compare/` for
  historical reasons (the MCP server's
  `annot_compare_screenshots` tool was the first caller). The
  function itself has no MCP-specific surface — it's pure
  (`pngBytes + pngBytes → DiffResult`). Relocating it to
  `@ingcreators/annot-annotator` lets non-MCP callers
  (Playwright visual regression fixtures, Astro pixel drift CI,
  custom test reporters, editor before/after preview) consume
  it without dragging the MCP server's dep footprint.

  ### `@ingcreators/annot-annotator` — new public surface

  ```ts
  import {
    diffScreenshots,
    aggregateDiffRegions,
    DimensionMismatchError,
    type DiffResult,
    type DiffOptions,
  } from "@ingcreators/annot-annotator";

  const result = await diffScreenshots(beforePng, afterPng, { threshold: 0.1 });
  // → { mismatchedPixels: number, regions: BBox[], width, height }
  ```

  annotator gains `pixelmatch` (~4 KB, no transitive deps) as a
  runtime dep.

  ### `@ingcreators/annot-mcp` — no public API change

  The existing `compare/diff.ts` + `compare/aggregate.ts` modules
  become one-line re-export shims forwarding from annotator. MCP's
  internal callers (`tools/compare-screenshots.ts`) and any
  external consumer importing from `@ingcreators/annot-mcp` keep
  working byte-identical.

  ### Compatibility

  Additive on annotator's side; zero behaviour change on MCP's
  side. Tests move with the code (annotator 71 → 81 passed; MCP
  84 → 78 passed — same scenarios at the new home, plus a new
  `diffScreenshots` smoke test that the MCP-side aggregate-only
  test didn't cover).

  ### Out of scope

  `pixelmatch` stays as a direct MCP dep — even though MCP no
  longer imports it from the moved code, it's a tiny package
  and removing the explicit dep would force consumers to rely
  on a transitive resolution through annotator, which is more
  fragile than declaring the intent directly.

- 691bec5: **Add `flattenEditablePng(pngBytes) → pngBytes`** — Phase 3j of
  `docs/plans/living-spec-authoring-roadmap.md` (Phase 3
  follow-up #2). The editor's editable-PNG format embeds the
  original un-annotated capture + the annotations SVG in PNG
  ancillary chunks for re-edit; "flatten" drops those chunks and
  keeps just the visible (already-annotated) bytes.

  ### `@ingcreators/annot-annotator` — new public surface

  ```ts
  import { flattenEditablePng } from "@ingcreators/annot-annotator";

  const flat = flattenEditablePng(editablePngBytes);
  // → flat PNG: same visible pixels, no Adobe XMP iTXt chunk,
  //   no custom svGo chunk. `readEditablePngBytes(flat)` returns
  //   null. File size drops significantly (the editable layer
  //   roughly doubled the bytes).
  ```

  ### `@ingcreators/annot-core/xmp-bytes` — new public surface

  The implementation lives in `@ingcreators/annot-core` as
  `stripPngEditableLayer` — the same chunk-walking helper that
  `writePngWithMetadata` / `writePngWithTagsOnly` already used
  internally to clean stale metadata before re-injecting. Now
  exported so other Tier A consumers (not just annotator) can
  use it directly.

  annotator's `flattenEditablePng` is a one-line wrapper that
  calls `stripPngEditableLayer` under a more user-facing name.

  ### Why this is metadata removal, not re-rasterization

  `toEditablePng` rasterizes the SVG fragment onto the base image
  FIRST and embeds the editable layer as ancillary PNG chunks
  (`iTXt` carrying Adobe XMP + custom `svGo` chunk). The visible
  bytes are already the annotated bitmap. Flattening strips the
  ancillary chunks; the IDAT pixel data stays byte-identical.
  No decode, no re-encode, no `@napi-rs/canvas` round-trip.

  ### Use cases
  - **Publish-flat** — editor session → distribution-ready PNG;
    the editable layer is dead weight for downstream consumers
    (Slack drop, third-party viewers).
  - **File size** — editable PNG roughly doubles in bytes
    (original + SVG embedded); flattening drops the overhead.
  - **Privacy hardening** — `burnRedactions` is the strong
    version for _redact_ regions; flattening drops the
    recoverable original entirely for _all_ annotations,
    including non-redact ones whose annotated visual the
    publisher wants to keep but whose original capture they
    don't want shippable.

  ### Internal rename in annot-core

  The private `removePngMetadata` helper in
  `@ingcreators/annot-core/xmp-bytes` is renamed to
  `stripPngEditableLayer` (clearer name describing what it does
  rather than how it's used). Internal callers in the same
  module updated. No external API change for the rename itself;
  `writePngWithMetadata` + `writePngWithTagsOnly` keep their
  existing signatures + behaviour.

  ### Compatibility

  Additive on annotator + core. No behaviour change for existing
  callers (the only internal rename is a private helper).

- 9697f27: **Export `burnRegions` as an operation-aligned alias for
  `burnRedactions`** — Phase 3k of
  `docs/plans/living-spec-authoring-roadmap.md`
  (Phase 3 follow-up #2). Closes the follow-up.

  `burnRedactions` is named for its first caller's intent (MCP's
  `annot_redact_screenshot`), but the underlying primitive is a
  `pngBytes + region[] → pngBytes` raster transform — generic
  over the caller's purpose. The new export surfaces the
  operation-aligned name alongside the intent-named original.

  ### `@ingcreators/annot-annotator` — new public export

  ```ts
  import { burnRegions } from "@ingcreators/annot-annotator";

  // Identical signature + behaviour to burnRedactions.
  const out = await burnRegions(pngBytes, [
    { bbox: { x: 10, y: 20, width: 100, height: 30 }, style: "mosaic" },
  ]);
  ```

  Identity-equal to `burnRedactions` (`burnRegions === burnRedactions`
  at the export level) — picking one name over the other is purely
  a docs-readability choice.

  ### Use cases that motivated the alias

  The function isn't redact-specific — the JSDoc on `burnRedactions`
  now enumerates:
  - Editor-side "highlight this region with a translucent colour
    and ship it baked" workflow.
  - Visual-regression pre-processing — burn dynamic content
    (timestamps, login state badges) into the screenshot so pixel
    diffs stay deterministic.
  - Watermark / overlay burn for downstream distribution.
  - Privacy hardening at non-redact regions (e.g. blur a logo in
    a publicly-shared screenshot).

  For any of these, `burnRegions` reads as the natural name.
  Redact callers stay on `burnRedactions` (still the recommended
  name when the intent IS redaction); no migration forced.

  ### `@ingcreators/annot-mcp` — no public API change

  MCP's `compare/burn.ts` re-export shim + `index.ts` forward both
  names. Existing `burnRedactions` callers see no change.

  ### Compatibility

  Additive. `burnRedactions` keeps its public API + JSDoc; the
  alias is purely additive.

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
