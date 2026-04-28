// @vitest-environment happy-dom
import type {
  CachedThumbnail,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  ThumbnailCache,
  ThumbnailCacheGetRequest,
} from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThumbnailManager } from "./thumbnail-manager.js";

/**
 * `ThumbnailManager` invariants. The cache is mocked so we can
 * assert (a) attach hits both memory + DB tiers correctly,
 * (b) cache misses are scheduled for prefetch, (c) prefetches
 * dispatch `annot-thumbnail-ready`, (d) in-flight dedup.
 *
 * `renderThumbnailWithDims` is mocked to return deterministic
 * output without a real `OffscreenCanvas` decode (happy-dom
 * doesn't ship one).
 */

vi.mock("./image-thumbnail.js", () => ({
  renderThumbnailWithDims: vi.fn(async (blob: Blob) => ({
    dataUrl: `data:image/jpeg;base64,RENDERED_${blob.size}`,
    width: 800,
    height: 600,
  })),
}));

class MockCache implements ThumbnailCache {
  store = new Map<string, { version: string; value: CachedThumbnail }>();
  setSpy = vi.fn();
  getSpy = vi.fn();
  getManySpy = vi.fn();
  deleteSpy = vi.fn();
  deletePrefixSpy = vi.fn();
  clearSpy = vi.fn();

  async get(key: string, expectedVersion: string): Promise<CachedThumbnail | undefined> {
    this.getSpy(key, expectedVersion);
    const row = this.store.get(key);
    if (!row || row.version !== expectedVersion) return undefined;
    return row.value;
  }

  async getMany(requests: ThumbnailCacheGetRequest[]): Promise<Map<string, CachedThumbnail>> {
    this.getManySpy(requests);
    const result = new Map<string, CachedThumbnail>();
    for (const { key, expectedVersion } of requests) {
      const row = this.store.get(key);
      if (row && row.version === expectedVersion) {
        result.set(key, row.value);
      }
    }
    return result;
  }

  async set(key: string, version: string, value: CachedThumbnail): Promise<void> {
    this.setSpy(key, version, value);
    this.store.set(key, { version, value });
  }

