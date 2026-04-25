/**
 * `<annot-save-menu>` — dropdown menu opened by the save split-
 * button's caret. Lists the export-format options ("Download
 * SVG", "Download PNG (re-editable)", "Download PPTX", etc.).
 *
 * Lit Phase 5c — replaces the imperative menu-construction
 * closure inside `Toolbar.#showSaveMenu`. The menu's positioning
 * (fixed, anchored to the caret button) + outside-click
 * dismissal stay with the orchestrator that mounts the element;
 * the element itself is purely presentational + dispatches a
 * `menu-select` `CustomEvent` when an item is clicked.
 */

import { html, LitElement } from "../lit.js";

export interface SaveMenuItem {
  /** Identifier passed back in the `menu-select` event detail
   *  (e.g. "svg", "jpg-editable", "png-editable", "pptx"). */
  id: string;
  /** Visible row label ("Download SVG"). */
  label: string;
  /** Tooltip / sub-description ("Editable vector format"). */
  description: string;
}

export interface SaveMenuSelectDetail {
  id: string;
}

export class AnnotSaveMenuElement extends LitElement {
  static override properties = {
    items: { attribute: false },
  };

  declare items: SaveMenuItem[];

  constructor() {
    super();
    this.items = [];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      ${this.items.map(
        (item) => html`
          <button
            type="button"
            class="copy-dropdown-item"
            data-tooltip=${item.description}
            aria-label=${item.description}
            @click=${() => this.#select(item.id)}
          >
            ${item.label}
          </button>
        `,
      )}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Apply the menu chrome classes the existing CSS targets.
    // Doing this once on connect avoids re-asserting them on every
    // Lit re-render.
    this.classList.add("save-dropdown-menu", "copy-dropdown-menu");
    this.style.display = "flex";
  }

  #select(id: string): void {
    this.dispatchEvent(
      new CustomEvent<SaveMenuSelectDetail>("menu-select", {
        detail: { id },
        bubbles: true,
      }),
    );
  }
}

if (!customElements.get("annot-save-menu")) {
  customElements.define("annot-save-menu", AnnotSaveMenuElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-save-menu": AnnotSaveMenuElement;
  }
}
