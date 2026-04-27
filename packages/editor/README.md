# @ingcreators/annot-editor

Live-browser editor primitives for [Annot](../../README.md). This is
**Tier C** in the project's three-tier model — code here may freely
use `document`, `window`, pointer events, `ResizeObserver`,
`MutationObserver`, and `<canvas>`.

What lives here:

- `CanvasManager` — the live SVG editing session.
- `SelectionManager` — bounding box, transform handles, arrow
  endpoint logic, callout tail rebuild.
- `PropertyPanel` — schema-driven right-side property editor
  (registry definitions live in
  [`@ingcreators/annot-core/editor`](../core)).
- The tool hierarchy (`ToolBase` + concrete tools — freehand,
  shape, arrow, text, redact, marker, …).
- `History` (undo/redo).
- Save / copy / download helpers (`saveToFile`, `getPngDataUrl`,
  `copyAsImage`, `saveAsEditableImage`, `exportSVGString`,
  `exportPptx`, `downloadAsImage`).
- Leaf widgets: tooltip, theme toggle, custom-select,
  anchored-popover, color-palette, canvas-context-menu.
- `pptx-export` (PPTX file output) and the CanvasManager-coupled
  side of `export.ts`.

## Public entry points

| Subpath | Surface |
|---------|---------|
| `@ingcreators/annot-editor` | The grouped public API (CanvasManager, SelectionManager, PropertyPanel, tool factories, save/copy/download helpers, leaf widgets) |
| `@ingcreators/annot-editor/<file>` | Per-file deep imports for editor internals (`tools/freehand-tool`, `property-panel`, etc.) — use sparingly |

## Depends on

- [`@ingcreators/annot-core`](../core) — Tier A + Tier B surface.
- [`@ingcreators/annot-render`](../render) — for the OOXML
  DrawingML builder used by `pptx-export`.

**Must not depend on `@ingcreators/annot-render` ↔ this is a
one-way arrow** (render → core only). And `annot-core` must not
depend on this package — both invariants are CI-enforced by
[`packages/core/src/headless.test.ts`](../core/src/headless.test.ts).

## Build

```bash
pnpm --filter @ingcreators/annot-editor build      # vite library build
pnpm --filter @ingcreators/annot-editor typecheck  # tsc --noEmit
```

## See also

- [`docs/plans/_done/three-package-split.md`](../../docs/plans/_done/three-package-split.md) — the
  rationale for splitting the editor out of `annot-core`.
- [`CLAUDE.md`](../../CLAUDE.md) — Tier model and rules for where new code belongs.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
