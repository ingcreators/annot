/**
 * @vitest-environment happy-dom
 *
 * `<annot-scratchpad-section>` tests covering the empty / populated
 * grid states, the save button enabled/disabled state, the active
 * thumbnail highlight, the `annot-scratchpad-save-request` /
 * `annot-scratchpad-insert` events, and the `addItem` / `removeItem`
 * imperative methods that mirror the pre-Lit class API.
 */

import { describe, expect, it, vi } from "vitest";
import "./annot-scratchpad-section.js";
import type { AnnotScratchpadSectionElement } from "./annot-scratchpad-section.js";
import type { ScratchpadItem, ScratchpadStore } from "./scratchpad-store.js";

function makeItem(overrides: Partial<ScratchpadItem> = {}): ScratchpadItem {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name,
    svgMarkup: overrides.svgMarkup ?? "<g></g>",
    thumbnail: overrides.thumbnail ?? "data:image/png;base64,",
    width: overrides.width ?? 100,
    height: overrides.height ?? 80,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function makeStore(initial: ScratchpadItem[] = []): ScratchpadStore {
  let items = [...initial];
  return {
    async save(data: Omit<ScratchpadItem, "id" | "createdAt">): Promise<ScratchpadItem> {
      const item = makeItem({
        ...data,
        id: `id-${items.length}`,
        createdAt: new Date().toISOString(),
      });
      items = [item, ...items];
      return item;
    },
    async list(): Promise<ScratchpadItem[]> {
      return [...items];
    },
    async delete(id: string): Promise<void> {
      items = items.filter((i) => i.id !== id);
    },
  } as unknown as ScratchpadStore;
}

async function mount(
  store: ScratchpadStore,
  opts: { saveEnabled?: boolean; activeItemId?: string | null } = {},
): Promise<AnnotScratchpadSectionElement> {
  const el = document.createElement("annot-scratchpad-section");
  el.store = store;
  if (opts.saveEnabled !== undefined) el.saveEnabled = opts.saveEnabled;
  if (opts.activeItemId !== undefined) el.activeItemId = opts.activeItemId;
  document.body.appendChild(el);
  await el.updateComplete;
  // refresh() resolves on the microtask after connectedCallback.
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

describe("<annot-scratchpad-section>", () => {
  it("shows the empty hint and a disabled save button when the store is empty", async () => {
    const el = await mount(makeStore([]));
    expect(el.querySelector(".scratchpad-empty")).not.toBeNull();
    expect(el.querySelectorAll(".scratchpad-item").length).toBe(0);
    const saveBtn = el.querySelector<HTMLButtonElement>(".scratchpad-save-btn")!;
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.getAttribute("data-tooltip")).toBe("Select one or more shapes first");
  });

  it("renders one thumbnail per item and hides the empty hint", async () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" }), makeItem({ id: "c" })];
    const el = await mount(makeStore(items));
    expect(el.querySelectorAll(".scratchpad-item").length).toBe(3);
    expect(el.querySelector(".scratchpad-empty")).toBeNull();
  });

  it("saveEnabled=true enables the button and updates the tooltip", async () => {
    const el = await mount(makeStore([]), { saveEnabled: true });
    const saveBtn = el.querySelector<HTMLButtonElement>(".scratchpad-save-btn")!;
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.getAttribute("data-tooltip")).toBe("Save current selection to Scratchpad");
  });

  it("clicking the save button dispatches annot-scratchpad-save-request", async () => {
    const el = await mount(makeStore([]), { saveEnabled: true });
    const onRequest = vi.fn();
    el.addEventListener("annot-scratchpad-save-request", onRequest);
    el.querySelector<HTMLButtonElement>(".scratchpad-save-btn")!.click();
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("clicking a thumbnail dispatches annot-scratchpad-insert with the item", async () => {
    const item = makeItem({ id: "x" });
    const el = await mount(makeStore([item]));
    const onInsert = vi.fn();
    el.addEventListener("annot-scratchpad-insert", (e) => onInsert((e as CustomEvent).detail));
    el.querySelector<HTMLElement>(".scratchpad-item")!.click();
    expect(onInsert).toHaveBeenCalledWith({ item });
  });

  it("activeItemId puts the matching thumbnail in active state", async () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const el = await mount(makeStore(items), { activeItemId: "b" });
    const cells = Array.from(el.querySelectorAll<HTMLElement>(".scratchpad-item"));
    expect(cells[0]!.classList.contains("active")).toBe(false);
    expect(cells[1]!.classList.contains("active")).toBe(true);
  });

  it("addItem prepends without re-fetching", async () => {
    const store = makeStore([makeItem({ id: "old" })]);
    const el = await mount(store);
    const listSpy = vi.spyOn(store, "list");
    await el.addItem(makeItem({ id: "new" }));
    await el.updateComplete;
    const ids = el.items.map((i) => i.id);
    expect(ids).toEqual(["new", "old"]);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("clicking the chip × calls store.delete and removes the chip + clears active when needed", async () => {
    const items = [makeItem({ id: "keep" }), makeItem({ id: "drop" })];
    const store = makeStore(items);
    const el = await mount(store, { activeItemId: "drop" });
    const deleteSpy = vi.spyOn(store, "delete");
    const cells = Array.from(el.querySelectorAll<HTMLElement>(".scratchpad-item"));
    cells[1]!.querySelector<HTMLButtonElement>(".scratchpad-item-delete")!.click();
    // wait for the async removeItem chain
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(deleteSpy).toHaveBeenCalledWith("drop");
    expect(el.querySelectorAll(".scratchpad-item").length).toBe(1);
    expect(el.activeItemId).toBeNull();
  });

  it("delete button click does not bubble up to the cell click handler", async () => {
    const items = [makeItem({ id: "x" })];
    const store = makeStore(items);
    const el = await mount(store);
    const onInsert = vi.fn();
    el.addEventListener("annot-scratchpad-insert", onInsert);
    el.querySelector<HTMLButtonElement>(".scratchpad-item-delete")!.click();
    expect(onInsert).not.toHaveBeenCalled();
  });
});