  async delete(key: string): Promise<void> {
    this.deleteSpy(key);
    this.store.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    this.deletePrefixSpy(prefix);
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  async clearAll(): Promise<void> {
    this.clearSpy();
    this.store.clear();
  }
}

interface MockProviderOptions {
  /** Set to false to make the provider OPT OUT of
   *  StorageWithThumbnailCache (no thumbnailKey). */
  participates?: boolean;
  /** Override `thumbnailKey` to return undefined for some paths. */
  keyOverride?: (path: string) => string | undefined;
  /** Return undefined to simulate "file deleted between listing
   *  and fetch". */
  fetchOverride?: (path: string) => Promise<Blob | undefined>;
}

function makeMockProvider(opts: MockProviderOptions = {}): StorageProvider {
  const participates = opts.participates ?? true;
  const base: Partial<StorageProvider> = {
    async saveImage(_record: Omit<ImageRecord, "path">) {
      return "x";
    },
    async getImage(_path: string) {
      return undefined;
    },
    async listImages(_folderPath: string) {
      return [] as ImageRecord[];
    },
    async listFolders(_parentPath: string) {
      return [] as FolderRecord[];
    },
    async createFolder(_parentPath: string, _name: string) {
      return "x";
    },
    async deleteFolder(_path: string) {},
    async renameFolder(_path: string, _newName: string) {
      return "x";
    },
    async moveFolder(_path: string, _newParent: string) {
      return "x";
    },
    async deleteImage(_path: string) {},
    async renameImage(_path: string, _newName: string) {
      return "x";
    },
    async moveImage(_path: string, _newFolder: string) {
      return "x";
    },
    async updateImage(_path: string, _updates: ImageRecordUpdate) {},
    async getBreadcrumb(_path: string) {
      return [] as FolderRecord[];
    },
  };
  if (participates) {
    Object.assign(base, {
      thumbnailKey: opts.keyOverride ?? ((path: string) => `mock:${path}`),
      thumbnailVersion: (_path: string) => "v1",
      fetchThumbnailSource:
        opts.fetchOverride ??
        (async (path: string) => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" })),
    });
  }
  return base as StorageProvider;
}

function record(path: string): ImageRecord {
  return {
    path,
    folderPath: "",
    originalDataUrl: "",
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width: 0,
    height: 0,
    sourceUrl: "",
    tags: {},
    createdAt: "",
    updatedAt: "",
  };
}

let receivedEvents: { path: string; dataUrl: string; width: number; height: number }[] = [];
function captureReadyEvents() {
  receivedEvents = [];
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    receivedEvents.push(detail);
  };
  window.addEventListener("annot-thumbnail-ready", handler);
  return () => window.removeEventListener("annot-thumbnail-ready", handler);
}

beforeEach(() => {
  receivedEvents = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ThumbnailManager — attach", () => {
  it("is a no-op for providers that don't implement StorageWithThumbnailCache", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider({ participates: false });
    const r = record("a.png");
    await mgr.attach(provider, [r]);
    expect(r.thumbnailDataUrl).toBe("");
    expect(cache.getManySpy).not.toHaveBeenCalled();
  });

  it("hydrates records from the persistent cache and promotes to memory LRU", async () => {
    const cache = new MockCache();
    cache.store.set("mock:a.png", {
      version: "v1",
      value: { dataUrl: "X", width: 100, height: 50 },
    });
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider();
    const r = record("a.png");
    await mgr.attach(provider, [r]);
    expect(r.thumbnailDataUrl).toBe("X");
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
    // Second attach for the same key should hit memory only —
    // when every request resolves from memory, the manager skips
    // the persistent-cache round-trip entirely.
    cache.getManySpy.mockClear();
    const r2 = record("a.png");
    await mgr.attach(provider, [r2]);
    expect(r2.thumbnailDataUrl).toBe("X");
    expect(cache.getManySpy).not.toHaveBeenCalled();
  });

  it("schedules background prefetch for cache misses and dispatches annot-thumbnail-ready", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider();
    const detach = captureReadyEvents();

    const r = record("a.png");
    await mgr.attach(provider, [r]);
    // Initial attach returns synchronously without a hit; the
    // prefetch is in-flight.
    expect(r.thumbnailDataUrl).toBe("");

    // Wait for the background prefetch to settle.
    await flushMicrotasks();

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]!.path).toBe("a.png");
    expect(receivedEvents[0]!.dataUrl).toMatch(/^data:image\/jpeg;/);
    expect(cache.setSpy).toHaveBeenCalledOnce();
    detach();
  });

  it("dedups concurrent prefetches for the same key", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const fetchSpy = vi.fn(async (_p: string) => new Blob([new Uint8Array([1, 2, 3])]));
    const provider = makeMockProvider({ fetchOverride: fetchSpy });

    // Two attaches on the same record before the first prefetch
    // settles. The second should reuse the in-flight promise.
    const r1 = record("a.png");
    const r2 = record("a.png");
    await Promise.all([mgr.attach(provider, [r1]), mgr.attach(provider, [r2])]);
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("skips records with thumbnailKey returning undefined", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider({
      keyOverride: (path) => (path === "skip.png" ? undefined : `mock:${path}`),
    });
    cache.store.set("mock:keep.png", {
      version: "v1",
      value: { dataUrl: "X", width: 1, height: 1 },
    });
    const skip = record("skip.png");
    const keep = record("keep.png");
    await mgr.attach(provider, [skip, keep]);
    expect(skip.thumbnailDataUrl).toBe("");
    expect(keep.thumbnailDataUrl).toBe("X");
  });
});

