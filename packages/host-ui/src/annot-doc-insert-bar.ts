/**
 * `<annot-doc-insert-bar>` — between-block insertion affordance for
 * `<annot-doc-shell>` editing mode.
 *
 * Phase 2 of `docs/plans/annot-html-document-ux-polish.md`.
 *
 * Renders a thin hover zone between blocks (and at the top + bottom
 * of the article). Default state: an 8px tall transparent band with
 * a hairline divider; on hover (or keyboard focus) it grows a "+
 * Insert" affordance. Click → opens the existing
 * `<annot-doc-block-menu>` anchored to this bar; the user picks a
 * block kind and we dispatch an `insert-block` event the shell
 * handles by splicing a new block at `insertAt`.
 *
 * The "type `/` in an empty block" path the slash-menu shipped in
 * Phase 4b stays unchanged — this element is purely additive.
 *
 * Light DOM (Hybrid CSS) following the host-ui convention.
 */

import {
  AnnotDocBlockMenuElement,
  type BlockMenuItem,
  type BlockMenuSelectDetail,
} from "./annot-doc-block-menu.js";
import "./annot-doc-block-menu.js";
import { html, LitElement, type TemplateResult } from "./lit.js";

export interface InsertBlockDetail {
  /** Splice index within `document.blocks` — 0 means "before the
   *  first block", `blocks.length` means "after the last block". */
  insertAt: number;
  /** The user's pick from the block-kind menu. The shell still
   *  owns the `BlockMenuItem` → `Block` materialisation so
   *  image-block insertion can route through the file picker. */
  item: BlockMenuItem;
}

export interface BlockDropAtDetail {
  /** Splice index within `document.blocks` — 0 means "before the
   *  first block", `blocks.length` means "after the last block". */
  insertAt: number;
}

/**
 * The bar itself. Public reactive properties:
 *
 *   - `insertAt: number` — splice index passed back in the
 *     `insert-block` event detail
 *   - `label: string` — visible text shown when the bar is
 *     expanded (default: "Insert")
 */
export class AnnotDocInsertBarElement extends LitElement {
  static override properties = {
    insertAt: { type: Number, attribute: "insert-at" },
    label: { type: String },
    dropTargetActive: { state: true },
  };

  declare insertAt: number;
  declare label: string;
  /** Phase 7 of `annot-html-document-ux-polish.md` — set true
   *  while a block-drag hovers this bar so the CSS can render
   *  the drop indicator (a thicker accent-coloured line). */
  declare dropTargetActive: boolean;

  constructor() {
    super();
    this.insertAt = 0;
    this.label = "Insert";
    this.dropTargetActive = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): TemplateResult {
    const classes = `annot-doc-insert-bar-button${this.dropTargetActive ? " is-drop-target" : ""}`;
    return html`
      <button
        type="button"
        class=${classes}
        aria-label=${`Insert block at position ${this.insertAt + 1}`}
        title="Click to insert a block here"
        @click=${this.#onClick}
        @dragover=${this.#onDragOver}
        @dragenter=${this.#onDragEnter}
        @dragleave=${this.#onDragLeave}
        @drop=${this.#onDrop}
      >
        <span class="annot-doc-insert-bar-rule" aria-hidden="true"></span>
        <span class="annot-doc-insert-bar-label" aria-hidden="true">
          <span class="annot-doc-insert-bar-plus">+</span>
          <span>${this.label}</span>
        </span>
      </button>
    `;
  }

  #onClick = (e: MouseEvent): void => {
    e.stopPropagation();
    const button = e.currentTarget as HTMLElement;
    const menu = AnnotDocBlockMenuElement.openFor(button);
    menu.addEventListener(
      "block-menu-select",
      (selectEvent: Event) => {
        const detail = (selectEvent as CustomEvent<BlockMenuSelectDetail>).detail;
        this.dispatchEvent(
          new CustomEvent<InsertBlockDetail>("insert-block", {
            bubbles: true,
            composed: true,
            detail: { insertAt: this.insertAt, item: detail.item },
          }),
        );
      },
      { once: true },
    );
  };

  // -------------------------------------------------------------------------
  // Phase 7 — drop target for the block drag-and-drop reorder flow
  // -------------------------------------------------------------------------

  #onDragOver = (e: DragEvent): void => {
    // The dragover MUST be `preventDefault`'d for a drop event
    // to fire. We accept any drag whose effectAllowed includes
    // "move" — the shell scopes the actual reorder via its
    // own `#draggedBlockIndex` bookkeeping so non-reorder drags
    // are filtered there.
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  #onDragEnter = (e: DragEvent): void => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    this.dropTargetActive = true;
  };

  #onDragLeave = (_e: DragEvent): void => {
    this.dropTargetActive = false;
  };

  #onDrop = (e: DragEvent): void => {
    e.preventDefault();
    this.dropTargetActive = false;
    this.dispatchEvent(
      new CustomEvent<BlockDropAtDetail>("block-drop-at", {
        bubbles: true,
        composed: true,
        detail: { insertAt: this.insertAt },
      }),
    );
  };
}

if (!customElements.get("annot-doc-insert-bar")) {
  customElements.define("annot-doc-insert-bar", AnnotDocInsertBarElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-insert-bar": AnnotDocInsertBarElement;
  }
}
