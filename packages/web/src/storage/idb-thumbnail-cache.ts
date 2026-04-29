/**
 * `IndexedDBThumbnailCache` — first-party browser-side
 * implementation of the
 * [`ThumbnailCache`](../../../core/src/storage/thumbnail-cache.ts)
 * contract.
 *
 * Owns the `annot-thumbs` IndexedDB database (separate from the
 * BrowserStore data DB so its schema versioning is independent).
 * Single object store `thumbnails`, primary keyed on `cacheKey`,
 * with an index on `lastAccessedAt` for LRU eviction.
 *
 * Eviction: at `set` time, if the running totals exceed
 * `MAX_BYTES` OR `MAX_ENTRIES` (whichever first), evict in
 * `lastAccessedAt` ascending order until both metrics drop ~10%
 * under the limit (avoids thrash on each subsequent `set`).
 *
 * Quota recovery: a `QuotaExceededError` from the platform
 * triggers one eviction sweep + retry; a second failure triggers
 * `clearAll` + retry; if that also fails we throw
 * `ThumbnailCacheQuotaError` and the manager falls back to
 * in-memory only for this session.
 *
 * Per the unified-thumbnail-cache plan
 * ([`docs/plans/_done/unified-thumbnail-cache.md`](../../../../docs/plans/_done/unified-thumbnail-cache.md)).
 */

import {
  type CachedThumbnail,
  type ThumbnailCache,
  type ThumbnailCacheGetRequest,
  ThumbnailCacheQuotaError,
} from "@ingcreators/annot-core/storage";

const DB_NAME = "annot-thumbs";
const DB_VERSION = 1;
const STORE = "thumbnails";
const LAST_ACCESSED_INDEX = "lastAccessedAt";

/** Hard cap on total `bytes` summed across entries. 50 MB at v1. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Hard cap on entry count. 5000 at v1. */
export const DEFAULT_MAX_ENTRIES = 5000;

/** Eviction "headroom": after a sweep, totals must drop this far
 *  below the limit before we stop evicting. Avoids the worst case
 *  where every subsequent `set` triggers another sweep. */
const EVICT_HEADROOM = 0.1; // 10 %

interface ThumbnailRow {
  cacheKey: string;
  version: string;
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  lastAccessedAt: number;
  createdAt: number;
}

export interface IndexedDBThumbnailCacheOptions {
  /** Override the IndexedDB factory (for `fake-indexeddb` in tests). */
  indexedDB?: IDBFactory;
  /** Override the byte cap (testing only — production uses
   *  `DEFAULT_MAX_BYTES`). */
  maxBytes?: number;
  /** Override the entry-count cap (testing only). */
  maxEntries?: number;
}

export class IndexedDBThumbnailCache implements ThumbnailCache {
  #idb: IDBFactory;
  #maxBytes: number;
  #maxEntries: number;
  #db?: Promise<IDBDatabase>;
  /** Monotonic in-session counter used as a sub-millisecond
   *  tiebreaker on `lastAccessedAt`. Without this, two operations
   *  inside the same `Date.now()` millisecond would index-collide
   *  and the LRU cursor's walk order becomes implementation-
   *  defined. The counter is bounded (53-bit safe integers); it
   *  resets per construction, which is fine because `Date.now()`'s
   *  millisecond component still anchors cross-session ordering. */
  #counter = 0;

  constructor(opts: IndexedDBThumbnailCacheOptions = {}) {
    this.#idb = opts.indexedDB ?? globalThis.indexedDB;
    this.#maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** `Date.now() * 1024 + counter`. Multiplying by 1024 leaves
   *  ~1024 distinct slots per millisecond before two entries
   *  would collide with the same composite — comfortably more
   *  than realistic operation rates. */
  #stamp(): number {
    this.#counter = (this.#counter + 1) & 0x3ff; // 0..1023
    return Date.now() * 1024 + this.#counter;
  }

