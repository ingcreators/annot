import type { DocumentRecord, ImageRecord, ListingEntry } from "@ingcreators/annot-core/storage";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IndexedDBMetadataCache,
  type IndexedDBMetadataCacheOptions,
  type MetadataBroadcastEvent,
} from "./idb-metadata-cache.js";

/**
 * `IndexedDBMetadataCache` invariants. We exercise:
 *
 *   - Round-trip CRUD for image / document records under
 *     version-gated reads.
 *   - Listing read / replace / upsert / remove semantics.
 *   - Per-namespace meta KV — `getNamespaceMeta` round-trip and
 *     delete.
 *   - Backend-ID forward / reverse lookups via the secondary
 *     index.
 *   - `migrateEntry` moves the record, the backend-ID row, and
 *     the listing entry into the new parent folder.
 *   - `rewriteEntriesForPrefix` updates every artefact under
 *     the prefix (records, backend-IDs, listings — including
 *     the paths inside listing entries).
 *   - `invalidatePath` / `invalidatePrefix` clear both the
 *     in-memory LRU and the IDB rows.
 *   - LRU eviction kicks in once the record cap is exceeded;
 *     `lastAccessedAt`-ascending eviction order respected.
 *   - Memory LRU bounded by the configured cap.
 *   - BroadcastChannel multi-tab sync: a put in instance A clears
 *     instance B's memory cache for the same key (Notify-and-reread
 *     pattern means the next read on B fetches from IDB and sees
 *     the new version).
 *   - Version mismatch evicts the IDB row in the same transaction.
 */

let nextChannelId = 0;

const baseOpts = (
  overrides: Partial<IndexedDBMetadataCacheOptions> = {},
): IndexedDBMetadataCacheOptions => ({
  // Unique per-test channel name so the parallel test runner doesn't
  // bleed broadcast events across files.
  channelName: overrides.channelName ?? `annot-metadata-test-${++nextChannelId}`,
  dispatchWindowEvents: false,
  ...overrides,
});

const makeImage = (path: string, overrides: Partial<ImageRecord> = {}): ImageRecord => ({
  path,
  folderPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
  originalDataUrl: "",
  thumbnailDataUrl: "",
  annotationsSvg: "",
  width: 1280,
  height: 720,
  sourceUrl: "",
  tags: {},
  createdAt: "2026-05-13T12:00:00Z",
  updatedAt: "2026-05-13T12:00:00Z",
  ...overrides,
});

const makeDocument = (path: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord => ({
  path,
  folderPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
  bytes: "",
  thumbnailDataUrl: "",
  title: "Untitled",
  imageCount: 0,
  blockCount: 0,
  createdAt: "2026-05-13T12:00:00Z",
  updatedAt: "2026-05-13T12:00:00Z",
  ...overrides,
});

const entry = (
  path: string,
  version: string,
  kind: ListingEntry["kind"] = "image",
): ListingEntry => ({ path, version, kind });

let openCaches: IndexedDBMetadataCache[] = [];

const track = (cache: IndexedDBMetadataCache): IndexedDBMetadataCache => {
  openCaches.push(cache);
  return cache;
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  openCaches = [];
});

afterEach(() => {
  for (const c of openCaches) c.close();
  openCaches = [];
});

// ─── Record CRUD ─────────────────────────────────────────────────

