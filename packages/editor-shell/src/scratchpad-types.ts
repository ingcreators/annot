/**
 * Scratchpad domain types — shared between the editor-shell-side
 * UI (`annot-scratchpad-section.ts` + `scratchpad-paste-tool.ts`)
 * and the host-side persistence implementation.
 *
 * Phase 2e of `docs/plans/_done/vscode-extension-host.md` —
 * `ScratchpadStore` (the IndexedDB implementation) stays in
 * `packages/web/src/editor/scratchpad-store.ts` per the plan
 * ("the store is host-state"). The popover UI moved here. To
 * avoid an editor-shell → web import edge, this file declares
 * the contract:
 *
 *   - `ScratchpadItem` — the value type. Identical to what web's
 *     `scratchpad-store.ts` historically exported; web's class
 *     re-exports the same name from this module so legacy import
 *     sites compile untouched.
 *   - `ScratchpadStoreLike` — the structural interface the
 *     popover depends on. Web's `ScratchpadStore` class
 *     implements it implicitly (TypeScript's structural typing).
 *     Hosts other than the PWA (the upcoming VSCode extension)
 *     pass any object satisfying the interface.
 */

export interface ScratchpadItem {
  id: string;
  name?: string;
  svgMarkup: string;
  thumbnail: string;
  width: number;
  height: number;
  createdAt: string;
}

/**
 * Structural contract the popover depends on. The host owns the
 * implementation (PWA: `ScratchpadStore` IndexedDB-backed;
 * VSCode: TBD). Methods mirror the existing web-side surface
 * 1:1; if a future host needs more, extend here and update the
 * implementations.
 */
export interface ScratchpadStoreLike {
  save(data: Omit<ScratchpadItem, "id" | "createdAt">): Promise<ScratchpadItem>;
  list(): Promise<ScratchpadItem[]>;
  delete(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
}
