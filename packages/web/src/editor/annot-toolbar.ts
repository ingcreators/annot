/**
 * `<annot-toolbar>` and `<annot-toolbar-button>` — the editor
 * toolbar's outer shell and per-tool button primitives.
 *
 * Lit Phase 5b — replaces `Toolbar.#btn()` (imperative button
 * factory) and `Toolbar.#render()`'s container-class shuffling
 * with declarative custom elements. The complex internals
 * (variant flyouts, badge population, preset persistence,
 * keyboard shortcuts) stay imperative within the `Toolbar`
 * class itself — they're scheduled for Phase 5c.
 *
 * Both elements use **light DOM** so the existing
 * `.toolbar-vertical` / `.toolbar-btn` rules in `editor.css`
 * apply unchanged. The Toolbar class continues to populate
 * children of `<annot-toolbar>` imperatively (groups,
 * separators, theme toggle, etc.) — the host element's only
 * job is to flip the vertical-orientation class. Per-button
 * state (active, tooltip, icon) is reactive.
 */

import { html, LitElement } from "../lit.js";

/** Plain custom element — not a Lit element — because the
 *  toolbar's children are populated imperatively by the
 *  `Toolbar` class. Going through Lit's render() would either
 *  clear those children on every reactive update or require a
 *  `<slot>` (only available in shadow DOM, which would defeat
 *  the existing CSS reach). The host therefore just observes
 *  the `orientation` attribute and toggles a class. */
export class AnnotToolbarElement extends HTMLElement {
  static observedAttributes = ["orientation"];

  attributeChangedCallback(name: string, _old: string, value: string): void {
    if (name === "orientation") {
      this.classList.toggle("toolbar-vertical", value === "vertical");
    }
  }

  connectedCallback(): void {
    // Apply the initial orientation class — `attributeChangedCallback`
    // alone misses the case where the attribute is set BEFORE the
    // element is upgraded.
    this.classList.toggle(
      "toolbar-vertical",
      this.getAttribute("orientation") === "vertical",
    );
  }
}

if (!customElements.get("annot-toolbar")) {
  customElements.define("annot-toolbar", AnnotToolbarElement);
}

export class AnnotToolbarButtonElement extends LitElement {
  static override properties = {
    icon: { type: String },
    tooltip: { type: String },
    active: { type: Boolean, reflect: true },
    dataTool: { type: String, attribute: "data-tool", reflect: true },
  };

  declare icon: string;
  declare tooltip: string;
  declare active: boolean;
  /** Tool id mirrored on the button's `data-tool` attribute so
   *  the imperative `#activate` path that reads
   *  `btn.dataset.tool` keeps working. */
  declare dataTool: string;

  constructor() {
    super();
    this.icon = "";
    this.tooltip = "";
    this.active = false;
    this.dataTool = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Inner `<button>` ref — the Toolbar class queries this so
   *  the existing imperative wiring (click handler + variant
   *  badge child, attached via `btn.appendChild(badge)`) still
   *  works without modification. */
  getButton(): HTMLButtonElement | null {
    return this.querySelector<HTMLButtonElement>(".toolbar-btn");
  }

  override render() {
    const cls = this.active
      ? "toolbar-btn material-symbols-outlined active"
      : "toolbar-btn material-symbols-outlined";
    return html`
      <button
        type="button"
        class=${cls}
        data-tooltip=${this.tooltip}
        aria-label=${this.tooltip}
        data-tool=${this.dataTool}
      >
        ${this.icon}
      </button>
    `;
  }
}

if (!customElements.get("annot-toolbar-button")) {
  customElements.define("annot-toolbar-button", AnnotToolbarButtonElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-toolbar": AnnotToolbarElement;
    "annot-toolbar-button": AnnotToolbarButtonElement;
  }
}
