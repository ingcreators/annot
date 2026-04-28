# Unified thumbnail cache

> **Status:** In progress (Phase 5)
> **Compatibility:** Affects every `StorageProvider` implementation
>   (`Browser` / `Device` / `GitHub` / `Drive`) and the gallery /
>   file-manager / save-pipeline glue. Plugin-author-facing surface
>   in `@ingcreators/annot-core/storage` gains three optional
>   methods.
> **Risk:** Single landing not viable — 5-phase split. Pre-release,
>   so no data migration: existing per-store thumbnail caches
>   (Browser's `IDB image record.thumbnailDataUrl`, Device's
>   `index.json[path].thumbnailDataUrl`, GitHub's in-memory
>   `GitHubBlobCache#thumbnail`, Drive's in-memory
>   `#thumbnailByDriveId`) are all greenfield-replaced. No backward
>   compatibility shims.

## Context

The 4 first-party `StorageProvider` implementations each ship their
own thumbnail strategy:

| Store | Where thumbs live | Persistence | Server thumb? |
|-------|------------------|------------|---------------|
| `BrowserStore` | inside the IndexedDB image record (`thumbnailDataUrl` field) | session-stable | no |
| `DeviceStore` | local file `index.json` next to the user's screenshots, on the picked folder via FileSystem-Access | session-stable, but bound to that specific folder | no |
| `GitHubStore` | in-memory `GitHubBlobCache#thumbnail` map | per-session only — every cold start re-prefetches | no (since [#311](https://github.com/ingcreators/annot/pull/311)/[#314](https://github.com/ingcreators/annot/pull/314)) |
| `GoogleDriveStore` | in-memory `#thumbnailByDriveId` map | per-session only | no (since [#315](https://github.com/ingcreators/annot/pull/315)) |

The `drawToThumbCanvas` helper (16:9, "never upscale", top-slice for
portrait sources) and the `generateThumbnailFromBlob` /
`generateThumbnailFromDataUrl` wrappers in
`packages/web/src/storage/image-thumbnail.ts` are already shared, so
the **rendering** is uniform — it's the **lifecycle** that's
duplicated:

- Each store reimplements its own `#ensureThumbnail` background
  prefetcher (GitHub + Drive — Browser/Device sidestep this by
  generating eagerly on save).
- Each store reimplements the in-flight dedup map.
- Each store dispatches `annot-thumbnail-ready` events from its own
  call site.
- `save-pipeline.writeThumbnail()` calls `updateImage(path, {
  thumbnailDataUrl })` to push fresh editor renders into whichever
  cache the store happens to own — every store has to special-case
  this update shape.
- GitHub/Drive lose all cached thumbnails on every cold start, so
  the user briefly sees blank cards until prefetch catches up. PR
  #313's `#thumbnailByDriveId` survives `resync()` but not a fresh
  `GoogleDriveStore` instance (storage switch / new tab).
- Plugins that want to add a new storage backend must reimplement
  the entire prefetch lifecycle, or punt on persistence.

PR #315 deliberately mirrored GitHub's `#ensureThumbnail` shape on
Drive so the two stores would be ready for extraction; this plan
follows through.

User directive (2026-04-29): pre-release, no migration concerns,
propose the ideal form.

## Design

### Goals

1. **Plugin-friendly.** Adding a new storage backend means
   implementing 3 short optional methods, not the prefetch
   lifecycle.
2. **Persistence across sessions for every backend.** Cold start
   shows the previous session's thumbnails immediately.
3. **One eviction / quota policy** instead of per-store ad-hoc
   limits.
4. **Testable in isolation.** Provider tests mock the cache;
   manager tests mock the provider.

### Architecture

```
                ┌─────────────────────────────────┐
                │   FileManager / Gallery (host)  │
                └────────┬────────────────────────┘
                         │ records
                         ▼
                ┌─────────────────────────────────┐
                │  ThumbnailManager (host-owned)  │
                │  ─ in-memory LRU (前段, ~100件)  │
                │  ─ IndexedDB persistent cache   │
                │  ─ in-flight prefetch dedup     │
                │  ─ annot-thumbnail-ready 発火   │
                └────────┬────────────────────────┘
                         │ thumbnailKey / thumbnailVersion
                         │ fetchThumbnailSource
                         ▼
                ┌─────────────────────────────────┐
                │  StorageProvider                │
                │  (built-in or plugin-registered)│
                └─────────────────────────────────┘
```

The host owns the lifecycle. Providers expose three small hooks.

### `StorageProvider` extension

Three new optional methods on `StorageProvider`:

```ts
interface StorageProvider {
  // ── existing methods (unchanged) ──
  saveImage(...): Promise<string>;
  getImage(...): Promise<ImageRecord | undefined>;
  listImages(...): Promise<ImageRecord[]>;
  updateImage(...): Promise<void>;
  // ...

  // ── thumbnail contract (new, all optional) ──

  /**
   * Stable per-image identifier independent of path renames /
   * collision-suffixing. Returning `undefined` opts the path out
   * of the unified cache (provider falls back to populating
   * `record.thumbnailDataUrl` itself, mirroring the legacy
   * inline-thumbnail shape).
   *
   * Examples (full keys after host-side prefixing):
   *   Browser:     `browser:<path>`
   *   Device:      `device:<rootHandleId>:<path>`
   *   GitHub:      `github:<owner>/<repo>/<branch>:<basePath>:<relPath>`
   *   GoogleDrive: `googledrive:<rootFolderId>:<driveId>`
   */
  thumbnailKey?(path: string): string | undefined;

  /**
   * Opaque "version" — must change whenever the file's bytes
   * change. Cache hits require a version match; mismatches
   * trigger eviction + re-prefetch. Stores that don't observe
   * external mutation may return `""` constant.
   *
   * Examples:
   *   Browser:     record.updatedAt (or "")
   *   Device:      file.lastModified.toString()
   *   GitHub:      blob sha
   *   GoogleDrive: modifiedTime
   */
  thumbnailVersion?(path: string): string;

  /**
   * Cache-miss source fetcher. Returns the bytes the manager
   * should run through `generateThumbnailFromBlob`. Default (when
   * not provided) is `getImage(path) → fetch(originalDataUrl) →
   * blob()`, which always works but isn't always optimal — Drive
   * and GitHub override to fetch raw bytes once instead of going
   * through the full record decode.
   */
  fetchThumbnailSource?(path: string): Promise<Blob | undefined>;
}
```

A provider that implements all three opts into the unified cache.
Providers without all three fall back to the legacy
`record.thumbnailDataUrl` inline shape — useful for trivial
plugins that want to ship a thumbnail without participating in the
shared invalidation contract.

### Tier placement

| Symbol | Tier | Package | Why |
|--------|------|---------|-----|
| `StorageProvider.thumbnailKey/Version/fetchThumbnailSource` (interface) | A | `@ingcreators/annot-core/storage` | type-only, DOM-free |
| `ThumbnailCache` interface | A | `@ingcreators/annot-core/storage` | abstract; no IDB import |
| `IndexedDBThumbnailCache` (impl) | C | `@ingcreators/annot-web/storage/idb-thumbnail-cache` | depends on `indexedDB` |
| `ThumbnailManager` (host-side prefetcher) | C | `@ingcreators/annot-web/storage/thumbnail-manager` | depends on `window.dispatchEvent` + IDB cache |
| `generateThumbnailFromBlob` / `drawToThumbCanvas` (existing) | B / A | unchanged | no movement |

### Naming convention

Built-in namespace prefixes match the existing `StorageMode`
strings used throughout the app (URL `?source=` handoff in
`router-host.ts`, `setStorageMode` / `saveLastStorage` in
`storage-bridge.ts`, sidebar `mode` column in `sidebar.ts`):
`browser` / `device` / `github` / `googledrive`. Anticipated
additions (OneDrive, Dropbox, S3, ...) would slot in as their
own discrete prefixes (`onedrive:`, `dropbox:`, `s3:`) rather
than being squeezed under a generic `drive:` umbrella, so the
storage mode is unambiguous from the cache key alone.

Rationale: keeping `StorageProvider` and `ThumbnailCache` typed in
core means plugins can import them without pulling browser-only
deps; the actual IDB implementation is web-only.

### `ThumbnailCache` interface

```ts
export interface CachedThumbnail {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ThumbnailCache {
  /**
   * Returns the cached entry IFF its stored version matches
   * `expectedVersion`. Stale entries (version mismatch) are
   * evicted as a side effect.
   */
  get(
    key: string,
    expectedVersion: string,
  ): Promise<CachedThumbnail | undefined>;

  /**
   * Bulk get for `listImages` — single IDB transaction instead
   * of one per record.
   */
  getMany(
    requests: { key: string; expectedVersion: string }[],
  ): Promise<Map<string, CachedThumbnail>>;

  /**
   * Write or overwrite. Updates the entry's `lastAccessedAt`
   * (used by LRU eviction). Throws `QuotaExceededError` only
   * after one self-eviction sweep + retry.
   */
  set(
    key: string,
    version: string,
    value: CachedThumbnail,
  ): Promise<void>;

  /** Evict by exact key. */
  delete(key: string): Promise<void>;

  /**
   * Drop everything under a key prefix. Used by
   * `StorageProvider.resync()` (per-instance namespace) and
   * plugin uninstall (whole `plugin:<id>:` namespace).
   */
  deletePrefix(prefix: string): Promise<void>;

  /** Quota-recovery hatch. */
  clearAll(): Promise<void>;
}
```

#### IndexedDB schema

New database `annot-thumbs`, version 1, single object store
`thumbnails`:

```ts
{
  cacheKey: string;            // primary key
  version: string;
  dataUrl: string;             // base64 PNG/JPEG (fits in IDB)
  width: number;
  height: number;
  bytes: number;               // for quota accounting
  lastAccessedAt: number;      // ms timestamp; indexed
  createdAt: number;           // ms timestamp
}
```

One index on `lastAccessedAt` for LRU eviction.

DB lives separate from the existing Browser-store DB so its
schema versioning is independent.

#### Quota / eviction

- LRU sweep: when total `sum(bytes)` exceeds 50 MB OR entry count
  exceeds 5000 (whichever first), evict in `lastAccessedAt`
  ascending order until both metrics drop 10% under the limit
  (avoids thrash).
- `set` runs the sweep before its write if it would push the
  store over the limit.
- `QuotaExceededError` triggers `clearAll() → retry once`. Final
  fallback: log + skip caching for that entry; the manager keeps
  the freshly generated thumbnail in memory only.

The 50 MB cap is configurable later; not critical for v1.

### `ThumbnailManager` (host)

```ts
export class ThumbnailManager {
  #cache: ThumbnailCache;
  #memoryLRU = new Map<string, CachedThumbnail>(); // ~100 entries
  #inFlight = new Map<string, Promise<void>>();

  constructor(cache: ThumbnailCache) {
    this.#cache = cache;
  }

  /**
   * Called by the gallery / file-manager after `listImages`
   * returns. Fills `record.thumbnailDataUrl` (and
   * `width`/`height` if zeroed) for every record whose key is
   * cached; schedules a background prefetch for the rest.
   */
  async attach(
    provider: StorageProvider,
    records: ImageRecord[],
  ): Promise<void> {
    if (!provider.thumbnailKey) return; // legacy provider — no-op
    const requests = records
      .map((record) => ({
        record,
        key: provider.thumbnailKey!(record.path),
        version: provider.thumbnailVersion?.(record.path) ?? "",
      }))
      .filter((x): x is typeof x & { key: string } => !!x.key);

    const hits = await this.#cache.getMany(
      requests.map(({ key, version }) => ({ key, expectedVersion: version })),
    );

    for (const { record, key, version } of requests) {
      const hit = hits.get(key) ?? this.#memoryLRU.get(key);
      if (hit) {
        record.thumbnailDataUrl = hit.dataUrl;
        record.width = record.width || hit.width;
        record.height = record.height || hit.height;
      } else {
        void this.#ensure(provider, record.path, key, version);
      }
    }
  }

  /**
   * Manual seeding — called by `save-pipeline.writeThumbnail()`
   * when the editor renders a fresh canvas, and on every
   * `saveImage` so newly-saved files don't have to wait on a
   * prefetch round-trip.
   */
  async write(
    provider: StorageProvider,
    path: string,
    dataUrl: string,
    dims: { width: number; height: number },
  ): Promise<void> {
    const key = provider.thumbnailKey?.(path);
    if (!key) return;
    const version = provider.thumbnailVersion?.(path) ?? "";
    const value: CachedThumbnail = { dataUrl, ...dims };
    this.#memoryLRU.set(key, value);
    await this.#cache.set(key, version, value);
    window.dispatchEvent(
      new CustomEvent("annot-thumbnail-ready", {
        detail: { path, dataUrl, width: dims.width, height: dims.height },
      }),
    );
  }

  async #ensure(
    provider: StorageProvider,
    path: string,
    key: string,
    version: string,
  ): Promise<void> {
    if (this.#inFlight.has(key)) return this.#inFlight.get(key);
    const promise = (async () => {
      try {
        const blob = await provider.fetchThumbnailSource!(path);
        if (!blob) return;
        const { dataUrl, width, height } =
          await renderThumbnailWithDims(blob);
        if (!dataUrl) return;
        const value = { dataUrl, width, height };
        this.#memoryLRU.set(key, value);
        await this.#cache.set(key, version, value);
        window.dispatchEvent(
          new CustomEvent("annot-thumbnail-ready", {
            detail: { path, dataUrl, width, height },
          }),
        );
      } catch {
        /* gallery keeps placeholder; next refresh retries */
      } finally {
        if (this.#inFlight.get(key) === promise) {
          this.#inFlight.delete(key);
        }
      }
    })();
    this.#inFlight.set(key, promise);
    return promise;
  }
}
```

`renderThumbnailWithDims` is a small extension of the existing
`generateThumbnailFromBlob` that also returns the natural
dimensions (decoded once via the existing `createImageBitmap`
inside).

### Save-pipeline integration

Currently `save-pipeline.writeThumbnail()` calls
`storage.updateImage(path, { thumbnailDataUrl })`. After this
plan:

```ts
async writeThumbnail(): Promise<void> {
  const storage = this.deps.getStorage();
  const canvas = this.deps.getCanvas();
  const path = this.deps.getCurrentImagePath();
  const tm = this.deps.getThumbnailManager();
  if (!canvas || !storage || !path || !tm) return;
  const renderedDataUrl = await getPngDataUrl(canvas);
  const thumb = await generateThumbnailFromDataUrl(renderedDataUrl);
  if (!thumb) return;
  await tm.write(storage, path, thumb, {
    width: canvas.width,
    height: canvas.height,
  });
}
```

The `updateImage(path, { thumbnailDataUrl })` branch on every
provider is removed (Phase 5). `ImageRecordUpdate.thumbnailDataUrl`
field is removed in Phase 5 as well.

### `listImages` flow

After this plan, providers' `listImages` returns records with
`thumbnailDataUrl: ""`, `width: 0`, `height: 0`. The gallery
then calls `ThumbnailManager.attach(provider, records)` which
patches both fields in place from the cache. Cards with cache
misses render blank for one tick, then patch in via the existing
`annot-thumbnail-ready` event mechanism the gallery already has.

`record.pageMetadata` and other XMP-derived fields stay as-is —
they're not part of the thumbnail contract.

### Key namespace conventions

```
built-in (host-reserved, matches StorageMode strings):
  browser:<path>
  device:<rootHandleId>:<path>
  github:<owner>/<repo>/<branch>:<basePath>:<relPath>
  googledrive:<rootFolderId>:<driveId>

plugin (plugin-author-managed):
  plugin:<pluginId>:<plugin-defined>
```

Each built-in prefix is exactly the storage's `StorageMode` /
URL `?source=` value (`browser` / `device` / `github` /
`googledrive`), so the cache key is unambiguous about which
backend produced it. Future cloud-storage additions slot in as
their own discrete prefixes (`onedrive:`, `dropbox:`, `s3:`)
rather than under a generic `drive:` umbrella.

The host enforces the `plugin:<pluginId>:` prefix at registration
time so plugin A can't read or evict plugin B's entries.

### What disappears from each provider

After Phase 5:

- `BrowserStore`: `thumbnailDataUrl` removed from the IDB image
  record schema; reads now go through the manager. `saveImage`
  just calls `tm.write(...)` with the caller-provided thumbnail.
- `DeviceStore`: `index.images[path].thumbnailDataUrl` field
  removed from `index.json`. `saveImage` calls `tm.write(...)`.
  The `#index` JSON keeps `tags` / `width` / `height` /
  `createdAt` / `mtime` (still useful for lazy `listImages`).
- `GitHubStore`: `GitHubBlobCache#thumbnail` and
  `GitHubBlobCache#thumbnailInFlight` removed.
  `GitHubBlobCache#dimensions` removed. `#ensureThumbnail`
  removed. `updateImage(path, { thumbnailDataUrl })` branch
  removed.
- `GoogleDriveStore`: `#thumbnailByDriveId` and
  `#thumbnailInFlightByDriveId` removed. `#ensureThumbnail`
  removed. `updateImage(path, { thumbnailDataUrl })` branch
  removed. `recordCache.thumbnailDataUrl` field stays for
  `getImage` (`originalDataUrl` is the actual cache target there;
  thumb is incidental).

`ImageRecordUpdate.thumbnailDataUrl` is removed entirely.
`ImageRecord.thumbnailDataUrl` stays — it's the read-side
field the gallery's `<img src>` binding consumes.

## Phased plan

Each phase lands as one PR, merged before the next starts (per
CLAUDE.md "one PR per phase"). Each phase is independently
revertable.

### Phase 1 — `ThumbnailCache` abstract + IDB implementation

- New `packages/core/src/storage/thumbnail-cache.ts`:
  - `interface ThumbnailCache`, `CachedThumbnail`,
    `ThumbnailCacheError` types.
  - Re-exported from `@ingcreators/annot-core/storage`.
- New `packages/web/src/storage/idb-thumbnail-cache.ts`:
  - `IndexedDBThumbnailCache` class.
  - Bootstraps `annot-thumbs` DB v1 with the `thumbnails` store.
  - LRU eviction sweep, quota-recovery `clearAll` retry.
- Single-file unit test under
  `packages/web/src/storage/idb-thumbnail-cache.test.ts`
  (`fake-indexeddb`-backed).
- No production wiring yet — pure addition.

Verification: `pnpm -r typecheck`, `pnpm test`, build.

Risk: low — pure addition.

### Phase 2 — `ThumbnailManager` host wrapper

- New `packages/web/src/storage/thumbnail-manager.ts`:
  - `ThumbnailManager` class.
  - `renderThumbnailWithDims(blob)` helper extending
    `image-thumbnail.ts` to also return dims (single decode).
- `app.ts` / boot wiring: instantiate one manager + IDB cache,
  expose via `app.deps.getThumbnailManager()`.
- Unit test:
  `packages/web/src/storage/thumbnail-manager.test.ts` —
  mock `ThumbnailCache` + a stub `StorageProvider`, assert
  `attach` patches records correctly and `#ensure` dedups in-flight.
- No provider integration yet — manager exists but no provider
  implements the optional methods.

Verification: typecheck, test, build.

Risk: low — pure addition.

### Phase 3 — Drive integration

- Add `thumbnailKey` / `thumbnailVersion` /
  `fetchThumbnailSource` to `GoogleDriveStore`.
- `saveImage` calls `tm.write(...)` instead of seeding
  `#thumbnailByDriveId`.
- `getImage` no longer generates / caches thumbnails (delegated
  to manager).
- `listImages` returns records with empty
  `thumbnailDataUrl` / `width=0` / `height=0`; gallery layer
  calls `tm.attach(provider, records)` after.
- Remove `#thumbnailByDriveId`, `#thumbnailInFlightByDriveId`,
  `#ensureThumbnail`, `updateImage(path, { thumbnailDataUrl })`
  branch.
- Update `google-drive-store.contract.test.ts` to use a real
  `IndexedDBThumbnailCache` (against `fake-indexeddb`) so the
  contract suite covers the new path end-to-end.
- `gallery / file-manager` plumbing change: `attach` call after
  `listImages`, listener for `annot-thumbnail-ready` to patch the
  card's `<img src>` (already exists for GitHub).

Verification: typecheck, test, build, manual: connect Drive cold
(new session), confirm thumbnails persist across resync + storage
switch + new tab.

Risk: medium — gallery flow change. Reverts cleanly because the
gallery still handles the case where `thumbnailDataUrl` is empty
(placeholder).

### Phase 4 — GitHub integration

- Same shape as Phase 3 for `GitHubStore`.
- Remove `GitHubBlobCache#thumbnail` / `#thumbnailInFlight` /
  `#dimensions` fields and their accessors.
- `#ensureThumbnail` deleted.
- `updateImage(path, { thumbnailDataUrl })` branch deleted.
- Contract test updated likewise.

Verification: typecheck, test, build, manual: connect a populated
GitHub repo, confirm thumbnails light up immediately on cold start
(persistence works), edits update the card thumbnail without page
reload.

Risk: low — Drive established the pattern in Phase 3.

### Phase 5 — Browser + Device integration; `ImageRecordUpdate.thumbnailDataUrl` removal

- `BrowserStore`: drop `thumbnailDataUrl` from the IDB record
  schema (no migration — pre-release). `saveImage` calls
  `tm.write(...)`. `listImages` returns records with empty thumb;
  gallery calls `attach` after.
- `DeviceStore`: drop `thumbnailDataUrl` from `index.json` entry
  schema. `saveImage` calls `tm.write(...)`. `listImages` returns
  records with empty thumb.
- Remove `ImageRecordUpdate.thumbnailDataUrl` field. Update every
  call site (`save-pipeline.writeThumbnail` already migrated in
  Phase 2).
- Update contract tests.

Verification: typecheck, test, build. Manual: capture into Browser
store, edit, confirm card thumbnail updates. Repeat with Device
store.

Risk: medium — Browser store schema change touches the most-used
backend. Contract test should catch regressions, and pre-release
status means we're not bound by old DBs in the wild.

### Phase 6 — Plugin API exposure

- Document `thumbnailKey` / `thumbnailVersion` /
  `fetchThumbnailSource` in
  `docs/plugin-api/storage.md` (or wherever the existing plugin
  storage docs live; create if missing).
- Enforce `plugin:<pluginId>:` prefix on plugin-registered
  providers in `storage/bridge.ts` registration: assert
  `thumbnailKey` returns a string starting with that prefix
  (host wraps the call to strip / re-prefix if not).
- Add a sample plugin storage to the docs that participates in
  the unified cache.

Verification: typecheck, build, doc preview. No new functional
tests beyond the prefix-enforcement assertion.

Risk: low — docs + one defensive wrapper.

## Verification

End-to-end manual test matrix after Phase 5:

| Backend | Cold start | Save → list | Edit → list | Switch to other store + back | Ctrl+R |
|---------|-----------|-------------|-------------|----------------------------|--------|
| Browser | thumbs persist (was: same) | same | same | same | same |
| Device | thumbs persist (was: same) | same | same | same | same |
| GitHub | thumbs persist (was: blank then populate) | same | edit thumb visible (was: stale) | thumbs persist (was: blank then populate) | same |
| Drive | thumbs persist (was: blank then populate or letterbox) | same | edit thumb visible | thumbs persist (was: black bars or blank) | same |

Automated:

- `packages/core/src/storage/thumbnail-cache.test.ts` — interface
  shape regressions.
- `packages/web/src/storage/idb-thumbnail-cache.test.ts` — LRU
  eviction, version mismatch eviction, prefix delete, quota
  recovery.
- `packages/web/src/storage/thumbnail-manager.test.ts` — attach
  flow, write flow, in-flight dedup, event dispatch.
- Contract test (`packages/web/src/storage/contract.test-helpers.ts`)
  gains coverage for: "after save, `thumbnailKey` returns a stable
  value across path-rename"; "after external mutation,
  `thumbnailVersion` changes" (Device/GitHub/Drive only).

## Migration notes

Pre-release. Existing user data:

- Browser: `thumbnailDataUrl` in IDB records will be ignored after
  Phase 5 — readers stop checking that field. The orphaned data is
  recoverable via the cache regenerating on first listing. We do
  not write a migration script.
- Device: same — `index.json[path].thumbnailDataUrl` is ignored.
  No script.
- GitHub / Drive: in-memory only, lost on restart anyway.

If we later decide to ship before full Phase 5 completion, the
gallery will still work because `tm.attach` is a no-op for
providers without `thumbnailKey`, and those providers continue to
populate `record.thumbnailDataUrl` themselves.

## Forward-looking notes

- **Worker offload.** The `renderThumbnailWithDims` decode +
  encode is a candidate for a Web Worker move once the manager is
  in place. `OffscreenCanvas` + IDB both work in workers; the
  helper can be portable as-is. Out of scope for this plan.
- **Pre-emptive prefetch on idle.** Once persistent, we can
  schedule prefetch of every visible folder's thumbnails on
  `requestIdleCallback` after first paint, not just on demand.
  Out of scope.
- **Cross-device thumb sharing.** If a user has Annot installed on
  two devices pointing at the same Drive root, each generates its
  own cache. Could persist thumbs in the Drive folder itself
  (similar to Device's `index.json`) — but that re-introduces the
  "data on remote" tension. Defer until a concrete user trigger.
- **Page-metadata cache.** The DOM-metadata sidebar (Elements
  panel) is another piece of derived state that today isn't
  cached at all. Same `ThumbnailCache` shape (key + version + blob
  payload) generalises. Out of scope but called out so a future
  reader can spot the symmetry.
