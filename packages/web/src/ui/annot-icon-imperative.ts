/**
 * Imperative `<annot-icon>` builder re-export shim.
 *
 * `createBuiltinIcon` / `createIcon` moved to
 * `@ingcreators/annot-editor-shell/annot-icon-imperative` in
 * Phase 2b of `docs/plans/_done/vscode-extension-host.md`. This
 * file is a thin re-export so existing `import { createBuiltinIcon }
 * from "../ui/annot-icon-imperative.js"` call sites compile
 * untouched. Phases 2c–2e migrate those call sites onto the
 * canonical import.
 */

export {
  createBuiltinIcon,
  createIcon,
} from "@ingcreators/annot-editor-shell/annot-icon-imperative";
