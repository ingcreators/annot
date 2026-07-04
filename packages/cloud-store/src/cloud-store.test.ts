// End-to-end tests for `AnnotCloudStore` against an in-process
// mock worker. Mock implements the request shapes the real worker
// exposes (see `packages/worker/src/index.ts`), so request/response
// flow exercises the same wire contract.

import { StoragePermissionError, StorageQuotaError } from "@ingcreators/annot-core/storage";
import { describe, expect, it } from "vitest";
import { AnnotCloudStore } from "./cloud-store.js";
import { bytesToDataUrl } from "./data-url.js";
import { makeMockWorker } from "./mock-worker.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = bytesToDataUrl(PNG_BYTES, "image/png");

async function makeStoreWithMock(options: Parameters<typeof makeMockWorker>[0] = {}) {
  const mock = makeMockWorker(options);
  const store = new AnnotCloudStore({
    baseUrl: "http://test.local",
    fetchImpl: mock.fetch,
  });
  return { mock, store };
}

// ─── init / auth ────────────────────────────────────────────────

describe("AnnotCloudStore.init", () => {
  it("hits /api/auth/me + caches the workspaceId for the namespace", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    expect(store.metadataNamespace()).toBe("annotcloud:ws-mock");
    expect(mock.requests[0]).toEqual({ method: "GET", url: "/api/auth/me" });
  });

  it("throws StoragePermissionError when the session has expired", async () => {
    const { store } = await makeStoreWithMock({ forceUnauthenticated: true });
    await expect(store.init()).rejects.toBeInstanceOf(StoragePermissionError);
  });

  it("metadataNamespace throws before init()", async () => {
    const { store } = await makeStoreWithMock();
    expect(() => store.metadataNamespace()).toThrow(/init.* must run/);
  });
});

// ─── saveImage ──────────────────────────────────────────────────

describe("AnnotCloudStore.saveImage", () => {
  it("POSTs the original bytes, PATCHes annotations, returns the path", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    const path = await store.saveImage(
      {
        folderPath: "",
        originalDataUrl: PNG_DATA_URL,
        thumbnailDataUrl: "",
        annotationsSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
        width: 1280,
        height: 720,
        sourceUrl: "https://example.com",
        tags: {},
        createdAt: "2026-05-18T00:00:00Z",
        updatedAt: "2026-05-18T00:00:00Z",
      },
      { filename: "screenshot.png" },
    );
    expect(path).toBe("screenshot.png");
    expect(mock.images()).toHaveLength(1);
    const wire = mock.images()[0]!;
    expect(wire.path).toBe("screenshot.png");
    expect(wire.width).toBe(1280);
    expect(wire.height).toBe(720);
    expect(wire.sourceUrl).toBe("https://example.com");
    expect(wire.hasAnnotations).toBe(true);
    // R2-side bytes match.
    expect(mock.imageBytes(wire.id)).toEqual(PNG_BYTES);
    expect(mock.imageAnnotations(wire.id)).toMatch(/<svg/);
  });

  it("auto-uniquifies on path collision", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES });

    const path = await store.saveImage(
      {
        folderPath: "",
        originalDataUrl: PNG_DATA_URL,
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: 0,
        height: 0,
        sourceUrl: "",
        tags: {},
        createdAt: "",
        updatedAt: "",
      },
      { filename: "shot.png" },
    );
    expect(path).toBe("shot (2).png");
  });

  it("respects nested folder paths", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    const path = await store.saveImage(
      {
        folderPath: "Screenshots/Mobile",
        originalDataUrl: PNG_DATA_URL,
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: 0,
        height: 0,
        sourceUrl: "",
        tags: {},
        createdAt: "",
        updatedAt: "",
      },
      { filename: "iphone.png" },
    );
    expect(path).toBe("Screenshots/Mobile/iphone.png");
    expect(mock.images()[0]!.path).toBe("Screenshots/Mobile/iphone.png");
  });

  it("translates 413 quota_exceeded → StorageQuotaError", async () => {
    const { store } = await makeStoreWithMock({ storageCapBytes: 4 });
    await store.init();
    await expect(
      store.saveImage(
        {
          folderPath: "",
          originalDataUrl: PNG_DATA_URL,
          thumbnailDataUrl: "",
          annotationsSvg: "",
          width: 0,
          height: 0,
          sourceUrl: "",
          tags: {},
          createdAt: "",
          updatedAt: "",
        },
        { filename: "huge.png" },
      ),
    ).rejects.toBeInstanceOf(StorageQuotaError);
  });
});

