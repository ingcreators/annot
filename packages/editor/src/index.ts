// @ingcreators/annot-editor — live-browser editor primitives.
//
// Phase 0 placeholder per `docs/plans/three-package-split.md`.
// The actual editor surface (CanvasManager, SelectionManager,
// PropertyPanel, the tool hierarchy, DOM widgets) lands here in
// Phases 1–8. Until then this entry has nothing to export and
// importing it from web / extension / desktop should be avoided —
// the existing `@ingcreators/annot-core/editor/*` deep imports
// remain the source of truth during the migration.
//
// Lives in the workspace from Phase 0 so:
//   - `pnpm install` resolves the package + runs through CI
//   - `pnpm --filter @ingcreators/annot-editor build` + typecheck
//     are wired and green before any code moves
//   - downstream package.json edits adding the dependency can
//     land alongside the moves they enable

export {};