describe("ThumbnailManager — write", () => {
  it("seeds memory + persistent cache and dispatches the ready event", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider();
    const detach = captureReadyEvents();

    await mgr.write(provider, "a.png", "data:image/jpeg;base64,DIRECT", {
      width: 1920,
      height: 1080,
    });

    expect(cache.setSpy).toHaveBeenCalledWith("mock:a.png", "v1", {
      dataUrl: "data:image/jpeg;base64,DIRECT",
      width: 1920,
      height: 1080,
    });
    expect(receivedEvents).toEqual([
      { path: "a.png", dataUrl: "data:image/jpeg;base64,DIRECT", width: 1920, height: 1080 },
    ]);

    // A subsequent attach picks the seeded value out of memory.
    const r = record("a.png");
    await mgr.attach(provider, [r]);
    expect(r.thumbnailDataUrl).toBe("data:image/jpeg;base64,DIRECT");
    detach();
  });

  it("no-ops for providers that don't participate", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider({ participates: false });
    await mgr.write(provider, "a.png", "X", { width: 1, height: 1 });
    expect(cache.setSpy).not.toHaveBeenCalled();
  });

  it("no-ops for empty dataUrl (generation failed upstream)", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider();
    await mgr.write(provider, "a.png", "", { width: 0, height: 0 });
    expect(cache.setSpy).not.toHaveBeenCalled();
  });

  it("survives persistent-layer set failures (in-memory entry still readable)", async () => {
    const cache = new MockCache();
    cache.setSpy.mockImplementation(() => {
      throw new Error("synthetic IDB failure");
    });
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider();
    await mgr.write(provider, "a.png", "data:image/jpeg;base64,DIRECT", {
      width: 1,
      height: 1,
    });
    // Memory tier still has it.
    const r = record("a.png");
    await mgr.attach(provider, [r]);
    expect(r.thumbnailDataUrl).toBe("data:image/jpeg;base64,DIRECT");
  });
});

describe("ThumbnailManager — invalidatePrefix", () => {
  it("scrubs both memory and persistent caches", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache);
    const provider = makeMockProvider();
    await mgr.write(provider, "a.png", "X", { width: 1, height: 1 });
    expect(cache.store.has("mock:a.png")).toBe(true);
    await mgr.invalidatePrefix("mock:");
    expect(cache.store.has("mock:a.png")).toBe(false);
    expect(cache.deletePrefixSpy).toHaveBeenCalledWith("mock:");

    // Subsequent attach should miss memory + DB and schedule a
    // prefetch (we don't await it).
    const r = record("a.png");
    await mgr.attach(provider, [r]);
    expect(r.thumbnailDataUrl).toBe("");
  });
});

describe("ThumbnailManager — memory LRU bound", () => {
  it("evicts the oldest in-memory entry once the cap is reached", async () => {
    const cache = new MockCache();
    const mgr = new ThumbnailManager(cache, { memoryLimit: 2 });
    const provider = makeMockProvider();
    await mgr.write(provider, "a.png", "AA", { width: 1, height: 1 });
    await mgr.write(provider, "b.png", "BB", { width: 1, height: 1 });
    await mgr.write(provider, "c.png", "CC", { width: 1, height: 1 });
    // 'a' was the oldest insertion → evicted from memory.
    // The persistent cache still has it.
    const ra = record("a.png");
    cache.getManySpy.mockClear();
    await mgr.attach(provider, [ra]);
    // Persistent cache hit re-promotes to memory.
    expect(ra.thumbnailDataUrl).toBe("AA");
    expect(cache.getManySpy).toHaveBeenCalledTimes(1);
    const reqs = cache.getManySpy.mock.calls[0]![0]!;
    // The DB request list should include 'a' since memory missed.
    expect(reqs).toEqual([{ key: "mock:a.png", expectedVersion: "v1" }]);
  });
});

async function flushMicrotasks(): Promise<void> {
  // Drain enough microtask ticks for the prefetch promise's
  // try/finally + dispatch to settle.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}
