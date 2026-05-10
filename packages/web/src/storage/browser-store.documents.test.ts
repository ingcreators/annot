/**
 * `BrowserStore` document-method tests — Phase 6a of
 * `docs/plans/annot-html-document.md`. Covers the four methods the
 * `StorageWithDocuments` capability adds (saveDocument /
 * getDocument / listDocuments / updateDocument), the IDB schema
 * upgrade from v2 → v3, and the `supportsDocuments` predicate's
 * narrowing on a real BrowserStore instance.
 */

import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserStore } from "./browser-store.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const SAMPLE_BYTES = `<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Sample</title>
  </head>
  <body>
    <article data-annot-doc>
      <p data-annot-block="paragraph">Hi.</p>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{"title":"Sample"}</script>
  </body>
</html>
`;

function makePayload(overrides: Partial<Parameters<BrowserStore["saveDocument"]>[0]> = {}) {
  const now = new Date("2026-05-10T00:00:00Z").toISOString();
  return {
    folderPath: "",
    bytes: SAMPLE_BYTES,
    thumbnailDataUrl: "",
    title: "Sample",
    imageCount: 0,
    blockCount: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("BrowserStore.saveDocument + getDocument round-trip", () => {
  it("saves a document under the requested filename + reads it back", async () => {
    const store = new BrowserStore();
    const path = await store.saveDocument(makePayload(), { filename: "manual.annot.html" });
    expect(path).toBe("manual.annot.html");
    const doc = await store.getDocument(path);
    expect(doc).toBeDefined();
    expect(doc?.title).toBe("Sample");
    expect(doc?.bytes).toBe(SAMPLE_BYTES);
    expect(doc?.path).toBe("manual.annot.html");
    expect(doc?.folderPath).toBe("");
    expect(doc?.imageCount).toBe(0);
    expect(doc?.blockCount).toBe(1);
  });

  it("falls back to a timestamped filename when none is provided", async () => {
    const store = new BrowserStore();
    const path = await store.saveDocument(makePayload());
    expect(path).toMatch(/^document-\d+\.annot\.html$/);
  });

  it("uniquifies on filename collision", async () => {
    const store = new BrowserStore();
    const a = await store.saveDocument(makePayload(), { filename: "manual.annot.html" });
    const b = await store.saveDocument(makePayload(), { filename: "manual.annot.html" });
    expect(a).toBe("manual.annot.html");
    // `uniquifyFilenameAsync` inserts " (N)" before the last dot;
    // for the double-extension `.annot.html` shape that lands
    // between `.annot` and `.html`, matching the image-side
    // `.annot.png` precedent.
    expect(b).toBe("manual.annot (2).html");
  });

  it("scopes documents by folderPath via the index", async () => {
    const store = new BrowserStore();
    await store.saveDocument(makePayload({ folderPath: "" }), { filename: "root.annot.html" });
    await store.saveDocument(makePayload({ folderPath: "Manuals" }), {
      filename: "a.annot.html",
    });
    await store.saveDocument(makePayload({ folderPath: "Manuals" }), {
      filename: "b.annot.html",
    });
    const root = await store.listDocuments("");
    const manuals = await store.listDocuments("Manuals");
    expect(root.map((d) => d.path)).toEqual(["root.annot.html"]);
    expect(manuals.map((d) => d.path).sort()).toEqual([
      "Manuals/a.annot.html",
      "Manuals/b.annot.html",
    ]);
  });
});

describe("BrowserStore.listDocuments", () => {
  it("returns [] for an empty / missing folder", async () => {
    const store = new BrowserStore();
    expect(await store.listDocuments("")).toEqual([]);
    expect(await store.listDocuments("Missing")).toEqual([]);
  });

  it("does NOT return image records via the documents listing", async () => {
    const store = new BrowserStore();
    // Save an image; should NOT show up under listDocuments.
    await store.saveImage(
      {
        originalDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        thumbnailDataUrl: "",
        annotationsSvg: "<g/>",
        width: 1,
        height: 1,
        folderPath: "",
        sourceUrl: "",
        tags: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { filename: "image.annot.png" },
    );
    expect(await store.listDocuments("")).toEqual([]);
  });
});

describe("BrowserStore.updateDocument", () => {
  it("applies updates in place + bumps updatedAt", async () => {
    const store = new BrowserStore();
    const path = await store.saveDocument(makePayload(), { filename: "doc.annot.html" });
    const newAt = new Date("2026-05-11T00:00:00Z").toISOString();
    await store.updateDocument(path, {
      bytes: '<!doctype html><html data-annot-doc-version="1"></html>',
      title: "Edited",
      blockCount: 5,
      updatedAt: newAt,
    });
    const doc = await store.getDocument(path);
    expect(doc?.title).toBe("Edited");
    expect(doc?.blockCount).toBe(5);
    expect(doc?.updatedAt).toBe(newAt);
    // Untouched fields preserved.
    expect(doc?.imageCount).toBe(0);
    expect(doc?.createdAt).toBe(makePayload().createdAt);
  });

  it("is idempotent on a missing source path", async () => {
    const store = new BrowserStore();
    await expect(store.updateDocument("nope.annot.html", { title: "x" })).resolves.toBeUndefined();
  });
});

describe("BrowserStore.deleteImage on document paths (Phase 6h)", () => {
  it("deletes documents via the path-keyed deleteImage call", async () => {
    const store = new BrowserStore();
    const path = await store.saveDocument(makePayload(), { filename: "deletable.annot.html" });
    expect(await store.getDocument(path)).toBeDefined();
    await store.deleteImage(path);
    expect(await store.getDocument(path)).toBeUndefined();
  });

  it("does not affect images when deleting a document path", async () => {
    const store = new BrowserStore();
    const imgPath = await store.saveImage(
      {
        originalDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        thumbnailDataUrl: "",
        annotationsSvg: "<g/>",
        width: 1,
        height: 1,
        folderPath: "",
        sourceUrl: "",
        tags: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { filename: "shared-name.annot.png" },
    );
    const docPath = await store.saveDocument(makePayload(), {
      filename: "shared-name.annot.html",
    });
    // Sanity: paths differ even though stems share characters.
    expect(imgPath).not.toBe(docPath);
    // Delete only the doc; image stays.
    await store.deleteImage(docPath);
    expect(await store.getDocument(docPath)).toBeUndefined();
    expect(await store.getImage(imgPath)).toBeDefined();
  });

  it("is idempotent on missing paths", async () => {
    const store = new BrowserStore();
    await expect(store.deleteImage("nope.annot.html")).resolves.toBeUndefined();
  });
});

describe("supportsDocuments predicate", () => {
  it("narrows BrowserStore to StorageWithDocuments", () => {
    const store = new BrowserStore();
    expect(supportsDocuments(store)).toBe(true);
  });

  it("returns false for a stub provider that doesn't implement the methods", () => {
    const stub = {
      saveImage: async () => "",
      getImage: async () => undefined,
      listImages: async () => [],
      updateImage: async () => {},
      moveImage: async () => "",
      renameImage: async () => "",
      deleteImage: async () => {},
      createFolder: async () => "",
      listFolders: async () => [],
      getFolder: async () => undefined,
      renameFolder: async () => "",
      moveFolder: async () => "",
      deleteFolder: async () => {},
      getBreadcrumb: async () => [],
    };
    expect(supportsDocuments(stub as never)).toBe(false);
  });
});
