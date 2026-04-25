// Tier B — undo/redo stack management for any string-snapshot
// model. Pure: no DOM types, no `innerHTML`, no SVG. Decoupled from
// the live editor by accepting two hooks (`getSnapshot`, `setSnapshot`)
// that the caller wires to whichever serialisation surface it owns.
//
// `History` (in `@ingcreators/annot-editor`) is a thin adapter that
// supplies `() => annotations.innerHTML` / `s => annotations.innerHTML = s`,
// preserving the existing browser API. Headless callers (future
// Playwright fixture, batch annotator) can supply their own
// snapshotter and exercise the same logic without a live SVG element.

/**
 * Default ceiling on the undo stack depth. Matches the historical
 * value in `@ingcreators/annot-editor`'s `History` class.
 */
export const DEFAULT_HISTORY_DEPTH = 100;

export interface HistoryHooks {
  /** Read the current snapshot the user can undo TO. Called inside
   *  `save()`. Must return a stable string for deterministic equality
   *  checks (none performed today, but reserved for future "skip
   *  duplicate save" optimisations). */
  getSnapshot: () => string;
  /** Apply a snapshot. Called inside `undo()` / `redo()` when a
   *  restore is about to happen. Should mutate whatever live model
   *  `getSnapshot()` is reading from. */
  setSnapshot: (snapshot: string) => void;
  /** Fired after `setSnapshot` runs — i.e. when the model was actually
   *  mutated by an undo or redo. NOT called by `save()`. The editor
   *  uses this to refresh selection handles and the property panel. */
  onRestore?: () => void;
  /** Fired after every state-changing call (save / undo / redo) where
   *  the stacks were modified. The editor uses this for auto-save. */
  onStateChange?: () => void;
  /** Cap on undo-stack depth. Older snapshots are dropped FIFO once
   *  the cap is exceeded. Defaults to {@link DEFAULT_HISTORY_DEPTH}. */
  maxDepth?: number;
}

export interface HistoryCore {
  /** Push the current snapshot (per `getSnapshot`) onto the undo
   *  stack and clear the redo stack. Always fires `onStateChange`. */
  save(): void;
  /** Restore the previous snapshot. Returns `true` if the model was
   *  actually mutated, `false` if the guard rejected the call (only
   *  the seed snapshot is left). Fires `onRestore` + `onStateChange`
   *  on success. */
  undo(): boolean;
  /** Replay the most recently undone snapshot. Returns `true` if the
   *  model was mutated, `false` if the redo stack was empty. */
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * Build a {@link HistoryCore} bound to the supplied hooks. The first
 * snapshot is captured eagerly inside the constructor — matching the
 * existing browser-side `History` constructor that called
 * `this.save()` to seed the undo stack with the initial state.
 */
export function createHistoryCore(hooks: HistoryHooks): HistoryCore {
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const maxDepth = hooks.maxDepth ?? DEFAULT_HISTORY_DEPTH;

  const fireStateChange = (): void => {
    hooks.onStateChange?.();
  };

  const core: HistoryCore = {
    save(): void {
      undoStack.push(hooks.getSnapshot());
      redoStack.length = 0;
      if (undoStack.length > maxDepth) {
        undoStack.shift();
      }
      fireStateChange();
    },

    undo(): boolean {
      // Same guard as the legacy implementation: the seed snapshot
      // must remain on the undo stack so a subsequent `redo()` can
      // bring the user back to the most-recent edit. `<= 1` rejects
      // the call when only the seed is left.
      if (undoStack.length <= 1) return false;
      const current = undoStack.pop()!;
      redoStack.push(current);
      // Pre-pop length was ≥ 2, so post-pop length is ≥ 1 and the
      // non-null assertion is safe.
      hooks.setSnapshot(undoStack[undoStack.length - 1]!);
      hooks.onRestore?.();
      fireStateChange();
      return true;
    },

    redo(): boolean {
      if (redoStack.length === 0) return false;
      const state = redoStack.pop()!;
      undoStack.push(state);
      hooks.setSnapshot(state);
      hooks.onRestore?.();
      fireStateChange();
      return true;
    },

    get canUndo(): boolean {
      return undoStack.length > 1;
    },
    get canRedo(): boolean {
      return redoStack.length > 0;
    },
  };

  // Seed snapshot. Matches the legacy constructor that called save()
  // immediately so the first user action has something to undo to.
  core.save();
  return core;
}