// ─── getImage ───────────────────────────────────────────────────

describe("AnnotCloudStore.getImage", () => {
  it("returns the full record including bytes + annotations", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({
      path: "shot.png",
      bytes: PNG_BYTES,
      width: 800,
      height: 600,
      annotationsSvg: "<svg/>",
      tags: { reviewed: "true" },
    });
    const record = await store.getImage("shot.png");
    expect(record).toBeDefined();
    expect(record?.path).toBe("shot.png");
    expect(record?.width).toBe(800);
    expect(record?.height).toBe(600);
    expect(record?.annotationsSvg).toBe("<svg/>");
    expect(record?.tags).toEqual({ reviewed: "true" });
    // Original bytes round-trip through base64.
    expect(record?.originalDataUrl).toBe(PNG_DATA_URL);
  });

  it("returns undefined for unknown paths", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    expect(await store.getImage("does-not-exist.png")).toBeUndefined();
  });

  it("tolerates a missing annotations sidecar (404)", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "plain.png", bytes: PNG_BYTES });
    const record = await store.getImage("plain.png");
    expect(record?.annotationsSvg).toBe("");
  });
});

// ─── annotations YAML sidecar ───────────────────────────────────

describe("AnnotCloudStore annotations-yaml sidecar", () => {
  const YAML = "version: 1\noverlays:\n  - ref: e2\n    intent: primary\n";

  it("getAnnotationsYaml returns undefined for an unknown path", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    expect(await store.getAnnotationsYaml("nope.png")).toBeUndefined();
  });

  it("getAnnotationsYaml returns undefined when the image has no sidecar", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES });
    expect(await store.getAnnotationsYaml("shot.png")).toBeUndefined();
  });

  it("set then get round-trips the yaml", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES });
    await store.setAnnotationsYaml("shot.png", YAML);
    expect(await store.getAnnotationsYaml("shot.png")).toBe(YAML);
  });

  it("getAnnotationsYaml reads a seeded sidecar", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES, annotationsYaml: YAML });
    expect(await store.getAnnotationsYaml("shot.png")).toBe(YAML);
  });

  it("setAnnotationsYaml replaces existing content", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES, annotationsYaml: YAML });
    await store.setAnnotationsYaml("shot.png", "version: 1\noverlays: []\n");
    expect(await store.getAnnotationsYaml("shot.png")).toBe("version: 1\noverlays: []\n");
  });

  it("setAnnotationsYaml throws when the image doesn't exist", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    await expect(store.setAnnotationsYaml("ghost.png", YAML)).rejects.toThrow(/no image/);
  });

  it("supportsAnnotationsYaml narrows the store", async () => {
    const { store } = await makeStoreWithMock();
    expect(typeof store.getAnnotationsYaml).toBe("function");
    expect(typeof store.setAnnotationsYaml).toBe("function");
  });
});

// ─── listImages ─────────────────────────────────────────────────

describe("AnnotCloudStore.listImages", () => {
  it("returns lightweight records sorted by path with empty bytes", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Screenshots/b.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Screenshots/a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Screenshots/sub/c.png", bytes: PNG_BYTES });

    const list = await store.listImages("Screenshots");
    // StorageProvider.listImages does NOT recurse. The worker's
    // prefix filter returns the descendant too, and the store
    // filters it back out before returning.
    expect(list.map((r) => r.path).sort()).toEqual(["Screenshots/a.png", "Screenshots/b.png"]);
    // Lightweight: no bytes carried.
    for (const r of list) {
      expect(r.originalDataUrl).toBe("");
      expect(r.thumbnailDataUrl).toBe("");
      expect(r.annotationsSvg).toBe("");
    }
  });

  it("returns the workspace root for empty folderPath", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "b.png", bytes: PNG_BYTES });
    const list = await store.listImages("");
    expect(list).toHaveLength(2);
  });

  it("does NOT include files in subfolders when listing the root", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "root.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Screenshots/nested.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Screenshots/deep/sub.png", bytes: PNG_BYTES });
    const list = await store.listImages("");
    expect(list.map((r) => r.path)).toEqual(["root.png"]);
  });
});

// ─── updateImage ────────────────────────────────────────────────

