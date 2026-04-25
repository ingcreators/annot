/**
 * Built-in `drawer.tags` section — embeds the `TagEditor` so users
 * can add / remove / edit tags on the open image.
 *
 * Lit Phase 1 — the section is now a
 * `<annot-drawer-tags-section>` element whose `firstUpdated`
 * instantiates the existing vanilla `TagEditor` into a child node.
 * `TagEditor` stays vanilla per the plan's Phase 1 scope —
 * migrating it is a separate follow-up.
 *
 * Reactive lifecycle: assigning `.tags` pushes the latest tags
 * into the existing `TagEditor` instance via `setTags`,
 * preserving the editor's mid-edit state where possible.
 */

import type { UISection } from "../../app/plugin-host.js";
import { html, LitElement } from "../../lit.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";
import { TagEditor } from "../tag-editor.js";

export class AnnotDrawerTagsSectionElement extends LitElement {
  static override properties = {
    tags: { attribute: false },
    onTagsChange: { attribute: false },
  };

  declare tags: Record<string, string>;
  declare onTagsChange: ((tags: Record<string, string>) => void) | null;
  #editor: TagEditor | null = null;

  constructor() {
    super();
    this.tags = {};
    this.onTagsChange = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    // Render once; the real content is populated imperatively by
    // `firstUpdated` because `TagEditor` is a vanilla class that
    // builds its own DOM inside the host container.
    return html`<div class="file-details-tags-editor"></div>`;
  }

  protected override firstUpdated(): void {
    const host = this.querySelector(".file-details-tags-editor") as HTMLElement | null;
    if (!host) return;
    this.#editor = new TagEditor(host);
    this.#editor.setTags(this.tags);
    this.#editor.onTagsChange = (t) => this.onTagsChange?.(t);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (this.#editor && changed.has("tags")) {
      // Push the latest tags into the existing TagEditor — it
      // preserves its UI state where possible, so this is cheaper
      // than rebuilding from scratch on every drawer-data change.
      this.#editor.setTags(this.tags);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // TagEditor doesn't register window-level listeners; the DOM
    // drop is enough. Null the ref so a reconnect rebuilds.
    this.#editor = null;
  }
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
  /** Forwarded to the TagEditor's `onTagsChange` so the host can
   *  persist the edit + propagate updates elsewhere (e.g. the
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
