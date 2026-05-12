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

Seven optional capability interfaces extend the core contract.
Implement the ones that fit your backend's semantics; the host
narrows via `supportsX(store)` predicates before calling.

| Interface | Predicate | What it adds |
|-----------|-----------|--------------|
| `StorageWithInit` | `supportsInit` | Async `init()` called once at first use |
| `StorageWithResync` | `supportsResync` | `resync()` called on every gallery refresh |
| `StorageWithForceRefresh` | `supportsForceRefresh` | User-initiated "Refresh" button hits `forceRefresh()` |
| `StorageWithTokenRefresher` | `supportsTokenRefresher` | OAuth token-refresh hook (`setTokenRefresher`) |
| `StorageWithRateLimit` | `supportsRateLimit` | Surface API rate-limit telemetry to the UI |
| `StorageWithThumbnailCache` | `supportsThumbnailCache` | Participate in the unified thumbnail cache |
| `StorageWithDocuments` | `supportsDocuments` | Persist `.annot.html` multi-image documents (this doc, second half) |

This guide covers the last two.

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

## `StorageWithDocuments` — four required methods

Multi-image manuals (`.annot.html` documents) are a separate
record kind from per-image annotations. Backends that opt into
`StorageWithDocuments` get four methods that mirror the
image-side CRUD pattern; delete / move / rename go through the
existing `deleteImage` / `moveImage` / `renameImage` because the
path-keyed model already covers any leaf file.

```ts
import type {
  DocumentRecord,
  DocumentRecordUpdate,
  StorageProvider,
  StorageWithDocuments,
} from "@ingcreators/annot-core/storage";

class MyImgurStore implements StorageProvider, StorageWithDocuments {
  // ── existing StorageProvider methods ──

  // ── document contract: 4 methods ──

  async saveDocument(
    record: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    // Save a new document. `record.bytes` is the canonical
    // `.annot.html` source — store it verbatim, no transformation.
    // Filename uniquification is the store's job: on collision,
    // append " (2)", " (3)", … and return the post-uniquification
    // path. NEVER throw `StorageConflictError` here — the
    // image-side `saveImage` is the path that throws on
    // intentional collisions; `saveDocument` always succeeds.
    const filename = opts?.filename ?? `document-${Date.now()}.annot.html`;
    const path = await this.#uniqueUpload(record.folderPath, filename, record.bytes);
    this.#docMeta.set(path, {
      title: record.title,
      blockCount: record.blockCount,
      imageCount: record.imageCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    return path;
  }

  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    const bytes = await this.#fetchText(path);
    if (bytes === undefined) return undefined;
    const meta = this.#docMeta.get(path);
    return {
      path,
      folderPath: parentOf(path),
      bytes,
      thumbnailDataUrl: "",
      title: meta?.title ?? stripExtension(path),
      blockCount: meta?.blockCount ?? 0,
      imageCount: meta?.imageCount ?? 0,
      createdAt: meta?.createdAt ?? "",
      updatedAt: meta?.updatedAt ?? "",
    };
  }

  async listDocuments(folderPath: string): Promise<DocumentRecord[]> {
    // Direct children of `folderPath` only — does NOT recurse.
    // Use `""` for the root folder. The result drives
    // `<annot-gallery-page>`'s "Documents" section, which
    // shows title / image count / updatedAt per row. Cached
    // metadata fields (`title`, `imageCount`, `blockCount`)
    // mean the gallery doesn't have to fetch + parse every
    // document's bytes to render the listing.
    const entries = await this.#listFolderChildren(folderPath, ".annot.html");
    return entries.map((e) => this.#summariseDocument(e));
  }

  async updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void> {
    // In-place update. `path` / `folderPath` are deliberately
    // NOT in the update set — to relocate the document, use the
    // path-keyed `moveImage` / `renameImage` (path-keyed
    // semantics apply uniformly to any leaf file).
    //
    // Idempotent on missing source: return silently when no
    // document exists at `path`. Callers that must distinguish
    // "updated" from "no-such-document" call `getDocument` first.
    if (!(await this.#exists(path))) return;
    if (updates.bytes !== undefined) {
      await this.#writeText(path, updates.bytes);
    }
    const cached = this.#docMeta.get(path) ?? {};
    if (updates.title !== undefined) cached.title = updates.title;
    if (updates.blockCount !== undefined) cached.blockCount = updates.blockCount;
    if (updates.imageCount !== undefined) cached.imageCount = updates.imageCount;
    if (updates.updatedAt !== undefined) cached.updatedAt = updates.updatedAt;
    this.#docMeta.set(path, cached);
  }
}
```