describe("AnnotCloudStore.updateImage", () => {
  it("patches annotations without touching other fields", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    const wire = mock.seedImage({ path: "shot.png", bytes: PNG_BYTES });
    await store.updateImage("shot.png", { annotationsSvg: "<svg/>" });
    expect(mock.imageAnnotations(wire.id)).toBe("<svg/>");
    // No tag change yet.
    expect(mock.images()[0]!.tags).toEqual({});
  });

  it("patches tags via JSON PATCH", async () => {
    const { mock, store } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES });
    await store.updateImage("shot.png", { tags: { stage: "review" } });
    expect(mock.images()[0]!.tags).toEqual({ stage: "review" });
  });

  it("is a no-op when the image doesn't exist (idempotent)", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    await store.updateImage("missing.png", { annotationsSvg: "<svg/>" });
    // No throw means the contract was honoured.
  });
});

// ─── moveImage / renameImage / deleteImage ──────────────────────

describe("AnnotCloudStore.moveImage", () => {
  it("changes the path's parent folder", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "a.png", bytes: PNG_BYTES });
    const newPath = await store.moveImage("a.png", "Archive");
    expect(newPath).toBe("Archive/a.png");
    expect(mock.images()[0]!.path).toBe("Archive/a.png");
  });

  it("auto-uniquifies on collision at the destination", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Archive/a.png", bytes: PNG_BYTES });
    const newPath = await store.moveImage("a.png", "Archive");
    expect(newPath).toBe("Archive/a (2).png");
  });
});

describe("AnnotCloudStore.renameImage", () => {
  it("changes the filename in place", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "old.png", bytes: PNG_BYTES });
    const newPath = await store.renameImage("old.png", "new.png");
    expect(newPath).toBe("new.png");
    expect(mock.images()[0]!.path).toBe("new.png");
  });

  it("throws StorageConflictError on collision (no auto-uniquify)", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "b.png", bytes: PNG_BYTES });
    const { StorageConflictError } = await import("@ingcreators/annot-core/storage");
    await expect(store.renameImage("a.png", "b.png")).rejects.toBeInstanceOf(StorageConflictError);
  });
});

describe("AnnotCloudStore.deleteImage", () => {
  it("removes the row", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "doomed.png", bytes: PNG_BYTES });
    await store.deleteImage("doomed.png");
    expect(mock.images()).toHaveLength(0);
  });

  it("is idempotent on missing paths", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    await store.deleteImage("ghost.png");
    // No throw.
  });

  it("preserves the containing folder hierarchy via phantoms", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Trip/Day1/photo.png", bytes: PNG_BYTES });
    // Sanity: the folder is visible via path derivation before delete.
    const beforeRoot = await store.listFolders("");
    expect(beforeRoot.map((f) => f.name)).toContain("Trip");
    await store.deleteImage("Trip/Day1/photo.png");
    // After deleting the only image, the folder hierarchy must
    // still be visible — the user explicitly removed the image,
    // not the folder.
    const root = await store.listFolders("");
    expect(root.map((f) => f.name)).toContain("Trip");
    const trip = await store.listFolders("Trip");
    expect(trip.map((f) => f.name)).toContain("Day1");
  });
});

// ─── folders (virtual) ──────────────────────────────────────────

describe("AnnotCloudStore folder operations", () => {
  it("derives folders from image paths during listFolders", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Screenshots/a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Screenshots/b.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Manuals/m1.png", bytes: PNG_BYTES });

    const root = await store.listFolders("");
    expect(root.map((f) => f.name).sort()).toEqual(["Manuals", "Screenshots"]);
  });

  it("derives nested folders", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Screenshots/Mobile/a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Screenshots/Desktop/b.png", bytes: PNG_BYTES });

    const screenshots = await store.listFolders("Screenshots");
    expect(screenshots.map((f) => f.name).sort()).toEqual(["Desktop", "Mobile"]);
  });

  it("createFolder adds a phantom folder visible in listFolders until reload", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    await store.createFolder("", "Empty");
    const root = await store.listFolders("");
    expect(root.map((f) => f.name)).toContain("Empty");
  });

  it("createFolder throws StorageConflictError on collision", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Photos/a.png", bytes: PNG_BYTES });
    const { StorageConflictError } = await import("@ingcreators/annot-core/storage");
    await expect(store.createFolder("", "Photos")).rejects.toBeInstanceOf(StorageConflictError);
  });

  it("renameFolder rewrites every descendant's path", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Old/a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Old/sub/b.png", bytes: PNG_BYTES });
    await store.renameFolder("Old", "New");
    const paths = mock
      .images()
      .map((w) => w.path)
      .sort();
    expect(paths).toEqual(["New/a.png", "New/sub/b.png"]);
  });

  it("moveFolder rewrites every descendant's path", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "src/a.png", bytes: PNG_BYTES });
    await store.moveFolder("src", "dest");
    expect(mock.images()[0]!.path).toBe("dest/src/a.png");
  });

  it("deleteFolder removes every image under the prefix", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "Junk/a.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Junk/b.png", bytes: PNG_BYTES });
    mock.seedImage({ path: "Keep/c.png", bytes: PNG_BYTES });
    await store.deleteFolder("Junk");
    expect(mock.images().map((w) => w.path)).toEqual(["Keep/c.png"]);
  });

  it("getBreadcrumb walks ancestor folders that exist", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "A/B/C/d.png", bytes: PNG_BYTES });
    const crumbs = await store.getBreadcrumb("A/B/C");
    expect(crumbs.map((f) => f.path)).toEqual(["A", "A/B", "A/B/C"]);
  });
});