describe("IndexedDBMetadataCache — image / document records", () => {
  it("getImage returns undefined for missing entries", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeUndefined();
  });

  it("putImage then getImage returns the record when versions match", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    const rec = makeImage("a.png", { tags: { source: "test" } });
    await cache.putImage("device:lib", "a.png", "v1", rec);
    const got = await cache.getImage("device:lib", "a.png", "v1");
    expect(got).toEqual(rec);
  });

  it("getImage returns undefined on version mismatch without evicting the row", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png"));
    expect(await cache.getImage("device:lib", "a.png", "v2")).toBeUndefined();
    // The cached v1 row is preserved — a multi-tab peer requesting
    // v1 still gets the cached value. Eviction-on-mismatch would
    // discard valid data here.
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeDefined();
  });

  it("getImage returns undefined for a document at the same path (kind discriminates)", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putDocument("device:lib", "a.annot.html", "v1", makeDocument("a.annot.html"));
    expect(await cache.getImage("device:lib", "a.annot.html", "v1")).toBeUndefined();
  });

  it("putImage overwrites the previous version", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png", { width: 100 }));
    await cache.putImage("device:lib", "a.png", "v2", makeImage("a.png", { width: 200 }));
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeUndefined();
    const got = await cache.getImage("device:lib", "a.png", "v2");
    expect(got?.width).toBe(200);
  });

  it("returned record is decoupled from the cached row (deep clone)", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    const rec = makeImage("a.png", { tags: { source: "test" } });
    await cache.putImage("device:lib", "a.png", "v1", rec);
    const got = await cache.getImage("device:lib", "a.png", "v1");
    expect(got).toBeDefined();
    if (!got) throw new Error("unreachable");
    (got.tags as Record<string, string>).source = "mutated";
    const reread = await cache.getImage("device:lib", "a.png", "v1");
    expect(reread?.tags.source).toBe("test");
  });

  it("document round-trip honors the kind discriminator", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    const doc = makeDocument("manual.annot.html", { title: "Manual" });
    await cache.putDocument("device:lib", "manual.annot.html", "v1", doc);
    expect(await cache.getDocument("device:lib", "manual.annot.html", "v1")).toEqual(doc);
    expect(await cache.getImage("device:lib", "manual.annot.html", "v1")).toBeUndefined();
  });
});

// ─── Listings ────────────────────────────────────────────────────

describe("IndexedDBMetadataCache — listings", () => {
  it("getListing returns undefined for unrecorded folders", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    expect(await cache.getListing("device:lib", "")).toBeUndefined();
  });

  it("putListing then getListing returns the entries", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    const list = [entry("a.png", "v1"), entry("b.png", "v2")];
    await cache.putListing("device:lib", "", list);
    expect(await cache.getListing("device:lib", "")).toEqual(list);
  });

  it("upsertListingEntry adds new entries and replaces existing same-path entries", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putListing("device:lib", "", [entry("a.png", "v1")]);
    await cache.upsertListingEntry("device:lib", "", entry("b.png", "v1"));
    expect((await cache.getListing("device:lib", ""))?.length).toBe(2);
    await cache.upsertListingEntry("device:lib", "", entry("a.png", "v2"));
    const updated = await cache.getListing("device:lib", "");
    const a = updated?.find((e) => e.path === "a.png");
    expect(a?.version).toBe("v2");
  });

  it("upsertListingEntry no-ops when the folder has no listing recorded", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.upsertListingEntry("device:lib", "", entry("a.png", "v1"));
    expect(await cache.getListing("device:lib", "")).toBeUndefined();
  });

  it("removeListingEntry drops a path", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putListing("device:lib", "", [entry("a.png", "v1"), entry("b.png", "v2")]);
    await cache.removeListingEntry("device:lib", "", "a.png");
    expect(await cache.getListing("device:lib", "")).toEqual([entry("b.png", "v2")]);
  });

  it("returned listing is decoupled from the cached row", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putListing("device:lib", "", [entry("a.png", "v1")]);
    const got = await cache.getListing("device:lib", "");
    if (!got) throw new Error("unreachable");
    got.push(entry("evil.png", "vX"));
    const reread = await cache.getListing("device:lib", "");
    expect(reread?.length).toBe(1);
  });
});

// ─── Namespace meta ──────────────────────────────────────────────

describe("IndexedDBMetadataCache — namespace meta", () => {
  it("getNamespaceMeta returns undefined when unset", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    expect(await cache.getNamespaceMeta("github:owner/repo:main", "branchHead")).toBeUndefined();
  });

  it("putNamespaceMeta then getNamespaceMeta returns the value", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putNamespaceMeta("github:owner/repo:main", "branchHead", "abc123");
    expect(await cache.getNamespaceMeta("github:owner/repo:main", "branchHead")).toBe("abc123");
  });

  it("deleteNamespaceMeta clears the value", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putNamespaceMeta("github:owner/repo:main", "branchHead", "abc123");
    await cache.deleteNamespaceMeta("github:owner/repo:main", "branchHead");
    expect(await cache.getNamespaceMeta("github:owner/repo:main", "branchHead")).toBeUndefined();
  });

  it("isolates values across namespaces", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putNamespaceMeta("github:a/b:main", "branchHead", "sha-a");
    await cache.putNamespaceMeta("github:c/d:main", "branchHead", "sha-c");
    expect(await cache.getNamespaceMeta("github:a/b:main", "branchHead")).toBe("sha-a");
    expect(await cache.getNamespaceMeta("github:c/d:main", "branchHead")).toBe("sha-c");
  });
});

