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
