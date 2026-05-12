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
}): StorageProvider & StorageWithDocuments {
  const images = opts.images ?? [];
  const documents = opts.documents ?? [];
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