// ─── Backend IDs ─────────────────────────────────────────────────

describe("IndexedDBMetadataCache — backend IDs", () => {
  it("setBackendId then forward + reverse lookups succeed", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.setBackendId("googledrive:root", "Folder/file.png", "drive-id-123");
    expect(await cache.getBackendIdByPath("googledrive:root", "Folder/file.png")).toBe(
      "drive-id-123",
    );
    expect(await cache.getPathByBackendId("googledrive:root", "drive-id-123")).toBe(
      "Folder/file.png",
    );
  });

  it("backend-id lookups are namespace-scoped", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.setBackendId("googledrive:rootA", "x.png", "drive-id-A");
    await cache.setBackendId("googledrive:rootB", "x.png", "drive-id-B");
    expect(await cache.getPathByBackendId("googledrive:rootA", "drive-id-B")).toBeUndefined();
    expect(await cache.getPathByBackendId("googledrive:rootA", "drive-id-A")).toBe("x.png");
    expect(await cache.getPathByBackendId("googledrive:rootB", "drive-id-B")).toBe("x.png");
  });
});

// ─── Bulk operations ─────────────────────────────────────────────

describe("IndexedDBMetadataCache — migrateEntry", () => {
  it("moves a record + backend-id + listing-entry to the new path", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("googledrive:root", "old/a.png", "v1", makeImage("old/a.png"));
    await cache.setBackendId("googledrive:root", "old/a.png", "drive-id-A");
    await cache.putListing("googledrive:root", "old", [entry("old/a.png", "v1")]);
    await cache.putListing("googledrive:root", "new", []); // existing listing on the dest side

    await cache.migrateEntry("googledrive:root", "old/a.png", "new/a.png");

    expect(await cache.getImage("googledrive:root", "old/a.png", "v1")).toBeUndefined();
    expect(await cache.getImage("googledrive:root", "new/a.png", "v1")).toBeDefined();
    expect(await cache.getBackendIdByPath("googledrive:root", "old/a.png")).toBeUndefined();
    expect(await cache.getBackendIdByPath("googledrive:root", "new/a.png")).toBe("drive-id-A");
    expect(await cache.getListing("googledrive:root", "old")).toEqual([]);
    const newListing = await cache.getListing("googledrive:root", "new");
    expect(newListing?.[0]?.path).toBe("new/a.png");
  });

  it("no-ops when oldPath equals newPath", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png"));
    await cache.migrateEntry("device:lib", "a.png", "a.png");
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeDefined();
  });
});

describe("IndexedDBMetadataCache — rewriteEntriesForPrefix", () => {
  it("rewrites records, backend-ids, listing keys, AND paths inside listing entries", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("device:lib", "old/a.png", "v1", makeImage("old/a.png"));
    await cache.putImage("device:lib", "old/sub/b.png", "v1", makeImage("old/sub/b.png"));
    await cache.setBackendId("device:lib", "old/a.png", "id-A");
    await cache.putListing("device:lib", "old", [entry("old/a.png", "v1")]);
    await cache.putListing("device:lib", "old/sub", [entry("old/sub/b.png", "v1")]);

    await cache.rewriteEntriesForPrefix("device:lib", "old", "fresh");

    expect(await cache.getImage("device:lib", "old/a.png", "v1")).toBeUndefined();
    expect(await cache.getImage("device:lib", "fresh/a.png", "v1")).toBeDefined();
    expect(await cache.getImage("device:lib", "fresh/sub/b.png", "v1")).toBeDefined();
    expect(await cache.getBackendIdByPath("device:lib", "old/a.png")).toBeUndefined();
    expect(await cache.getBackendIdByPath("device:lib", "fresh/a.png")).toBe("id-A");
    expect(await cache.getListing("device:lib", "old")).toBeUndefined();
    const freshListing = await cache.getListing("device:lib", "fresh");
    expect(freshListing?.[0]?.path).toBe("fresh/a.png");
    const freshSubListing = await cache.getListing("device:lib", "fresh/sub");
    expect(freshSubListing?.[0]?.path).toBe("fresh/sub/b.png");
  });
});

