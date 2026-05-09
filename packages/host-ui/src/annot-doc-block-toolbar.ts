/**
 * `<annot-doc-block-toolbar>` — floating control row for a block
 * inside `<annot-doc-shell>` when in editing mode.
 *
 * Phase 4a of `docs/plans/annot-html-document.md`. Buttons:
 * delete, move up, move down. Insert above / insert below land
 * in Phase 4b together with the slash menu (block-kind picker)
 * since "insert paragraph" alone — the only kind reachable
 * without a kind picker — is too narrow to ship in isolation.
 *
 * Light DOM (Hybrid CSS) following the host-ui convention. The
 * shell positions the toolbar relative to its block; this
 * component is purely presentational + dispatches a
 * `block-action` CustomEvent on click.
 */

import { html, LitElement, type TemplateResult } from "./lit.js";

export type BlockToolbarAction = "delete" | "moveUp" | "moveDown";

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
