/**
 * Built-in `right-panel.selection-properties` section — surfaces
 * properties of the currently-selected element(s) via the embedded
 * `PropertyPanel` instance. Title is dynamic — set per element kind
 * via `ctx.setTitle` so it reads "Selected Rectangle" / "Selected
 * Arrow" / "3 selected — 2 rectangles + 1 arrow".
 *
 * Lit Phase 2 — replaces the imperative lifecycle closure with a
 * `<annot-right-panel-selection-properties-section>` element that
 * owns the attach / detach of the panel-level `PropertyPanel`
 * singleton. `PropertyPanel` itself stays vanilla (it lives in
 * `@ingcreators/annot-core`; migrating it is a separate plan per
 * the migration's Non-goals).
 *
 * The `PropertyPanel` singleton is owned by `<annot-editor-right-panel>`;
 * this section borrows its host element on mount and detaches it
 * on unmount so the PropertyPanel's internal observers / event
 * listeners survive mode switches.
 */

import type { UISection } from "../ui-section.js";
import { html, LitElement } from "../lit.js";

export class AnnotRightPanelSelectionPropertiesSectionElement extends LitElement {
  static override properties = {
    elements: { attribute: false },
    propPanelHost: { attribute: false },
    showPropPanel: { attribute: false },
    hidePropPanel: { attribute: false },
    setTitle: { attribute: false },
    computeTitle: { attribute: false },
  };

  declare elements: SVGElement[];
  declare propPanelHost: HTMLElement | null;
  declare showPropPanel: ((els: SVGElement[]) => void) | null;
  declare hidePropPanel: (() => void) | null;
  declare setTitle: ((title: string) => void) | null;
  declare computeTitle: ((els: SVGElement[]) => string) | null;

  constructor() {
    super();
    this.elements = [];
    this.propPanelHost = null;
    this.showPropPanel = null;
    this.hidePropPanel = null;
    this.setTitle = null;
    this.computeTitle = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    // The PropertyPanel host is attached imperatively from `updated()`.
    return html`<div class="selection-properties-host"></div>`;
  }

  protected override updated(): void {
    const host = this.querySelector(".selection-properties-host") as HTMLElement | null;
    if (!host || !this.propPanelHost) return;
    if (this.propPanelHost.parentElement !== host) {
      host.appendChild(this.propPanelHost);
    }
    this.showPropPanel?.(this.elements);
    if (this.computeTitle) this.setTitle?.(this.computeTitle(this.elements));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.hidePropPanel?.();
    // Detach the PropertyPanel's host element from this section's
    // container so the next mount can re-attach it cleanly. The
    // element itself is stable (owned by `<annot-editor-right-panel>`);
    // only the parent link drops here.
    if (this.propPanelHost?.parentElement) {
      this.propPanelHost.parentElement.removeChild(this.propPanelHost);
    }
  }
}

if (!customElements.get("annot-right-panel-selection-properties-section")) {
  customElements.define(
    "annot-right-panel-selection-properties-section",
    AnnotRightPanelSelectionPropertiesSectionElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-right-panel-selection-properties-section": AnnotRightPanelSelectionPropertiesSectionElement;
  }
}

export interface SelectionPropertiesSectionDeps {
  getSelection(): SVGElement[];
  /** Stable PropertyPanel host container — owned by
   *  `<annot-editor-right-panel>` so the embedded `PropertyPanel`
   *  instance survives mode switches. The section borrows the
   *  element on mount, returns it on unmount. */
  getPropPanelHost(): HTMLElement;
  /** `propPanel.show(elements)` — re-render the controls for the
   *  current selection. */
  showPropPanel(elements: SVGElement[]): void;
  hidePropPanel(): void;
  /** Friendly title computed from the selection. Plumbed from the
   *  panel host so the title-naming logic stays co-located with
   *  the rest of the right-panel state. */
  computeTitle(elements: SVGElement[]): string;
}

export function createSelectionPropertiesSection(
  deps: SelectionPropertiesSectionDeps,
): UISection {
  let el: AnnotRightPanelSelectionPropertiesSectionElement | null = null;
  const sync = (ctx: { setTitle: (t: string) => void }) => {
    if (!el) return;
    el.elements = deps.getSelection();
    el.propPanelHost = deps.getPropPanelHost();
    el.showPropPanel = (els) => deps.showPropPanel(els);
    el.hidePropPanel = () => deps.hidePropPanel();
    el.setTitle = (t) => ctx.setTitle(t);
    el.computeTitle = (els) => deps.computeTitle(els);
  };

  return {
    id: "right-panel.selection-properties",
    title: "Selection",
    priority: 20,
    visible() {
      return deps.getSelection().length > 0;
    },
    mount(container, ctx) {
      el = document.createElement("annot-right-panel-selection-properties-section");
      container.appendChild(el);
      sync(ctx);
      return {
        update(updateCtx) {
          sync(updateCtx);
        },
        unmount() {
          el?.remove();
          el = null;
        },
      };
    },
  };
}
