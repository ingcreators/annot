/**
 * `<annot-doc-block-toolbar>` — floating control row for a block
 * inside `<annot-doc-shell>` when in editing mode.
 *
 * Phases of `docs/plans/annot-html-document.md`:
 * - Phase 4a landed delete / move-up / move-down.
 * - Phase 4b (this file's update) adds insert-above /
 *   insert-below buttons + the slash menu's discoverable
 *   "+" affordance for empty paragraphs.
 *
 * Light DOM (Hybrid CSS) following the host-ui convention. The
 * shell positions the toolbar relative to its block; this
 * component is purely presentational + dispatches a
 * `block-action` CustomEvent on click.
 */

import { html, LitElement, type TemplateResult } from "./lit.js";

export type BlockToolbarAction =
  | "delete"
  | "moveUp"
  | "moveDown"
  | "insertAbove"
  | "insertBelow"
  | "insertImage";

export interface BlockToolbarActionDetail {
  action: BlockToolbarAction;
}

export class AnnotDocBlockToolbarElement extends LitElement {
  static override properties = {
    canMoveUp: { type: Boolean, attribute: "can-move-up" },
    canMoveDown: { type: Boolean, attribute: "can-move-down" },
  };

  declare canMoveUp: boolean;
  declare canMoveDown: boolean;

  constructor() {
    super();
    this.canMoveUp = true;
    this.canMoveDown = true;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): TemplateResult {
    // Image-frame SVG glyph for the "Insert image" affordance.
    // Inline so the toolbar stays self-contained — no
    // `<annot-icon>` registry round-trip needed for a single
    // glyph, and the SVG paints with `currentColor` so it
    // inherits the toolbar button's text colour automatically.
    const imageIcon = html`<svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5"/>
      <circle cx="6" cy="7" r="1" fill="currentColor"/>
      <path d="M14 11 L10 8 L5 13"/>
    </svg>`;

    return html`
      <div class="annot-doc-block-toolbar" role="toolbar" aria-label="Block actions">
        <button
          type="button"
          class="block-action"
          aria-label="Insert block above"
          title="Insert empty block above"
          @click=${() => this.#dispatch("insertAbove")}
        >
          ⤴
        </button>
        <button
          type="button"
          class="block-action"
          aria-label="Insert block below"
          title="Insert empty block below"
          @click=${() => this.#dispatch("insertBelow")}
        >
          ⤵
        </button>
        <button
          type="button"
          class="block-action block-action-image"
          aria-label="Insert image below"
          title="Insert image below (or paste / drop one anywhere)"
          @click=${() => this.#dispatch("insertImage")}
        >
          ${imageIcon}
        </button>
        <button
          type="button"
          class="block-action"
          aria-label="Move up"
          title="Move up"
          ?disabled=${!this.canMoveUp}
          @click=${() => this.#dispatch("moveUp")}
        >
          ↑
        </button>
        <button
          type="button"
          class="block-action"
          aria-label="Move down"
          title="Move down"
          ?disabled=${!this.canMoveDown}
          @click=${() => this.#dispatch("moveDown")}
        >
          ↓
        </button>
        <button
          type="button"
          class="block-action block-action-danger"
          aria-label="Delete block"
          title="Delete block"
          @click=${() => this.#dispatch("delete")}
        >
          ×
        </button>
      </div>
    `;
  }

  #dispatch(action: BlockToolbarAction): void {
    this.dispatchEvent(
      new CustomEvent<BlockToolbarActionDetail>("block-action", {
        bubbles: true,
        composed: true,
        detail: { action },
      }),
    );
  }
}

customElements.define("annot-doc-block-toolbar", AnnotDocBlockToolbarElement);

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-block-toolbar": AnnotDocBlockToolbarElement;
  }
}
