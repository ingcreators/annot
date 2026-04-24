export class History {
  #undoStack: string[] = [];
  #redoStack: string[] = [];
  #annotations: SVGGElement;
  #onChange?: () => void;

  /** Called after every state change (save/undo/redo). Use for auto-save. */
  onStateChange?: () => void;

  constructor(annotations: SVGGElement, onChange?: () => void) {
    this.#annotations = annotations;
    this.#onChange = onChange;
    this.save();
  }

  save(): void {
    this.#undoStack.push(this.#annotations.innerHTML);
    this.#redoStack.length = 0;
    if (this.#undoStack.length > 100) {
      this.#undoStack.shift();
    }
    this.onStateChange?.();
  }

  undo(): void {
    if (this.#undoStack.length <= 1) return;
    const current = this.#undoStack.pop()!;
    this.#redoStack.push(current);
    this.#annotations.innerHTML = this.#undoStack[this.#undoStack.length - 1];
    this.#onChange?.();
    this.onStateChange?.();
  }

  redo(): void {
    if (this.#redoStack.length === 0) return;
    const state = this.#redoStack.pop()!;
    this.#undoStack.push(state);
    this.#annotations.innerHTML = state;
    this.#onChange?.();
    this.onStateChange?.();
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 1;
  }
  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }
}
