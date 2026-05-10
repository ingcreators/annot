/**
 * @vitest-environment happy-dom
 *
 * `<annot-gallery-page>` tests covering the visible states the
 * element can land in: empty / populated grids, search-filtered
 * results, the multi-selection state machine
 * (single / ctrl / shift), the `annot-gallery-*` event surface
 * the file-manager listens for, and the count-change event the
 * shell uses for its toolbar status text.
 *
 * Storage is a thin in-memory mock — refresh()'s recursive
 * search and resync paths are exercised via separate unit tests
 * on the storage providers themselves.
 */

import type { FolderRecord, ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./annot-gallery-page.js";
import type { AnnotGalleryPageElement } from "./annot-gallery-page.js";

interface FixtureOpts {
  images?: ImageRecord[];
  folders?: FolderRecord[];
}

function makeStorage(initial: FixtureOpts = {}): StorageProvider {
  const images = [...(initial.images ?? [])];
  const folders = [...(initial.folders ?? [])];
  return {
    async listImages(folderPath: string) {
      return images.filter((i) => i.folderPath === folderPath);
    },
    async listFolders() {
      return [...folders];
    },
    async getBreadcrumb() {
      return [];
    },
    async deleteImage(path: string) {
      const idx = images.findIndex((i) => i.path === path);
      if (idx >= 0) images.splice(idx, 1);
    },
    async deleteFolder(path: string) {
      const idx = folders.findIndex((f) => f.path === path);
      if (idx >= 0) folders.splice(idx, 1);
    },
  } as unknown as StorageProvider;
}

function makeImage(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    path: overrides.path ?? "image.png",
    folderPath: overrides.folderPath ?? "",
    originalDataUrl: "",
    thumbnailDataUrl: overrides.thumbnailDataUrl ?? "",
    annotationsSvg: "",
    width: overrides.width ?? 100,
    height: overrides.height ?? 80,
    sourceUrl: overrides.sourceUrl ?? "",
    tags: overrides.tags ?? {},
    createdAt: overrides.createdAt ?? "2026-04-25T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-25T10:00:00Z",
  };
}

function makeFolder(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path: overrides.path ?? "Folder",
    name: overrides.name ?? "Folder",
    parentPath: overrides.parentPath ?? "",
    createdAt: overrides.createdAt ?? "2026-04-25T00:00:00Z",
  } as FolderRecord;
}

async function mount(opts: FixtureOpts = {}): Promise<AnnotGalleryPageElement> {
  const el = document.createElement("annot-gallery-page");
  el.storage = makeStorage(opts);
  document.body.appendChild(el);
  await el.updateComplete;
  await el.refresh();
  await el.updateComplete;
  return el;
}

