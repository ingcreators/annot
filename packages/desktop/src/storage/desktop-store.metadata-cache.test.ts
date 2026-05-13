/**
 * @vitest-environment happy-dom
 *
 * `DesktopStore` × `MetadataCache` integration — Phase 4 of
 * `docs/plans/shared-metadata-cache.md`. Mirrors the
 * `device-store.metadata-cache.test.ts` shape:
 *
 *   - The legacy `.annot.json` sidecar is ignored on read and never
 *     written.
 *   - First `listImages` populates the IDB cache from XMP; mtime
 *     change triggers single-file re-read.
 *   - `attachMetadataCache` is required before `init()` / any
 *     mutation.
 */

import { DEFAULT_ENCODE_OPTIONS } from "@ingcreators/annot-core/encode";
import { createEditableImage } from "@ingcreators/annot-core/xmp";
import { IndexedDBMetadataCache } from "@ingcreators/annot-host-ui/idb-metadata-cache";
import type { BuildEditableImageDeps } from "@ingcreators/annot-web/storage/image-encode";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { DesktopFs } from "./desktop-fs.js";
import { createMockDesktopFs } from "./desktop-fs.test-mock.js";
import { DesktopStore } from "./desktop-store.js";

const stubDeps: BuildEditableImageDeps = {
  renderImageRecord: async () => {
    throw new Error("renderImageRecord should not be called in metadata-cache tests");
  },
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl, chosen: "png" }),
  loadEncodeOptions: () => DEFAULT_ENCODE_OPTIONS,
  createEditableImage,
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function buildStore() {
  const fs = createMockDesktopFs();
  const store = new DesktopStore(fs, "mock-library", stubDeps);
  const cache = new IndexedDBMetadataCache({
    channelName: `desktop-store-mdcache-${Math.random().toString(36).slice(2)}`,
    dispatchWindowEvents: false,
  });
  store.attachMetadataCache(cache);
  return { fs, store, cache };
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

describe("DesktopStore × MetadataCache — legacy sidecar is ignored", () => {
  it("does not appear in listImages and isn't read on init", async () => {
    const { fs, store } = buildStore();

    // Pre-seed a legacy sidecar with garbage.
    await fs.writeFile(
      ".annot.json",
      new TextEncoder().encode(
        JSON.stringify({
          images: {
            "bogus.png": { createdAt: "2099-01-01", tags: {}, width: 0, height: 0 },
          },
        }),
      ),
    );

    await store.saveImage(makePayload(), { filename: "real.png" });
    await store.init();

    const list = await store.listImages("");
    expect(list.map((r) => r.path).sort()).toEqual(["real.png"]);
  });

  it("save / update do not regenerate `.annot.json` on disk", async () => {
    const { fs, store } = buildStore();
    await store.saveImage(makePayload(), { filename: "x.png" });
    await store.updateImage("x.png", { tags: { source: "test" } });
    const entries = await fs.readDir("");
    expect(entries.find((e) => e.name === ".annot.json")).toBeUndefined();
  });
});

describe("DesktopStore × MetadataCache — cache populate / mtime-driven refresh", () => {
  it("populates the cache on first listImages", async () => {
    const { fs, store, cache } = buildStore();
    await dropPng(fs, "image.png");

    const first = await store.listImages("");
    expect(first.map((r) => r.path)).toEqual(["image.png"]);

    const ns = store.metadataNamespace();
    const stat = await fs.stat("image.png");
    const version = String(stat?.mtime ?? 0);
    expect(await cache.getImage(ns, "image.png", version)).toBeDefined();
  });
});

describe("DesktopStore × MetadataCache — attach is required", () => {
  it("throws on cache-using methods when no cache is attached", async () => {
    const store = new DesktopStore(createMockDesktopFs(), "mock-library", stubDeps);
    await expect(store.init()).rejects.toThrow(/MetadataCache not attached/);
    await expect(store.listImages("")).rejects.toThrow(/MetadataCache not attached/);
  });
});

async function dropPng(fs: DesktopFs, name: string): Promise<void> {
  // Decode the base64 PNG payload and write straight to the mock FS.
  const base64 = tinyPng.split(",", 2)[1] ?? "";
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  await fs.writeFile(name, bytes);
}
