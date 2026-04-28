/**
 * In-memory caches GitHubStore keeps so the editor's read / save
 * loop doesn't round-trip the network on every operation. Owns four
 * Maps keyed by basePath-relative path:
 *
 *   - `record`            — last full `ImageRecord` we produced per
 *                           path. Lets `updateImage` re-render
 *                           without re-fetching the source bytes.
 *   - `meta`              — last-known commit info per file
 *                           (`createdAt` / `updatedAt`), surfaced
 *                           to the editor header.
 *   - `thumbnail`         — gallery thumbnail data URL. GitHub has
 *                           no thumbnail facility, so we generate
 *                           and remember our own.
 *   - `thumbnailInFlight` — dedup map for in-flight thumbnail
 *                           fetches launched by `listImages`.
 *
 * Lifted out of `github-store.ts` (proposal 4 follow-up after #142
 * and #143) so the cache invariants — purge-all-on-delete,
 * move-entries-on-rename, rewrite-entries-on-folder-rename — can be
 * unit-tested independently of the HTTP layer + I/O pipeline.
 *
 * Path semantics: every key is a basePath-relative path, matching
 * the rest of the store. `migrateEntry` and
 * `rewriteEntriesForPrefix` accept optional record transforms so
 * callers can keep `ImageRecord.path` / `folderPath` consistent
 * with the new key without the cache class needing to know about
 * those fields.
 */

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { rewritePathPrefix } from "@ingcreators/annot-core/storage";

/** Last-known commit info for a single file. Populated
 *  opportunistically on `getImage` and surfaced to the editor
 *  header. Both fields optional because the API doesn't always
 *  return them (e.g. for newly-created files between push and
 *  the next list). */
export interface GitHubFileMeta {
  createdAt?: string;
  updatedAt?: string;
}

/** Image natural dimensions. Populated by the thumbnail prefetch
 *  (`createImageBitmap` / XMP decode) so the gallery's `WxH • date`
 *  line can render before any `getImage` round-trip has taken
 *  place. Stored separately from the record cache because a stub
 *  record with empty `originalDataUrl` would shortcut `getImage`'s
 *  cache check and surface a blank-canvas editor. */
export interface ImageDimensions {
  width: number;
  height: number;
}

export class GitHubBlobCache {
  #record = new Map<string, ImageRecord>();
  #meta = new Map<string, GitHubFileMeta>();
  #thumbnail = new Map<string, string>();
  #thumbnailInFlight = new Map<string, Promise<void>>();
  #dimensions = new Map<string, ImageDimensions>();

  // ─── Record cache ─────────────────────────────────────────────────

  setRecord(path: string, record: ImageRecord): void {
    this.#record.set(path, record);
  }
  getRecord(path: string): ImageRecord | undefined {
    return this.#record.get(path);
  }
  deleteRecord(path: string): boolean {
    return this.#record.delete(path);
  }
  recordEntries(): IterableIterator<[string, ImageRecord]> {
    return this.#record.entries();
  }

  // ─── File meta cache ──────────────────────────────────────────────

  setMeta(path: string, meta: GitHubFileMeta): void {
    this.#meta.set(path, meta);
  }
  getMeta(path: string): GitHubFileMeta | undefined {
    return this.#meta.get(path);
  }
  deleteMeta(path: string): boolean {
    return this.#meta.delete(path);
  }

  // ─── Thumbnail cache ──────────────────────────────────────────────

  setThumbnail(path: string, dataUrl: string): void {
    this.#thumbnail.set(path, dataUrl);
  }
  getThumbnail(path: string): string | undefined {
    return this.#thumbnail.get(path);
  }
  hasThumbnail(path: string): boolean {
    return this.#thumbnail.has(path);
  }
  deleteThumbnail(path: string): boolean {
    return this.#thumbnail.delete(path);
  }

  // ─── Thumbnail in-flight tracking ─────────────────────────────────

  setThumbnailInFlight(path: string, p: Promise<void>): void {
    this.#thumbnailInFlight.set(path, p);
  }
  getThumbnailInFlight(path: string): Promise<void> | undefined {
    return this.#thumbnailInFlight.get(path);
  }
  deleteThumbnailInFlight(path: string): boolean {
    return this.#thumbnailInFlight.delete(path);
  }

  // ─── Dimensions cache ─────────────────────────────────────────────

  setDimensions(path: string, dims: ImageDimensions): void {
    this.#dimensions.set(path, dims);
  }
  getDimensions(path: string): ImageDimensions | undefined {
    return this.#dimensions.get(path);
  }
  deleteDimensions(path: string): boolean {
    return this.#dimensions.delete(path);
  }

