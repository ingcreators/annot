# Shared MetadataCache (IndexedDB) across storage providers

> **Status:** Done — all 8 phases landed.
>
> | Phase | Description | PR |
> |-------|-------------|----|
> | P0 | Plan doc | [#667](https://github.com/ingcreators/annot/pull/667) |
> | P1 | Tier A `MetadataCache` interface | [#668](https://github.com/ingcreators/annot/pull/668) |
> | P2 | Tier C `IndexedDBMetadataCache` + memory LRU + BroadcastChannel multi-tab sync | [#669](https://github.com/ingcreators/annot/pull/669) |
> | P3 | DeviceStore migration (pilot) | [#670](https://github.com/ingcreators/annot/pull/670) |
> | P4 | DesktopStore migration | [#671](https://github.com/ingcreators/annot/pull/671) |
> | P5 | GitHubStore + branch HEAD SHA tracking (additive — bespoke caches retained) | [#672](https://github.com/ingcreators/annot/pull/672) |
> | P6 | GoogleDriveStore + Changes API page token seed (additive — bespoke caches retained) | [#673](https://github.com/ingcreators/annot/pull/673) |
> | P7 | CLAUDE.md guardrail + plugin-api docs + archive | this PR |
>
> NOTE: P5 / P6 deviated from the plan's "drop bespoke caches"
> language — both stores' in-session caches (`GitHubTreeState` /
> `GitHubBlobCache` / `#docMeta`; Drive's path↔id maps + record
> cache) are tightly coupled to their backend's API contract, and
> a full migration onto the shared cache's listing/record layers
> proved larger than the 3–4d budget. The capability is in,
> `branchHead` / `changesPageToken` cross-session tracking lands,
> and the cross-tab listener is wired. A follow-up plan can
> finish the bespoke-cache replacement when there's a concrete
> trigger (e.g. wanting differential `compare`-based update on
> GitHub HEAD mismatch, or differential Drive `changes.list`
> application).
>
> **Compatibility:** Affected 4 of 6 `StorageProvider` implementations
>   (`Device` / `Desktop` / `GitHub` / `Drive`). `BrowserStore` and
>   the extension's `IDBStore` keep their current shape since they
>   already use IndexedDB natively. Adds one optional capability
>   (`StorageWithMetadataCache`); existing callers see no public
>   surface change.
> **Risk:** Single landing not viable — 8-phase split, each phase
>   independently revertable per
>   [`docs/plans/README.md`](../README.md). Conservative on disk
>   data: existing `.annot.json` sidecars in user folders are left
>   in place (not read, not deleted) so a downgrade still finds a
>   valid sidecar.

## Context

Annot's storage providers each maintain their own bespoke metadata
cache:

- `DeviceStore` writes a `.annot.json` sidecar to the user-selected
  folder, mirroring it into an in-memory `#index` rebuilt on every
  `init()` / `resync()`. See
  [`packages/web/src/storage/device-store.ts:47`](../../packages/web/src/storage/device-store.ts:47).
- `DesktopStore` does the same shape over the Electron FS adapter
  ([`packages/desktop/src/storage/desktop-store.ts:64`](../../packages/desktop/src/storage/desktop-store.ts:64)).
- `GitHubStore` keeps three in-memory caches: `GitHubTreeState`
  (path → blob SHA + folder set), `GitHubBlobCache`
  (path → `ImageRecord` + commit timestamps), and a bare `#docMeta`
  Map. All wiped on every session start.
- `GoogleDriveStore` keeps `#fileMeta`, `#recordCache`,
  `#documentMeta`, and bidirectional path ↔ Drive ID maps in memory.
- `BrowserStore` and the extension's `IDBStore` already use IDB
  natively — no separate cache layer.

Sub-problems this creates:

1. **Duplicated lifecycle code** across four stores (load / sync /
   revalidate / orphan-purge / backfill).
2. **No cross-session persistence** for network-backed stores —
   GitHub re-fetches the full tree on every session; Drive re-lists
   every folder visited.
3. **No multi-tab consistency** — two tabs editing the same Drive
   account drift apart silently.
4. **Mixed storage models in Desktop** — bitmap on FS, thumbnails
   in IDB ([`thumbnail-cache.ts`](../../packages/core/src/storage/thumbnail-cache.ts)),
   metadata index in `.annot.json`. The IDB precedent already
   exists for thumbnails; metadata is the missing symmetry.

The thumbnail subsystem
([`_done/unified-thumbnail-cache.md`](./_done/unified-thumbnail-cache.md))
shipped a shared `IndexedDBThumbnailCache` with a per-store
`StorageWithThumbnailCache` capability. Stores answer "what's the
version key" and "where do source bytes live"; the host owns the
cache lifecycle. This plan applies the same pattern to metadata,
plus adds two backend-specific incremental-sync features that the
per-namespace primitive enables for free (GitHub branch HEAD SHA,
Drive Changes API page token).

Outcome: each opt-in store sheds 200–400 LOC of bespoke cache
logic, the metadata layer gains cross-session persistence +
multi-tab consistency, and the `MetadataCache` primitive becomes
the foundation for future incremental-sync features.

## Design

### Architecture

Two layers, mirroring the thumbnail architecture:

- **Tier A** `@ingcreators/annot-core/storage/metadata-cache` —
  pure types + capability interface + predicate. No DOM.
- **Tier C** `@ingcreators/annot-host-ui/idb-metadata-cache` —
  `IndexedDBMetadataCache` implementation with memory LRU and
  `BroadcastChannel` multi-tab sync.

Stores opt in by implementing `StorageWithMetadataCache` and
taking the `MetadataCache` as a constructor dependency. Stores
that don't opt in continue working unchanged (BrowserStore /
IDBStore stay as they are).

This is a **library**, not a **manager-wrapper**. Unlike the
thumbnail subsystem where the host calls
`thumbnailManager.attach(provider, records)` from above,
`MetadataCache` is used by each store from below — because
`listImages` returns metadata, there is no "decoration after
listing" slot to wrap. The public `StorageProvider` interface
stays byte-identical; consumer callsites never change.

### `MetadataCache` interface (Tier A)

```ts
export interface MetadataCache {
  // ── Per-path record cache ────────────────────────
  getImage(ns: string, path: string, version: string): Promise<ImageRecord | undefined>;
  putImage(ns: string, path: string, version: string, rec: ImageRecord): Promise<void>;
  getDocument(ns: string, path: string, version: string): Promise<DocumentRecord | undefined>;
  putDocument(ns: string, path: string, version: string, rec: DocumentRecord): Promise<void>;

  // ── Per-folder listing cache ─────────────────────
  getListing(ns: string, folderPath: string): Promise<ListingEntry[] | undefined>;
  putListing(ns: string, folderPath: string, entries: ListingEntry[]): Promise<void>;
  upsertListingEntry(ns: string, folderPath: string, entry: ListingEntry): Promise<void>;
  removeListingEntry(ns: string, folderPath: string, path: string): Promise<void>;

  // ── Per-namespace meta (single value KV) ─────────
  // Used for GitHub branchHead, Drive changesPageToken, etc.
  getNamespaceMeta(ns: string, key: string): Promise<string | undefined>;
  putNamespaceMeta(ns: string, key: string, value: string): Promise<void>;
  deleteNamespaceMeta(ns: string, key: string): Promise<void>;

  // ── Backend ID map (for ID-based backends like Drive) ─
  setBackendId(ns: string, path: string, backendId: string): Promise<void>;
  getBackendIdByPath(ns: string, path: string): Promise<string | undefined>;
  getPathByBackendId(ns: string, backendId: string): Promise<string | undefined>;

  // ── Bulk operations (generic across stores) ──────
  migrateEntry(ns: string, oldPath: string, newPath: string): Promise<void>;
  rewriteEntriesForPrefix(ns: string, oldPrefix: string, newPrefix: string): Promise<void>;

  // ── Invalidation ─────────────────────────────────
  invalidatePath(ns: string, path: string): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
}

export interface ListingEntry {
  path: string;
  version: string;        // mtime / blob SHA / modifiedTime
  kind: "image" | "document" | "folder";
}

export interface StorageWithMetadataCache {
  metadataNamespace(): string;     // "device:<root>" / "github:<owner>/<repo>:<branch>" / etc.
  attachMetadataCache(cache: MetadataCache): void;
}

export function supportsMetadataCache(
  store: StorageProvider
): store is StorageProvider & StorageWithMetadataCache;
```

**Caching policy**: only lightweight fields. Excluded from the
cache:

- `ImageRecord.originalDataUrl` (image bytes, can be MB).
- `ImageRecord.annotationsSvg` (mutates often, version-tracked
  only).
- `DocumentRecord.bytes` (full HTML with embedded base64 PNGs,
  often multi-MB).

These are re-fetched on demand via the store's existing path. The
cache holds the rest (title, blockCount, imageCount, width,
height, tags, sourceUrl, pageMetadata, createdAt, updatedAt, plus
the namespace-qualified version).

### `IndexedDBMetadataCache` (Tier C)

IDB schema: database `annot-metadata`, object stores:

| Object store | keyPath | Indexes | Purpose |
|---|---|---|---|
| `records` | `cacheKey` (`ns:path`) | `ns`, `lastAccessedAt` | per-path `ImageRecord` / `DocumentRecord` |
| `listings` | `listingKey` (`ns:folderPath`) | `ns` | per-folder `ListingEntry[]` |
| `namespace_meta` | `id` (`ns:key`) | `ns` | per-namespace KV (branchHead, changesPageToken) |
| `backend_ids` | `pathKey` (`ns:path`) | `ns`, `backendIdKey` | bidirectional path ↔ backendId |

Memory LRU layer in front of IDB (default 500 entries for
records, 200 for listings).

Multi-tab sync via `BroadcastChannel("annot-metadata")` with the
**Notify-and-reread** pattern: messages carry
`(ns, path/folderPath, version)` only — receivers invalidate
their memory LRU and reread IDB on next access. Sender UUID
filters echo. Messages emitted **after** IDB commit, not before
(so a peer never reads stale state).

```ts
type CacheBroadcastEvent =
  | { type: "path-changed"; ns: string; path: string; version: string; sender: string }
  | { type: "listing-changed"; ns: string; folderPath: string; sender: string }
  | { type: "prefix-invalidated"; prefix: string; sender: string }
  | { type: "ns-meta-changed"; ns: string; key: string; sender: string };
```

Re-dispatched as `CustomEvent`s on `window`
(`annot-metadata-changed`, `annot-metadata-ns-changed`) so the
host UI and the GitHub/Drive stores can react (clear their memory
shortcuts, refresh open galleries).

### Per-store integration

#### DeviceStore (P3 pilot) and DesktopStore (P4)

Drop `#index`, `#loadIndex`, `#saveIndex`, `#syncFilesToIndex`,
`#revalidateModified`, `#removeOrphanedEntries`,
`#backfillMissingMetadata`. **Do not read or delete `.annot.json`**
— it may exist from prior versions but is ignored. (Conservative:
old binaries downgrading to a previous Annot release still find a
valid sidecar.)

`listImages(folderPath)` walks the FS each call (cheap on SSD),
diffs against `cache.getListing(ns, folderPath)` by mtime version,
and re-reads XMP only for changed entries. Saves XMP-extracted
metadata via `cache.putImage(ns, path, String(mtime), rec)`.

Namespaces: `"device:<rootName>"` / `"desktop:<rootName>"`.

#### GitHubStore (P5)

Drop `GitHubTreeState`, `GitHubBlobCache`, `#docMeta`. The blob
SHA flows into `ListingEntry.version` — one field serves both
cache revalidation AND Contents-API optimistic concurrency
(today's `#shaByPath` Map collapses into the listing-entry
version slot).

Add **branch HEAD SHA tracking** via
`cache.putNamespaceMeta(ns, "branchHead", commitSha)`:

- `init()` fetches current HEAD via 1 API call
  (`GET /repos/.../git/refs/heads/{branch}`).
- If HEAD matches stored `branchHead`, skip the recursive tree
  fetch entirely (cache hit). Memory shortcut: `#headSha` cached
  for 60s to avoid re-checking on every `listImages`.
- If HEAD differs (another commit landed), invalidate-all for the
  namespace (`invalidatePrefix("github:owner/repo:branch:")`) and
  re-fetch the recursive tree. v1 is invalidate-all; differential
  update via `GET /compare/{base}...{head}` is deferred to a
  follow-up.
- After own commit, write the new commit SHA to `branchHead` so
  the next `listImages` sees a HEAD match.
- Listener on `annot-metadata-ns-changed` for cross-tab HEAD
  updates.

#### GoogleDriveStore (P6)

Drop `#fileMeta`, `#recordCache`, `#documentMeta`, `#pathToId`,
`#idToPath`. Path ↔ Drive ID lives in
`cache.setBackendId(ns, path, fileId)`.

Add **Changes API page token tracking** via
`cache.putNamespaceMeta(ns, "changesPageToken", token)`:

- `init()` reads stored token. If present, calls
  `GET /drive/v3/changes?pageToken=...` and applies each change
  to the cache (path-changed / listing-changed). If absent
  (first run), calls `GET /drive/v3/changes/startPageToken` to
  seed.
- `resync()` does the same.
- Changes are filtered by ancestor-folder check (only changes
  within the configured root folder).
- Listener on `annot-metadata-ns-changed` for cross-tab token
  updates (avoid duplicate-applying changes already consumed by
  another tab).

### Why this approach

Considered and rejected:

- **Replace memory caches with IDB at the store level only, no
  shared layer** → still N implementations of "open IDB, define
  schema, manage migrations". Doesn't shed the duplicated
  lifecycle logic.
- **Manager-wrapper pattern like `ThumbnailManager`** → would
  force every `storage.getImage(path)` callsite to become
  `manager.getImage(storage, path)`. Highly invasive across the
  codebase. The Tier A library approach lets the public
  `StorageProvider` interface stay byte-identical.
- **Remove `.annot.json` entirely** → would force re-scan on
  cross-device folder copies and break downgrade compatibility.
  The "write to IDB but don't read/delete `.annot.json`" stance
  has the best risk profile during transition.

## Phased plan

Each phase lands as its own independently-revertable PR per
[`README.md`](./README.md)'s phased-plan convention. P3–P6 are
independent of each other once P2 is on `main`.

### P0 — Plan doc

- This document, in `docs/plans/shared-metadata-cache.md`.
- PR title: `docs(plans): shared metadata cache`.

### P1 — Tier A interface

- Add `packages/core/src/storage/metadata-cache.ts` with the
  interface + `StorageWithMetadataCache` capability + predicate.
- Re-export from `@ingcreators/annot-core/storage` and the
  `annot-core` root.
- No runtime impact (types only). `pnpm -r typecheck` is the
  primary verification.
- Estimated 0.5 day.

### P2 — Tier C IndexedDB implementation

- Add `packages/host-ui/src/idb-metadata-cache.ts` with the IDB
  schema, memory LRU, and BroadcastChannel sync.
- Wire `fake-indexeddb` test dep if not already present; check
  `packages/host-ui/package.json`.
- Tests: CRUD, LRU eviction, BroadcastChannel mock, prefix
  invalidation, migrate operations, namespace-meta and
  backend-id round-trips.
- Stores are NOT migrated in this phase — implementation exists
  but unused.
- Estimated 2–3 days.

### P3 — DeviceStore migration (pilot)

- Refactor
  [`device-store.ts`](../../packages/web/src/storage/device-store.ts)
  to take a `MetadataCache` in the constructor.
- Implement `StorageWithMetadataCache`.
- Replace `#index` walkthrough with cache-driven `listImages`
  (FS walk → diff vs cache → re-read XMP for changed entries).
- Drop `#loadIndex` / `#saveIndex` / `#syncFilesToIndex` /
  `#revalidateModified` / `#removeOrphanedEntries` /
  `#backfillMissingMetadata`. Leave the `.annot.json` file alone
  (don't read, don't delete).
- Update [`packages/web/src/storage/bridge.ts`](../../packages/web/src/storage/bridge.ts)
  to pass the cache in.
- Existing
  [`device-store.contract.test.ts`](../../packages/web/src/storage/device-store.contract.test.ts)
  keeps passing.
- New tests:
  - `.annot.json` present in directory is ignored (not read).
  - First `listImages` populates the IDB cache from XMP.
  - Subsequent `listImages` hits cache when mtimes unchanged.
  - mtime change triggers single-file re-read, not folder-wide
    re-scan.
- Estimated 2–3 days.

### P4 — DesktopStore migration

- Mirror P3 against
  [`packages/desktop/src/storage/desktop-store.ts`](../../packages/desktop/src/storage/desktop-store.ts).
- Wire through
  [`packages/desktop/src/storage/bootstrap.ts`](../../packages/desktop/src/storage/bootstrap.ts)
  — construct the `IndexedDBMetadataCache` once, pass to
  DesktopStore.
- Same `.annot.json` policy.
- `desktop-store.contract.test.ts` keeps passing; add the cache
  hit/miss tests.
- Estimated 1–2 days.

### P5 — GitHubStore migration + branch HEAD SHA tracking

- Refactor
  [`packages/web/src/storage/github-store.ts`](../../packages/web/src/storage/github-store.ts)
  to take a `MetadataCache`.
- Drop
  [`github-tree-state.ts`](../../packages/web/src/storage/github-tree-state.ts),
  [`github-blob-cache.ts`](../../packages/web/src/storage/github-blob-cache.ts),
  `#docMeta` (delete the dedicated files when no longer used).
- Move `migrateEntry` / `rewriteEntriesForPrefix` logic from
  `GitHubBlobCache` into the Tier C IDB implementation as
  generic primitives (already exposed on the Tier A interface
  in P1).
- Add `branchHead` namespace-meta wiring:
  - On `init()`: fetch current HEAD via
    `GET /repos/.../git/refs/heads/{branch}`. Compare with
    stored. Skip recursive tree fetch on match;
    invalidate-prefix + re-fetch on mismatch.
  - On commit: write new commit SHA from response to
    `branchHead`.
  - TTL (60s) memory shortcut `#headSha` avoids re-checking
    HEAD on every `listImages` call.
- Listener on `annot-metadata-ns-changed` for cross-tab HEAD
  invalidation.
- New tests:
  - HEAD-match → tree fetch is skipped.
  - HEAD-mismatch → cache invalidated + re-fetched.
  - Own commit → next `listImages` sees match.
  - 60s TTL respected.
  - Cross-tab BroadcastChannel updates `#headSha` shortcut.
- Estimated 3–4 days.

### P6 — GoogleDriveStore migration + Changes API

- Refactor
  [`packages/web/src/storage/google-drive-store.ts`](../../packages/web/src/storage/google-drive-store.ts)
  to take a `MetadataCache`.
- Drop `#fileMeta`, `#recordCache`, `#documentMeta`,
  `#pathToId`, `#idToPath`.
- Use `setBackendId` for path ↔ Drive fileId.
- Add Changes API wiring:
  - `init()` / `resync()`: read `changesPageToken`. Apply
    changes since token; advance token.
  - First run: seed via `startPageToken`.
- Listener on `annot-metadata-ns-changed` for cross-tab token
  updates.
- New tests: change application (add / remove / move),
  ancestor filtering, token advancement, cross-tab token sync.
- Estimated 3–4 days.

### P7 — Documentation + plan archived

- Add CLAUDE.md guardrail section ("MetadataCache is the only
  way in") under the storage section.
- Add `docs/plugin-api/metadata-cache.md` for plugin authors
  (capability surface + namespace prefix rules).
- Move this plan to `docs/plans/_done/` with the phase / PR
  table populated.
- Estimated 0.5 day.

## Verification

For each phase:

- `pnpm -r typecheck` passes.
- `pnpm test` passes. Note total pass count in commit's
  `Verified:` paragraph.
- `pnpm lint` reports 0 findings.
- `pnpm --filter <changed-pkg> build` passes (core / host-ui /
  web / desktop as applicable).

Per-phase additional verification:

- **P2**: `IndexedDBMetadataCache` tests cover CRUD round-trips,
  LRU eviction at the configured cap, BroadcastChannel send +
  receive (mocked), prefix invalidation, migrate operations,
  namespace-meta and backend-id round-trips.
- **P3 (DeviceStore pilot)**: existing
  `device-store.contract.test.ts` continues passing. New tests
  validate: `.annot.json` ignored on read, IDB populated from
  XMP on first listImages, cache hit on subsequent listImages
  with unchanged mtimes, single-file re-read on mtime change.
- **P4 (Desktop)**: existing
  `desktop-store.contract.test.ts` continues passing. Add cache
  integration tests mirroring P3's shape.
- **P5 (GitHub)**: existing
  `github-store.contract.test.ts` continues passing. New tests
  cover: HEAD-match skips tree fetch, HEAD-mismatch triggers
  invalidate-prefix + re-fetch, own commit advances
  `branchHead`, 60s TTL respected via mock clock, cross-tab
  BroadcastChannel clears `#headSha`.
- **P6 (Drive)**: existing
  `google-drive-store.contract.test.ts` continues passing. New
  tests cover: `startPageToken` seeded on first run, changes
  applied to listing + record cache, ancestor filtering rejects
  out-of-scope changes, token advanced after consumption,
  cross-tab token sync.

Manual two-tab verification (P2 onwards):

- Open Annot in two tabs against the same Drive account.
- In tab A: rename an image.
- In tab B: gallery refreshes via `annot-metadata-changed`
  event.
- Verify no full page reload required.

Manual GitHub HEAD detection (P5):

- Open Annot against a GitHub repo.
- Push an unrelated commit from a separate clone.
- Click Refresh in Annot.
- Verify the gallery reflects the new commit's tree (or, with
  BroadcastChannel + a second tab, reflects it on next
  navigation without manual refresh).

Manual Drive Changes integration (P6):

- Open Annot against a Drive folder.
- Add a file via drive.google.com (web UI).
- Click Refresh in Annot.
- Verify the new file appears via the Changes API path (one
  changes-list call) rather than a full folder re-list.

## Migration notes

**No on-disk migration required.** Existing `.annot.json`
sidecars in user folders are left untouched. From P3 onwards,
DeviceStore / DesktopStore ignore them on read and never write
to them; the file is dead weight on disk but doesn't break
anything if a user downgrades or shares the folder with an
older Annot install.

**No `StorageProvider` interface change.** The new capability
`StorageWithMetadataCache` is purely additive. Consumers of
`StorageProvider` (gallery / editor / file-manager / save
pipeline) see no public surface change.

**No `ImageRecord` / `DocumentRecord` / `PageMetadata` change.**
The cache stores subsets of these types; the types themselves
stay byte-identical.

**Pre-existing IDB databases unaffected.** BrowserStore's
`annot-browser-store` DB and the extension's
`annot-extension-store` DB are untouched. The new
`annot-metadata` DB is added alongside.

## Forward-looking notes

This plan deliberately scopes out the following follow-ups so
they can be evaluated independently once the foundation is in
place:

- **Differential update on GitHub HEAD mismatch** —
  `GET /repos/.../compare/{base}...{head}` instead of full tree
  re-fetch. v1 is invalidate-all. Worth measuring before doing.
- **Send-side debouncing of BroadcastChannel** — rapid mass
  imports could emit thousands of messages. Measure first; add
  `coalesceBroadcasts` option only if the receive side actually
  hits a bottleneck.
- **bfcache restore handling** — `pageshow` event with
  `event.persisted === true` should trigger a soft resync.
  Lands in each store's `init()` path as part of P3–P6, not as
  a separate phase.
- **Plugin author surface** — the `plugin:<pluginId>:` namespace
  prefix convention is documented in P7; plugin runtime
  enforcement (the host should reject providers that return a
  non-`plugin:` prefix) is out of this plan's scope.
- **`.annot.json` sidecar removal** — once enough release
  cycles have passed that "downgrade safety" is no longer a
  concern, a follow-up plan can drop the sidecar entirely and
  free DeviceStore's `purgeEmptyFiles` work from special-casing
  it.
