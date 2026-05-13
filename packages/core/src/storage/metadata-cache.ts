/**
 * Persistent metadata cache contract — Tier A, DOM-free.
 *
 * Owns the per-store record + per-folder listing layer that today
 * each `StorageProvider` implementation reinvents (DeviceStore's
 * `.annot.json` sidecar + `#index`, GitHubStore's `GitHubTreeState`
 * + `GitHubBlobCache`, GoogleDriveStore's `#fileMeta` / `#recordCache`
 * / id maps).
 *
 * Implementations decide where the bytes live: the first-party
 * `IndexedDBMetadataCache` in `@ingcreators/annot-host-ui/idb-metadata-cache`
 * is the canonical browser-side option; tests / Node hosts can swap
 * in an in-memory mock with the same surface.
 *
 * The shared-metadata-cache plan
 * ([`docs/plans/shared-metadata-cache.md`](../../../../docs/plans/shared-metadata-cache.md))
 * lifts the per-store metadata lifecycle into a shared cache; this
 * file is the Tier A contract piece.
 *
 * Keys carry a host-reserved namespace prefix matching the
 * `StorageMode` strings used elsewhere in the app (`browser:` /
 * `device:` / `desktop:` / `github:` / `googledrive:`); plugin-
 * registered providers must use the `plugin:<pluginId>:` prefix the
 * host enforces at registration time. See the plan doc for the full
 * convention.
 *
 * **Caching policy**: only lightweight fields. Heavy payloads —
 * `ImageRecord.originalDataUrl`, `ImageRecord.annotationsSvg`,
 * `DocumentRecord.bytes` — are NOT cached here; the backend re-fetches
 * them on demand. The cache holds title / dimensions / tags /
 * timestamps / sidecar metadata plus the namespace-qualified version
 * string.
 */

import type { DocumentRecord, ImageRecord, StorageProvider } from "./types.js";

/**
 * What kind of leaf entity a `ListingEntry` represents. `folder`
 * means "this child path is a subfolder of the listing's
 * `folderPath`"; consumers walk it for the folder tree, not for
 * `getImage` / `getDocument` lookups.
 */
export type ListingEntryKind = "image" | "document" | "folder";

/**
 * One entry in a folder's listing. `path` is the full path (not the
 * leaf name); `version` is the opaque per-backend version string the
 * cache uses to detect external mutation (`mtime` for Device/Desktop,
 * blob SHA for GitHub, `modifiedTime` for Drive).
 */
export interface ListingEntry {
  path: string;
  version: string;
  kind: ListingEntryKind;
}

/**
 * Path → cached record + listing + per-namespace metadata store with
 * version-gated hits. Lifecycle is shared across every opt-in
 * `StorageProvider`; the providers themselves talk to this directly
 * (unlike thumbnails, where a manager sits between the provider and
 * the cache — metadata is intrinsic to `listImages` rather than a
 * side-channel).
 *
 * Methods are organized by concern:
 *
 *   - **Records**: per-path `ImageRecord` / `DocumentRecord` caches,
 *     version-gated so a stale entry is invisible to readers.
 *   - **Listing**: per-folder `ListingEntry[]` cache, used by
 *     `listImages` / `listDocuments` / `listFolders` so the store
 *     can return "what we know" before deciding whether to revalidate
 *     against the backend.
 *   - **Namespace meta**: per-namespace single-value KV store. Used
 *     for GitHub `branchHead` SHA tracking and Drive
 *     `changesPageToken` integration.
 *   - **Backend ID**: per-namespace bidirectional path ↔
 *     backend-internal-id map. Used by ID-based backends (Drive)
 *     where the change-tracking API speaks fileIds, not paths.
 *   - **Bulk operations**: cross-namespace migrations (rename,
 *     move-folder prefix rewrite) consolidated in one place rather
 *     than reimplemented per backend.
 *   - **Invalidation**: precise (`invalidatePath`) and broad
 *     (`invalidatePrefix`) eviction, used on `resync()` /
 *     `forceRefresh()` paths.
 */
export interface MetadataCache {
  // ── Per-path record cache ────────────────────────

