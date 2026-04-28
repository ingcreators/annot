import { builtinIcon } from "@ingcreators/annot-core";
import "../ui/annot-icon.js";
/**
 * `<annot-scratchpad-section>` — thumbnail grid + "+ Save selection"
 * button used in the right-panel's Scratchpad popover.
 *
 * Lit completion Phase 2 — replaces the imperative
 * `ScratchpadSection` class. The host (editor-session) assigns
 * `.store`, `.saveEnabled`, `.activeItemId` reactive properties and
 * listens for the `annot-scratchpad-save-request` /
 * `annot-scratchpad-insert` CustomEvents instead of attaching
 * `onSaveRequested` / `onInsert` callbacks to a class instance.
 *
 * `addItem(item)` and `refresh()` stay as imperative methods since
 * the host calls them at well-defined moments (after serializing a
 * selection, on initial mount); modeling them as reactive props
 * would require the host to keep a parallel `items` array just to
 * trigger a re-render, which is more ceremony than the call.
 *
 * Light DOM (Hybrid CSS) so the existing `.scratchpad-grid` /
 * `.scratchpad-item` rules in `editor.css` apply unchanged.
 */

import { html, LitElement, nothing } from "../lit.js";
import type { ScratchpadItem, ScratchpadStore } from "./scratchpad-store.js";

const EMPTY_HINT =
  "No saved items yet. Select a shape on the canvas and click + to save it for reuse.";

export class AnnotScratchpadSectionElement extends LitElement {
  static override properties = {
    store: { attribute: false },
    saveEnabled: { attribute: false },
    activeItemId: { attribute: false },
    items: { state: true },
  };

  declare store: ScratchpadStore | null;
  declare saveEnabled: boolean;
  declare activeItemId: string | null;
  declare items: ScratchpadItem[];

  constructor() {
    super();
    this.store = null;
    this.saveEnabled = false;
    this.activeItemId = null;
    this.items = [];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Initial load — fire-and-forget; render() handles the empty
    // state until the list resolves.
    if (this.store) void this.refresh();
  }

  override render() {
    const saveTooltip = this.saveEnabled
      ? "Save current selection to Scratchpad"
      : "Select one or more shapes first";
    return html`
      <div class="scratchpad-section-header">
        <h3 class="editor-right-panel-section-title">Scratchpad</h3>
        <button type="button"
          class="scratchpad-save-btn"
          data-tooltip=${saveTooltip}
          aria-label="Save selection to Scratchpad"
          ?disabled=${!this.saveEnabled}
          @click=${this.#onSaveClick}
        >
          <annot-icon aria-hidden="true" .spec=${builtinIcon("add")}></annot-icon>
        </button>
      </div>
      <div class="scratchpad-grid">
        ${this.items.map((item) => this.#renderThumbnail(item))}
      </div>
      ${this.items.length === 0
        ? html`<p class="scratchpad-empty">${EMPTY_HINT}</p>`
        : nothing}
    `;
  }

  #renderThumbnail(item: ScratchpadItem) {
    const cls = `scratchpad-item${this.activeItemId === item.id ? " active" : ""}`;
    const tooltip = item.name || "Click, then click on the canvas to place";
    return html`
      <div
        class=${cls}
        data-tooltip=${tooltip}
        aria-label=${tooltip}
        @click=${() => this.#onInsertItem(item)}
      >
        <img
          class="scratchpad-item-thumb"
          src=${item.thumbnail}
          alt=${item.name || "Scratchpad item"}
          draggable="false"
        />
        <button
          type="button"
          class="scratchpad-item-delete"
          data-tooltip="Delete"
          aria-label="Delete scratchpad item"
          @click=${(e: Event) => this.#onDeleteItem(e, item.id)}
        >
          <annot-icon .spec=${builtinIcon("close")}></annot-icon>
        </button>
      </div>
    `;
  }

  /** Reload the items from the store. The host calls this directly
   *  on initial mount; subsequent updates flow through `addItem` /
   *  `removeItem` so the section doesn't need to round-trip the
   *  store on every change. */
  async refresh(): Promise<void> {
    if (!this.store) {
      this.items = [];
      return;
    }
    this.items = await this.store.list();
  }

  /** Prepend a freshly-saved item to the list without re-fetching
   *  from the store. Called by the host after `store.save(...)` so
   *  the popover updates immediately. */
  async addItem(item: ScratchpadItem): Promise<void> {
    this.items = [item, ...this.items];
  }

  /** Delete an item (store + local list). Mirrors the pre-Lit
   *  imperative API. Wired internally to the chip × button. */
  async removeItem(id: string): Promise<void> {
    if (!this.store) return;
    await this.store.delete(id);
    this.items = this.items.filter((i) => i.id !== id);
    if (this.activeItemId === id) this.activeItemId = null;
  }

  #onSaveClick = (): void => {
    this.dispatchEvent(
      new CustomEvent("annot-scratchpad-save-request", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  #onInsertItem = (item: ScratchpadItem): void => {
    this.dispatchEvent(
      new CustomEvent<{ item: ScratchpadItem }>("annot-scratchpad-insert", {
        detail: { item },
        bubbles: true,
        composed: true,
      }),
    );
  };

  #onDeleteItem = (e: Event, id: string): void => {
    e.stopPropagation();
    void this.removeItem(id);
  };
}

if (!customElements.get("annot-scratchpad-section")) {
  customElements.define("annot-scratchpad-section", AnnotScratchpadSectionElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-scratchpad-section": AnnotScratchpadSectionElement;
  }
  interface HTMLElementEventMap {
    "annot-scratchpad-save-request": CustomEvent<void>;
    "annot-scratchpad-insert": CustomEvent<{ item: ScratchpadItem }>;
  }
}
