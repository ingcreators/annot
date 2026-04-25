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
// SelectionManager — pointer-driven selection / handles / drag /
// resize / rotate. Uses `smart-guides` overlays internally.
export { SelectionManager } from "./selection.js";
