/**
 * Built-in `drawer.external-links` section — renders the links
 * collected via `pluginHost.collectExternalLinks` (today's
 * `github-external-links` built-in plugin contributes "View on
 * GitHub"; future plugins can stack their own).
 *
 * Lit Phase 1 — replaces the imperative `render()` closure with
 * a `<annot-drawer-external-links-section>` element. The
 * `createExternalLinksSection` factory stays so the drawer host
 * can compose it as a `UISection` alongside plugin-authored
 * sections (whose `mount` is still an opaque callback).
 *
 * Reactive lifecycle: the element's `links` property reflects
 * the latest contributions; the factory's `update(ctx)`
 * re-reads via `deps.getData()` and reassigns the property,
 * which triggers a Lit re-render.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import type { UISection } from "../../app/plugin-host.js";
import { html, LitElement, nothing } from "../../lit.js";
import "../../ui/annot-icon.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";

export interface ExternalLinkEntry {
  label: string;
  url: string;
  icon?: string;
}

export class AnnotDrawerExternalLinksSectionElement extends LitElement {
  static override properties = {
    links: { attribute: false },
  };

  declare links: ExternalLinkEntry[];

  constructor() {
    super();
    this.links = [];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    if (!this.links.length) return nothing;
    return html`
      ${this.links.map(
        (link) => html`
          <div class="file-details-row file-details-link-row">
            <a
              class="file-details-external-link"
              href=${link.url}
              target="_blank"
              rel="noopener noreferrer"
              data-tooltip=${link.url}
              aria-label=${link.url}
            >
              ${link.icon
                ? html`<annot-icon .spec=${builtinIcon(link.icon)}></annot-icon>`
                : nothing}${link.label}
            </a>
          </div>
        `,
      )}
    `;
  }
}

if (!customElements.get("annot-drawer-external-links-section")) {
  customElements.define(
    "annot-drawer-external-links-section",
    AnnotDrawerExternalLinksSectionElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-drawer-external-links-section": AnnotDrawerExternalLinksSectionElement;
  }
}

export interface ExternalLinksSectionDeps {
  getData(): FileDetailsData;
}

export function createExternalLinksSection(deps: ExternalLinksSectionDeps): UISection {
  let el: AnnotDrawerExternalLinksSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.links = deps.getData().externalLinks ?? [];
  };

  return {
    id: "drawer.external-links",
    title: "Links",
    priority: 40,
    visible() {
      const links = deps.getData().externalLinks;
      return Boolean(links && links.length > 0);
    },
    mount(container) {
      el = document.createElement("annot-drawer-external-links-section");
      container.appendChild(el);
      sync();
      return {
        update() {
          sync();
        },
        unmount() {
          el?.remove();
          el = null;
        },
      };
    },
  };
}
