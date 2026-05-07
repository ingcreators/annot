/**
 * Host-side prefetch + cache lifecycle for the unified thumbnail
 * system. Every `StorageProvider` that implements
 * `StorageWithThumbnailCache` (key + version + source fetcher)
 * delegates its prefetch / persistence / dedup / event-dispatch
 * concerns to a single shared `ThumbnailManager` instance; the
 * provider just answers data questions.
 *
 * Pipeline on cache miss:
 *   provider.fetchThumbnailSource(path)
 *      → renderThumbnailWithDims(blob)
 *      → cache.set(key, version, value)
 *      → window.dispatchEvent("annot-thumbnail-ready", …)
 *
 * The `attach(provider, records)` entry point is the gallery's
 * single integration site — call it after `provider.listImages`
 * and the records get their `thumbnailDataUrl` / `width` /
 * `height` fields patched in place from the cache (hits) or
 * scheduled for prefetch (misses).
 *
 * Per [`docs/plans/_done/unified-thumbnail-cache.md`](../../../../docs/plans/_done/unified-thumbnail-cache.md).
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import {
  type CachedThumbnail,
  supportsThumbnailCache,
  type ThumbnailCache,
} from "@ingcreators/annot-core/storage";
import { renderThumbnailWithDims } from "./image-thumbnail.js";

/** Detail shape on the `annot-thumbnail-ready` `CustomEvent`. */
export interface ThumbnailReadyDetail {
  path: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** In-memory LRU cap (entries). The persistent cache is the
 *  permanent source of truth; the in-memory layer is a hot-path
 *  shortcut for the visible viewport. */
const MEMORY_LRU_LIMIT = 100;

export interface ThumbnailManagerOptions {
  /** Override the in-memory LRU cap (testing only). */
  memoryLimit?: number;
}

export class ThumbnailManager {
  #cache: ThumbnailCache;
  #memoryLRU = new Map<string, CachedThumbnail>();
  #memoryLimit: number;
  #inFlight = new Map<string, Promise<void>>();

  constructor(cache: ThumbnailCache, opts: ThumbnailManagerOptions = {}) {
    this.#cache = cache;
    this.#memoryLimit = opts.memoryLimit ?? MEMORY_LRU_LIMIT;
  }

  /**
   * Patch every record in `records` with its cached thumbnail (when
   * available) and schedule background prefetches for cache misses.
   * Mutates `records` in place — the records' `thumbnailDataUrl`,
   * `width`, and `height` fields are filled when we have a hit.
   *
   * No-op for providers that don't implement
   * `StorageWithThumbnailCache` (the manager simply doesn't engage,
   * provider keeps owning `record.thumbnailDataUrl`).
   */
  async attach(provider: StorageProvider, records: ImageRecord[]): Promise<void> {
    if (!supportsThumbnailCache(provider)) return;

    type Plan = { record: ImageRecord; key: string; version: string };
    const plans: Plan[] = [];
    for (const record of records) {
      const key = provider.thumbnailKey(record.path);
      if (!key) continue;
      const version = provider.thumbnailVersion(record.path);
      plans.push({ record, key, version });
    }
    if (plans.length === 0) return;

    // Bulk read from persistence — single IDB transaction. The
    // in-memory LRU front-cache catches the visible viewport's
    // hottest entries without a tx round-trip.
    const memoryHits = new Map<string, CachedThumbnail>();
    const dbRequests: { key: string; expectedVersion: string }[] = [];
    for (const plan of plans) {
      const memHit = this.#memoryLRU.get(plan.key);
      if (memHit) {
        memoryHits.set(plan.key, memHit);
      } else {
        dbRequests.push({ key: plan.key, expectedVersion: plan.version });
      }
    }
    const dbHits = dbRequests.length ? await this.#cache.getMany(dbRequests) : new Map();

    for (const { record, key, version } of plans) {
      const hit = memoryHits.get(key) ?? dbHits.get(key);
      if (hit) {
        record.thumbnailDataUrl = hit.dataUrl;
        if (!record.width) record.width = hit.width;
        if (!record.height) record.height = hit.height;
        // Promote DB hits into the memory LRU so subsequent
        // attach() calls in the same session skip the tx.
        if (!memoryHits.has(key)) this.#memoryLRUSet(key, hit);
      } else {
        void this.#ensure(provider, record.path, key, version);
      }
    }
  }

