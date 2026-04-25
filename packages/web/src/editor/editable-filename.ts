/**
 * `<annot-editable-filename>` — display-and-edit filename row.
 *
 * Single-click leaves the value selectable (so users can copy);
 * double-click swaps the span for an input. Enter / blur commit
 * the edit; Escape cancels. Invalid characters surface an inline
 * error message.
 *
 * Lit Phase 4 — extracted out of `HeaderHost`'s inline-rename
 * machinery so the same component can serve both the editor
 * header breadcrumb and the drawer's "Name" row in the future.
 * The drawer currently has its own inline-edit input on the file
 * section; consolidating the two is a follow-up beyond this PR.
 */

import { html, LitElement, nothing } from "../lit.js";
import { validateFilename } from "./file-details-drawer-types.js";

export class AnnotEditableFilenameElement extends LitElement {
  static override properties = {
    filename: { type: String },
    /** Optional tooltip text shown in the read-only state. The
     *  edit-mode input has its own fixed tooltip about the
     *  Enter / Esc keybinds. */
    tooltip: { type: String },
    /** Async commit callback. Reject with an `Error` whose
     *  `message` populates the inline error label. The element
     *  re-enables itself after the promise settles. */
    onCommit: { attribute: false },
    editing: { state: true },
    error: { state: true },
    disabled: { state: true },
  };

  declare filename: string;
  declare tooltip: string;
  declare onCommit: ((newName: string) => Promise<void>) | null;
  declare editing: boolean;
  declare error: string;
  declare disabled: boolean;

  constructor() {
    super();
    this.filename = "";
    this.tooltip = "";
    this.onCommit = null;
    this.editing = false;
    this.error = "";
    this.disabled = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    if (this.editing) return this.#renderInput();
    return html`
      <span
        class="breadcrumb-item breadcrumb-filename active"
        data-tooltip=${this.tooltip || "Double-click to rename"}
        aria-label=${this.tooltip || "Double-click to rename"}
        @dblclick=${this.#enterEditMode}
        >${this.filename}</span
      >
    `;
  }

  #renderInput() {
    return html`
      <input
        type="text"
        class="breadcrumb-filename-input"
        .value=${this.filename}
        spellcheck="false"
        autocomplete="off"
        aria-label="File name, editable"
        ?disabled=${this.disabled}
        @keydown=${this.#onKeydown}
        @blur=${this.#onBlur}
      />
      ${this.error
        ? html`<div class="breadcrumb-filename-error" aria-live="polite">${this.error}</div>`
        : nothing}
    `;
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("editing") && this.editing) {
      const input = this.querySelector<HTMLInputElement>(".breadcrumb-filename-input");
      if (input) {
        input.focus();
        const dot = input.value.lastIndexOf(".");
        // Defer so the browser's default all-select doesn't
        // override our base-name range.
        setTimeout(() => {
          input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
        }, 0);
      }
    }
  }

  #enterEditMode = (): void => {
    this.error = "";
    this.editing = true;
  };

  #onKeydown = (e: KeyboardEvent): void => {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur(); // triggers commit via blur listener
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = this.filename;
      this.error = "";
      this.editing = false;
    }
  };

  #onBlur = (e: FocusEvent): void => {
    void this.#commit(e.currentTarget as HTMLInputElement);
  };

  async #commit(input: HTMLInputElement): Promise<void> {
    const next = input.value.trim();
    const original = this.filename;
    if (!next || next === original) {
      this.editing = false;
      this.error = "";
      return;
    }
    const err = validateFilename(next);
    if (err) {
      this.error = err;
      input.focus();
      return;
    }
    try {
      this.disabled = true;
      this.error = "";
      await this.onCommit?.(next);
      // The host should reassign `.filename` to the final
      // (possibly uniquified) name in its rename callback. Exit
      // edit mode regardless so the new value renders read-only.
      this.editing = false;
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Rename failed";
      this.error = msg;
    } finally {
      this.disabled = false;
    }
  }
}

if (!customElements.get("annot-editable-filename")) {
  customElements.define("annot-editable-filename", AnnotEditableFilenameElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-editable-filename": AnnotEditableFilenameElement;
  }
}
