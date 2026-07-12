# Metadata unification — the file tells the whole story

> **Status:** In progress
> **Compatibility:**
>   - **Deliberately breaking.** Signed off 2026-07-12: existing
>     annot files do NOT need to keep working — this plan cleans the
>     format up in one move instead of layering compat shims.
>     Readers stay defensive (missing fields → empty defaults, per
>     the CLAUDE.md §1 guardrail) so old files degrade gracefully
>     rather than crash, but no migration/backfill code is written.
>   - XMP packet schema bumps `annot:version` 1.0 → 2.0 (new
>     first-class fields; see the inventory below).
>   - `AnnotMetadata` (core/xmp) gains `sourceUrl` / `createdAt` /
>     `producer` / `dpr` / `version` fields.
>   - `CreateEditablePngBytesOptions` (and the browser-side
>     `createEditableImage`) gain the matching optional inputs.
>   - Legacy `.annot.json` sidecar handling and the desktop
>     legacy-data notice are removed outright.
>   - Import filenames are normalized to the `.annot.<ext>` double
>     extension at save time (uploads included).

## Why now

The desktop e2e work (PRs #1097–#1099) surfaced that ImageRecord
fields have three different sources of authority, and two of them
silently lose data:

| Field | Actual authority today | Failure mode |
|---|---|---|
| annotations / original / width / height / tags / elementTree | XMP packet in the file ✓ | — |
| `sourceUrl` | **MetadataCache (IndexedDB) only** | Lost on cache eviction, another machine, a fresh clone of a GitHubStore repo |
| `createdAt` | MetadataCache, falling back to **file mtime** | Silently drifts to copy/sync time |

Meanwhile `WELL_KNOWN_TAG_KEYS` (`source` / `capturedAt` /
`commit`) shows producers already smuggling provenance through the
opaque `tags` map because the schema has no first-class home for
it — and `ElementTree` (`capturedAt` / `url` / `viewport.scale`)
carries the same facts for DOM captures only, leaving desktop
screen captures / pastes / uploads with no provenance at all.

**Invariant this plan establishes: the file tells the whole
story.** Every non-derivable ImageRecord field is persisted in the
image file itself. `MetadataCache` becomes what its name claims —
a rebuildable derived cache — and is never authoritative.

## Metadata inventory (the field-by-field audit)

### In the file — kept as-is

| Field | Carrier | Notes |
|---|---|---|
| `annot:version` | XMP | Bumped to `2.0`; now also **read back** (previously write-only) |
| `annot:annotations` | XMP | Annotations-only SVG layer |
| `annot:width` / `annot:height` | XMP | Canvas mounts without decoding |
| `annot:tags` | XMP | Opaque user/producer kv — stays open-ended |
| original bitmap | `svGo` chunk / APP2 | |
| element tree | `annot:elementTree` iTXt | Deflate YAML, own chunk |

### In the file — added (annot:version 2.0)

| Field | Why first-class |
|---|---|
| `annot:sourceUrl` | Capture provenance. Today cache-only ⇒ data loss. Elements panel / external-links depend on it. |
| `annot:createdAt` | ISO timestamp of capture/import. Today cache-only with mtime fallback ⇒ silently rewritten by copy/sync. |
| `annot:producer` | What created the file (`extension` / `desktop` / `web` / `vscode` / `annotator` / `mcp` / `playwright`). Today smuggled inconsistently as `tags.source` by some producers only. |
| `annot:dpr` | `devicePixelRatio` at capture. Today only inside `elementTree.viewport.scale`, so non-DOM captures (desktop screen / window / region) lose it. Capture-time fact, not derivable later. |

Promotion policy for `WELL_KNOWN_TAG_KEYS`: `source` → `producer`,
`capturedAt` → `createdAt` (first-class); `commit` / `screen` stay
tags (domain-specific). Producers stop writing the promoted keys
into `tags`; readers don't translate old tags (breaking-OK).

### Deliberately NOT in the file (derivable or positional)

| Field | Authority | Rationale |
|---|---|---|
| `path` / `folderPath` | Filesystem location | Location isn't content; moving a file must not rewrite bytes |
| `updatedAt` | File mtime | The FS already records it; duplicating invites skew |
| `thumbnailDataUrl` | Thumbnail cache | Derived, regenerable |
| listing arrays / backend ids / branch heads | MetadataCache | Store-internal bookkeeping, rebuildable by a walk |

### Cache demotion

`MetadataCache` keeps exactly its current role for speed (listing
without re-parsing XMP) but `getImage` reads `sourceUrl` /
`createdAt` from the packet, not the cache. Cache values are
refreshed FROM the packet on every `#refreshImageCache`, never the
reverse.

## Phases (one PR each, merged sequentially)

### Phase 1 — XMP schema 2.0 (core)

`packages/core/src/xmp/xmp-bytes.ts` + `xmp-browser.ts`:

- `buildXmp` gains `sourceUrl` / `createdAt` / `producer` / `dpr`
  (all optional; omitted elements are not emitted). Version string
  → `2.0`.
- `AnnotMetadata` gains the four fields plus `version`;
  `parseXmpToMetadata` extracts them (missing → `""` / `0`).
  XML-escape `sourceUrl` on write (it's the first free-text,
  non-CDATA field in the packet).
- `CreateEditablePngBytesOptions` + browser `createEditableImage`
  thread the new inputs.
- Unit tests: round-trip all four; absent-field defaults; escaping.
- `docs/metadata-format.md` — new canonical doc for the XMP packet
  (chunk layout, field table, version history), cross-linked from
  `docs/svg-format.md` and CLAUDE.md.

### Phase 2 — producers & stores write / read the new fields

- `packages/web/src/storage/image-encode.ts`
  (`buildEditableImageBlob`) passes `sourceUrl` / `createdAt` /
  `producer` / `dpr` from the record; `ImageRecord` gains optional
  `producer?` / `dpr?`.
- All four `StorageProvider` impls (`DeviceStore`, `DesktopStore`,
  `BrowserStore`, extension `IDBStore` if applicable) + vscode
  webview `encodeBytesForSave`: write the fields on save, and
  `getImage` returns `meta.sourceUrl` / `meta.createdAt` as the
  authority (cache as fallback for files saved before 2.0 — one
  `||`, not a migration layer).
- Capture entry points set `producer` + `dpr` + `createdAt` at the
  moment of capture (extension background, desktop `doCapture`,
  PWA capture/paste/upload, annotator/mcp/playwright pass-through).

### Phase 3 — index-time dimension probe

The remaining half of #1097's fix: `#refreshImageCache` in
`DeviceStore` / `DesktopStore` probes XMP-less files via the
shared `probeRasterDims` and caches real dimensions, so gallery
cards show dims uniformly instead of falling back to a date.

### Phase 4 — import filename normalization

`saveImage` normalizes the stored filename to the `.annot.<ext>`
double extension (`uploaded.png` → `uploaded.annot.png`) via a
shared Tier-A helper in `annot-core` used by all stores. Rationale:
the vscode host claims `*.annot.{svg,png,jpeg,jpg}` only — today an
uploaded file is first-class in the PWA/desktop but invisible to
the vscode custom editor. One identity rule: **Annot-managed files
carry the double extension AND the XMP packet.**

### Phase 5 — legacy layer removal

- Delete `.annot.json` sidecar constants + listing filters
  (`LEGACY_INDEX_FILE`) from DeviceStore / DesktopStore.
- Delete the desktop legacy-data notice (`maybeShowLegacyDataNotice`,
  `renderLegacyDataNotice`, the `extension.legacyDataInfo` IPC, the
  localStorage dismissal flag, associated CSS).

### Phase 6 — host parity polish

- Desktop error banner gains the Retry action (the SavePipeline
  callback already supplies it; the banner just drops it today).
- `SAVE_DEBOUNCE_MS` policy moves to a shared host-ui constant
  (local 500 ms / networked 1500 ms) instead of per-host literals.

## Out of scope (recorded, not forgotten)

- **Upload post-action divergence** (desktop auto-opens the editor,
  PWA stays in the gallery): a product decision, not a bug — needs
  an explicit call before unifying either way.
- npm-facing deprecations (product-docs aliases, the
  `/playwright` deprecated subpath): published-package breaking
  changes on their own announced schedule (0.5.0), unrelated to
  file compatibility.
- GitHubStore / GoogleDriveStore bespoke-cache consolidation: the
  deferred halves of `_done/shared-metadata-cache.md`, a separate
  track.
- `.annot.svg` provenance parity (root `data-annot-*` attributes
  for sourceUrl/createdAt): follow-up once 2.0 settles; the PNG XMP
  path is the canonical living-spec carrier (AD-09).

## Verification

Per phase: `pnpm -r typecheck`, `pnpm test`, `pnpm lint`, builds of
touched packages. Phases 2–4 additionally re-run the desktop +
vscode + web e2e suites — the XMP round-trip specs
(`png.spec.ts`, desktop `editor.spec.ts`) are the regression net
for the packet changes.
