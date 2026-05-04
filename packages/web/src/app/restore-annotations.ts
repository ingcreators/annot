/**
 * Compatibility re-export — `restoreAnnotations` now lives in the
 * host-neutral editor-shell package. The PWA's `EditorSession` still
 * imports from this path while Phase 4 of
 * `docs/plans/editor-session-shell-switchover.md` migrates the boot
 * path through `EditorShell.mountFromRecord` (which calls
 * `restoreAnnotations` itself). Phase 5 deletes this shim once the
 * direct call site goes away.
 */

export { restoreAnnotations } from "@ingcreators/annot-editor-shell/restore-annotations";
