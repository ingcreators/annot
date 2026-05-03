/**
 * `<annot-icon>` — render an `IconSpec` as a Lit web component.
 *
 * Phase 4a of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 *
 * Centralises the `unsafeHTML` cast that the renderer
 * (`renderIconHtml`, Tier-B) ultimately produces — one element
 * to scrutinise during reviews instead of N call sites peppered
 * with `unsafeHTML`. Plugin authors importing
 * `@ingcreators/annot-web/lit` can compose icon UI as
 *
 *   html`<annot-icon .spec=${spec}></annot-icon>`
 *
 * without touching the registry / sanitiser / renderer modules
 * directly.
 *
 * The element renders to LIGHT DOM so the host CSS that targets
 * it (`.editor-right-panel-empty-icon`, `.toolbar-button-icon`,
 * etc.) keeps applying without churn during the migration —
 * matching `docs/plans/_done/lit-migration.md`'s hybrid-CSS
 * stance. Element sizing comes from the surrounding context;
 * default `display: inline-flex; width: 1em; height: 1em` is
 * applied as a host style for callers that haven't styled it.
 */

import type { IconSpec } from "@ingcreators/annot-core";
import { renderIconHtml } from "@ingcreators/annot-core";
import { html, LitElement, nothing, unsafeHTML } from "./lit.js";

export class AnnotIconElement extends LitElement {
  static override properties = {
    // The icon descriptor. `attribute: false` because IconSpec is
    // an object discriminator — no string-attribute fallback makes
    // sense (and we don't want stringified specs leaking to the
    // DOM as a misleading `spec="[object Object]"`).
    spec: { attribute: false },
  };

  // `declare` is type-only so Lit's reactive getter/setter isn't
  // shadowed by a class-field initialiser at ES2022.
  declare spec: IconSpec | null;

  constructor() {
    super();
    this.spec = null;
  }

  // Light DOM during the migration — surrounding `.material-
  // symbols-outlined`-targeting CSS gets superseded site-by-site
  // as Phase 4b–4g move call sites onto the new element, but
  // existing global rules still need to find the inline SVG
  // children. Shadow DOM would isolate them and break.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    if (!this.spec) return nothing;
    const markup = renderIconHtml(this.spec);
    if (!markup) return nothing;
    return html`${unsafeHTML(markup)}`;
  }
}

if (!customElements.get("annot-icon")) {
  customElements.define("annot-icon", AnnotIconElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-icon": AnnotIconElement;
  }
}
