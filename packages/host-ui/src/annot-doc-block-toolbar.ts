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

export type BlockToolbarAction = "delete" | "moveUp" | "moveDown" | "insertAbove" | "insertBelow";

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
    return html`
      <div class="annot-doc-block-toolbar" role="toolbar" aria-label="Block actions">
        <button
          type="button"
          class="block-action"
          aria-label="Insert block above"
          title="Insert above"
          @click=${() => this.#dispatch("insertAbove")}
        >
          ⤴
        </button>
        <button
          type="button"
          class="block-action"
          aria-label="Insert block below"
          title="Insert below"
          @click=${() => this.#dispatch("insertBelow")}
        >
          ⤵
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