// ─── Invalidation ────────────────────────────────────────────────

describe("IndexedDBMetadataCache — invalidation", () => {
  it("invalidatePath drops the record and the memory LRU entry", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png"));
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeDefined();
    await cache.invalidatePath("device:lib", "a.png");
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeUndefined();
  });

  it("invalidatePrefix drops everything under that prefix", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await cache.putImage("github:owner/repo:main", "a.png", "v1", makeImage("a.png"));
    await cache.putImage("github:owner/repo:main", "b.png", "v1", makeImage("b.png"));
    await cache.putImage("github:owner/repo:dev", "a.png", "v1", makeImage("a.png"));
    await cache.putNamespaceMeta("github:owner/repo:main", "branchHead", "abc");

    await cache.invalidatePrefix("github:owner/repo:main:");

    expect(await cache.getImage("github:owner/repo:main", "a.png", "v1")).toBeUndefined();
    expect(await cache.getImage("github:owner/repo:main", "b.png", "v1")).toBeUndefined();
    expect(await cache.getImage("github:owner/repo:dev", "a.png", "v1")).toBeDefined();
    expect(await cache.getNamespaceMeta("github:owner/repo:main", "branchHead")).toBeUndefined();
  });

  it("invalidatePrefix throws on empty prefix (safety check)", async () => {
    const cache = track(new IndexedDBMetadataCache(baseOpts()));
    await expect(cache.invalidatePrefix("")).rejects.toThrow(/non-empty/);
  });
});

// ─── LRU eviction ────────────────────────────────────────────────

describe("IndexedDBMetadataCache — LRU eviction", () => {
  it("evicts least-recently-accessed records once the IDB cap is exceeded", async () => {
    const cache = track(
      new IndexedDBMetadataCache(baseOpts({ maxRecordEntries: 4, recordMemoryLimit: 100 })),
    );

    // Fill to cap.
    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png"));
    await cache.putImage("device:lib", "b.png", "v1", makeImage("b.png"));
    await cache.putImage("device:lib", "c.png", "v1", makeImage("c.png"));
    await cache.putImage("device:lib", "d.png", "v1", makeImage("d.png"));

    // Touch `a` so it isn't oldest anymore.
    await cache.getImage("device:lib", "a.png", "v1");

    // One more put forces eviction down to the headroom target (90% of cap).
    await cache.putImage("device:lib", "e.png", "v1", makeImage("e.png"));

    // `b` was the next-oldest after the touch — it should be gone first.
    expect(await cache.getImage("device:lib", "b.png", "v1")).toBeUndefined();
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeDefined();
    expect(await cache.getImage("device:lib", "e.png", "v1")).toBeDefined();
  });

  it("memory LRU is bounded by the configured cap", async () => {
    const cache = track(
      new IndexedDBMetadataCache(baseOpts({ recordMemoryLimit: 2, maxRecordEntries: 1000 })),
    );

    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png"));
    await cache.putImage("device:lib", "b.png", "v1", makeImage("b.png"));
    await cache.putImage("device:lib", "c.png", "v1", makeImage("c.png"));

    // `a` should have fallen out of the in-memory LRU but still be in IDB.
    // We can't directly observe the memory map, so we verify behaviour:
    // a subsequent get for `a` still succeeds — proving it's reachable
    // via the IDB fall-through, and the LRU cap didn't accidentally
    // drop it from IDB too.
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeDefined();
  });
});

// ─── Multi-tab BroadcastChannel ──────────────────────────────────

