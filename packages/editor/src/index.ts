// @ingcreators/annot-editor — live-browser editor primitives.
//
// Phases 1–8 of `docs/plans/three-package-split.md` migrate the
// editor UI surface here from `@ingcreators/annot-core/editor/*`.
// During the migration the entry grows phase by phase; consumers
// that want a specific symbol can import from the deep subpath
// (e.g. `@ingcreators/annot-editor/canvas-context-menu`) when
// the root re-export hasn't been added yet.
//
// **Architectural invariants:**
//
//   1. This package depends on `@ingcreators/annot-core` only.
//      It MUST NOT import from `@ingcreators/annot-web` (the
//      PWA shell) or pull in any host-specific feature flags.
//
//   2. Conversely, `@ingcreators/annot-core` MUST NOT import
//      from this package. The dependency direction is one-way:
//      `annot-editor → annot-core`. The cycle-prevention check
//      in `packages/core/src/headless.test.ts` enforces this at
//      CI time.

export { openCanvasContextMenu } from "./canvas-context-menu.js";
export type { CanvasMenuItem } from "./canvas-context-menu.js";
export { createThemeToggle } from "./theme-toggle.js";
// Tool hierarchy moved in Phase 2. `ToolBase` is the abstract
// pointer-event-driven primitive every concrete tool extends;
// `ToolOptions` is the styled-options contract the toolbar reads
// presets into. Per-tool concrete classes are exposed only
// through their deep subpaths (`./tools/<name>-tool`) — tools
// are typically activated by the toolbar and not imported by
// general-purpose host code.
export { ToolBase } from "./tools/tool-base.js";
export type { ToolOptions } from "./tools/tool-base.js";
// PropertyPanel — full DOM panel construction; see Phase 2 notes
// in `docs/plans/three-package-split.md`.
export { PropertyPanel } from "./property-panel.js";
// CanvasManager — live SVG host (image, annotations group, UI
// overlay, pointer event routing). Keystone editor primitive.
export { CanvasManager } from "./canvas-manager.js";
// History — undo/redo for the canvas's annotation subtree.
// Tracks `<g id="annotations">` innerHTML snapshots.
export { History } from "./history.js";
// CanvasManager-coupled save / copy / download surface. The
// data-driven counterpart `renderImageRecord` lives in
// `@ingcreators/annot-render` so storage backends and gallery
// bulk-export can reach it without pulling in the editor.
export {
  copyAnnotationsAsImage,
  copyAsImage,
  downloadAsImage,
  exportAnnotationsSvgForIdb,
  exportExcelSVG,
  exportSVGString,
  getPngDataUrl,
  saveAsEditableImage,
  saveToFile,
} from "./export.js";
// PowerPoint export. Today coupled to a live `CanvasManager`;
// future ImageRecord-driven refactor migrates it to
// `@ingcreators/annot-render` so bulk-export can build
// multi-slide decks from gallery selections.
export { exportPptx } from "./pptx-export.js";
// SelectionManager — pointer-driven selection / handles / drag /
// resize / rotate. Uses `smart-guides` overlays internally.
export { SelectionManager } from "./selection.js";
// Leaf widgets — used by editor surfaces (PropertyPanel, Toolbar)
// and by external host code (e.g. web's gallery uses `setTooltip`,
// the toolbar's flyouts open via `openAnchoredPopover`).
export { setTooltip, getTooltip } from "./tooltip.js";
export { createCustomSelect } from "./custom-select.js";
export { createColorPalette } from "./color-palette.js";
export { openAnchoredPopover } from "./anchored-popover.js";