### Cached metadata fields

`DocumentRecord` carries four metadata fields the host's gallery
+ template picker rely on for fast listings:

- `title` — mirrors the JSON sidecar's `title` field. The
  format spec enforces `<title>` ↔ `meta.title` equality on
  save, so re-deriving on every list call is wasteful.
- `imageCount` — number of `ImageBlock` entries in
  `doc.blocks`.
- `blockCount` — total top-level block count.
- `thumbnailDataUrl` — implementation-defined. The reference
  `BrowserStore` renders the first ImageBlock's SVG to a small
  bitmap; backends that opt into `StorageWithThumbnailCache`
  may answer this via the unified cache instead. Empty string
  when no preview is available.

Cache them however your backend prefers. Cloud backends
(Google Drive, Imgur, S3) typically write to `appProperties` /
object metadata; on-disk stores (Device, Desktop) write XMP-
adjacent sidecars or accept the cost of re-parsing on each
list (BrowserStore does the latter). GitHub uses an in-memory
map keyed by basePath-relative path because the GitHub API has
no `appProperties` equivalent.

### Path-keyed delete / move / rename

Documents and images share the path-keyed surface. Your
backend's existing `deleteImage("folder/<file>.annot.html")`
deletes a document just as it deletes an image; same for
`moveImage` / `renameImage`. The discriminator is the file
extension AND the receiving backend's storage layout
(separate IDB store / separate object key prefix / etc). If
your layout demands different code paths internally, fan
out inside the existing methods — consumers see a uniform
path-keyed surface.

### What you DON'T need to implement

- ❌ Don't ship a separate `deleteDocument` / `moveDocument`
  / `renameDocument`. The host's gallery + editor route
  through `deleteImage` / `moveImage` / `renameImage` for
  any leaf file.
- ❌ Don't reject documents in `saveImage` / `getImage` /
  `listImages` — those are image-only by contract. Your
  backend's storage layout decides whether documents and
  images share or split the underlying bucket.
- ❌ Don't throw `StorageConflictError` from `saveDocument`.
  Filename uniquification is the store's responsibility;
  the returned path IS the post-uniquification path.

### What the host does for you

- Hides document-related UI (gallery section, "New Document"
  menu entry, "From Template…" entry, etc.) when the active
  storage's `supportsDocuments(store)` returns `false`.
- Routes the editor's save lifecycle (debounced
  `updateDocument` calls + status-bar status indicator)
  through your backend transparently.
- Surfaces template-picker entries by calling
  `listDocuments("Templates")` — `Templates/` is a folder
  convention, not a special bucket. Your backend doesn't
  need to know about templates at all.

### Reference implementations

- **`BrowserStore`** ([`packages/web/src/storage/browser-store.ts`](../../packages/web/src/storage/browser-store.ts)) —
  IDB-backed; documents in a separate store from images.
- **`DeviceStore`** ([`packages/web/src/storage/device-store.ts`](../../packages/web/src/storage/device-store.ts)) —
  FS Access API; documents and images share the directory
  but use different per-file XMP sidecars.
- **`DesktopStore`** ([`packages/desktop/src/storage/desktop-store.ts`](../../packages/desktop/src/storage/desktop-store.ts)) —
  Electron `fs`; same model as DeviceStore.
- **`GoogleDriveStore`** ([`packages/web/src/storage/google-drive-store.ts`](../../packages/web/src/storage/google-drive-store.ts)) —
  REST API; documents are `text/html` files. Cached metadata
  via `appProperties`.
- **`GitHubStore`** ([`packages/web/src/storage/github-store.ts`](../../packages/web/src/storage/github-store.ts)) —
  Commit-as-save; documents are committed verbatim as
  `text/html` blobs. Cached metadata via an in-memory map.

Each shows a different trade-off between bucket layout, cache
strategy, and uniformity with the image-side CRUD.

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
- [`docs/plans/_done/annot-html-document.md`](../plans/_done/annot-html-document.md) —
  master plan for the multi-image document format. Phases 6a / 7a–7d
  ship `StorageWithDocuments` across the five built-in backends;
  later phases (template picker, multi-slide PPTX export, VSCode
  custom editor) build on the capability.
- [`docs/annot-html-format.md`](../annot-html-format.md) —
  canonical `.annot.html` format spec. Useful when your backend
  needs to peek inside a document (template-marker detection,
  metadata extraction) without going through the full Tier B
  parser.
- [`docs/plugin-api/documents.md`](./documents.md) —
  forward-looking plugin surface for custom block types
  (v2 — v1 documents are restricted to the built-in block
  taxonomy).
