# Annot SVG annotation format

> **Status:** Draft. Version **1** is the current shipping format but
> it has not yet had a schema freeze event; the attribute vocabulary
> listed below is descriptive of what the code emits today, not a
> prescriptive spec. Treat this file as the canonical reference as we
> lock it down.

This document describes the SVG representation Annot uses for its
annotation layer — the shape that flows between the editor, the
storage layer, and (eventually) the headless annotator + GitHub
collaboration path. Keeping this format portable is what lets the
product expand beyond a single UI; see
[`PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) for why.

## Overview

An Annot annotation document is a standard SVG whose content is
**self-contained enough to round-trip through copy-paste, filesystem
storage, and git**. The document carries:

- The base screenshot as an `<image>` with the original pixel data
  embedded (or referenced — see below).
- One `<g id="annotations">` group holding every annotation.
- Optional `<defs>` entries for shared gradients, markers, filters.
- Metadata attributes on the root `<svg>` identifying the format
  version and capture context.

Round-tripping goal: read → edit in any Annot host → write should
produce a byte-identical (modulo cosmetic whitespace) SVG if no
annotation changes were made.

## Root element attributes

```xml
<svg
  xmlns="http://www.w3.org/2000/svg"
  data-annot-version="1"
  viewBox="0 0 1280 720"
  width="1280" height="720">
  …
</svg>
```

| Attribute            | Required | Purpose                                        |
|----------------------|----------|------------------------------------------------|
| `data-annot-version` | **Yes**  | Integer, current `1`. Consumers validate and migrate. |
| `viewBox`            | Yes      | Screenshot dimensions in CSS pixels.            |
| `width` / `height`   | Yes      | Match `viewBox` (simplifies host layout).       |

**Missing `data-annot-version`** is treated as version `0` — the
pre-versioning format. Readers attempt best-effort parsing and, on
next save, stamp the current version.

## Top-level structure

```xml
<svg data-annot-version="1" …>
  <defs>
    <!-- Arrow markers, gradient stops, etc. -->
  </defs>

  <image href="data:image/png;base64,…" width="1280" height="720"/>

  <g id="annotations">
    <!-- One or more annotation elements, ordered by paint depth. -->
  </g>
</svg>
```

Paint order inside `#annotations` is authoritative: later children
render on top. This order is what z-order commands (Bring to front,
Send backward, …) manipulate.

## Annotation element vocabulary

Each annotation is a direct child of `#annotations`. Element choice
follows SVG conventions; Annot-specific metadata lives in `data-*`
attributes.

### Shapes

| Tool      | Tag         | Key `data-*` attributes                              |
|-----------|-------------|------------------------------------------------------|
| Rectangle | `<rect>`    | — (plain rect)                                       |
| Rounded   | `<rect>`    | `data-rounded="true"`, `rx` auto-sized               |
| Ellipse   | `<ellipse>` | —                                                    |
| Highlight | `<rect>`    | `data-highlight="1"`, semi-transparent fill, no stroke |

### Lines / arrows

Emitted as `<path data-type="arrow">` carrying:

- `data-x1`, `data-y1`, `data-x2`, `data-y2` — geometric endpoints
- `data-arrow-start-shape`, `-width`, `-length`
- `data-arrow-end-shape`, `-width`, `-length`
- `d` — composed stem + head subpaths

See `packages/core/src/editor/arrow-markers.ts` for the shape set.

### Text / sticky / callout

`<g data-type="textbox">` wrapping `<rect>` (background) + `<text>`.
Variant selected by:

- `data-variant="plain"` — no bg
- `data-variant="sticky"` — opaque bg
- `data-variant="callout"` — bg + pointer tail

### Counter (numbered marker)

`<g data-marker="N" data-shape="circle|rect|rounded">` wrapping a
filled shape + a `<text>` with the number.

### Freehand / draw

`<g data-type="freehand">` with one or more `<path>` children, one
per stroke inside the draw session. Pen vs highlighter distinguished
by stroke width and opacity.

### Redact

Three variants:
- `<rect data-redact-style="solid">` — opaque cover
- `<image data-redact-style="mosaic">` — baked pixelated tile
- `<image data-redact-style="blur">` — baked gaussian-blurred region

### Group

`<g data-type="group">` wrapping other annotation elements. Created
by Ctrl+G. Ungroup flattens back to siblings of the group's parent.

## Transform attributes

Annotations may carry `transform="translate(tx, ty) rotate(deg)"`.
For paint groups (freehand, arrow, markers), per-element drift is
tracked via `data-tx` / `data-ty` so the PPTX exporter can bake
offsets that aren't part of the shape's raw geometry.

Flipping is recorded as:

- `data-flip-h="1"` / `data-flip-v="1"` on most shapes
- On lines / arrows, flips are **baked into the endpoint coordinates**
  directly (see `toggleFlip` in `transform-utils.ts`) because
  `transform` would rotate the arrowhead incorrectly.

## Metadata extension points

Two extension surfaces that are part of the contract:

### 1. `PageMetadata` (DOM elements from capture)

Stored **alongside** the SVG in the storage record, not inside the
SVG itself. See `PageMetadata` / `PageElement` in
`packages/core/src/storage/types.ts`.

This is the bridge to the future Playwright integration — locators
will be synthesized from / mapped to these records.

### 2. XMP (editable image round-trip)

For PNG export, Annot uses XMP metadata to embed the original SVG
inside the PNG via `createEditableImage()` in
`packages/core/src/xmp/xmp-browser.ts`. Reading such a PNG back
reconstructs the editable SVG.

## Version history

### Version 1 (2026-04, current)

Initial versioned format. Content described above. Implicitly
covers everything written by Annot as of April 2026.

### Version 0 (pre-versioning)

SVG documents written by Annot before `data-annot-version` was
introduced. Same structure as v1 minus the version attribute.
Readers treat missing attribute as v0 and re-stamp on save.

## Open questions (track here before the schema freeze)

- [ ] Should `PageMetadata` be embeddable inside the SVG as a
      `<metadata>` element for single-file portability? Trades file
      size against simplicity of the storage contract.
- [ ] Namespacing: do we want `xmlns:annot="https://annot.dev/ns"`
      and `<annot:*>` elements instead of `data-*` attributes? More
      principled but harder for downstream tools that assume plain
      SVG.
- [ ] `<filter>` definitions for drop-shadow / glow are inlined into
      each use — dedup into `<defs>`?

## See also

- [`PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) — why this format
  needs to stay portable.
- [`CLAUDE.md`](../CLAUDE.md) — operational checklist that enforces
  schema-break discipline.
- `packages/core/src/editor/` — source of truth for the writer code.