  async get(key: string, expectedVersion: string): Promise<CachedThumbnail | undefined> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const row = req.result as ThumbnailRow | undefined;
        if (!row) {
          resolve(undefined);
          return;
        }
        if (row.version !== expectedVersion) {
          // Stale — evict in this same transaction so the next
          // caller sees a clean miss.
          store.delete(key);
          resolve(undefined);
          return;
        }
        // Fresh — bump lastAccessedAt for LRU eviction.
        row.lastAccessedAt = this.#stamp();
        store.put(row);
        resolve({ dataUrl: row.dataUrl, width: row.width, height: row.height });
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getMany(requests: ThumbnailCacheGetRequest[]): Promise<Map<string, CachedThumbnail>> {
    if (requests.length === 0) return new Map();
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const result = new Map<string, CachedThumbnail>();
      let pending = requests.length;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      for (const { key, expectedVersion } of requests) {
        const req = store.get(key);
        req.onsuccess = () => {
          const row = req.result as ThumbnailRow | undefined;
          if (row) {
            if (row.version === expectedVersion) {
              row.lastAccessedAt = this.#stamp();
              store.put(row);
              result.set(key, {
                dataUrl: row.dataUrl,
                width: row.width,
                height: row.height,
              });
            } else {
              store.delete(key);
            }
          }
          // tx.oncomplete handles resolve; pending counter is
          // bookkeeping in case we ever want a fast-path (unused).
          pending -= 1;
        };
        req.onerror = () => reject(req.error);
      }
      // Touch `pending` so TS doesn't complain — also a useful
      // guard if we ever switch to early-resolve semantics.
      void pending;
    });
  }

  async set(key: string, version: string, value: CachedThumbnail): Promise<void> {
    const bytes = estimateBytes(value);
    const row: ThumbnailRow = {
      cacheKey: key,
      version,
      dataUrl: value.dataUrl,
      width: value.width,
      height: value.height,
      bytes,
      lastAccessedAt: this.#stamp(),
      createdAt: Date.now(),
    };

    // Pre-emptive eviction so we don't immediately overflow.
    await this.#maybeEvict(bytes);

    try {
      await this.#put(row);
      return;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }

    // Quota error path: try a second eviction sweep + retry, then
    // a full clear + retry, then surface as
    // `ThumbnailCacheQuotaError` for the manager to handle.
    await this.#evictDown(this.#maxBytes * (1 - EVICT_HEADROOM));
    try {
      await this.#put(row);
      return;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
    await this.clearAll();
    try {
      await this.#put(row);
    } catch (e) {
      throw new ThumbnailCacheQuotaError(undefined, { cause: e });
    }
  }

  async delete(key: string): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix) {
      // A bare `deletePrefix("")` would wipe everything by the
      // `startsWith` check — guard against it explicitly so a
      // caller never accidentally clears the world.
      throw new Error("deletePrefix requires a non-empty prefix");
    }
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      // IDBKeyRange `bound(prefix, prefix + "￿")` would be
      // marginally faster than a full cursor walk, but key-range
      // semantics get fiddly across implementations and
      // `cacheKey` is short — stay with the cursor for clarity.
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const k = cursor.primaryKey as string;
        if (typeof k === "string" && k.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Internals ───────────────────────────────────────────────

  #open(): Promise<IDBDatabase> {
    if (this.#db) return this.#db;
    this.#db = new Promise((resolve, reject) => {
      const req = this.#idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "cacheKey" });
          store.createIndex(LAST_ACCESSED_INDEX, "lastAccessedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.#db;
  }

  async #put(row: ThumbnailRow): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * If adding `incomingBytes` to the current totals would exceed
   * `maxBytes` or `maxEntries`, run an eviction sweep until both
   * are ~10% under the limit. No-op when totals are already fine.
   */
  async #maybeEvict(incomingBytes: number): Promise<void> {
    const { totalBytes, totalEntries } = await this.#totals();
    const wouldOverflow =
      totalBytes + incomingBytes > this.#maxBytes || totalEntries + 1 > this.#maxEntries;
    if (!wouldOverflow) return;
    await this.#evictDown(this.#maxBytes * (1 - EVICT_HEADROOM));
  }

  async #totals(): Promise<{ totalBytes: number; totalEntries: number }> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      let totalBytes = 0;
      let totalEntries = 0;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve({ totalBytes, totalEntries });
          return;
        }
        const row = cursor.value as ThumbnailRow;
        totalBytes += row.bytes;
        totalEntries += 1;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Walk the `lastAccessedAt` index in ascending order and delete
   * entries until total bytes drop to or below `targetBytes` AND
   * total entries drop to or below `targetEntries`. Targets are
   * the pre-computed "headroom" thresholds.
   */
  async #evictDown(targetBytes: number): Promise<void> {
    const targetEntries = this.#maxEntries * (1 - EVICT_HEADROOM);
    const db = await this.#open();
    const { totalBytes, totalEntries } = await this.#totals();
    if (totalBytes <= targetBytes && totalEntries <= targetEntries) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const idx = store.index(LAST_ACCESSED_INDEX);
      let runningBytes = totalBytes;
      let runningEntries = totalEntries;
      const req = idx.openCursor(); // ascending by default
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (runningBytes <= targetBytes && runningEntries <= targetEntries) {
          resolve();
          return;
        }
        const row = cursor.value as ThumbnailRow;
        runningBytes -= row.bytes;
        runningEntries -= 1;
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Approximate the in-flight size of a `CachedThumbnail`'s `dataUrl`.
 * `dataUrl` is base64; the actual JPEG bytes are ~3/4 of the string
 * length. The dimensions / version / key are negligible compared to
 * the data URL so we ignore them.
 */
function estimateBytes(value: CachedThumbnail): number {
  const len = value.dataUrl.length;
  // Strip the `data:image/jpeg;base64,` prefix — its length is
  // roughly fixed and small. Matters when totals are near the
  // limit.
  const headerEnd = value.dataUrl.indexOf(",");
  const base64Len = headerEnd >= 0 ? len - headerEnd - 1 : len;
  return Math.ceil((base64Len * 3) / 4);
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22)
  );
}
