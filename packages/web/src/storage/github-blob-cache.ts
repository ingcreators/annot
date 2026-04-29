/**
 * In-memory caches GitHubStore keeps so the editor's read / save
 * loop doesn't round-trip the network on every operation. Owns two
 * Maps keyed by basePath-relative path:
 *
 *   - `record` — last full `ImageRecord` we produced per path. Lets
 *               `updateImage` re-render without re-fetching the
 *               source bytes.
 *   - `meta`   — last-known commit info per file (`createdAt` /
 *               `updatedAt`), surfaced to the editor header.
 *
 * Lifted out of `github-store.ts` (proposal 4 follow-up after #142
 * and #143) so the cache invariants — purge-all-on-delete,
 * move-entries-on-rename, rewrite-entries-on-folder-rename — can be
 * unit-tested independently of the HTTP layer + I/O pipeline.
 *
 * History: thumbnail and dimension caches lived here through Phase
 * 3 of `docs/plans/_done/unified-thumbnail-cache.md` and were lifted into
 * the host-side `ThumbnailManager` + `IndexedDBThumbnailCache` in
 * Phase 4 — the cache surface is now record + meta only.
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

export class GitHubBlobCache {
  #record = new Map<string, ImageRecord>();
  #meta = new Map<string, GitHubFileMeta>();

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

  // ─── Compound operations ──────────────────────────────────────────

  /**
   * Drop every cache entry for `path` — record + meta. Used after a
   * delete or when an atomic-tree commit removed a path.
   */
  purge(path: string): void {
    this.#record.delete(path);
    this.#meta.delete(path);
  }

  /**
   * Move every cache entry for `oldPath` to `newPath` (record +
   * meta).
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
   * `record.path` / `record.folderPath` consistently. Meta entries
   * migrate as-is — they don't carry path-aware fields.
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
  }

  /** Drop every entry across both caches. Used by forceRefresh. */
  clear(): void {
    this.#record.clear();
    this.#meta.clear();
  }
}
