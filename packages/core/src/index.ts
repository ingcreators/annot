// @ingcreators/annot-core — root entry, **headless by construction**.
//
// As of Stage 4-4/4-5 of `docs/plans/pre-release-cleanup.md`, the
// root barrel re-exports ONLY the DOM-free public surface — the
// same symbols that live in `./headless.ts`. Browser-side
// consumers (PWA, extension, desktop) reach the editor UI,
// XMP, and Tauri-bridge symbols through their respective
// subpaths:
//
//   - `@ingcreators/annot-core/editor`        — CanvasManager, Toolbar,
//                                                PropertyPanel, SelectionManager,
//                                                History, ToolBase, the
//                                                `export*Svg*` / `copy*` /
//                                                `save*` / `download*` /
//                                                `getPng*` / `render*`
//                                                helpers, theme toggle,
//                                                anchored popover, icon
//                                                catalogues.
//   - `@ingcreators/annot-core/xmp`           — createEditableImage /
//                                                readEditableImage round-trip.
//   - `@ingcreators/annot-core/tauri-bridge`  — Tauri IPC + isTauri detection.
//
// This split lets the future `@ingcreators/annot-annotator` headless
// library, the Playwright fixture, and the GitHub Action import
// `@ingcreators/annot-core` confident that nothing in the module
// graph reaches for `document` / `window`. The contract is
// continuously enforced by `headless.test.ts`.

export * from "./headless.js";
