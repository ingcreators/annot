// @vitest-environment happy-dom
import { IndexedDBMetadataCache } from "@ingcreators/annot-host-ui/idb-metadata-cache";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRoot } from "./device-fs.test-mock.js";
import { DeviceStore } from "./device-store.js";

/**
 * Raw-raster dimension probing in `DeviceStore.getImage`.
 *
 * An external image dropped into a device folder carries no XMP
 * packet, so `readEditableImage` returns null and the record's
 * width / height used to come out 0×0 — which mounts a 0×0 canvas
 * svg (blank editor) since the shell sizes the canvas from the
 * record, not from the decoded bitmap. `getImage` now probes the
 * pixel dimensions via `createImageBitmap` on that fallback path,
 * mirroring the vscode webview and DesktopStore.
 *
 * happy-dom has no `createImageBitmap`, so the probe is stubbed —
 * which also pins the fail-soft contract for environments where
 * decoding is unavailable.
 */

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

// 1x1 transparent PNG, smallest valid payload.
const TINY_PNG =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeStore() {
  const root = createMockRoot();
  const store = new DeviceStore(root as unknown as FileSystemDirectoryHandle);
  store.attachMetadataCache(
    new IndexedDBMetadataCache({
      channelName: `device-store-raster-dims-${Math.random().toString(36).slice(2)}`,
      dispatchWindowEvents: false,
    }),
  );
  return { root, store };
}

/** Drop a plain (XMP-less) file into the mock root, as if the user
 *  copied an external screenshot into the device folder. */
async function seedPlainFile(root: ReturnType<typeof createMockRoot>, name: string): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  // Arbitrary non-XMP bytes — the probe is stubbed, so the content
  // only needs to NOT parse as an Annot editable image.
  await writable.write(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer);
  await writable.close();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeviceStore raw-raster dimension probing", () => {
  it("probes pixel dimensions for a file without an XMP packet", async () => {
    const probe = vi.fn(async () => ({ width: 640, height: 400, close: () => {} }));
    vi.stubGlobal("createImageBitmap", probe);

    const { root, store } = makeStore();
    await seedPlainFile(root, "external.png");

    const record = await store.getImage("external.png");
    expect(record?.width).toBe(640);
    expect(record?.height).toBe(400);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("caches probed dimensions at listing time (gallery cards show dims)", async () => {
    const probe = vi.fn(async () => ({ width: 640, height: 400, close: () => {} }));
    vi.stubGlobal("createImageBitmap", probe);

    const { root, store } = makeStore();
    await seedPlainFile(root, "external.png");

    const listed = await store.listImages("");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.width).toBe(640);
    expect(listed[0]?.height).toBe(400);

    // Second listing hits the cache — no re-decode for the same
    // file version.
    await store.listImages("");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("fails soft to 0×0 when decoding is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", () => {
      throw new Error("no decoder in this environment");
    });

    const { root, store } = makeStore();
    await seedPlainFile(root, "external.png");

    const record = await store.getImage("external.png");
    expect(record).toBeDefined();
    expect(record?.width).toBe(0);
    expect(record?.height).toBe(0);
  });

  it("keeps XMP dimensions authoritative and skips the probe", async () => {
    const probe = vi.fn(async () => ({ width: 999, height: 999, close: () => {} }));
    vi.stubGlobal("createImageBitmap", probe);

    const { store } = makeStore();
    const now = new Date().toISOString();
    const path = await store.saveImage(
      {
        folderPath: "",
        originalDataUrl: TINY_PNG,
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: 123,
        height: 45,
        sourceUrl: "",
        tags: {},
        createdAt: now,
        updatedAt: now,
      },
      { filename: "authored.annot.png" },
    );

    const record = await store.getImage(path);
    expect(record?.width).toBe(123);
    expect(record?.height).toBe(45);
    expect(probe).not.toHaveBeenCalled();
  });
});
