// @ingcreators/annot-editor-shell — host-neutral editor surface.
//
// Phase 1 of `docs/plans/_done/vscode-extension-host.md` scaffolds
// this package; subsequent phases move toolbar / right-panel /
// drawer / scratchpad / keyboard-help out of `packages/web/src/`
// and into here, with `packages/web` consuming the shell as the
// regression-proof first user.
//
// **Architectural invariants:**
//
//   1. This package depends on `@ingcreators/annot-core` and
//      `@ingcreators/annot-editor` only. It MUST NOT import from
//      `@ingcreators/annot-web` (the PWA shell) or any host-
//      specific glue (router-host, capture-host, etc.).
//
//   2. The shell mounts into a host-supplied `HTMLElement` and
//      reaches storage through a host-supplied `StorageProvider`.
//      It MUST NOT call `document.getElementById("svg-root")` /
//      `"canvas-container"` / `"statusbar"` / `"file-manager"` or
//      any other PWA-shell DOM id; those couplings are the whole
//      reason the package exists.

export { EditorShell } from "./editor-shell.js";
export type {
  EditorShellEvent,
  EditorShellEventHandler,
  EditorShellFeatures,
  EditorShellHost,
} from "./editor-shell.js";
