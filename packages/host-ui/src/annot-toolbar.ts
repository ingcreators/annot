/**
 * `<annot-toolbar>` and `<annot-toolbar-button>` — the editor
 * toolbar's outer shell and per-tool button primitives.
 *
 * History: Lit migration Phase 5b (`_done/lit-migration.md`)
 * replaced `Toolbar.#btn()` (imperative button factory) and
 * `Toolbar.#render()`'s container-class shuffling with
 * declarative custom elements. The remaining internals
 * (variant + color flyouts, save dropdown, badge population,
 * preset persistence, keyboard shortcuts, canvas context-menu)
 * landed across Phase 6a / 6b / 6c of
 * `_done/lit-migration-completion.md`: variant + color flyouts
 * unified into a single `#showFlyout` / `<annot-tool-flyout>`
 * pair (6a), the save dropdown's orchestration absorbed into
 * `<annot-save-menu>` (6b). `Toolbar` is now a thin orchestrator
 * over those Lit collaborators.
 *
 * Both elements use **light DOM** so the existing
 * `.toolbar-vertical` / `.toolbar-btn` rules in `editor.css`
 * apply unchanged. The Toolbar class continues to populate
 * children of `<annot-toolbar>` imperatively (groups,
 * separators, theme toggle, etc.) — the host element's only
 * job is to flip the vertical-orientation class. Per-button
 * state (active, tooltip, icon) is reactive.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import { html, LitElement } from "./lit.js";
import "./annot-icon.js";

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
    this.classList.toggle("toolbar-vertical", this.getAttribute("orientation") === "vertical");
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
   *  works without modification.
   *
   *  Forces a synchronous render via `performUpdate()` if the
   *  inner button hasn't been rendered yet. Pre-this-call, Lit
   *  schedules its first update on a microtask, which is too
   *  late for `Toolbar.#render`'s synchronous wiring path —
   *  it queries this getter immediately after `document.createElement`
   *  + `shell.appendChild(...)`. The normal async cycle would
   *  return null and the `!` non-null assertion downstream would
   *  blow up `addEventListener` on null. */
  getButton(): HTMLButtonElement | null {
    let btn = this.querySelector<HTMLButtonElement>(".toolbar-btn");
    if (!btn) {
      // `performUpdate` is a public ReactiveElement API that runs
      // any pending update synchronously. Safe even when no update
      // is pending — it short-circuits in that case.
      this.performUpdate();
      btn = this.querySelector<HTMLButtonElement>(".toolbar-btn");
    }
    return btn;
  }

  override render() {
    const cls = this.active ? "toolbar-btn active" : "toolbar-btn";
    return html`
      <button
        type="button"
        class=${cls}
        data-tooltip=${this.tooltip}
        aria-label=${this.tooltip}
        data-tool=${this.dataTool}
      >
        <annot-icon .spec=${builtinIcon(this.icon)}></annot-icon>
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
