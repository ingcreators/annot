import { setTooltip } from "@ingcreators/annot-core/editor/tooltip";
/**
 * ScratchpadSection — thumbnail grid UI for the right panel's
 * "Scratchpad" area.
 *
 * Responsibilities:
 *   - List items from the ScratchpadStore as clickable thumbnails
 *   - Expose "+ Save selection" button
 *   - Delete an item via a hover-revealed × button
 *
 * Out of scope for this MVP (Phase 3a):
 *   - Drag and drop save / insert
 *   - Rename / reorder
 *   - Categories
 */
import type { ScratchpadItem, ScratchpadStore } from "./scratchpad-store.js";

export class ScratchpadSection {
  #container: HTMLElement;
  #store: ScratchpadStore;
  #gridEl: HTMLElement;
  #emptyEl: HTMLElement;
  #saveBtn: HTMLButtonElement;
  #items: ScratchpadItem[] = [];
  /** The currently-armed item's id, or null when no item is armed.
   *  Drives the "active" visual state on the thumbnail so the user
   *  can see which item will land on the next canvas click. */
  #activeItemId: string | null = null;

  /** Called when the user clicks a thumbnail. Host decides where to
   *  insert the item on the canvas. */
  onInsert?: (item: ScratchpadItem) => void;
  /** Called when the user clicks the "+ Save selection" button. Host
   *  is responsible for collecting the current selection, calling
   *  `addItem()` with the serialized payload. */
  onSaveRequested?: () => void;

  constructor(container: HTMLElement, store: ScratchpadStore) {
    this.#container = container;
    this.#store = store;

    // Header: title + "+ Save selection" button
    const header = document.createElement("div");
    header.className = "scratchpad-section-header";
    const title = document.createElement("h3");
    title.className = "editor-right-panel-section-title";
    title.textContent = "Scratchpad";
    header.appendChild(title);

    this.#saveBtn = document.createElement("button");
    this.#saveBtn.type = "button";
    this.#saveBtn.className = "scratchpad-save-btn";
    setTooltip(this.#saveBtn, "Save current selection to Scratchpad");
    this.#saveBtn.setAttribute("aria-label", "Save selection to Scratchpad");
    this.#saveBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">add</span>`;
    this.#saveBtn.disabled = true; // enabled when selection is present
    this.#saveBtn.addEventListener("click", () => this.onSaveRequested?.());
    header.appendChild(this.#saveBtn);
    this.#container.appendChild(header);

    // Grid + empty state
    this.#gridEl = document.createElement("div");
    this.#gridEl.className = "scratchpad-grid";
    this.#container.appendChild(this.#gridEl);

    this.#emptyEl = document.createElement("p");
    this.#emptyEl.className = "scratchpad-empty";
    this.#emptyEl.textContent =
      "No saved items yet. Select a shape on the canvas and click + to save it for reuse.";
    this.#container.appendChild(this.#emptyEl);

    // Initial load
    void this.refresh();
  }

  /** Enable/disable the "+ Save selection" button based on whether
   *  the canvas currently has a non-empty selection. */
  setSaveEnabled(enabled: boolean): void {
    this.#saveBtn.disabled = !enabled;
    setTooltip(
      this.#saveBtn,
      enabled ? "Save current selection to Scratchpad" : "Select one or more shapes first",
    );
  }

  async refresh(): Promise<void> {
    this.#items = await this.#store.list();
    this.#renderItems();
  }

  /** After the host serializes the selection and calls store.save(),
   *  it invokes this so the section refreshes without a full round-trip. */
  async addItem(item: ScratchpadItem): Promise<void> {
    this.#items = [item, ...this.#items];
    this.#renderItems();
  }

  async removeItem(id: string): Promise<void> {
    await this.#store.delete(id);
    this.#items = this.#items.filter((i) => i.id !== id);
    if (this.#activeItemId === id) this.#activeItemId = null;
    this.#renderItems();
  }

  /** Mark a specific item as "armed" (or clear all). Drives the
   *  visual active state and gets called by the host when the
   *  paste tool is armed / completes / is canceled. */
  setActiveItem(id: string | null): void {
    if (this.#activeItemId === id) return;
    this.#activeItemId = id;
    this.#renderItems();
  }

  #renderItems(): void {
    this.#gridEl.innerHTML = "";
    if (this.#items.length === 0) {
      this.#emptyEl.style.display = "";
      return;
    }
    this.#emptyEl.style.display = "none";

    for (const item of this.#items) {
      this.#gridEl.appendChild(this.#makeThumbnail(item));
    }
  }

  #makeThumbnail(item: ScratchpadItem): HTMLElement {
    const cell = document.createElement("div");
    cell.className = `scratchpad-item${this.#activeItemId === item.id ? " active" : ""}`;
    setTooltip(cell, item.name || "Click, then click on the canvas to place");

    const img = document.createElement("img");
    img.className = "scratchpad-item-thumb";
    img.src = item.thumbnail;
    img.alt = item.name || "Scratchpad item";
    img.draggable = false;
    cell.appendChild(img);

    cell.addEventListener("click", () => {
      this.onInsert?.(item);
    });

    // Hover-revealed delete affordance
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "scratchpad-item-delete material-symbols-outlined";
    delBtn.textContent = "close";
    setTooltip(delBtn, "Delete");
    delBtn.setAttribute("aria-label", "Delete scratchpad item");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.removeItem(item.id);
    });
    cell.appendChild(delBtn);

    return cell;
  }
}
