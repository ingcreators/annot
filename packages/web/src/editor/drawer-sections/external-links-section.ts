/**
 * Built-in `drawer.external-links` section — renders the links
 * collected via `pluginHost.collectExternalLinks` (today's
 * `github-external-links` built-in plugin contributes "View on
 * GitHub"; future plugins can stack their own).
 *
 * Migrated from the previous monolithic
 * `FileDetailsDrawer.#renderLinksSection` as part of Phase 2 of
 * `docs/plans/plugin-ui-slots.md`. The section's `visible(ctx)`
 * gates on the data carrying at least one link, so deployments
 * without contributing plugins (or with the GitHub built-in
 * disabled) don't see the heading.
 *
 * Reactive lifecycle: `update(ctx)` re-reads the link list and
 * re-renders. New plugins coming online mid-session would land
 * here on the next host-level update.
 */

import { setTooltip } from "@ingcreators/annot-core/utils";
import type { UISection } from "../../app/plugin-host.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";

export interface ExternalLinksSectionDeps {
  getData(): FileDetailsData;
}

export function createExternalLinksSection(deps: ExternalLinksSectionDeps): UISection {
  let bodyRef: HTMLElement | null = null;

  const render = (container: HTMLElement) => {
    container.innerHTML = "";
    const links = deps.getData().externalLinks ?? [];
    for (const link of links) {
      const row = document.createElement("div");
      row.className = "file-details-row file-details-link-row";
      const a = document.createElement("a");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "file-details-external-link";
      if (link.icon) {
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined";
        icon.textContent = link.icon;
        icon.setAttribute("aria-hidden", "true");
        a.appendChild(icon);
      }
      a.appendChild(document.createTextNode(link.label));
      setTooltip(a, link.url);
      row.appendChild(a);
      container.appendChild(row);
    }
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
      bodyRef = container;
      render(container);
      return {
        update() {
          if (bodyRef) render(bodyRef);
        },
        unmount() {
          bodyRef = null;
        },
      };
    },
  };
}
