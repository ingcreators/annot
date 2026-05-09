import { createHistoryCore, type HistoryCore } from "@ingcreators/annot-core/editor/history-core";

/**
 * Browser-side undo/redo wrapper that snapshots an `<g>` annotations
 * element by serialising / restoring its `innerHTML`. The actual
 * stack management (push, pop, depth cap, redo invalidation) lives
 * in `@ingcreators/annot-core/editor/history-core` so it can be unit-
 * tested without a live SVG element.
 */
export class History {
  #core: HistoryCore;

  /** Called after every state change (save/undo/redo). Use for auto-save. */
  onStateChange?: () => void;

  constructor(annotations: SVGGElement, onChange?: () => void) {
    this.#core = createHistoryCore({
      getSnapshot: () => annotations.innerHTML,
      setSnapshot: (snapshot) => {
        annotations.innerHTML = snapshot;
      },
      onRestore: onChange,
      onStateChange: () => this.onStateChange?.(),
    });
  }

  save(): void {
    this.#core.save();
  }

  undo(): void {
    this.#core.undo();
  }

  redo(): void {
    this.#core.redo();
  }

  get canUndo(): boolean {
    return this.#core.canUndo;
  }
  get canRedo(): boolean {
    return this.#core.canRedo;
  }
}
