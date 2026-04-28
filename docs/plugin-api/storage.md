# Plugin API: Storage

> **Audience:** plugin authors who want to ship a custom storage
> backend (S3, OneDrive, Notion, Linear, …) that participates fully
> in Annot's gallery + editor. If you're using one of the built-in
> backends (Browser / Device / GitHub / Google Drive) you don't
> need this doc.

A storage backend is any object that implements
[`StorageProvider`](../../packages/core/src/storage/types.ts) from
`@ingcreators/annot-core/storage`. The plugin host's
`registerStorage({ mode, label, icon, connect })` registers a
sidebar chip whose `connect` callback returns a `StorageProvider`
when the user picks it.

## Mandatory surface

`StorageProvider` is the contract every backend must implement —
images CRUD, folders CRUD, breadcrumbs. See
[`packages/core/src/storage/types.ts`](../../packages/core/src/storage/types.ts)
for the full method-by-method JSDoc; the error contract is
documented inline (which methods throw, which return `undefined`,
which auto-uniquify).

## Optional capabilities

Six optional capability interfaces extend the core contract.
Implement the ones that fit your backend's semantics; the host
narrows via `supportsX(store)` predicates before calling.

| Interface | Predicate | What it adds |
|-----------|-----------|--------------|
| `StorageWithInit` | `supportsInit` | Async `init()` called once at first use |
| `StorageWithResync` | `supportsResync` | `resync()` called on every gallery refresh |
| `StorageWithForceRefresh` | `supportsForceRefresh` | User-initiated "Refresh" button hits `forceRefresh()` |
| `StorageWithTokenRefresher` | `supportsTokenRefresher` | OAuth token-refresh hook (`setTokenRefresher`) |
| `StorageWithRateLimit` | `supportsRateLimit` | Surface API rate-limit telemetry to the UI |
| `StorageWithThumbnailCache` | `supportsThumbnailCache` | Participate in the unified thumbnail cache (this doc) |

This guide covers the last one.

## `StorageWithThumbnailCache` — three optional methods

```ts
import type { StorageProvider, StorageWithThumbnailCache }
  from "@ingcreators/annot-core/storage";

class MyImgurStore implements StorageProvider, StorageWithThumbnailCache {
  // ── existing StorageProvider methods (saveImage, getImage, ...) ──

  // ── thumbnail contract: 3 methods ──

  thumbnailKey(path: string): string | undefined {
    // Stable per-image identifier. Whatever uniquely picks out
    // *this* image inside *your* backend — usually an immutable id
    // your service hands you back at upload time. Annot's host
    // prepends `plugin:<your-mode>:` automatically before the key
    // hits the cache, so you don't need to namespace yourself.
    return this.#imageIds.get(path);
  }

  thumbnailVersion(path: string): string {
    // Opaque "version". Must change whenever the file's bytes
    // change — etag, sha, modifiedTime, anything. Cache hits
    // require a matching version; mismatches re-prefetch.
    // Stores with no external mutation may return `""` constant.
    return this.#meta.get(path)?.etag ?? "";
  }

  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    // Cache-miss source bytes. Return whatever blob can be decoded
    // by `createImageBitmap` — your backend's raw bytes for the
    // image, or a URL fetch result. The host runs the result
    // through its 480 px JPEG resizer; you don't generate the
    // thumbnail yourself.
    const id = this.#imageIds.get(path);
    if (!id) return undefined;
    const resp = await fetch(`https://api.imgur.com/${id}/blob`);
    return await resp.blob();
  }
}
```

Once the three methods are present, the host:

- Hydrates `<annot-gallery-page>` cards from the cache on every
  `listImages` (so cold starts show the previous session's
  thumbnails immediately).
- Schedules background prefetches for cache misses, dispatching
  `annot-thumbnail-ready` when each completes so the in-DOM card
  swaps its `<img src>` in place.
- Persists across sessions via IndexedDB (the host's
  `IndexedDBThumbnailCache` — a single `annot-thumbs` database
  shared by every backend, with LRU eviction at 50 MB / 5000
  entries).
- Evicts on version mismatch (your `thumbnailVersion` returns a
  different value).
- Cleans up your namespace (`plugin:<mode>:*`) on plugin uninstall.

You don't write any prefetch loop, dedup map, in-flight tracker,
event dispatcher, or quota handler. The host owns the lifecycle.

## What you DON'T need to do

- ❌ Don't generate thumbnails yourself — the host runs
  `generateThumbnailFromBlob` on whatever you return from
  `fetchThumbnailSource`.
- ❌ Don't store the thumbnail in your own backend — the host's
  IndexedDB cache is browser-local and shared across every backend.
- ❌ Don't dispatch `annot-thumbnail-ready` — the manager does it
  on every successful prefetch and `tm.write` call.
- ❌ Don't worry about the namespace prefix — the host wraps your
  `thumbnailKey` to prepend `plugin:<mode>:` automatically (and
  enforces the prefix so two plugins can't collide on each other's
  keys).
- ❌ Don't implement `updateImage(path, { thumbnailDataUrl })` —
  that field is removed from `ImageRecordUpdate` since Phase 5 of
  the unified-thumbnail-cache plan.

## What you SHOULD do for great UX

After your `saveImage` returns, the host's capture flow seeds the
cache via `tm.write` so the gallery card shows the saved
thumbnail immediately (no prefetch round-trip). You don't call
`tm.write` yourself — the host's `CaptureHost` and `SavePipeline`
do. You just need to make sure your `thumbnailKey` returns a stable
value as soon as `saveImage` resolves.

If your backend has a fast "thumbnail URL" endpoint (similar to
Drive's `thumbnailLink`) that returns server-side thumbnails:
**don't use it for the cache**. The whole point of the unified
cache is consistency across backends — every thumbnail goes
through `drawToThumbCanvas`'s 16:9 / never-upscale rules.

## Sample skeleton

```ts
// my-imgur-plugin/storage.ts
import type {
  ImageRecord,
  StorageProvider,
  StorageWithThumbnailCache,
} from "@ingcreators/annot-core/storage";

