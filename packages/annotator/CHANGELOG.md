# @ingcreators/annot-annotator

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