  // ─── Compound operations ──────────────────────────────────────────

  /**
   * Drop every cache entry for `path` — record, meta, thumbnail,
   * and any in-flight thumbnail fetch. Used after a delete or when
   * an atomic-tree commit removed a path.
   */
  purge(path: string): void {
    this.#record.delete(path);
    this.#meta.delete(path);
    this.#thumbnail.delete(path);
    this.#thumbnailInFlight.delete(path);
    this.#dimensions.delete(path);
  }

  /**
   * Move every cache entry for `oldPath` to `newPath` (record +
   * meta + thumbnail). The thumbnail in-flight map is NOT migrated:
   * pending fetches were keyed to the old path and are deliberately
   * dropped — by the time they resolve their target no longer
   * exists, and the listImages caller will re-launch a fetch
   * against the new path on the next pass.
   *
   * `transformRecord` is an optional hook to update fields inside
   * the record value itself (commonly `path` and `folderPath`) so
   * the cached record stays consistent with its new key. The cache
   * class deliberately knows nothing about which fields to update
   * — that's business logic.
   */
  migrateEntry(
    oldPath: string,
    newPath: string,
    transformRecord?: (record: ImageRecord) => ImageRecord,
  ): void {
    const cached = this.#record.get(oldPath);
    if (cached) {
      this.#record.delete(oldPath);
      this.#record.set(newPath, transformRecord ? transformRecord(cached) : cached);
    }
    const meta = this.#meta.get(oldPath);
    if (meta) {
      this.#meta.delete(oldPath);
      this.#meta.set(newPath, meta);
    }
    const thumb = this.#thumbnail.get(oldPath);
    if (thumb) {
      this.#thumbnail.delete(oldPath);
      this.#thumbnail.set(newPath, thumb);
    }
    const dims = this.#dimensions.get(oldPath);
    if (dims) {
      this.#dimensions.delete(oldPath);
      this.#dimensions.set(newPath, dims);
    }
  }

  /**
   * For every entry whose key matches `oldPrefix` exactly OR starts
   * with `oldPrefix + "/"`, rename the key by swapping `oldPrefix`
   * for `newPrefix` (segment-aware via
   * `@ingcreators/annot-core/storage` `rewritePathPrefix`). Used
   * by folder rename / move so the in-memory caches stay
   * authoritative without a tree re-fetch.
   *
   * `transformRecord` receives the new path so callers can update
   * `record.path` / `record.folderPath` consistently. Meta and
   * thumbnail entries migrate as-is — they don't carry path-aware
   * fields.
   */
  rewriteEntriesForPrefix(
    oldPrefix: string,
    newPrefix: string,
    transformRecord?: (record: ImageRecord, newPath: string) => ImageRecord,
  ): void {
    for (const [p, rec] of Array.from(this.#record.entries())) {
      if (p === oldPrefix || p.startsWith(`${oldPrefix}/`)) {
        const np = rewritePathPrefix(p, oldPrefix, newPrefix);
        this.#record.delete(p);
        this.#record.set(np, transformRecord ? transformRecord(rec, np) : rec);
      }
    }
    for (const [p, m] of Array.from(this.#meta.entries())) {
      if (p === oldPrefix || p.startsWith(`${oldPrefix}/`)) {
        const np = rewritePathPrefix(p, oldPrefix, newPrefix);
        this.#meta.delete(p);
        this.#meta.set(np, m);
      }
    }
    for (const [p, t] of Array.from(this.#thumbnail.entries())) {
      if (p === oldPrefix || p.startsWith(`${oldPrefix}/`)) {
        const np = rewritePathPrefix(p, oldPrefix, newPrefix);
        this.#thumbnail.delete(p);
        this.#thumbnail.set(np, t);
      }
    }
    for (const [p, d] of Array.from(this.#dimensions.entries())) {
      if (p === oldPrefix || p.startsWith(`${oldPrefix}/`)) {
        const np = rewritePathPrefix(p, oldPrefix, newPrefix);
        this.#dimensions.delete(p);
        this.#dimensions.set(np, d);
      }
    }
  }

  /** Drop every entry across all five caches. Used by forceRefresh. */
  clear(): void {
    this.#record.clear();
    this.#meta.clear();
    this.#thumbnail.clear();
    this.#thumbnailInFlight.clear();
    this.#dimensions.clear();
  }
}
