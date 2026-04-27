# @ingcreators/annot-render

Data-driven rendering for [Annot](../../README.md). This is **Tier
C-render** — code here may use `<canvas>` and the OOXML DrawingML
builder, but it does **not** participate in a live editor session.

What lives here:

- `renderImageRecord` — turn a stored `ImageRecord` into a bitmap
  (PNG / JPEG). Future home for gallery bulk-export.
- The shared OOXML DrawingML builder (`buildShapeXml`,
  `buildDrawingXml`, `buildBackgroundPic`) used by:
    - **PPTX export** (slide content via `ns: "p"`) in
      [`@ingcreators/annot-editor`](../editor)'s `pptx-export`.
    - **Office clipboard** (Tauri shape-paste via `ns: "a"`) in
      [`@ingcreators/annot-editor`](../editor)'s
      `toolbar.ts:#copyForOffice`.

  Adding a new tool that needs both surfaces means **one
  `transformOf` mapping in
  [`@ingcreators/annot-core/editor/svg-to-annotation-shapes`](../core/src/editor/svg-to-annotation-shapes.ts) +
  one per-shape builder under
  [`./src/drawingml/shapes/`](./src/drawingml/shapes/)** — both
  consumers pick it up automatically.

## Public entry points

| Subpath | Surface |
|---------|---------|
| `@ingcreators/annot-render` | `renderImageRecord` + the DrawingML builder API |
| `@ingcreators/annot-render/<file>` | Per-file deep imports |

## Depends on

- [`@ingcreators/annot-core`](../core) — Tier A + Tier B surface.

**Must NOT depend on [`@ingcreators/annot-editor`](../editor)** —
the split exists so that storage backends and gallery bulk-export
can pull rendering without dragging in the live editor session.
This invariant is CI-enforced by
[`packages/core/src/headless.test.ts`](../core/src/headless.test.ts).

## Build

```bash
pnpm --filter @ingcreators/annot-render build      # vite library build
pnpm --filter @ingcreators/annot-render typecheck  # tsc --noEmit
```

## See also

- [`docs/plans/_done/three-package-split.md`](../../docs/plans/_done/three-package-split.md) — why
  this package exists.
- [`docs/plans/_done/office-paste-shared-drawing-builder.md`](../../docs/plans/_done/office-paste-shared-drawing-builder.md) — how
  the DrawingML builder collapsed two parallel implementations
  (TypeScript + Rust) onto a single shared source of truth.
- [`docs/plans/_done/pptx-export-shared-builder-finish.md`](../../docs/plans/_done/pptx-export-shared-builder-finish.md) — the
  follow-up that completed the migration on the PPTX export side.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
