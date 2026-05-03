/**
 * Built-in `drawer.tags` section — embeds the tag editor so users
 * can add / remove / edit tags on the open image.
 *
 * The tag editor itself is `<annot-tag-editor>` (Lit). This section
 * is a thin Lit wrapper that owns the section frame inside the
 * drawer host, listens for `annot-tag-change`, and forwards the
 * change to the host through `onTagsChange`.
 *
 * Reactive lifecycle: assigning `.tags` updates the child element
 * via Lit's reactive property pipeline; the `annot-tag-change`
 * event keeps the parent state in sync without imperative
 * `setTags` calls.
 */

import { html, LitElement } from "../lit.js";
import type { UISection } from "../ui-section.js";
import "../annot-tag-editor.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";

export class AnnotDrawerTagsSectionElement extends LitElement {
  static override properties = {
    tags: { attribute: false },
    onTagsChange: { attribute: false },
  };

  declare tags: Record<string, string>;
  declare onTagsChange: ((tags: Record<string, string>) => void) | null;

  constructor() {
    super();
    this.tags = {};
    this.onTagsChange = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <div class="file-details-tags-editor">
        <annot-tag-editor
          .tags=${this.tags}
          @annot-tag-change=${this.#onTagChange}
        ></annot-tag-editor>
      </div>
    `;
  }

  #onTagChange = (e: CustomEvent<{ tags: Record<string, string> }>): void => {
    this.onTagsChange?.(e.detail.tags);
  };
}

if (!customElements.get("annot-drawer-tags-section")) {
  customElements.define("annot-drawer-tags-section", AnnotDrawerTagsSectionElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-drawer-tags-section": AnnotDrawerTagsSectionElement;
  }
}

export interface TagsSectionDeps {
  getData(): FileDetailsData;
  /** Forwarded to the editor's `annot-tag-change` event so the host
   *  can persist the edit + propagate updates elsewhere (e.g. the
   *  save pipeline). */
  onTagsChange?(tags: Record<string, string>): void;
}

export function createTagsSection(deps: TagsSectionDeps): UISection {
  let el: AnnotDrawerTagsSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.tags = deps.getData().tags;
    el.onTagsChange = deps.onTagsChange ? (t) => deps.onTagsChange!(t) : null;
  };

  return {
    id: "drawer.tags",
    title: "Tags",
    priority: 20,
    mount(container) {
      el = document.createElement("annot-drawer-tags-section");
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
