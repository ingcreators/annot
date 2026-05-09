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

export { openAnchoredPopover } from "./anchored-popover.js";
export type { CanvasMenuItem } from "./canvas-context-menu.js";
export { openCanvasContextMenu } from "./canvas-context-menu.js";
// CanvasManager — live SVG host (image, annotations group, UI
// overlay, pointer event routing). Keystone editor primitive.
export { CanvasManager } from "./canvas-manager.js";
export { createColorPalette } from "./color-palette.js";
export { createCustomSelect } from "./custom-select.js";
// CanvasManager-coupled save / copy / download surface. The
// data-driven counterpart `renderImageRecord` lives in
// `@ingcreators/annot-render` so storage backends and gallery
// bulk-export can reach it without pulling in the editor.
export {
  copyAsImage,
  downloadAsImage,
  exportAnnotationsSvgForIdb,
  exportSVGString,
  getPngDataUrl,
  saveToFile,
} from "./export.js";
// History — undo/redo for the canvas's annotation subtree.
// Tracks `<g id="annotations">` innerHTML snapshots.
export { History } from "./history.js";
// PowerPoint export. Today coupled to a live `CanvasManager`;
// future ImageRecord-driven refactor migrates it to
// `@ingcreators/annot-render` so bulk-export can build
// multi-slide decks from gallery selections.
export { exportPptx } from "./pptx-export.js";
// PropertyPanel — full DOM panel construction; see Phase 2 notes
// in `docs/plans/three-package-split.md`.
export { PropertyPanel } from "./property-panel.js";
// SelectionManager — pointer-driven selection / handles / drag /
// resize / rotate. Uses `smart-guides` overlays internally.
export { SelectionManager } from "./selection.js";
export type {
  ThemeMode,
  ThemeOverrides,
  ThemeTokenName,
  ThemeTokenSection,
} from "./theme-overrides.js";
// Theme persistence + user-driven token overrides. Boot once with
// `applyPersistedTheme()`; runtime customisation via
// `setThemeOverrides({ accent: "#ff00aa" })`. See
// `docs/design-system.md` for the full token reference.
export {
  applyPersistedTheme,
  clearThemeOverrides,
  getThemeOverrides,
  persistThemeChoice,
  setThemeOverrides,
  THEME_OVERRIDES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_SECTIONS,
} from "./theme-overrides.js";
export { createThemeToggle } from "./theme-toggle.js";
export type { ToolOptions } from "./tools/tool-base.js";
// Tool hierarchy moved in Phase 2. `ToolBase` is the abstract
// pointer-event-driven primitive every concrete tool extends;
// `ToolOptions` is the styled-options contract the toolbar reads
// presets into. Per-tool concrete classes are exposed only
// through their deep subpaths (`./tools/<name>-tool`) — tools
// are typically activated by the toolbar and not imported by
// general-purpose host code.
export { ToolBase } from "./tools/tool-base.js";
// Leaf widgets — used by editor surfaces (PropertyPanel, Toolbar)
// and by external host code (e.g. web's gallery uses `setTooltip`,
// the toolbar's flyouts open via `openAnchoredPopover`).
export { getTooltip, setTooltip } from "./tooltip.js";