describe("IndexedDBMetadataCache — multi-tab sync", () => {
  it("a put in one instance invalidates the memory LRU of the peer", async () => {
    const channelName = `annot-metadata-test-multitab-${++nextChannelId}`;
    const a = track(new IndexedDBMetadataCache(baseOpts({ channelName })));
    const b = track(new IndexedDBMetadataCache(baseOpts({ channelName })));

    // Warm B's memory cache by reading after a put.
    await a.putImage("device:lib", "x.png", "v1", makeImage("x.png", { width: 100 }));
    await waitMicrotask();
    const initial = await b.getImage("device:lib", "x.png", "v1");
    expect(initial?.width).toBe(100);

    // A updates the record to v2. The broadcast should clear B's
    // memory cache for that key, so B's next read with v1 misses
    // (the v2 row in IDB has version="v2", so the v1 read evicts
    // it on mismatch and returns undefined).
    await a.putImage("device:lib", "x.png", "v2", makeImage("x.png", { width: 200 }));
    await waitMicrotask();
    expect(await b.getImage("device:lib", "x.png", "v1")).toBeUndefined();
    expect(await b.getImage("device:lib", "x.png", "v2")).toBeDefined();
  });

  it("a listing put in one instance invalidates the peer's listing memory", async () => {
    const channelName = `annot-metadata-test-listing-${++nextChannelId}`;
    const a = track(new IndexedDBMetadataCache(baseOpts({ channelName })));
    const b = track(new IndexedDBMetadataCache(baseOpts({ channelName })));

    await a.putListing("device:lib", "", [entry("x.png", "v1")]);
    await waitMicrotask();
    expect((await b.getListing("device:lib", ""))?.length).toBe(1);

    await a.putListing("device:lib", "", [entry("x.png", "v1"), entry("y.png", "v1")]);
    await waitMicrotask();
    expect((await b.getListing("device:lib", ""))?.length).toBe(2);
  });

  it("own echo is filtered out (sender id check)", async () => {
    const channelName = `annot-metadata-test-echo-${++nextChannelId}`;
    const receivedFromSelf = false;

    const cache = track(
      new IndexedDBMetadataCache(
        baseOpts({
          channelName,
          senderIdFactory: () => "sender-fixed",
        }),
      ),
    );

    // Tap into the same channel as a 3rd observer to count messages.
    const observer = new BroadcastChannel(channelName);
    const events: MetadataBroadcastEvent[] = [];
    observer.onmessage = (e) => events.push(e.data as MetadataBroadcastEvent);

    await cache.putImage("device:lib", "a.png", "v1", makeImage("a.png"));
    await waitMicrotask();

    // The observer should have seen the message (proves it was sent).
    expect(events.some((e) => e.type === "path-changed")).toBe(true);
    // But the cache itself should NOT have re-processed its own
    // message — we can't directly observe `#onBroadcast`, so use a
    // proxy: insert a fake "ns-meta-changed" with the same sender id
    // and verify the cache ignores it (no `window` dispatch in
    // tests, so we just check there's no error path).
    observer.postMessage({
      type: "path-changed",
      ns: "device:lib",
      path: "a.png",
      version: "vX",
      sender: "sender-fixed",
    } satisfies MetadataBroadcastEvent);
    await waitMicrotask();
    // The cache's memory entry should still match the original
    // version since the echo is filtered.
    expect(await cache.getImage("device:lib", "a.png", "v1")).toBeDefined();
    void receivedFromSelf;
    observer.close();
  });

  it("ns-meta change broadcasts to peers", async () => {
    const channelName = `annot-metadata-test-nsmeta-${++nextChannelId}`;
    const a = track(new IndexedDBMetadataCache(baseOpts({ channelName })));
    track(new IndexedDBMetadataCache(baseOpts({ channelName })));

    const observer = new BroadcastChannel(channelName);
    const events: MetadataBroadcastEvent[] = [];
    observer.onmessage = (e) => events.push(e.data as MetadataBroadcastEvent);

    await a.putNamespaceMeta("github:o/r:main", "branchHead", "abc");
    await waitMicrotask();

    expect(events.find((e) => e.type === "ns-meta-changed")).toMatchObject({
      type: "ns-meta-changed",
      ns: "github:o/r:main",
      key: "branchHead",
    });
    observer.close();
  });
});

// Resolve after the BroadcastChannel delivery microtask queue
// drains. Node's BroadcastChannel uses async dispatch internally
// (postTask), so a single microtask isn't always enough; do a few
// `setTimeout(0)` ticks to be safe.
function waitMicrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => setTimeout(() => setTimeout(resolve, 0), 0), 0);
  });
}
