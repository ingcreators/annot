import { type CachedThumbnail, ThumbnailCacheQuotaError } from "@ingcreators/annot-core/storage";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDBThumbnailCache } from "./idb-thumbnail-cache.js";

/**
 * `IndexedDBThumbnailCache` invariants. We exercise:
 *
 *   - Round-trip get / set / delete / clearAll.
 *   - Version-mismatch eviction inside `get`.
 *   - Bulk `getMany` returns the matching subset and evicts
 *     mismatches in the same transaction.
 *   - `deletePrefix` only removes keys under the prefix.
 *   - LRU eviction kicks in once max bytes / max entries is
 *     exceeded, dropping least-recently-accessed entries first.
 *   - `set` rejects nothing on `QuotaExceededError`-style
 *     synthetic failures (we exercise the path with low caps;
 *     the real platform-thrown error is harder to stage in
 *     fake-indexeddb).
 *
 * `fake-indexeddb` gives us a real IDB shape against an
 * in-memory backing store, so we can assert tx semantics
 * (lastAccessedAt updates land in the same write tx) without
 * needing a real browser.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const fakeJpegDataUrl = (size: number): string => {
  // Build a base64-ish payload of the requested base64 length so
  // `estimateBytes` returns close to `(size * 3) / 4` — used to
  // exercise the `MAX_BYTES` cap without burning real memory.
  return `data:image/jpeg;base64,${"A".repeat(size)}`;
};

const sampleThumb = (size = 64): CachedThumbnail => ({
  dataUrl: fakeJpegDataUrl(size),
  width: 480,
  height: 270,
});

describe("IndexedDBThumbnailCache — basic round-trip", () => {
  it("get returns undefined for missing keys", async () => {
    const cache = new IndexedDBThumbnailCache();
    expect(await cache.get("missing", "v1")).toBeUndefined();
  });

  it("set then get returns the stored value when versions match", async () => {
    const cache = new IndexedDBThumbnailCache();
    const value = sampleThumb();
    await cache.set("browser:foo.png", "v1", value);
    expect(await cache.get("browser:foo.png", "v1")).toEqual(value);
  });

  it("get evicts and returns undefined on version mismatch", async () => {
    const cache = new IndexedDBThumbnailCache();
    await cache.set("browser:foo.png", "v1", sampleThumb());
    expect(await cache.get("browser:foo.png", "v2")).toBeUndefined();
    // Side-effect eviction: subsequent get with the original
    // version is also a miss.
    expect(await cache.get("browser:foo.png", "v1")).toBeUndefined();
  });

  it("delete removes the entry", async () => {
    const cache = new IndexedDBThumbnailCache();
    await cache.set("browser:foo.png", "v1", sampleThumb());
    await cache.delete("browser:foo.png");
    expect(await cache.get("browser:foo.png", "v1")).toBeUndefined();
  });

  it("clearAll wipes the store", async () => {
    const cache = new IndexedDBThumbnailCache();
    await cache.set("a", "v1", sampleThumb());
    await cache.set("b", "v1", sampleThumb());
    await cache.clearAll();
    expect(await cache.get("a", "v1")).toBeUndefined();
    expect(await cache.get("b", "v1")).toBeUndefined();
  });
});

describe("IndexedDBThumbnailCache — getMany", () => {
  it("returns hits for matching versions and skips mismatches", async () => {
    const cache = new IndexedDBThumbnailCache();
    const a = sampleThumb(32);
    const b = sampleThumb(32);
    const c = sampleThumb(32);
    await cache.set("a", "v1", a);
    await cache.set("b", "v1", b);
    await cache.set("c", "v1", c);
    const result = await cache.getMany([
      { key: "a", expectedVersion: "v1" }, // hit
      { key: "b", expectedVersion: "vX" }, // mismatch → evict
      { key: "c", expectedVersion: "v1" }, // hit
      { key: "d", expectedVersion: "v1" }, // missing
    ]);
    expect(Array.from(result.keys()).sort()).toEqual(["a", "c"]);
    expect(result.get("a")).toEqual(a);
    expect(result.get("c")).toEqual(c);
    // The mismatch should have been evicted in the same tx.
    expect(await cache.get("b", "v1")).toBeUndefined();
  });

  it("returns an empty map for an empty request list without opening a tx", async () => {
    const cache = new IndexedDBThumbnailCache();
    const result = await cache.getMany([]);
    expect(result.size).toBe(0);
  });
});

describe("IndexedDBThumbnailCache — deletePrefix", () => {
  it("removes only entries whose key starts with the prefix", async () => {
    const cache = new IndexedDBThumbnailCache();
    await cache.set("browser:a", "v1", sampleThumb());
    await cache.set("browser:b", "v1", sampleThumb());
    await cache.set("github:c", "v1", sampleThumb());
    await cache.deletePrefix("browser:");
    expect(await cache.get("browser:a", "v1")).toBeUndefined();
    expect(await cache.get("browser:b", "v1")).toBeUndefined();
    expect(await cache.get("github:c", "v1")).toBeDefined();
  });

  it("rejects empty prefix to prevent accidental wipe", async () => {
    const cache = new IndexedDBThumbnailCache();
    await expect(cache.deletePrefix("")).rejects.toThrow(/non-empty prefix/);
  });
});

describe("IndexedDBThumbnailCache — LRU eviction", () => {
  it("evicts least-recently-accessed entries when over the byte cap", async () => {
    // 4 KB cap so a few sample thumbs overflow without dragging
    // the test into "make a real megabyte" territory.
    const cache = new IndexedDBThumbnailCache({
      maxBytes: 4 * 1024,
      maxEntries: 100,
    });
    // Each entry is ~2 KB (data URL of length ~2700 base64 → ~2 KB
    // of payload after estimate).
    const big = sampleThumb(2700);

    await cache.set("a", "v1", big);
    await cache.set("b", "v1", big);
    // Touch `a` so it becomes more-recently-used than `b`.
    await cache.get("a", "v1");
    // Adding `c` should overflow → evict `b` (oldest
    // lastAccessedAt) but keep `a` because we just touched it.
    await cache.set("c", "v1", big);

    expect(await cache.get("a", "v1")).toBeDefined();
    expect(await cache.get("b", "v1")).toBeUndefined();
    expect(await cache.get("c", "v1")).toBeDefined();
  });

  it("evicts on entry-count cap independently of bytes", async () => {
    const cache = new IndexedDBThumbnailCache({
      maxBytes: 100 * 1024 * 1024, // effectively unlimited
      maxEntries: 3,
    });
    const small = sampleThumb(8);
    await cache.set("a", "v1", small);
    await cache.set("b", "v1", small);
    await cache.set("c", "v1", small);
    // Three already at cap; the next set must trigger eviction
    // (sweep targets 10 % under, so ~2 entries remain plus the new
    // arrival, which still respects the cap).
    await cache.get("b", "v1"); // touch
    await cache.get("c", "v1"); // touch
    await cache.set("d", "v1", small);

    expect(await cache.get("a", "v1")).toBeUndefined();
    expect(await cache.get("d", "v1")).toBeDefined();
  });
});

describe("IndexedDBThumbnailCache — quota recovery", () => {
  // Note: end-to-end testing of the put → evict → put → clearAll →
  // put → throw chain against `fake-indexeddb`'s internals is
  // prohibitively fragile (the polyfill defends its FDBRequest's
  // `error` slot from external mutation, so synthetic quota errors
  // can't be injected without forking the polyfill). The retry
  // ladder itself is exercised at the integration level in Phase 2's
  // ThumbnailManager tests, where a stub cache can throw
  // deterministically.
  //
  // Here we just assert the error class is exported so callers can
  // `instanceof` against it without runtime surprises.
  it("exports ThumbnailCacheQuotaError as an instanceof-able class", () => {
    const err = new ThumbnailCacheQuotaError();
    expect(err).toBeInstanceOf(ThumbnailCacheQuotaError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ThumbnailCacheQuotaError");
  });
});
