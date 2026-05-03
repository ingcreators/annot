/**
 * Built-in `drawer.last-commit` section — author, date, message
 * headline + short SHA for the file's most recent commit. GitHub-
 * only today; the section's `visible(ctx)` predicate gates on
 * presence of `data.lastCommit`, so non-GitHub backends (and
 * GitHub before the async lookup completes) don't render the
 * heading.
 *
 * Lit Phase 1 — replaces the imperative `renderRows` closure with
 * a `<annot-drawer-last-commit-section>` element. The
 * `createLastCommitSection` factory stays so the drawer host can
 * compose it as a `UISection` alongside plugin-authored sections
 * (whose `mount` is still an opaque callback).
 */

import { html, LitElement, nothing } from "../lit.js";
import type { UISection } from "../ui-section.js";
import type { FileDetailsData, LastCommitInfo } from "../file-details-drawer-types.js";
import { formatDate } from "./helpers.js";

export class AnnotDrawerLastCommitSectionElement extends LitElement {
  static override properties = {
    commit: { attribute: false },
  };

  declare commit: LastCommitInfo | null;

  constructor() {
    super();
    this.commit = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const commit = this.commit;
    if (!commit) return nothing;
    return html`
      <div class="file-details-row">
        <span class="file-details-row-label">Author</span>
        <span class="file-details-row-value selectable">
          ${commit.authorAvatarUrl
            ? html`<img
                class="file-details-avatar"
                src=${commit.authorAvatarUrl}
                alt=""
                width="16"
                height="16"
              />`
            : nothing}${commit.authorName}
        </span>
      </div>
      <div class="file-details-row">
        <span class="file-details-row-label">Date</span>
        <span
          class="file-details-row-value"
          data-tooltip=${formatDate(commit.date)}
          aria-label=${formatDate(commit.date)}
          >${formatDate(commit.date)}</span
        >
      </div>
      <div class="file-details-row">
        <span class="file-details-row-label">Message</span>
        <span
          class="file-details-row-value selectable"
          data-tooltip=${commit.messageHeadline}
          aria-label=${commit.messageHeadline}
        >
          ${commit.url
            ? html`<a href=${commit.url} target="_blank" rel="noopener noreferrer"
                >${commit.messageHeadline}</a
              >`
            : commit.messageHeadline}
          <code class="file-details-sha">${commit.shortSha}</code>
        </span>
      </div>
    `;
  }
}

if (!customElements.get("annot-drawer-last-commit-section")) {
  customElements.define(
    "annot-drawer-last-commit-section",
    AnnotDrawerLastCommitSectionElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-drawer-last-commit-section": AnnotDrawerLastCommitSectionElement;
  }
}

export interface LastCommitSectionDeps {
  getData(): FileDetailsData;
}

export function createLastCommitSection(deps: LastCommitSectionDeps): UISection {
  let el: AnnotDrawerLastCommitSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.commit = deps.getData().lastCommit ?? null;
  };

  return {
    id: "drawer.last-commit",
    title: "Last commit",
    priority: 30,
    visible() {
      return Boolean(deps.getData().lastCommit);
    },
    mount(container) {
      el = document.createElement("annot-drawer-last-commit-section");
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
