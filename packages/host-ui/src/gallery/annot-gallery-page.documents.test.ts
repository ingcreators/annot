/**
 * @vitest-environment happy-dom
 *
 * `<annot-gallery-page>` document-listing tests — Phase 6d of
 * `docs/plans/_done/annot-html-document.md`. Focused on the new
 * Documents section: hidden when the storage doesn't opt into
 * `StorageWithDocuments`, populated when it does, and the
 * `annot-gallery-open-document` event the file-manager listens
 * for. The full gallery surface is covered by
 * `annot-gallery-page.test.ts`; we only assert the document-side
 * additions here.
 */

import type {
  DocumentRecord,
  ImageRecord,
  StorageProvider,
  StorageWithDocuments,
} from "@ingcreators/annot-core/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./annot-gallery-page.js";
import type { AnnotGalleryPageElement } from "./annot-gallery-page.js";

function makeImage(path: string): ImageRecord {
  return {
    path,
    folderPath: "",
    originalDataUrl: "",
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width: 100,
    height: 80,
    sourceUrl: "",
    tags: {},
    createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
  };
}

function makeDocument(path: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = new Date("2026-05-10T00:00:00Z").toISOString();
  return {
    path,
    folderPath: "",
    bytes: "<!doctype html>",
    thumbnailDataUrl: "",
    title: overrides.title ?? "Untitled",
    imageCount: overrides.imageCount ?? 0,
    blockCount: overrides.blockCount ?? 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeImageOnlyStorage(images: ImageRecord[] = []): StorageProvider {
  return {
    async listImages(folderPath: string) {
      return images.filter((i) => i.folderPath === folderPath);
    },
    async listFolders() {
      return [];
    },
    async getBreadcrumb() {
      return [];
    },
  } as unknown as StorageProvider;
}

function makeDocCapableStorage(opts: {
  images?: ImageRecord[];
  documents?: DocumentRecord[];
  onDeleteImage?: (path: string) => void;
}): StorageProvider & StorageWithDocuments {
  const images = [...(opts.images ?? [])];
  const documents = [...(opts.documents ?? [])];
  return {
    async listImages(folderPath: string) {
      return images.filter((i) => i.folderPath === folderPath);
    },
    async listFolders() {
      return [];
    },
    async getBreadcrumb() {
      return [];
    },
    async listDocuments(folderPath: string) {
      return documents.filter((d) => d.folderPath === folderPath);
    },
    async getDocument() {
      return undefined;
    },
    async saveDocument() {
      return "";
    },
    async updateDocument() {},
    async deleteImage(path: string) {
      opts.onDeleteImage?.(path);
      const imgIdx = images.findIndex((i) => i.path === path);
      if (imgIdx >= 0) images.splice(imgIdx, 1);
      const docIdx = documents.findIndex((d) => d.path === path);
      if (docIdx >= 0) documents.splice(docIdx, 1);
    },
  } as unknown as StorageProvider & StorageWithDocuments;
}

function mount(): AnnotGalleryPageElement {
  const el = document.createElement("annot-gallery-page") as AnnotGalleryPageElement;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("annot-gallery-page: documents listing", () => {
  it("does NOT render the Documents section when storage doesn't support documents", async () => {
    const storage = makeImageOnlyStorage([makeImage("a.png")]);
    const el = mount();
    el.storage = storage;
    await el.refresh("");
    await el.updateComplete;
    expect(el.querySelector(".gallery-document-grid")).toBeNull();
    expect(
      Array.from(el.querySelectorAll(".gallery-section-header")).map((h) => h.textContent?.trim()),
    ).not.toContain("Documents");
    expect(el.documents).toEqual([]);
  });

  it("renders document cards when storage opts into StorageWithDocuments", async () => {
    const storage = makeDocCapableStorage({
      documents: [
        makeDocument("manual.annot.html", { title: "Onboarding", blockCount: 5, imageCount: 2 }),
        makeDocument("notes.annot.html", { title: "Notes" }),
      ],
    });
    const el = mount();
    el.storage = storage;
    await el.refresh("");
    await el.updateComplete;

    const docCards = el.querySelectorAll(".gallery-document-item");
    expect(docCards).toHaveLength(2);
    const titles = Array.from(el.querySelectorAll(".gallery-document-item .gallery-item-name")).map(
      (n) => n.textContent?.trim(),
    );
    expect(titles).toEqual(["Onboarding", "Notes"]);
  });

  it("dispatches annot-gallery-open-document on dblclick + Enter", async () => {
    const doc = makeDocument("a.annot.html", { title: "A" });
    const storage = makeDocCapableStorage({ documents: [doc] });
    const el = mount();
    el.storage = storage;
    await el.refresh("");
    await el.updateComplete;

    const captured: DocumentRecord[] = [];
    el.addEventListener("annot-gallery-open-document", (e) => {
      captured.push((e as CustomEvent<{ record: DocumentRecord }>).detail.record);
    });

    const card = el.querySelector(".gallery-document-item") as HTMLElement;
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.path).toBe("a.annot.html");

    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(captured).toHaveLength(2);
  });

  it("renders a 'more actions' button on each document card", async () => {
    const storage = makeDocCapableStorage({
      documents: [makeDocument("a.annot.html", { title: "A" })],
    });
    const el = mount();
    el.storage = storage;
    await el.refresh("");
    await el.updateComplete;
    const moreBtn = el.querySelector(".gallery-document-item .gallery-card-more");
    expect(moreBtn).not.toBeNull();
  });

  it("renders the section header 'Documents' when both documents + images exist", async () => {
    const storage = makeDocCapableStorage({
      images: [makeImage("a.png")],
      documents: [makeDocument("notes.annot.html", { title: "Notes" })],
    });
    const el = mount();
    el.storage = storage;
    await el.refresh("");
    await el.updateComplete;
    const headers = Array.from(el.querySelectorAll(".gallery-section-header")).map((h) =>
      h.textContent?.trim(),
    );
    expect(headers).toContain("Documents");
    // Images header is only emitted when there are also folders
    // or documents above it — both present here, so it should
    // appear (and explicitly NOT be "Files").
    expect(headers).toContain("Images");
    expect(headers).not.toContain("Files");
  });

  describe("documents multi-select", () => {
    it("plain click selects a single document card", async () => {
      const storage = makeDocCapableStorage({
        documents: [
          makeDocument("a.annot.html", { title: "A" }),
          makeDocument("b.annot.html", { title: "B" }),
        ],
      });
      const el = mount();
      el.storage = storage;
      await el.refresh("");
      await el.updateComplete;
      const cards = el.querySelectorAll<HTMLElement>(".gallery-document-item");
      cards[0]!.click();
      await el.updateComplete;
      expect(el.getSelection().documents.map((d) => d.path)).toEqual(["a.annot.html"]);
      // Plain click on another doc replaces the selection.
      cards[1]!.click();
      await el.updateComplete;
      expect(el.getSelection().documents.map((d) => d.path)).toEqual(["b.annot.html"]);
      // Selected card carries `aria-pressed="true"` for a11y.
      expect(cards[1]!.getAttribute("aria-pressed")).toBe("true");
      expect(cards[0]!.getAttribute("aria-pressed")).toBe("false");
    });

    it("ctrl+click toggles a document into a multi-selection", async () => {
      const storage = makeDocCapableStorage({
        documents: [
          makeDocument("a.annot.html", { title: "A" }),
          makeDocument("b.annot.html", { title: "B" }),
          makeDocument("c.annot.html", { title: "C" }),
        ],
      });
      const el = mount();
      el.storage = storage;
      await el.refresh("");
      await el.updateComplete;
      const cards = el.querySelectorAll<HTMLElement>(".gallery-document-item");
      cards[0]!.click();
      cards[2]!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
      await el.updateComplete;
      const paths = el
        .getSelection()
        .documents.map((d) => d.path)
        .sort();
      expect(paths).toEqual(["a.annot.html", "c.annot.html"]);
    });

    it("shift+click range select walks anchor → target across documents", async () => {
      const storage = makeDocCapableStorage({
        documents: [
          makeDocument("a.annot.html"),
          makeDocument("b.annot.html"),
          makeDocument("c.annot.html"),
          makeDocument("d.annot.html"),
        ],
      });
      const el = mount();
      el.storage = storage;
      await el.refresh("");
      await el.updateComplete;
      const cards = el.querySelectorAll<HTMLElement>(".gallery-document-item");
      cards[0]!.click();
      cards[2]!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      await el.updateComplete;
      const paths = el
        .getSelection()
        .documents.map((d) => d.path)
        .sort();
      expect(paths).toEqual(["a.annot.html", "b.annot.html", "c.annot.html"]);
    });

    it("supports mixed selection — documents + images coexist", async () => {
      const storage = makeDocCapableStorage({
        images: [makeImage("a.png")],
        documents: [makeDocument("notes.annot.html", { title: "Notes" })],
      });
      const el = mount();
      el.storage = storage;
      await el.refresh("");
      await el.updateComplete;
      const docCard = el.querySelector<HTMLElement>(".gallery-document-item")!;
      const imgCard = el.querySelector<HTMLElement>(".gallery-item:not(.gallery-document-item)")!;
      docCard.click();
      imgCard.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
      await el.updateComplete;
      const sel = el.getSelection();
      expect(sel.documents.map((d) => d.path)).toEqual(["notes.annot.html"]);
      expect(sel.images.map((i) => i.path)).toEqual(["a.png"]);
    });

    it("clearSelection() empties documents along with images / folders", async () => {
      const storage = makeDocCapableStorage({
        documents: [makeDocument("a.annot.html")],
      });
      const el = mount();
      el.storage = storage;
      await el.refresh("");
      await el.updateComplete;
      el.querySelector<HTMLElement>(".gallery-document-item")!.click();
      await el.updateComplete;
      expect(el.totalSelectedCount).toBe(1);
      el.clearSelection();
      expect(el.totalSelectedCount).toBe(0);
      expect(el.getSelection().documents).toEqual([]);
    });
  });

  describe("documents bulk delete", () => {
    it("deleteSelection() removes every selected document via storage.deleteImage", async () => {
      const calls: string[] = [];
      const storage = makeDocCapableStorage({
        documents: [
          makeDocument("a.annot.html"),
          makeDocument("b.annot.html"),
          makeDocument("c.annot.html"),
        ],
        onDeleteImage: (path) => calls.push(path),
      });
      const el = mount();
      el.storage = storage;
      await el.refresh("");
      await el.updateComplete;
      const cards = el.querySelectorAll<HTMLElement>(".gallery-document-item");
      cards[0]!.click();
      cards[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
      await el.updateComplete;
      expect(el.getSelection().documents.length).toBe(2);

      // `deleteSelection` raises an `<annot-dialog>` and awaits
      // its `dialog-ok` event. We click the dialog's OK button
      // after the next microtask so the gallery's await resolves
      // through the existing showConfirmDialog promise wiring.
      const deletePromise = el.deleteSelection();
      await Promise.resolve();
      await Promise.resolve();
      const okBtn = document.querySelector<HTMLButtonElement>(".app-dialog-ok");
      expect(okBtn).not.toBeNull();
      okBtn!.click();
      await deletePromise;
      expect(calls.sort()).toEqual(["a.annot.html", "b.annot.html"]);
      // Documents listing reflects the deletion after the refresh.
      await el.updateComplete;
      const remaining = Array.from(el.querySelectorAll(".gallery-document-item")).map(
        (c) => (c as HTMLElement).dataset["documentPath"],
      );
      expect(remaining).toEqual(["c.annot.html"]);
    });
  });

  it("listDocuments errors gracefully fall back to an empty list", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = {
      async listImages() {
        return [];
      },
      async listFolders() {
        return [];
      },
      async getBreadcrumb() {
        return [];
      },
      listDocuments: vi.fn(async () => {
        throw new Error("boom");
      }),
      getDocument: async () => undefined,
      saveDocument: async () => "",
      updateDocument: async () => {},
    } as unknown as StorageProvider & StorageWithDocuments;
    const el = mount();
    el.storage = storage;
    await el.refresh("");
    await el.updateComplete;
    expect(el.documents).toEqual([]);
    expect(el.querySelector(".gallery-document-grid")).toBeNull();
    errorSpy.mockRestore();
  });
});
