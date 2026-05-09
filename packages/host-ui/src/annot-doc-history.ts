/**
 * `DocumentHistory` — snapshot-based undo/redo for `AnnotDocument`.
 *
 * Phase 4a of `docs/plans/annot-html-document.md`. Documents are
 * small (typical: < 1 MB even with several embedded screenshots),
 * so we snapshot the whole `AnnotDocument` per commit instead of
 * tracking diffs. This is what `History` in `@ingcreators/annot-editor`
 * does on the SVG side and the single-author docs use case is
 * similar enough to keep the same approach.
 *
 * - `push(doc)` adds a snapshot AND clears any redo entries past
 *   the cursor (standard undo-stack semantics).
 * - `undo()` / `redo()` move the cursor and return the document at
 *   the new position, or `null` when at the boundary.
 * - `canUndo()` / `canRedo()` are sync read-only checks for UI
 *   button enable state.
 *
 * The shell wraps this in editor-mode setup; tests below run the
 * class directly because it has no DOM dependency.
 */

import type { AnnotDocument } from "@ingcreators/annot-doc";

const DEFAULT_LIMIT = 200;

export class DocumentHistory {
  #stack: AnnotDocument[];
  #cursor: number;
  #limit: number;

  constructor(initial: AnnotDocument, opts: { limit?: number } = {}) {
    this.#stack = [initial];
    this.#cursor = 0;
    this.#limit = opts.limit ?? DEFAULT_LIMIT;
  }

  /** Push a new snapshot. Truncates the redo tail. No-op if the
   *  doc is `===` to the current snapshot (caller spammed
   *  identical pushes). */
  push(doc: AnnotDocument): void {
    if (doc === this.current()) return;
    // Drop any redo tail past the cursor.
    if (this.#cursor < this.#stack.length - 1) {
      this.#stack = this.#stack.slice(0, this.#cursor + 1);
    }
    this.#stack.push(doc);
    this.#cursor++;
    // Trim from the head if we exceed the limit.
    while (this.#stack.length > this.#limit) {
      this.#stack.shift();
      this.#cursor--;
    }
  }

  undo(): AnnotDocument | null {
    if (this.#cursor === 0) return null;
    this.#cursor--;
    return this.#stack[this.#cursor] ?? null;
  }

  redo(): AnnotDocument | null {
    if (this.#cursor >= this.#stack.length - 1) return null;
    this.#cursor++;
    return this.#stack[this.#cursor] ?? null;
  }

  canUndo(): boolean {
    return this.#cursor > 0;
  }

  canRedo(): boolean {
    return this.#cursor < this.#stack.length - 1;
  }

  current(): AnnotDocument {
    const doc = this.#stack[this.#cursor];
    if (!doc) throw new Error("DocumentHistory invariant: cursor out of range");
    return doc;
  }

  /** Replace the current snapshot in place WITHOUT pushing. Useful
   *  for coalescing live typing — the editor can call this while
   *  the user is mid-stroke, then `push` only on commit boundaries
   *  (block-level mutations, blur, undo). */
  replaceCurrent(doc: AnnotDocument): void {
    this.#stack[this.#cursor] = doc;
  }

  size(): number {
    return this.#stack.length;
  }

  cursor(): number {
    return this.#cursor;
  }
}
