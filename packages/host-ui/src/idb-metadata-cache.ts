/**
 * `IndexedDBMetadataCache` — first-party browser-side implementation
 * of the
 * [`MetadataCache`](../../core/src/storage/metadata-cache.ts)
 * contract.
 *
 * Owns the `annot-metadata` IndexedDB database (separate from the
 * `annot-thumbs` thumbnail DB and from BrowserStore's data DB so
 * its schema versioning is independent). Four object stores:
 *
 *   - `records` — per-`(ns, path)` `ImageRecord` / `DocumentRecord`
 *     plus the version string for cache-hit gating. Indexed on
 *     `ns` (prefix invalidation walks via the index) and
 *     `lastAccessedAt` (LRU eviction).
 *   - `listings` — per-`(ns, folderPath)` `ListingEntry[]`. Indexed
 *     on `ns`.
 *   - `namespace_meta` — per-`(ns, key)` string value KV. Indexed
 *     on `ns`. Used by GitHubStore's `branchHead` and Drive's
 *     `changesPageToken`.
 *   - `backend_ids` — per-`(ns, path)` `backendId` + reverse index
 *     for Drive-style path ↔ fileId.
 *
 * Memory LRU layer in front of the persistent store keeps the hot
 * working set (default 500 records, 200 listings) on the synchronous
 * path. Misses fall through to IDB.
 *
 * Multi-tab consistency via a `BroadcastChannel`
 * (`annot-metadata` by default): mutations broadcast after the IDB
 * write commits; receivers invalidate their memory LRU for the
 * affected key. Pattern is "Notify-and-reread" — messages carry
 * only `(ns, path/folderPath, version)`, not the record payload,
 * so peers always read the IDB's committed state on next access.
 *
 * Per the shared-metadata-cache plan
 * ([`docs/plans/shared-metadata-cache.md`](../../../docs/plans/shared-metadata-cache.md)).
 */

import type { DocumentRecord, ImageRecord } from "@ingcreators/annot-core/storage";
import {
  type ListingEntry,
  type MetadataCache,
  MetadataCacheQuotaError,
} from "@ingcreators/annot-core/storage";

const DB_NAME = "annot-metadata";
const DB_VERSION = 1;

const STORE_RECORDS = "records";
const STORE_LISTINGS = "listings";
const STORE_NS_META = "namespace_meta";
const STORE_BACKEND_IDS = "backend_ids";

const NS_INDEX = "ns";
const LAST_ACCESSED_INDEX = "lastAccessedAt";
const BACKEND_ID_INDEX = "backendIdKey";

const DEFAULT_CHANNEL_NAME = "annot-metadata";

/** Default cap on the in-memory record LRU. Mutable in tests. */
export const DEFAULT_RECORD_MEMORY_LIMIT = 500;

/** Default cap on the in-memory listing LRU. */
export const DEFAULT_LISTING_MEMORY_LIMIT = 200;

/** Default cap on total record entries persisted in IDB. */
export const DEFAULT_MAX_RECORD_ENTRIES = 20000;

/** Eviction "headroom" — sweeps drop us this far below the cap so
 *  a single excess `put` doesn't trigger immediate re-eviction. */
const EVICT_HEADROOM = 0.1;

type RecordKind = "image" | "document";

interface RecordRow {
  cacheKey: string;
  ns: string;
  path: string;
  version: string;
  kind: RecordKind;
  record: ImageRecord | DocumentRecord;
  lastAccessedAt: number;
  createdAt: number;
}

interface ListingRow {
  listingKey: string;
  ns: string;
  folderPath: string;
  entries: ListingEntry[];
  updatedAt: number;
}

interface NamespaceMetaRow {
  id: string;
  ns: string;
  key: string;
  value: string;
  updatedAt: number;
}

interface BackendIdRow {
  pathKey: string;
  ns: string;
  path: string;
  backendId: string;
  backendIdKey: string; // ns + ":" + backendId — for reverse lookup
  updatedAt: number;
}

/**
 * Outgoing / incoming `BroadcastChannel` event shape. Receivers
 * narrow on `type` and invalidate their memory LRU for the affected
 * key. `sender` is the per-instance UUID used to filter own echo.
 */
