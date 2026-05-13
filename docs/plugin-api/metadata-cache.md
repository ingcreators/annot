# Plugin API: MetadataCache

> **Audience:** plugin authors who want their custom storage backend
> to participate in Annot's shared metadata cache — cross-session
> persistence + multi-tab consistency for the lightweight fields
> the gallery + listing UI care about.

A storage backend opts into the shared metadata cache by
implementing the
[`StorageWithMetadataCache`](../../packages/core/src/storage/metadata-cache.ts)
capability from `@ingcreators/annot-core/storage`. Two short
methods are all that's required.

The cache mirrors the architecture of
[`StorageWithThumbnailCache`](./storage.md): a Tier A interface
contract + a first-party Tier C IndexedDB implementation
(`@ingcreators/annot-host-ui/idb-metadata-cache`) that
plugin-registered backends can opt into without re-implementing
the persistence layer.

## What gets cached

| Field source | Cached? | Where it lives |
|---|---|---|
| Lightweight metadata (path, version, title, dimensions, tags, timestamps) | ✓ | `MetadataCache` |
| Per-folder `ListingEntry[]` | ✓ | `MetadataCache` |
| Per-namespace KV (e.g. branch HEAD SHA, change-page tokens) | ✓ | `MetadataCache` |
| Path ↔ backend-internal ID maps (for ID-native backends) | ✓ | `MetadataCache` |
| `ImageRecord.originalDataUrl` (image bytes) | ✗ | Backend on demand |
| `ImageRecord.annotationsSvg` (mutates often) | ✗ | Backend on demand |
| `DocumentRecord.bytes` (multi-MB HTML) | ✗ | Backend on demand |

The cache is a **performance layer for lightweight metadata** —
not a substitute for the backend. Heavy payloads keep flowing
through the backend's existing read path.

## Mandatory surface — two methods

```ts
import type {
  MetadataCache,
  StorageProvider,
  StorageWithMetadataCache,
} from "@ingcreators/annot-core/storage";

class MyImgurStore implements StorageProvider, StorageWithMetadataCache {
  #cache?: MetadataCache;

  // ── existing StorageProvider methods (saveImage, getImage, ...) ──

  // ── metadata-cache contract: 2 methods ──

  metadataNamespace(): string {
    // Stable per-instance namespace. Host enforces a
    // `plugin:<your-mode>:` prefix at registration time so two
    // plugins can't collide. Suffix the rest however you like —
    // a stable account / library id keeps two instances of your
    // plugin (e.g. user signed into account A vs B) from
    // overwriting each other's cache entries.
    return `plugin:imgur:${this.#accountId}`;
  }

  attachMetadataCache(cache: MetadataCache): void {
    // The host calls this exactly once, before any other method.
    // Stash the reference; use it from save / read / mutation
    // sites to persist lightweight metadata.
    this.#cache = cache;
  }
}
```

That's the minimum. With those two methods in place, the host:

- Constructs a single `IndexedDBMetadataCache` per browser tab and
  attaches it to every opt-in store.
- Coordinates across tabs via `BroadcastChannel("annot-metadata")`
  so a save in one tab invalidates the others.
- Re-dispatches change notifications on `window` as
  `annot-metadata-changed` / `annot-metadata-ns-changed` so UI
  surfaces can react.

## Using the cache from your store

Inside your backend's CRUD methods, populate the cache alongside
the actual backend write:

```ts
async saveImage(rec, opts) {
  const path = /* ... upload to imgur ... */;
  const version = /* ... etag from imgur response ... */;

  // Cache the lightweight metadata so the gallery's next listImages
  // returns it without a round-trip.
  await this.#cache!.putImage("plugin:imgur:" + this.#accountId, path, version, {
    path,
    folderPath: rec.folderPath,
    originalDataUrl: "",      // NEVER cache image bytes
    annotationsSvg: "",       // NEVER cache annotation SVG
    thumbnailDataUrl: "",
    width: rec.width,
    height: rec.height,
    tags: rec.tags,
    sourceUrl: rec.sourceUrl,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  });

  // Mirror the entry into the folder's listing.
  await this.#cache!.upsertListingEntry(
    "plugin:imgur:" + this.#accountId,
    rec.folderPath,
    { path, version, kind: "image" },
  );

  return path;
}
```

And on read, prefer cached metadata over a fresh API call when the
version matches:

```ts
async listImages(folderPath) {
  const ns = `plugin:imgur:${this.#accountId}`;
  // 1. Get cached listing.
  const cached = await this.#cache!.getListing(ns, folderPath);
  if (cached) {
    // 2. Hydrate records from the cache for entries whose version
    //    hasn't changed.
    const records: ImageRecord[] = [];
    for (const entry of cached) {
      const cachedRec = await this.#cache!.getImage(ns, entry.path, entry.version);
      if (cachedRec) {
        records.push(cachedRec);
      }
    }
    return records;
  }

  // 3. Cold miss — fetch from backend, populate cache.
  const apiRecords = await this.#api.listFolder(folderPath);
  // ... convert + cache + return ...
}
```

The Tier A interface
([`metadata-cache.ts`](../../packages/core/src/storage/metadata-cache.ts))
documents every method.

## Per-namespace metadata (advanced)

Backends that need to track a single per-namespace value across
sessions — e.g. an OAuth provider's last-known token rotation
timestamp, a Drive Changes API page token, a Git commit SHA —
can store one via:

```ts
// Persist a value.
await this.#cache!.putNamespaceMeta(ns, "changesPageToken", token);

