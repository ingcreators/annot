/**
 * `<annot-tag-editor>` — compact key:value chip editor used by the
 * file-details drawer's Tags section.
 *
 * The element renders a row of chips plus an "+ Tag" button; clicking
 * the button reveals an inline key/value input row that submits on
 * Enter / OK and dismisses on Escape / Cancel.
 *
 * Lit completion Phase 1 — replaces the imperative
 * `TagEditor` class. The host now consumes the element directly via
 * `.tags = …` and listens for the `annot-tag-change` CustomEvent
 * instead of attaching an `onTagsChange` callback to a class
 * instance. Light DOM (Hybrid CSS per CLAUDE.md) keeps the existing
 * `.tag-editor` / `.tag-chip` / `.tag-input-row` rules in
 * `editor.css` matching unchanged.
 *
 * The DOM structure preserves the pre-Lit shape so that the
 * `.tag-input-row` popover (`position: absolute; bottom: 100%`)
 * positions relative to the same ancestor it always did:
 *
 *   <annot-tag-editor>
 *     <div class="tag-editor">
 *       <div class="tag-chips">…chips…</div>
 *       <button class="tag-add-btn">+ Tag</button>
 *     </div>
 *     <!-- when adding: -->
 *     <div class="tag-input-row">…</div>
 *   </annot-tag-editor>
 */

import { html, LitElement, nothing } from "./lit.js";

export class AnnotTagEditorElement extends LitElement {
  static override properties = {
    tags: { attribute: false },
    adding: { state: true },
    pendingKey: { state: true },
    pendingValue: { state: true },
  };

  declare tags: Record<string, string>;
  declare adding: boolean;
  declare pendingKey: string;
  declare pendingValue: string;

  constructor() {
    super();
    this.tags = {};
    this.adding = false;
    this.pendingKey = "";
    this.pendingValue = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <div class="tag-editor">
        <div class="tag-chips">
          ${Object.entries(this.tags).map(
            ([key, value]) => html`
              <span class="tag-chip">
                <span class="tag-chip-label">${key}: ${value}</span>
                <button
                  type="button"
                  class="tag-chip-delete"
                  data-tooltip=${`Remove ${key}`}
                  aria-label=${`Remove ${key}`}
                  @click=${(e: Event) => this.#onRemoveTag(e, key)}
                >
                  &#x00d7;
                </button>
              </span>
            `,
          )}
        </div>
        <button
          type="button"
          class="tag-add-btn"
          data-tooltip="Add tag"
          aria-label="Add tag"
          @click=${this.#onShowAddInput}
        >
          + Tag
        </button>
      </div>
      ${this.adding ? this.#renderInputRow() : nothing}
    `;
  }

  #renderInputRow() {
    return html`
      <div class="tag-input-row">
        <input
          type="text"
          placeholder="key"
          class="tag-input tag-input-key"
          .value=${this.pendingKey}
          @input=${(e: Event) => {
            this.pendingKey = (e.currentTarget as HTMLInputElement).value;
          }}
          @keydown=${this.#onInputKeydown}
        />
        <input
          type="text"
          placeholder="value"
          class="tag-input tag-input-value"
          .value=${this.pendingValue}
          @input=${(e: Event) => {
            this.pendingValue = (e.currentTarget as HTMLInputElement).value;
          }}
          @keydown=${this.#onInputKeydown}
        />
        <button
          type="button"
          class="tag-ok-btn"
          data-tooltip="Add"
          aria-label="Add"
          @click=${this.#commitAdd}
        >
          &#x2713;
        </button>
        <button
          type="button"
          class="tag-cancel-btn"
          data-tooltip="Cancel"
          aria-label="Cancel"
          @click=${this.#cancelAdd}
        >
          &#x00d7;
        </button>
      </div>
    `;
  }

  protected override updated(changed: Map<string, unknown>): void {
    // Focus the key input the first frame the input row appears.
    // Done here rather than in render() because Lit applies the
    // template before this hook runs.
    if (changed.has("adding") && this.adding) {
      const keyEl = this.querySelector<HTMLInputElement>(".tag-input-key");
      keyEl?.focus();
    }
  }

  #onShowAddInput = (e: Event): void => {
    e.stopPropagation();
    this.pendingKey = "";
    this.pendingValue = "";
    this.adding = true;
  };

  #commitAdd = (): void => {
    const k = this.pendingKey.trim();
    const v = this.pendingValue.trim();
    if (k) {
      const next = { ...this.tags, [k]: v };
      this.tags = next;
      this.#emitChange(next);
    }
    this.adding = false;
  };

  #cancelAdd = (): void => {
    this.adding = false;
  };

  #onInputKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.#commitAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.#cancelAdd();
    }
  };

  #onRemoveTag = (e: Event, key: string): void => {
    e.stopPropagation();
    const next = { ...this.tags };
    delete next[key];
    this.tags = next;
    this.#emitChange(next);
  };

  #emitChange(tags: Record<string, string>): void {
    this.dispatchEvent(
      new CustomEvent<{ tags: Record<string, string> }>("annot-tag-change", {
        detail: { tags: { ...tags } },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("annot-tag-editor")) {
  customElements.define("annot-tag-editor", AnnotTagEditorElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-tag-editor": AnnotTagEditorElement;
  }
  interface HTMLElementEventMap {
    "annot-tag-change": CustomEvent<{ tags: Record<string, string> }>;
  }
}
