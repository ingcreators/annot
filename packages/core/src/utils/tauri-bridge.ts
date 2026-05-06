/**
 * @deprecated Use `@ingcreators/annot-core/desktop-bridge`.
 *
 * Re-export shim for one PR cycle (Phase 5 of
 * `docs/plans/desktop-electron-migration.md`). The canonical
 * symbols + types live in `./desktop-bridge.ts`; this file exists
 * only so call sites importing
 * `@ingcreators/annot-core/tauri-bridge` keep working without a
 * mass rename in the Phase 5 cutover. Phase 9 of the migration
 * deletes this file.
 *
 * The detection global flipped: the new `isDesktop` (and its
 * `isTauri` alias re-exported here) returns true under either
 * Electron (`__ANNOT_DESKTOP__`) or Tauri (`__TAURI_INTERNALS__`),
 * so `if (isTauri)` predicates fire correctly under both hosts
 * without any call-site change.
 */

export * from "./desktop-bridge.js";
