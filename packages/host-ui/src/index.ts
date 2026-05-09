// @ingcreators/annot-host-ui — host-neutral editor surface.
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
export { installKeyboardHelp } from "./keyboard-help.js";
export type { UISection, UISectionContext, UISectionLifecycle } from "./ui-section.js";
export type { AnnotIconElement } from "./annot-icon.js";
export { createBuiltinIcon, createIcon } from "./annot-icon-imperative.js";
import "./annot-icon.js";
export type { AnnotTagEditorElement } from "./annot-tag-editor.js";
import "./annot-tag-editor.js";
export {
  type AnnotFileDetailsDrawerElement,
  BUILTIN_DRAWER_SECTION_IDS,
  estimateDataUrlBytes,
  type FileDetailsData,
  type LastCommitInfo,
  validateFilename,
} from "./annot-file-details-drawer.js";
import "./annot-file-details-drawer.js";
export type { ScratchpadItem, ScratchpadStoreLike } from "./scratchpad-types.js";
export type { AnnotScratchpadSectionElement } from "./annot-scratchpad-section.js";
import "./annot-scratchpad-section.js";
export { ScratchpadPasteTool } from "./scratchpad-paste-tool.js";
export {
  type SerializedSelection,
  parseStoredItem,
  renderThumbnail,
  serializeSelection,
} from "./scratchpad-utils.js";
export {
  type AnnotEditorStatusbarElement,
  ZOOM_OPTIONS,
} from "./editor-statusbar.js";
import "./editor-statusbar.js";
export type {
  AnnotApplyRedactionsButtonElement,
  ApplyRedactionsAppliedDetail,
} from "./annot-apply-redactions-button.js";
import "./annot-apply-redactions-button.js";
