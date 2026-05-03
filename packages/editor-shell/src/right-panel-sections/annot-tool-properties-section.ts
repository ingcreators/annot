/**
 * Built-in `right-panel.tool-properties` section — renders the
 * controls (color / width / variant / etc.) for the currently-active
 * drawing tool. Title is dynamic — set per active tool via
 * `ctx.setTitle` so it reads "Rectangle" / "Arrow" / "Sticky note"
 * matching the toolbar's display title.
 *
 * Lit Phase 2 — replaces the imperative render closure with a
 * `<annot-right-panel-tool-properties-section>` element whose
 * `firstUpdated` + `updated` delegates into
 * `Toolbar.renderToolProperties(id, container)`. The `Toolbar`
 * class itself is still vanilla — it moves out of
 * `@ingcreators/annot-core` and into web as part of Phase 5 per
 * the plan's sign-off.
 *
 * `visible(ctx)` returns false in Select mode (no active tool) and
 * for tools that have no adjustable properties (`crop`).
 */

import type { Toolbar } from "@ingcreators/annot-editor-shell/toolbar";
import type { UISection } from "../ui-section.js";
import { html, LitElement } from "../lit.js";

export class AnnotRightPanelToolPropertiesSectionElement extends LitElement {
  static override properties = {
    toolId: { attribute: false },
    toolbar: { attribute: false },
    setTitle: { attribute: false },
  };

  declare toolId: string | null;
  declare toolbar: Toolbar | null;
  declare setTitle: ((title: string) => void) | null;

  constructor() {
    super();
    this.toolId = null;
    this.toolbar = null;
    this.setTitle = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    // Static shell — Toolbar populates the inner container
    // imperatively from `updated()`. Re-rendering the wrapper
    // without this.toolId set would wipe the Toolbar's DOM.
    return html`<div class="tool-properties-host"></div>`;
  }

  protected override updated(): void {
    const host = this.querySelector(".tool-properties-host") as HTMLElement | null;
    if (!host || !this.toolbar || !this.toolId) return;
    host.innerHTML = "";
    this.toolbar.renderToolProperties(this.toolId, host);
    this.setTitle?.(this.toolbar.getToolDisplayTitle(this.toolId));
  }
}

if (!customElements.get("annot-right-panel-tool-properties-section")) {
  customElements.define(
    "annot-right-panel-tool-properties-section",
    AnnotRightPanelToolPropertiesSectionElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-right-panel-tool-properties-section": AnnotRightPanelToolPropertiesSectionElement;
  }
}

export interface ToolPropertiesSectionDeps {
  getActiveToolId(): string | null;
  getToolbar(): Toolbar;
}

export function createToolPropertiesSection(deps: ToolPropertiesSectionDeps): UISection {
  let el: AnnotRightPanelToolPropertiesSectionElement | null = null;

  return {
    id: "right-panel.tool-properties",
    // Static fallback — the host overrides via `ctx.setTitle`
    // from inside mount with the active tool's display name.
    title: "Tool",
    priority: 10,
    visible() {
      const id = deps.getActiveToolId();
      return id !== null && id !== "crop";
    },
    mount(container, ctx) {
      el = document.createElement("annot-right-panel-tool-properties-section");
      el.toolbar = deps.getToolbar();
      el.toolId = deps.getActiveToolId();
      el.setTitle = (t) => ctx.setTitle(t);
      container.appendChild(el);
      return {
        update(updateCtx) {
          if (!el) return;
          el.toolbar = deps.getToolbar();
          el.toolId = deps.getActiveToolId();
          el.setTitle = (t) => updateCtx.setTitle(t);
          // Properties assigned above are already reactive; the
          // Lit `updated()` hook re-delegates into Toolbar.
        },
        unmount() {
          el?.remove();
          el = null;
        },
      };
    },
  };
}
