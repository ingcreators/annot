/**
 * @vitest-environment happy-dom
 *
 * DeviceStore × MetadataCache integration — Phase 3 of
 * `docs/plans/shared-metadata-cache.md`. Validates the cache-driven
 * behaviour layered on top of the existing contract surface:
 *
 *   - The legacy `.annot.json` sidecar is ignored on read and never
 *     written. A file with that name in the directory does NOT appear
 *     in `listImages` results.
 *   - First `listImages` populates the IDB cache from XMP.
 *   - Subsequent `listImages` hits the cache when mtimes are
 *     unchanged.
 *   - mtime change triggers a single-file re-read, not a folder-wide
 *     re-scan.
 *   - `attachMetadataCache` is required before `init()` / any
 *     mutation — calling without one throws.
 */

import { IndexedDBMetadataCache } from "@ingcreators/annot-host-ui/idb-metadata-cache";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRoot, type MockDirectoryHandle } from "./device-fs.test-mock.js";
import { DeviceStore } from "./device-store.js";

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function buildStore() {
  const root = createMockRoot();
  const store = new DeviceStore(root as unknown as FileSystemDirectoryHandle);
  const cache = new IndexedDBMetadataCache({
    channelName: `device-store-mdcache-${Math.random().toString(36).slice(2)}`,
    dispatchWindowEvents: false,
  });
  store.attachMetadataCache(cache);
  return { root, store, cache };
}

const tinyPng =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makePayload(folder = "") {
  const now = new Date().toISOString();
  return {
    folderPath: folder,
    originalDataUrl: tinyPng,
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width: 1,
    height: 1,
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
  };
}

describe("DeviceStore × MetadataCache — `.annot.json` is ignored", () => {
  it("does not appear in listImages and isn't read on init", async () => {
    const { root, store } = buildStore();

    // Pre-seed a legacy sidecar with garbage. If the store reads it
    // and trusts it, the test would fail because `listImages` would
    // surface bogus entries.
    const sidecarHandle = await root.getFileHandle(".annot.json", { create: true });
    const writable = await sidecarHandle.createWritable();
    await writable.write(
      JSON.stringify({
        images: {
          "bogus.png": { createdAt: "2099-01-01", tags: {}, width: 0, height: 0 },
        },
      }),
    );
    await writable.close();

    // Save an actual image so the store has something legitimate to find.
    await store.saveImage(makePayload(), { filename: "real.annot.png" });

    await store.init();

    const list = await store.listImages("");
    expect(list.map((r) => r.path).sort()).toEqual(["real.annot.png"]);
  });

  it("save / update do not regenerate `.annot.json` on disk", async () => {
    const { root, store } = buildStore();
    await store.saveImage(makePayload(), { filename: "x.annot.png" });
    await store.updateImage("x.annot.png", { tags: { source: "test" } });
    // No `.annot.json` should have appeared.
    let hasIndex = false;
    for await (const [name] of (root as unknown as FileSystemDirectoryHandle).entries()) {
      if (name === ".annot.json") hasIndex = true;
    }
    expect(hasIndex).toBe(false);
  });
});

describe("DeviceStore × MetadataCache — cache hit / miss semantics", () => {
  it("populates the cache on first listImages and serves it on the second", async () => {
    const { root, store, cache } = buildStore();

    // Drop a file directly through the FSA mock (no saveImage), so
    // the store has no prior knowledge of it.
    await dropPng(root, "image.png", tinyPng);

    // First listImages: cache miss → reads XMP, populates cache.
    const first = await store.listImages("");
    expect(first.map((r) => r.path)).toEqual(["image.png"]);

    // Cache should now have a row for that path under the store's
    // namespace.
    const ns = store.metadataNamespace();
    const file = await (
      await (root as unknown as FileSystemDirectoryHandle).getFileHandle("image.png")
    ).getFile();
    const version = String(file.lastModified);
    expect(await cache.getImage(ns, "image.png", version)).toBeDefined();

    // Second listImages: cache hit returns same result without
    // requiring re-population.
    const second = await store.listImages("");
    expect(second.map((r) => r.path)).toEqual(["image.png"]);
  });

  it("mtime change refreshes only the affected entry", async () => {
    const { root, store, cache } = buildStore();
    await dropPng(root, "a.png", tinyPng);
    await dropPng(root, "b.png", tinyPng);
    await store.listImages(""); // populate cache

    const ns = store.metadataNamespace();

    // Spy on cache.putImage to count refreshes during the next list.
    const putSpy = vi.spyOn(cache, "putImage");

    // Mutate `a.png` so its mtime version advances. The FSA mock's
    // `createWritable` increments `lastModified`.
    await dropPng(root, "a.png", tinyPng);
    await store.listImages("");

    // Only `a.png` should have been re-cached. `b.png` stayed at the
    // same mtime so its cache row was reused.
    const aPuts = putSpy.mock.calls.filter(([, path]) => path === "a.png");
    const bPuts = putSpy.mock.calls.filter(([, path]) => path === "b.png");
    expect(aPuts.length).toBeGreaterThanOrEqual(1);
    expect(bPuts.length).toBe(0);
    void ns;
  });
});

describe("DeviceStore × MetadataCache — attach is required", () => {
  it("throws on cache-using methods when no cache is attached", async () => {
    const store = new DeviceStore(createMockRoot() as unknown as FileSystemDirectoryHandle);
    await expect(store.init()).rejects.toThrow(/MetadataCache not attached/);
    await expect(store.listImages("")).rejects.toThrow(/MetadataCache not attached/);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────

async function dropPng(root: MockDirectoryHandle, name: string, dataUrl: string): Promise<void> {
  // Decode base64 PNG payload and write straight to the FSA mock.
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const handle = await (root as unknown as FileSystemDirectoryHandle).getFileHandle(name, {
    create: true,
  });
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}
