# @ingcreators/annot-annotator

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
