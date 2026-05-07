/**
 * Targeted gap-fill tests for `BrowserStore` — covers the methods
 * the shared StorageProvider contract (driven by
 * `browser-store.contract.test.ts`) doesn't reach:
 *
 *   - `thumbnailKey(path)` — namespaced cache key returned to the
 *     unified `ThumbnailManager` so two storage backends can't
 *     collide on identical paths.
 *   - `thumbnailVersion(path)` — empty-string sentinel because no
 *     external writer exists for the BrowserStore IDB.
 *   - `fetchThumbnailSource(path)` — manager calls this when the
 *     thumbnail cache misses; it pulls the record's
 *     `originalDataUrl` back through `fetch()` for re-rasterization.
 *   - `moveFolder` collision branch — the contract test exercises
 *     the rename-collision (line 287) but not the cross-parent
 *     move-collision (line 299).
 */

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageConflictError } from "@ingcreators/annot-core/storage";
import { BrowserStore } from "./browser-store.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const TINY_PNG_DATA_URL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function makeStoreWithImage(
  store: BrowserStore,
  attrs: Partial<{ folderPath: string; filename: string; originalDataUrl: string }> = {},
): Promise<string> {
  return store.saveImage(
    {
      originalDataUrl: attrs.originalDataUrl ?? TINY_PNG_DATA_URL,
      thumbnailDataUrl: "",
      annotationsSvg: "<g/>",
      width: 1,
      height: 1,
      folderPath: attrs.folderPath ?? "",
      sourceUrl: "",
      tags: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { filename: attrs.filename ?? "test.annot.png" },
  );
}

describe("BrowserStore.thumbnailKey + thumbnailVersion", () => {
  it("thumbnailKey returns the path prefixed with 'browser:' so two backends can't collide on identical paths", () => {
    const store = new BrowserStore();
    expect(store.thumbnailKey("Inbox/foo.annot.png")).toBe("browser:Inbox/foo.annot.png");
    expect(store.thumbnailKey("")).toBe("browser:");
    expect(store.thumbnailKey("a/b/c.svg")).toBe("browser:a/b/c.svg");
  });

  it("thumbnailVersion returns the empty-string sentinel (no external writer to detect)", () => {
    const store = new BrowserStore();
    expect(store.thumbnailVersion("anything")).toBe("");
    expect(store.thumbnailVersion("")).toBe("");
  });
});

describe("BrowserStore.fetchThumbnailSource", () => {
  it("returns undefined when no record exists at the path", async () => {
    const store = new BrowserStore();
    expect(await store.fetchThumbnailSource("Inbox/missing.annot.png")).toBeUndefined();
  });

  it("returns undefined when the record exists but has no originalDataUrl", async () => {
    const store = new BrowserStore();
    const path = await makeStoreWithImage(store, { originalDataUrl: "" });
    expect(await store.fetchThumbnailSource(path)).toBeUndefined();
  });

  it("returns the originalDataUrl as a Blob when the record exists + the data URL fetches cleanly", async () => {
    const store = new BrowserStore();
    const path = await makeStoreWithImage(store);
    const blob = await store.fetchThumbnailSource(path);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("image/png");
    expect(blob!.size).toBeGreaterThan(0);
  });
});

describe("BrowserStore.moveFolder — collision branch", () => {
  it("throws StorageConflictError when the destination already contains a folder of the same name", async () => {
    const store = new BrowserStore();
    // Source: /A, target parent: /B, collision: /B/A
    await store.createFolder("", "A");
    await store.createFolder("", "B");
    await store.createFolder("B", "A"); // pre-existing /B/A
    await expect(store.moveFolder("A", "B")).rejects.toBeInstanceOf(StorageConflictError);
  });

  it("succeeds when the destination has no name collision (happy-path control)", async () => {
    const store = new BrowserStore();
    await store.createFolder("", "A");
    await store.createFolder("", "B");
    // No /B/A pre-exists.
    const newPath = await store.moveFolder("A", "B");
    expect(newPath).toBe("B/A");
  });

  it("returns the original path unchanged when newParentPath equals the existing parent (no-op move)", async () => {
    const store = new BrowserStore();
    await store.createFolder("", "Parent");
    await store.createFolder("Parent", "Child");
    const result = await store.moveFolder("Parent/Child", "Parent");
    expect(result).toBe("Parent/Child");
  });
});