  /**
   * Returns the cached image record IFF its stored version matches
   * `version`. Version mismatch returns `undefined` without
   * disturbing the stored row — in a multi-tab world a peer may
   * have written a NEWER version we don't yet know about, and
   * silently evicting it here would discard valid data. Stale
   * entries age out via LRU or are overwritten by the next `put`.
   * `lastAccessedAt` is updated on hit so LRU eviction respects
   * recent reads.
   */
  getImage(ns: string, path: string, version: string): Promise<ImageRecord | undefined>;

  /**
   * Write-or-overwrite at `(ns, path)`. The `version` field becomes
   * the new gate for future `getImage` calls. Implementations
   * should handle quota exhaustion internally (one self-eviction
   * sweep + retry, `clearAll` as last resort) and only throw
   * `MetadataCacheQuotaError` when even that fails.
   */
  putImage(ns: string, path: string, version: string, rec: ImageRecord): Promise<void>;

  /** Document equivalent of {@link getImage}. */
  getDocument(ns: string, path: string, version: string): Promise<DocumentRecord | undefined>;

  /** Document equivalent of {@link putImage}. */
  putDocument(ns: string, path: string, version: string, rec: DocumentRecord): Promise<void>;

  // ── Per-folder listing cache ─────────────────────

  /**
   * Returns the cached listing for `folderPath` under `ns`, or
   * `undefined` if no listing has been recorded. Listings are
   * **not** version-gated at this layer — callers compare individual
   * entry versions to decide whether to revalidate per-entry.
   */
  getListing(ns: string, folderPath: string): Promise<ListingEntry[] | undefined>;

  /**
   * Replace the cached listing at `(ns, folderPath)` with `entries`.
   * Used on cold-fetch or invalidate-all paths. Incremental updates
   * (single add / version bump / remove) should prefer the
   * targeted helpers below.
   */
  putListing(ns: string, folderPath: string, entries: ListingEntry[]): Promise<void>;

  /**
   * Add `entry` to the listing for `(ns, folderPath)`, or replace
   * the existing entry with the same `path`. No-op if no listing
   * has been recorded for the folder.
   */
  upsertListingEntry(ns: string, folderPath: string, entry: ListingEntry): Promise<void>;

  /**
   * Remove the entry matching `path` from the listing for
   * `(ns, folderPath)`. No-op if no listing or no matching entry.
   */
  removeListingEntry(ns: string, folderPath: string, path: string): Promise<void>;

  // ── Per-namespace meta (single value KV) ─────────

  /**
   * Read a single per-namespace value. Returns `undefined` when not
   * set. Used today for:
   *
   *   - GitHubStore's `branchHead` (current commit SHA of the
   *     tracked branch). On `init()` the store compares the live
   *     HEAD against this value; on match it skips the recursive
   *     tree fetch entirely.
   *   - GoogleDriveStore's `changesPageToken` (Drive Changes API
   *     resume token). On `init()` / `resync()` the store reads
   *     this token, applies changes since, advances the token.
   *
   * Treated as opaque strings by the cache.
   */
  getNamespaceMeta(ns: string, key: string): Promise<string | undefined>;

  /** Write-or-overwrite a per-namespace value. */
  putNamespaceMeta(ns: string, key: string, value: string): Promise<void>;

  /** Remove a per-namespace value. */
  deleteNamespaceMeta(ns: string, key: string): Promise<void>;

  // ── Backend ID map (for ID-based backends) ───────

  /**
   * Record the path ↔ backend-internal-id mapping. Used by ID-based
   * backends (Drive's fileId, future S3 / API-keyed stores) where
   * the change-tracking API speaks IDs, not paths. The cache
   * maintains both directions so `getBackendIdByPath` and
   * `getPathByBackendId` are constant-time.
   */
  setBackendId(ns: string, path: string, backendId: string): Promise<void>;

  /** Forward lookup: path → backend ID. */
  getBackendIdByPath(ns: string, path: string): Promise<string | undefined>;

  /** Reverse lookup: backend ID → path. */
  getPathByBackendId(ns: string, backendId: string): Promise<string | undefined>;

  // ── Bulk operations ──────────────────────────────

  /**
   * Move every cached artefact (record + listing entry + backend
   * ID) from `oldPath` to `newPath` within the namespace.
   * Generalizes the per-store rename/move handling that
   * `GitHubBlobCache.migrateEntry` did for GitHubStore alone.
   * Listing entries are updated in BOTH the source and destination
   * folder's listings (remove from old, upsert into new).
   */
  migrateEntry(ns: string, oldPath: string, newPath: string): Promise<void>;