export class ImgurStore implements StorageProvider, StorageWithThumbnailCache {
  #imageIds = new Map<string, string>(); // path -> Imgur image id
  #meta = new Map<string, { etag: string }>();

  // ── StorageProvider core ──
  async saveImage(record, opts) { /* upload, populate #imageIds, return path */ }
  async getImage(path) { /* lookup, return ImageRecord */ }
  async listImages(folder) { /* return ImageRecord[] */ }
  async listFolders(parent) { /* … */ }
  async createFolder(parent, name) { /* … */ }
  async deleteFolder(path) { /* … */ }
  async renameFolder(path, name) { /* … */ }
  async moveFolder(path, parent) { /* … */ }
  async deleteImage(path) { /* … */ }
  async renameImage(path, name) { /* … */ }
  async moveImage(path, folder) { /* … */ }
  async updateImage(path, updates) { /* annotationsSvg / tags only */ }
  async getBreadcrumb(path) { /* … */ }

  // ── StorageWithThumbnailCache ──
  thumbnailKey(path: string): string | undefined {
    return this.#imageIds.get(path);
  }
  thumbnailVersion(path: string): string {
    return this.#meta.get(path)?.etag ?? "";
  }
  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    const id = this.#imageIds.get(path);
    if (!id) return undefined;
    const resp = await fetch(`https://i.imgur.com/${id}.jpg`);
    return await resp.blob();
  }
}
```

That's the whole plugin-side surface. The host takes care of the
rest.

## Reference

- [`packages/core/src/storage/types.ts`](../../packages/core/src/storage/types.ts) —
  `StorageProvider`, every `StorageWith*` capability interface,
  `supportsX` predicates, error contract.
- [`packages/core/src/storage/thumbnail-cache.ts`](../../packages/core/src/storage/thumbnail-cache.ts) —
  `ThumbnailCache` interface, `CachedThumbnail`,
  `ThumbnailCacheError` / `ThumbnailCacheQuotaError`. Useful if
  you want to provide your own cache implementation; otherwise
  ignore (the host instantiates an `IndexedDBThumbnailCache` for
  you).
- [`packages/web/src/storage/thumbnail-manager.ts`](../../packages/web/src/storage/thumbnail-manager.ts) —
  host-side prefetcher. Read this if you're curious how the
  lifecycle works under the hood.
- [`docs/plans/_done/unified-thumbnail-cache.md`](../plans/_done/unified-thumbnail-cache.md) —
  design doc covering the rationale, alternatives considered, and
  per-backend integration notes.