  /**
   * Manual seeding — called by `save-pipeline.writeThumbnail()`
   * when the editor renders a fresh canvas, and by `saveImage`
   * call sites so newly-saved files don't have to wait on a
   * prefetch round-trip.
   *
   * Dispatches `annot-thumbnail-ready` so any rendered gallery
   * card patches its `<img src>` in place.
   */
  async write(
    provider: StorageProvider,
    path: string,
    dataUrl: string,
    dims: { width: number; height: number },
  ): Promise<void> {
    if (!supportsThumbnailCache(provider)) return;
    if (!dataUrl) return;
    const key = provider.thumbnailKey(path);
    if (!key) return;
    const version = provider.thumbnailVersion(path);
    const value: CachedThumbnail = { dataUrl, width: dims.width, height: dims.height };
    this.#memoryLRUSet(key, value);
    try {
      await this.#cache.set(key, version, value);
    } catch {
      // Persistent layer failed (quota, IDB error). The in-memory
      // entry still carries this session — the gallery is fine.
    }
    this.#dispatchReady(path, value);
  }

  /**
   * Drop every cache entry under a key prefix. Used by:
   *   - `StorageProvider.resync()` integration to invalidate a
   *     whole instance's namespace without enumerating individual
   *     keys.
   *   - Plugin uninstall (`plugin:<pluginId>:`).
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    // Scrub the in-memory side first so a concurrent `attach()`
    // doesn't promote a stale entry while the IDB delete runs.
    for (const k of Array.from(this.#memoryLRU.keys())) {
      if (k.startsWith(prefix)) this.#memoryLRU.delete(k);
    }
    await this.#cache.deletePrefix(prefix);
  }

  // ── Internals ───────────────────────────────────────────────

  async #ensure(
    provider: StorageProvider & {
      fetchThumbnailSource: (path: string) => Promise<Blob | undefined>;
    },
    path: string,
    key: string,
    version: string,
  ): Promise<void> {
    const existing = this.#inFlight.get(key);
    if (existing) return existing;
    // `let` + post-assign matches the pattern in
    // `github-store.ts#ensureThumbnail` — TS otherwise flags the
    // self-reference inside the IIFE's `finally` as use-before-
    // assignment, but the body only runs after the assignment
    // settles synchronously.
    let promise: Promise<void> | undefined;
    promise = (async () => {
      try {
        const blob = await provider.fetchThumbnailSource(path);
        if (!blob) return;
        const { dataUrl, width, height } = await renderThumbnailWithDims(blob);
        if (!dataUrl) return;
        // Don't clobber a fresher write that raced in (e.g. a
        // `write()` from the editor's save pipeline while our
        // prefetch was running).
        if (this.#memoryLRU.has(key)) return;
        const value: CachedThumbnail = { dataUrl, width, height };
        this.#memoryLRUSet(key, value);
        try {
          await this.#cache.set(key, version, value);
        } catch {
          // Persistence failed — keep the in-memory entry so the
          // current session still benefits.
        }
        this.#dispatchReady(path, value);
      } catch {
        // Provider fetch failed (network, auth, deleted file).
        // Gallery keeps placeholder; next refresh retries.
      } finally {
        if (this.#inFlight.get(key) === promise) {
          this.#inFlight.delete(key);
        }
      }
    })();
    this.#inFlight.set(key, promise);
    return promise;
  }

  #memoryLRUSet(key: string, value: CachedThumbnail): void {
    // Re-insertion bumps insertion order in JS Map → effective LRU.
    if (this.#memoryLRU.has(key)) this.#memoryLRU.delete(key);
    this.#memoryLRU.set(key, value);
    while (this.#memoryLRU.size > this.#memoryLimit) {
      const oldest = this.#memoryLRU.keys().next().value;
      if (oldest === undefined) break;
      this.#memoryLRU.delete(oldest);
    }
  }

  #dispatchReady(path: string, value: CachedThumbnail): void {
    if (typeof window === "undefined") return;
    const detail: ThumbnailReadyDetail = {
      path,
      dataUrl: value.dataUrl,
      width: value.width,
      height: value.height,
    };
    window.dispatchEvent(new CustomEvent("annot-thumbnail-ready", { detail }));
  }
}