// Read it back (returns undefined when never set).
const token = await this.#cache!.getNamespaceMeta(ns, "changesPageToken");
```

GitHub uses this for the branch HEAD commit SHA; Drive for the
Changes API page token. Both let the store skip expensive
re-listing on session start when the live backend state hasn't
moved since last session.

## Backend ID maps (for ID-native backends)

If your backend is fileId-keyed (Drive, Notion, S3 with random
keys, ...), persist the path ↔ id mapping so the gallery's
listImages doesn't have to re-walk an external API to resolve
IDs:

```ts
await this.#cache!.setBackendId(ns, "Documents/x.png", "imgur-uuid-123");
const id = await this.#cache!.getBackendIdByPath(ns, "Documents/x.png");
const path = await this.#cache!.getPathByBackendId(ns, "imgur-uuid-123");
```

The lookup is O(1) in both directions thanks to the secondary
index on the IDB store.

## What you DON'T need to do

- ❌ Don't construct your own `IndexedDBMetadataCache` — the host
  injects the shared singleton.
- ❌ Don't manage cross-tab consistency yourself — the
  `BroadcastChannel` infrastructure is internal to the cache
  implementation; your store just writes through.
- ❌ Don't persist `originalDataUrl` / `annotationsSvg` /
  `DocumentRecord.bytes`. The cache is a deliberate
  lightweight-only layer — heavy payloads fetch from the backend
  on demand.
- ❌ Don't worry about namespace collisions — the host enforces
  the `plugin:<your-mode>:` prefix at registration time.

## Listening for cross-tab changes

If your store needs to react to peer-tab writes (e.g. clearing
in-memory shortcuts so the next read sees fresh data), wire a
`window` listener inside `attachMetadataCache`:

```ts
attachMetadataCache(cache: MetadataCache): void {
  this.#cache = cache;
  if (typeof window === "undefined") return;
  window.addEventListener("annot-metadata-changed", (e) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.ns !== this.metadataNamespace()) return;
    // Peer tab wrote something. Drop your in-memory shortcuts.
  });
  window.addEventListener("annot-metadata-ns-changed", (e) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.ns !== this.metadataNamespace()) return;
    // Peer-tab namespace-meta change. Handle accordingly
    // (e.g. clear caches that depend on the now-stale token).
  });
}
```

The host re-dispatches `BroadcastChannel` events as `window`
`CustomEvent`s so UI components and stores share one event model.
Both first-party stores (GitHub branch HEAD, Drive page token)
use this pattern.

## Relation to other plans

- [`unified-thumbnail-cache.md`](../plans/_done/unified-thumbnail-cache.md):
  same architectural pattern (Tier A interface + Tier C IDB impl
  + capability surface), applied to image previews. A store can
  opt into both independently.
- [`shared-metadata-cache.md`](../plans/_done/shared-metadata-cache.md):
  the design + phasing for the metadata cache itself. Read this
  for the rationale + the caching-policy decisions.
