/**
 * Persistent thumbnail cache contract — Tier A, DOM-free.
 *
 * Owns a key-versioned key/value store of pre-rendered gallery
 * thumbnails (`dataUrl` + natural dimensions). Implementations
 * decide where the bytes live: the first-party
 * `IndexedDBThumbnailCache` in `@ingcreators/annot-web/storage/
 * idb-thumbnail-cache` is the canonical browser-side option;
 * tests / Node hosts can swap in an in-memory mock with the
 * same surface.
 *
 * The unified-thumbnail-cache plan
 * ([`docs/plans/_done/unified-thumbnail-cache.md`](../../../../docs/plans/_done/unified-thumbnail-cache.md))
 * lifts the per-store `#ensureThumbnail` lifecycle into a single
 * host-side `ThumbnailManager` that talks to one `ThumbnailCache`
 * instance shared across every backend; this file is the Tier A
 * piece that contract.
 *
 * Keys carry a host-reserved namespace prefix matching the
 * `StorageMode` strings used elsewhere in the app (`browser:` /
 * `device:` / `github:` / `googledrive:`); plugin-registered
 * providers must use the `plugin:<pluginId>:` prefix the host
 * enforces at registration time. See the plan doc for the full
 * convention.
 */

/**
 * One cached thumbnail. JPEG-encoded `dataUrl` (already base64
 * via the standard `image-thumbnail.ts` helper) plus the source
 * image's natural dimensions — needed by the gallery card's
 * `WxH • date` line so it doesn't have to wait on a separate
 * decode round-trip after a cache hit.
 */
export interface CachedThumbnail {
  dataUrl: string;
  width: number;
  height: number;
}

/** One bulk-`get` request — the key plus the version the caller
 *  considers fresh. Mismatches are evicted, not returned. */
export interface ThumbnailCacheGetRequest {
  key: string;
  expectedVersion: string;
}

/**
 * Key/value store of `CachedThumbnail` entries with version-gated
 * cache hits. Lifecycle owned by the host-side `ThumbnailManager`;
 * `StorageProvider` implementations don't talk to this directly,
 * they expose `thumbnailKey` / `thumbnailVersion` /
 * `fetchThumbnailSource` and let the manager drive the cache.
 */
export interface ThumbnailCache {
  /**
   * Returns the cached entry IFF its stored version matches
   * `expectedVersion`. Stale entries (version mismatch) are
   * evicted as a side effect of `get` — the next caller sees a
   * cold miss. `lastAccessedAt` is updated on hit so LRU
   * eviction respects recent reads.
   */
  get(key: string, expectedVersion: string): Promise<CachedThumbnail | undefined>;

  /**
   * Bulk get — single transaction instead of one per record.
   * Used by `ThumbnailManager.attach` against a `listImages`
   * result so cold listings of a populated gallery don't fan
   * out into N IDB round-trips.
   *
   * The returned `Map` keys are the request keys (so callers
   * can correlate). Misses are simply absent.
   */
  getMany(requests: ThumbnailCacheGetRequest[]): Promise<Map<string, CachedThumbnail>>;

  /**
   * Write or overwrite at `key`. Updates the entry's
   * `lastAccessedAt`. Implementations should handle quota
   * exhaustion internally (one self-eviction sweep + retry,
   * `clearAll` as last resort) and only throw
   * `ThumbnailCacheQuotaError` when even that fails.
   */
  set(key: string, version: string, value: CachedThumbnail): Promise<void>;

  /** Evict by exact key. */
  delete(key: string): Promise<void>;

  /**
   * Drop every entry whose key starts with `prefix`. Used by:
   *   - `StorageProvider.resync()` to invalidate a whole instance's
   *     namespace without enumerating individual keys.
   *   - Plugin uninstall — the host fires
   *     `deletePrefix("plugin:<pluginId>:")`.
   */
  deletePrefix(prefix: string): Promise<void>;

  /** Quota-recovery hatch. Drops everything. */
  clearAll(): Promise<void>;
}

/**
 * Base error type implementations may throw out of `set` once
 * eviction + retry both fail. `ThumbnailManager` swallows this
 * and falls back to in-memory only — the gallery still gets the
 * thumbnail for the current session, just not across reload.
 */
export class ThumbnailCacheError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThumbnailCacheError";
  }
}

/** Specific `ThumbnailCacheError` for quota-exhaustion paths.
 *  Implementations that distinguish quota from other I/O errors
 *  should throw this so callers can apply quota-specific UI
 *  ("free up space") rather than the generic fallback. */
export class ThumbnailCacheQuotaError extends ThumbnailCacheError {
  constructor(message = "Thumbnail cache quota exceeded", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThumbnailCacheQuotaError";
  }
}
