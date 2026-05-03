/**
 * `<annot-icon>` re-export shim.
 *
 * The element + `AnnotIconElement` class moved to
 * `@ingcreators/annot-editor-shell/annot-icon` in Phase 2b of
 * `docs/plans/_done/vscode-extension-host.md`. This file is a
 * thin re-export so the many `import "../ui/annot-icon.js"` /
 * `import { AnnotIconElement } from "../ui/annot-icon.js"`
 * call sites across `packages/web/src/` continue to compile
 * untouched. Side-effect of this import is unchanged: the
 * `<annot-icon>` custom element is registered with the
 * `customElements` registry on first import.
 *
 * Phases 2c–2e migrate those call sites onto the canonical
 * `@ingcreators/annot-editor-shell/annot-icon` import; this shim
 * stays until then so the moves can land independently.
 */

export type { AnnotIconElement } from "@ingcreators/annot-editor-shell/annot-icon";
import "@ingcreators/annot-editor-shell/annot-icon";