export type MetadataBroadcastEvent =
  | { type: "path-changed"; ns: string; path: string; version: string; sender: string }
  | { type: "listing-changed"; ns: string; folderPath: string; sender: string }
  | { type: "prefix-invalidated"; prefix: string; sender: string }
  | { type: "ns-meta-changed"; ns: string; key: string; sender: string };

/**
 * Detail shape for the re-dispatched `CustomEvent`s on `window`.
 * Hosts wire UI listeners onto these to react to cross-tab changes
 * (refresh open galleries, drop in-store memory shortcuts, etc.).
 */
export type MetadataChangedDetail =
  | { kind: "path"; ns: string; path: string; version: string }
  | { kind: "listing"; ns: string; folderPath: string }
  | { kind: "prefix"; prefix: string };

export interface MetadataNamespaceChangedDetail {
  ns: string;
  key: string;
}

export interface IndexedDBMetadataCacheOptions {
  /** Override the IndexedDB factory (for `fake-indexeddb` in tests). */
  indexedDB?: IDBFactory;
  /** Disable cross-tab `BroadcastChannel` wiring. Default: enabled
   *  when `BroadcastChannel` is available. */
  multiTab?: boolean;
  /** Override the channel name (test isolation). */
  channelName?: string;
  /** Override the in-memory record LRU cap. */
  recordMemoryLimit?: number;
  /** Override the in-memory listing LRU cap. */
  listingMemoryLimit?: number;
  /** Override the IDB record-entry cap (testing only). */
  maxRecordEntries?: number;
  /** Skip `window`-side `CustomEvent` re-dispatch (testing in a
   *  bare-Node environment). Default: dispatch when `window` is
   *  defined. */
  dispatchWindowEvents?: boolean;
  /** Override the sender id generator (test determinism). */
  senderIdFactory?: () => string;
}

/**
 * Convenience cache-key builders. Exported for tests + downstream
 * consumers that want to derive keys without going through the
 * cache (e.g. a custom `invalidatePrefix` callsite). Keep the
 * format aligned with how the IDB rows are written — changing
 * them breaks on-disk caches.
 */
export function recordCacheKey(ns: string, path: string): string {
  return `${ns}:${path}`;
}
export function listingCacheKey(ns: string, folderPath: string): string {
  return `${ns}:${folderPath}`;
}
export function nsMetaCacheKey(ns: string, key: string): string {
  return `${ns}:${key}`;
}
export function backendIdKey(ns: string, backendId: string): string {
  return `${ns}:${backendId}`;
}

export class IndexedDBMetadataCache implements MetadataCache {
  #idb: IDBFactory;
  #db?: Promise<IDBDatabase>;
  #channel?: BroadcastChannel;
  #senderId: string;
  #dispatchWindow: boolean;
  #recordLimit: number;
  #listingLimit: number;
  #maxRecordEntries: number;
  #recordMem = new Map<string, RecordRow>();
  #listingMem = new Map<string, ListingRow>();
  /** Monotonic in-session counter for tiebreaking same-ms timestamps
   *  on the `lastAccessedAt` index. Same pattern as IDB thumbnail
   *  cache uses to keep cursor walks deterministic. */
  #counter = 0;

  constructor(opts: IndexedDBMetadataCacheOptions = {}) {
    this.#idb = opts.indexedDB ?? globalThis.indexedDB;
    this.#recordLimit = opts.recordMemoryLimit ?? DEFAULT_RECORD_MEMORY_LIMIT;
    this.#listingLimit = opts.listingMemoryLimit ?? DEFAULT_LISTING_MEMORY_LIMIT;
    this.#maxRecordEntries = opts.maxRecordEntries ?? DEFAULT_MAX_RECORD_ENTRIES;
    this.#senderId = (opts.senderIdFactory ?? defaultSenderId)();
    this.#dispatchWindow = opts.dispatchWindowEvents ?? typeof window !== "undefined";

    const multiTab = opts.multiTab !== false && typeof globalThis.BroadcastChannel !== "undefined";
    if (multiTab) {
      this.#channel = new globalThis.BroadcastChannel(opts.channelName ?? DEFAULT_CHANNEL_NAME);
      this.#channel.onmessage = (e) => this.#onBroadcast(e.data as MetadataBroadcastEvent);
    }
  }