  /**
   * Bulk-rewrite every cached artefact whose path starts with
   * `oldPrefix` to start with `newPrefix` instead. Generalizes
   * `GitHubBlobCache.rewriteEntriesForPrefix`. Used by folder
   * rename / folder move operations.
   */
  rewriteEntriesForPrefix(ns: string, oldPrefix: string, newPrefix: string): Promise<void>;

  // ── Invalidation ─────────────────────────────────

  /** Targeted eviction: drop the record at `(ns, path)`. */
  invalidatePath(ns: string, path: string): Promise<void>;

  /**
   * Drop every cached artefact whose key starts with `prefix`.
   * Used by:
   *   - `StorageProvider.forceRefresh()` to invalidate a whole
   *     instance's namespace.
   *   - GitHubStore's branch-HEAD-mismatch handling (v1: drop the
   *     whole namespace, re-fetch from scratch).
   *   - Plugin uninstall — the host fires
   *     `invalidatePrefix("plugin:<pluginId>:")`.
   */
  invalidatePrefix(prefix: string): Promise<void>;
}

/**
 * Base error type implementations may throw out of mutating methods
 * when their underlying transport fails irrecoverably. Stores that
 * catch this should fall back to in-memory-only operation —
 * functionality stays correct for the current session, just not
 * across reload.
 */
export class MetadataCacheError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MetadataCacheError";
  }
}

/**
 * Specific `MetadataCacheError` for quota-exhaustion paths.
 * Implementations that distinguish quota from other I/O errors
 * should throw this so the host can render quota-specific UI
 * ("free up space") rather than the generic fallback.
 */
export class MetadataCacheQuotaError extends MetadataCacheError {
  constructor(message = "Metadata cache quota exceeded", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MetadataCacheQuotaError";
  }
}

/**
 * Capability interface — opt into the shared metadata cache by
 * implementing both methods. Stores that don't implement this
 * continue managing their own metadata internally
 * (BrowserStore / IDBStore — already IDB-native and don't benefit
 * from a second cache layer).
 *
 * The host wires the cache in at construction time via
 * `attachMetadataCache(cache)`; the store reads its own namespace
 * via `metadataNamespace()` so consumers (test helpers, `forceRefresh`
 * implementations) can derive prefix-invalidation keys.
 */
export interface StorageWithMetadataCache {
  /**
   * Return the per-instance namespace prefix used to scope this
   * store's cache entries. Examples:
   *
   *   - DeviceStore:        `"device:my-screenshots"` (root folder name)
   *   - DesktopStore:       `"desktop:default-library"`
   *   - GitHubStore:        `"github:owner/repo:main"` (owner / repo / branch)
   *   - GoogleDriveStore:   `"googledrive:<rootFolderId>"`
   *   - Plugin-registered:  `"plugin:<pluginId>:..."` — the rest of
   *     the suffix is the plugin's choice; the `plugin:<pluginId>:`
   *     prefix is enforced by the host at registration time.
   *
   * Stable across resync. Implementations MUST NOT bake mutable
   * state into the namespace (e.g. don't append a "session ID" or
   * "build hash") — invalidation relies on prefix stability across
   * sessions.
   */
  metadataNamespace(): string;

  /**
   * Receive the `MetadataCache` instance from the host at
   * construction time. After this call, the store may issue cache
   * operations from any of its public methods.
   *
   * Called exactly once per store instance, before any
   * `StorageProvider` method. Stores that need to perform initial
   * cache reads (e.g. seeding their in-memory shortcuts from
   * `getNamespaceMeta`) should do so in `init()`, not here.
   */
  attachMetadataCache(cache: MetadataCache): void;
}

/**
 * Capability predicate — narrow a `StorageProvider` to
 * `StorageProvider & StorageWithMetadataCache` before invoking
 * the optional methods. Mirrors the `supports*` helpers next to
 * the other `StorageWith*` interfaces in `./types.ts`.
 */
export function supportsMetadataCache(
  store: StorageProvider,
): store is StorageProvider & StorageWithMetadataCache {
  const s = store as Partial<StorageWithMetadataCache>;
  return typeof s.metadataNamespace === "function" && typeof s.attachMetadataCache === "function";
}