describe("<annot-gallery-page>", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the empty hint when storage has no images or folders", async () => {
    const el = await mount();
    expect(el.querySelector(".gallery-empty")?.textContent || "").toMatch(/No items yet/);
  });

  it("renders one card per image and one per folder", async () => {
    const el = await mount({
      images: [makeImage({ path: "a.png" }), makeImage({ path: "b.png" })],
      folders: [makeFolder({ path: "Box", name: "Box" })],
    });
    expect(el.querySelectorAll(".gallery-folder-card").length).toBe(1);
    expect(el.querySelectorAll(".gallery-item").length).toBe(2);
    expect(el.querySelector(".gallery-folder-card-name")?.textContent?.trim()).toBe("Box");
  });

  it("clicking an image card replaces selection and fires annot-gallery-selection-change", async () => {
    const el = await mount({
      images: [makeImage({ path: "a.png" }), makeImage({ path: "b.png" })],
    });
    const onSel = vi.fn();
    el.addEventListener("annot-gallery-selection-change", (e) => onSel(e.detail));
    const cards = el.querySelectorAll<HTMLElement>(".gallery-item");
    cards[0]!.click();
    await el.updateComplete;
    expect(el.getSelection().images.map((i) => i.path)).toEqual(["a.png"]);
    cards[1]!.click();
    await el.updateComplete;
    // Plain click replaces — only b.png remains.
    expect(el.getSelection().images.map((i) => i.path)).toEqual(["b.png"]);
    expect(onSel).toHaveBeenCalled();
  });

  it("ctrl+click toggles a card in the multi-selection set", async () => {
    const el = await mount({
      images: [makeImage({ path: "a.png" }), makeImage({ path: "b.png" })],
    });
    const cards = el.querySelectorAll<HTMLElement>(".gallery-item");
    cards[0]!.click(); // select a
    cards[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })); // toggle b in
    await el.updateComplete;
    const selected = el
      .getSelection()
      .images.map((i) => i.path)
      .sort();
    expect(selected).toEqual(["a.png", "b.png"]);
  });

  it("double-click on an image fires annot-gallery-open-image", async () => {
    const el = await mount({ images: [makeImage({ path: "a.png" })] });
    const onOpen = vi.fn();
    el.addEventListener("annot-gallery-open-image", (e) => onOpen(e.detail.record.path));
    el.querySelector<HTMLElement>(".gallery-item")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    expect(onOpen).toHaveBeenCalledWith("a.png");
  });

  it("double-click on a folder fires annot-gallery-folder-change", async () => {
    const el = await mount({ folders: [makeFolder({ path: "Box", name: "Box" })] });
    const onFolder = vi.fn();
    el.addEventListener("annot-gallery-folder-change", (e) => onFolder(e.detail.folderPath));
    el.querySelector<HTMLElement>(".gallery-folder-card")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    expect(onFolder).toHaveBeenCalledWith("Box");
  });

  it("count-change fires with total + filtered after refresh", async () => {
    const onCount = vi.fn();
    const el = document.createElement("annot-gallery-page");
    el.storage = makeStorage({
      images: [makeImage({ path: "a.png" }), makeImage({ path: "b.png" })],
    });
    el.addEventListener("annot-gallery-count-change", (e) => onCount(e.detail));
    document.body.appendChild(el);
    await el.updateComplete;
    await el.refresh();
    await el.updateComplete;
    // count-change fires every render; the last call reflects the final state.
    const last = onCount.mock.calls.at(-1)?.[0];
    expect(last).toEqual({ total: 2, filtered: 2 });
  });

  it("clearSelection() empties both image + folder sets", async () => {
    const el = await mount({
      images: [makeImage({ path: "a.png" })],
      folders: [makeFolder({ path: "Box", name: "Box" })],
    });
    el.querySelector<HTMLElement>(".gallery-item")!.click();
    await el.updateComplete;
    expect(el.totalSelectedCount).toBe(1);
    el.clearSelection();
    expect(el.totalSelectedCount).toBe(0);
  });

  it("setViewMode('list') adds the list-view class on the inner grid", async () => {
    const el = await mount();
    el.setViewMode("list");
    await el.updateComplete;
    expect(el.querySelector(".gallery-grid")?.classList.contains("list-view")).toBe(true);
  });

  it("filtering by search query hides folders and matching-only images", async () => {
    const el = await mount({
      images: [makeImage({ path: "alpha.png" }), makeImage({ path: "beta.png" })],
      folders: [makeFolder({ path: "Box", name: "Box" })],
    });
    expect(el.querySelectorAll(".gallery-folder-card").length).toBe(1);
    el.query = "alpha";
    await el.updateComplete;
    expect(el.querySelectorAll(".gallery-folder-card").length).toBe(0);
    expect(
      Array.from(el.querySelectorAll<HTMLElement>(".gallery-item")).map(
        (c) => c.dataset["imagePath"],
      ),
    ).toEqual(["alpha.png"]);
  });

  it("destroy() removes the element from the DOM", async () => {
    const el = await mount();
    expect(document.body.contains(el)).toBe(true);
    el.destroy();
    expect(document.body.contains(el)).toBe(false);
  });
});