  /** Close the BroadcastChannel and drop the in-memory LRUs. Use
   *  this in tests or when the cache instance is being thrown away. */
  close(): void {
    this.#channel?.close();
    this.#channel = undefined;
    this.#recordMem.clear();
    this.#listingMem.clear();
  }

  // ── Per-path record cache ────────────────────────

  async getImage(ns: string, path: string, version: string): Promise<ImageRecord | undefined> {
    return (await this.#getRecord(ns, path, version, "image")) as ImageRecord | undefined;
  }

  async putImage(ns: string, path: string, version: string, rec: ImageRecord): Promise<void> {
    await this.#putRecord(ns, path, version, "image", rec);
  }

  async getDocument(
    ns: string,
    path: string,
    version: string,
  ): Promise<DocumentRecord | undefined> {
    return (await this.#getRecord(ns, path, version, "document")) as DocumentRecord | undefined;
  }

  async putDocument(ns: string, path: string, version: string, rec: DocumentRecord): Promise<void> {
    await this.#putRecord(ns, path, version, "document", rec);
  }

  // ── Per-folder listing cache ─────────────────────

  async getListing(ns: string, folderPath: string): Promise<ListingEntry[] | undefined> {
    const key = listingCacheKey(ns, folderPath);
    const mem = this.#listingMem.get(key);
    if (mem) {
      this.#bumpListingMem(key, mem);
      return cloneEntries(mem.entries);
    }
    const db = await this.#open();
    const row = await idbGet<ListingRow>(db, STORE_LISTINGS, key);
    if (!row) return undefined;
    this.#listingMemSet(key, row);
    return cloneEntries(row.entries);
  }

  async putListing(ns: string, folderPath: string, entries: ListingEntry[]): Promise<void> {
    const key = listingCacheKey(ns, folderPath);
    const row: ListingRow = {
      listingKey: key,
      ns,
      folderPath,
      entries: cloneEntries(entries),
      updatedAt: this.#stamp(),
    };
    await idbPut(await this.#open(), STORE_LISTINGS, row);
    this.#listingMemSet(key, row);
    this.#emit({ type: "listing-changed", ns, folderPath, sender: this.#senderId });
    this.#dispatch("annot-metadata-changed", { kind: "listing", ns, folderPath });
  }

  async upsertListingEntry(ns: string, folderPath: string, entry: ListingEntry): Promise<void> {
    const existing = await this.getListing(ns, folderPath);
    if (!existing) return;
    const next = existing.filter((e) => e.path !== entry.path);
    next.push({ ...entry });
    await this.putListing(ns, folderPath, next);
  }

  async removeListingEntry(ns: string, folderPath: string, path: string): Promise<void> {
    const existing = await this.getListing(ns, folderPath);
    if (!existing) return;
    const next = existing.filter((e) => e.path !== path);
    if (next.length === existing.length) return;
    await this.putListing(ns, folderPath, next);
  }

  // ── Per-namespace meta ───────────────────────────

  async getNamespaceMeta(ns: string, key: string): Promise<string | undefined> {
    const id = nsMetaCacheKey(ns, key);
    const row = await idbGet<NamespaceMetaRow>(await this.#open(), STORE_NS_META, id);
    return row?.value;
  }

  async putNamespaceMeta(ns: string, key: string, value: string): Promise<void> {
    const row: NamespaceMetaRow = {
      id: nsMetaCacheKey(ns, key),
      ns,
      key,
      value,
      updatedAt: this.#stamp(),
    };
    await idbPut(await this.#open(), STORE_NS_META, row);
    this.#emit({ type: "ns-meta-changed", ns, key, sender: this.#senderId });
    this.#dispatchNs(ns, key);
  }

  async deleteNamespaceMeta(ns: string, key: string): Promise<void> {
    const id = nsMetaCacheKey(ns, key);
    await idbDelete(await this.#open(), STORE_NS_META, id);
    this.#emit({ type: "ns-meta-changed", ns, key, sender: this.#senderId });
    this.#dispatchNs(ns, key);
  }

  // ── Backend ID map ───────────────────────────────

  async setBackendId(ns: string, path: string, backendId: string): Promise<void> {
    const row: BackendIdRow = {
      pathKey: recordCacheKey(ns, path),
      ns,
      path,
      backendId,
      backendIdKey: backendIdKey(ns, backendId),
      updatedAt: this.#stamp(),
    };
    await idbPut(await this.#open(), STORE_BACKEND_IDS, row);
  }

  async getBackendIdByPath(ns: string, path: string): Promise<string | undefined> {
    const row = await idbGet<BackendIdRow>(
      await this.#open(),
      STORE_BACKEND_IDS,
      recordCacheKey(ns, path),
    );
    return row?.backendId;
  }

  async getPathByBackendId(ns: string, backendId: string): Promise<string | undefined> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BACKEND_IDS, "readonly");
      const idx = tx.objectStore(STORE_BACKEND_IDS).index(BACKEND_ID_INDEX);
      const req = idx.get(backendIdKey(ns, backendId));
      req.onsuccess = () => resolve((req.result as BackendIdRow | undefined)?.path);
      req.onerror = () => reject(req.error);
    });
  }

  // ── Bulk operations ──────────────────────────────

  async migrateEntry(ns: string, oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;

    const db = await this.#open();
    const oldKey = recordCacheKey(ns, oldPath);
    const newKey = recordCacheKey(ns, newPath);

    // Move the record row (image or document) — preserve version /
    // kind / timestamps; only the keyed identity changes.
    const recordRow = await idbGet<RecordRow>(db, STORE_RECORDS, oldKey);
    if (recordRow) {
      const next: RecordRow = {
        ...recordRow,
        cacheKey: newKey,
        path: newPath,
      };
      await idbDelete(db, STORE_RECORDS, oldKey);
      await idbPut(db, STORE_RECORDS, next);
      this.#recordMem.delete(oldKey);
      this.#recordMem.set(newKey, next);
    }

    // Move the backend ID row, if any.
    const backendRow = await idbGet<BackendIdRow>(db, STORE_BACKEND_IDS, oldKey);
    if (backendRow) {
      const next: BackendIdRow = {
        ...backendRow,
        pathKey: newKey,
        path: newPath,
      };
      await idbDelete(db, STORE_BACKEND_IDS, oldKey);
      await idbPut(db, STORE_BACKEND_IDS, next);
    }

    // Listing updates: remove from old parent, upsert into new
    // parent (preserving the entry's version / kind).
    const oldParent = parentOf(oldPath);
    const newParent = parentOf(newPath);
    const versionForListing = recordRow?.version ?? "";
    const kindForListing: ListingEntry["kind"] =
      recordRow?.kind === "document" ? "document" : "image";

    await this.removeListingEntry(ns, oldParent, oldPath);
    const existingNewListing = await this.getListing(ns, newParent);
    if (existingNewListing) {
      await this.upsertListingEntry(ns, newParent, {
        path: newPath,
        version: versionForListing,
        kind: kindForListing,
      });
    }

    this.#emit({
      type: "path-changed",
      ns,
      path: oldPath,
      version: "",
      sender: this.#senderId,
    });
    this.#emit({
      type: "path-changed",
      ns,
      path: newPath,
      version: versionForListing,
      sender: this.#senderId,
    });
  }

  async rewriteEntriesForPrefix(ns: string, oldPrefix: string, newPrefix: string): Promise<void> {
    if (oldPrefix === newPrefix) return;
    const db = await this.#open();

    const oldFullPrefix = `${ns}:${oldPrefix}`;
    const newFullPrefix = `${ns}:${newPrefix}`;

    // Records.
    const records = await this.#allUnderPrefix<RecordRow>(
      db,
      STORE_RECORDS,
      "cacheKey",
      oldFullPrefix,
    );
    for (const row of records) {
      const newPath = newPrefix + row.path.slice(oldPrefix.length);
      const newCacheKey = recordCacheKey(ns, newPath);
      await idbDelete(db, STORE_RECORDS, row.cacheKey);
      await idbPut(db, STORE_RECORDS, { ...row, cacheKey: newCacheKey, path: newPath });
      this.#recordMem.delete(row.cacheKey);
    }

    // Backend IDs.
    const backendIds = await this.#allUnderPrefix<BackendIdRow>(
      db,
      STORE_BACKEND_IDS,
      "pathKey",
      oldFullPrefix,
    );
    for (const row of backendIds) {
      const newPath = newPrefix + row.path.slice(oldPrefix.length);
      const newPathKey = recordCacheKey(ns, newPath);
      await idbDelete(db, STORE_BACKEND_IDS, row.pathKey);
      await idbPut(db, STORE_BACKEND_IDS, { ...row, pathKey: newPathKey, path: newPath });
    }

    // Listings — both the listings keyed under the prefix AND the
    // path values inside listings outside the prefix that point
    // into it. The latter doesn't happen in practice (a listing's
    // entries live under its `folderPath`), so we only rewrite the
    // listings whose own key is under the prefix.
    const listings = await this.#allUnderPrefix<ListingRow>(
      db,
      STORE_LISTINGS,
      "listingKey",
      oldFullPrefix,
    );
    for (const row of listings) {
      const newFolderPath = newPrefix + row.folderPath.slice(oldPrefix.length);
      const newListingKey = listingCacheKey(ns, newFolderPath);
      const nextEntries = row.entries.map((e) => ({
        ...e,
        path: newPrefix + e.path.slice(oldPrefix.length),
      }));
      await idbDelete(db, STORE_LISTINGS, row.listingKey);
      await idbPut(db, STORE_LISTINGS, {
        ...row,
        listingKey: newListingKey,
        folderPath: newFolderPath,
        entries: nextEntries,
        updatedAt: this.#stamp(),
      });
      this.#listingMem.delete(row.listingKey);
    }

    // Broad invalidation broadcast — receivers drop their memory
    // LRU for anything under either prefix.
    this.#emit({ type: "prefix-invalidated", prefix: oldFullPrefix, sender: this.#senderId });
    this.#emit({ type: "prefix-invalidated", prefix: newFullPrefix, sender: this.#senderId });
    this.#dispatch("annot-metadata-changed", { kind: "prefix", prefix: oldFullPrefix });
    this.#dispatch("annot-metadata-changed", { kind: "prefix", prefix: newFullPrefix });
  }

  // ── Invalidation ─────────────────────────────────

  async invalidatePath(ns: string, path: string): Promise<void> {
    const key = recordCacheKey(ns, path);
    const db = await this.#open();
    await idbDelete(db, STORE_RECORDS, key);
    this.#recordMem.delete(key);
    this.#emit({
      type: "path-changed",
      ns,
      path,
      version: "",
      sender: this.#senderId,
    });
    this.#dispatch("annot-metadata-changed", { kind: "path", ns, path, version: "" });
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    if (!prefix) {
      throw new Error("invalidatePrefix requires a non-empty prefix");
    }
    const db = await this.#open();

    await deletePrefixFromStore(db, STORE_RECORDS, prefix);
    await deletePrefixFromStore(db, STORE_LISTINGS, prefix);
    await deletePrefixFromStore(db, STORE_NS_META, prefix);
    await deletePrefixFromStore(db, STORE_BACKEND_IDS, prefix);

    for (const k of [...this.#recordMem.keys()]) {
      if (k.startsWith(prefix)) this.#recordMem.delete(k);
    }
    for (const k of [...this.#listingMem.keys()]) {
      if (k.startsWith(prefix)) this.#listingMem.delete(k);
    }

    this.#emit({ type: "prefix-invalidated", prefix, sender: this.#senderId });
    this.#dispatch("annot-metadata-changed", { kind: "prefix", prefix });
  }

  // ── Internals ─────────────────────────────────────

  async #getRecord(
    ns: string,
    path: string,
    version: string,
    kind: RecordKind,
  ): Promise<ImageRecord | DocumentRecord | undefined> {
    const key = recordCacheKey(ns, path);
    const mem = this.#recordMem.get(key);
    if (mem) {
      if (mem.version === version && mem.kind === kind) {
        // Write-through `lastAccessedAt` to keep the IDB-side LRU
        // honest. Without this, memory hits bypass IDB entirely and
        // the cold cache's eviction order goes stale.
        mem.lastAccessedAt = this.#stamp();
        this.#bumpRecordMem(key, mem);
        await idbPut(await this.#open(), STORE_RECORDS, mem);
        return cloneRecord(mem.record);
      }
      // Version / kind mismatch on the memory side — drop and fall
      // through to IDB. We do NOT evict the IDB row here: in a
      // multi-tab world another tab may have written a NEWER version
      // and broadcasted; the local memory copy is stale (an older
      // version we cached earlier), so the request for the local
      // version simply misses without disturbing the newer IDB row.
      this.#recordMem.delete(key);
    }

    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, "readwrite");
      const store = tx.objectStore(STORE_RECORDS);
      const req = store.get(key);
      req.onsuccess = () => {
        const row = req.result as RecordRow | undefined;
        if (!row) {
          resolve(undefined);
          return;
        }
        if (row.version !== version || row.kind !== kind) {
          // Plain miss — do NOT evict. The cached version may be
          // newer than what the caller asked for (a peer tab wrote
          // it via BroadcastChannel-aware sync); evicting here would
          // throw away valid data. Stale entries are eventually
          // overwritten by the next `put` or aged out by LRU.
          resolve(undefined);
          return;
        }
        row.lastAccessedAt = this.#stamp();
        store.put(row);
        this.#recordMemSet(key, row);
        resolve(cloneRecord(row.record));
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async #putRecord(
    ns: string,
    path: string,
    version: string,
    kind: RecordKind,
    rec: ImageRecord | DocumentRecord,
  ): Promise<void> {
    const key = recordCacheKey(ns, path);
    const row: RecordRow = {
      cacheKey: key,
      ns,
      path,
      version,
      kind,
      record: cloneRecord(rec),
      lastAccessedAt: this.#stamp(),
      createdAt: Date.now(),
    };

    await this.#maybeEvictRecords();

    try {
      await idbPut(await this.#open(), STORE_RECORDS, row);
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      await this.#evictRecordsDown(Math.floor(this.#maxRecordEntries * (1 - EVICT_HEADROOM)));
      try {
        await idbPut(await this.#open(), STORE_RECORDS, row);
      } catch (e2) {
        if (!isQuotaError(e2)) throw e2;
        // Last resort: wipe records, retry once, surface
        // `MetadataCacheQuotaError` if even that fails.
        await this.#clearStore(STORE_RECORDS);
        this.#recordMem.clear();
        try {
          await idbPut(await this.#open(), STORE_RECORDS, row);
        } catch (e3) {
          throw new MetadataCacheQuotaError(undefined, { cause: e3 });
        }
      }
    }

    this.#recordMemSet(key, row);
    this.#emit({ type: "path-changed", ns, path, version, sender: this.#senderId });
    this.#dispatch("annot-metadata-changed", { kind: "path", ns, path, version });
  }

  async #maybeEvictRecords(): Promise<void> {
    const count = await this.#countRecords();
    if (count + 1 <= this.#maxRecordEntries) return;
    await this.#evictRecordsDown(Math.floor(this.#maxRecordEntries * (1 - EVICT_HEADROOM)));
  }

  async #countRecords(): Promise<number> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, "readonly");
      const req = tx.objectStore(STORE_RECORDS).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async #evictRecordsDown(target: number): Promise<void> {
    const db = await this.#open();
    const current = await this.#countRecords();
    if (current <= target) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, "readwrite");
      const idx = tx.objectStore(STORE_RECORDS).index(LAST_ACCESSED_INDEX);
      let running = current;
      const req = idx.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || running <= target) {
          resolve();
          return;
        }
        const row = cursor.value as RecordRow;
        cursor.delete();
        this.#recordMem.delete(row.cacheKey);
        running -= 1;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async #clearStore(name: string): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readwrite");
      tx.objectStore(name).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async #allUnderPrefix<T>(
    db: IDBDatabase,
    storeName: string,
    keyField: string,
    prefix: string,
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const out: T[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const row = cursor.value as Record<string, unknown>;
        const k = row[keyField];
        if (typeof k === "string" && k.startsWith(prefix)) {
          out.push(row as T);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  #recordMemSet(key: string, row: RecordRow): void {
    if (this.#recordMem.has(key)) this.#recordMem.delete(key);
    this.#recordMem.set(key, row);
    while (this.#recordMem.size > this.#recordLimit) {
      const oldest = this.#recordMem.keys().next().value;
      if (oldest === undefined) break;
      this.#recordMem.delete(oldest);
    }
  }

  #bumpRecordMem(key: string, row: RecordRow): void {
    this.#recordMem.delete(key);
    this.#recordMem.set(key, row);
  }

  #listingMemSet(key: string, row: ListingRow): void {
    if (this.#listingMem.has(key)) this.#listingMem.delete(key);
    this.#listingMem.set(key, row);
    while (this.#listingMem.size > this.#listingLimit) {
      const oldest = this.#listingMem.keys().next().value;
      if (oldest === undefined) break;
      this.#listingMem.delete(oldest);
    }
  }

  #bumpListingMem(key: string, row: ListingRow): void {
    this.#listingMem.delete(key);
    this.#listingMem.set(key, row);
  }

  #stamp(): number {
    this.#counter = (this.#counter + 1) & 0x3ff;
    return Date.now() * 1024 + this.#counter;
  }

  #open(): Promise<IDBDatabase> {
    if (this.#db) return this.#db;
    this.#db = new Promise((resolve, reject) => {
      const req = this.#idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const store = db.createObjectStore(STORE_RECORDS, { keyPath: "cacheKey" });
          store.createIndex(NS_INDEX, "ns", { unique: false });
          store.createIndex(LAST_ACCESSED_INDEX, "lastAccessedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_LISTINGS)) {
          const store = db.createObjectStore(STORE_LISTINGS, { keyPath: "listingKey" });
          store.createIndex(NS_INDEX, "ns", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_NS_META)) {
          const store = db.createObjectStore(STORE_NS_META, { keyPath: "id" });
          store.createIndex(NS_INDEX, "ns", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_BACKEND_IDS)) {
          const store = db.createObjectStore(STORE_BACKEND_IDS, { keyPath: "pathKey" });
          store.createIndex(NS_INDEX, "ns", { unique: false });
          store.createIndex(BACKEND_ID_INDEX, "backendIdKey", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.#db;
  }

  #emit(event: MetadataBroadcastEvent): void {
    this.#channel?.postMessage(event);
  }

  #onBroadcast(event: MetadataBroadcastEvent): void {
    if (event.sender === this.#senderId) return;
    switch (event.type) {
      case "path-changed": {
        const key = recordCacheKey(event.ns, event.path);
        const mem = this.#recordMem.get(key);
        if (mem && mem.version !== event.version) {
          this.#recordMem.delete(key);
        }
        this.#dispatch("annot-metadata-changed", {
          kind: "path",
          ns: event.ns,
          path: event.path,
          version: event.version,
        });
        break;
      }
      case "listing-changed": {
        this.#listingMem.delete(listingCacheKey(event.ns, event.folderPath));
        this.#dispatch("annot-metadata-changed", {
          kind: "listing",
          ns: event.ns,
          folderPath: event.folderPath,
        });
        break;
      }
      case "prefix-invalidated": {
        for (const k of [...this.#recordMem.keys()]) {
          if (k.startsWith(event.prefix)) this.#recordMem.delete(k);
        }
        for (const k of [...this.#listingMem.keys()]) {
          if (k.startsWith(event.prefix)) this.#listingMem.delete(k);
        }
        this.#dispatch("annot-metadata-changed", { kind: "prefix", prefix: event.prefix });
        break;
      }
      case "ns-meta-changed": {
        this.#dispatchNs(event.ns, event.key);
        break;
      }
    }
  }

  #dispatch(name: "annot-metadata-changed", detail: MetadataChangedDetail): void {
    if (!this.#dispatchWindow || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  #dispatchNs(ns: string, key: string): void {
    if (!this.#dispatchWindow || typeof window === "undefined") return;
    const detail: MetadataNamespaceChangedDetail = { ns, key };
    window.dispatchEvent(new CustomEvent("annot-metadata-ns-changed", { detail }));
  }
}

// ─── IDB transaction helpers ────────────────────────────────────

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, storeName: string, row: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(row as object);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deletePrefixFromStore(db: IDBDatabase, storeName: string, prefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
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

// ─── Misc helpers ────────────────────────────────────────────────

function cloneEntries(entries: ListingEntry[]): ListingEntry[] {
  return entries.map((e) => ({ ...e }));
}

function cloneRecord<T extends ImageRecord | DocumentRecord>(rec: T): T {
  // Structured clone is what IDB does internally, but expose a
  // sync deep clone for the memory-LRU path so callers can't
  // mutate cached state through a returned reference.
  if (typeof structuredClone === "function") {
    return structuredClone(rec);
  }
  return JSON.parse(JSON.stringify(rec)) as T;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22)
  );
}

function defaultSenderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without `crypto.randomUUID` (e.g.
  // very old Node). Not cryptographically strong; only used as an
  // echo-suppression discriminator.
  return `sender-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