// ─── documents ──────────────────────────────────────────────────

describe("AnnotCloudStore document methods", () => {
  it("saveDocument + getDocument round-trip", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    const path = await store.saveDocument(
      {
        folderPath: "",
        bytes: "<!doctype html><html><body>hi</body></html>",
        thumbnailDataUrl: "",
        title: "Test Doc",
        imageCount: 0,
        blockCount: 3,
        createdAt: "",
        updatedAt: "",
      },
      { filename: "test.annot.html" },
    );
    expect(path).toBe("test.annot.html");
    expect(mock.documents()).toHaveLength(1);
    expect(mock.documents()[0]!.title).toBe("Test Doc");
    expect(mock.documents()[0]!.blockCount).toBe(3);

    const got = await store.getDocument("test.annot.html");
    expect(got?.bytes).toBe("<!doctype html><html><body>hi</body></html>");
    expect(got?.title).toBe("Test Doc");
  });

  it("listDocuments returns lightweight records", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedDocument({ path: "a.annot.html", bytes: "<html></html>", title: "A" });
    mock.seedDocument({ path: "b.annot.html", bytes: "<html></html>", title: "B" });
    const list = await store.listDocuments("");
    expect(list.map((r) => r.title).sort()).toEqual(["A", "B"]);
    for (const r of list) expect(r.bytes).toBe("");
  });

  it("listDocuments does NOT include subfolder documents when listing the root", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedDocument({ path: "root.annot.html", bytes: "<html></html>", title: "Root" });
    mock.seedDocument({
      path: "Folder/nested.annot.html",
      bytes: "<html></html>",
      title: "Nested",
    });
    const list = await store.listDocuments("");
    expect(list.map((r) => r.title)).toEqual(["Root"]);
  });

  it("updateDocument with bytes routes through the content endpoint", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    const wire = mock.seedDocument({
      path: "doc.annot.html",
      bytes: "<html>old</html>",
      title: "Old",
    });
    await store.updateDocument("doc.annot.html", {
      bytes: "<html>new</html>",
      title: "New",
      blockCount: 7,
    });
    const text = new TextDecoder().decode(mock.documentBytes(wire.id)!);
    expect(text).toBe("<html>new</html>");
    expect(mock.documents()[0]!.title).toBe("New");
    expect(mock.documents()[0]!.blockCount).toBe(7);
  });
});

// ─── StorageWithThumbnailCache ──────────────────────────────────

describe("AnnotCloudStore thumbnail cache hooks", () => {
  it("thumbnailKey is workspace-scoped", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    expect(store.thumbnailKey("shot.png")).toBe("annotcloud:ws-mock:shot.png");
  });

  it("fetchThumbnailSource returns the original bytes as a Blob", async () => {
    const { store, mock } = await makeStoreWithMock();
    await store.init();
    mock.seedImage({ path: "shot.png", bytes: PNG_BYTES });
    const blob = await store.fetchThumbnailSource("shot.png");
    expect(blob).toBeDefined();
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(bytes).toEqual(PNG_BYTES);
  });

  it("fetchThumbnailSource returns undefined for missing images", async () => {
    const { store } = await makeStoreWithMock();
    await store.init();
    expect(await store.fetchThumbnailSource("nope.png")).toBeUndefined();
  });
});
