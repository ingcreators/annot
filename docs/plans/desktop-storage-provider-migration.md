# Desktop: replace SQLite gallery with `DesktopStore` (StorageProvider)

> **Status:** Draft
>
> **Compatibility:** Replaces the desktop host's bespoke SQLite-backed
> gallery (`projects` + `images` tables in
> [`db.rs`](../../packages/desktop/src-tauri/src/db.rs); renderer-side
> [`gallery.ts`](../../packages/desktop/src/app/gallery.ts) +
> [`project-manager.ts`](../../packages/desktop/src/app/project-manager.ts)
> + 6 IPC commands across `commands/{projects,images,capture}.rs`)
> with a `DesktopStore` `StorageProvider` implementation backed by a
> filesystem library directory. `ImageRecord` metadata (tags, notes,
> source URL, annotations) is embedded in each file's XMP — exactly
> the model `DeviceStore`
> ([`packages/web/src/storage/device-store.ts`](../../packages/web/src/storage/device-store.ts))
> already uses for the PWA's "Device" mode (File System Access API)
> and `VSCodeStore` uses for the VSCode host.
>
> **No data migration.** Confirmed 2026-05-06: existing
> SQLite-rooted captures are NOT auto-imported into the new
> library. Users start fresh in `<userData>/library/`; the
> legacy `data/` directory is left in place for the user to
> back up or delete manually. Rationale: pre-release, the
> install in active use has only the auto-created `Default`
> project with no production data. Adding a migrator would
> spend implementation budget on a path that yields no user
> value here. (If a future user surfaces preserved-data
> requirements, a migrator is straightforward to add later as
> a separate plan — `DesktopStore` is its only dependency.)
>
> The desktop renderer's bespoke gallery UI
> (`gallery.ts` + `project-manager.ts`) is replaced by mounting the
> unified `<annot-file-manager-shell>` from
> `@ingcreators/annot-editor-shell` — the same gallery surface the
> PWA, VSCode host, and (eventually) the Tauri/Electron desktop all
> share once this plan lands.
>
> **Risk:** Largest UX-visible change to `packages/desktop` since its
> inception. Two categories of risk (data-migration risk is
> eliminated by skipping the migrator):
>
> 1. **UX regression** — the desktop's current gallery has its own
>    project picker, search, and tag-edit affordances. Replacing it
>    with `<annot-file-manager-shell>` means the desktop adopts the
>    PWA's gallery UX wholesale. Inventory in Phase 0 confirms
>    feature parity (or surfaces gaps to address before cutover).
> 2. **Path-based-storage compliance** — the desktop has been the
>    holdout since [`_done/path-based-storage.md`](./_done/path-based-storage.md)
>    landed. This plan brings it into compliance. The risk is
>    discovering that the bespoke desktop gallery exposed
>    workflows that don't translate cleanly to path-based;
>    Phase 0's audit catches this.
>
> Phases 0–3 are pure additions (DesktopStore lives alongside the
> SQLite stack); Phase 4 flips the default. Phase 5 deletes the
> SQLite + bespoke-gallery code paths.

## Context

### Current state (Tauri host)

- **SQLite at [`db.rs:34`](../../packages/desktop/src-tauri/src/db.rs:34)**
  with two tables:
  - `projects` (id / name / description / timestamps; default
    project pre-inserted as id=1)
  - `images` (id / project_id FK / filename / path / svg_path /
    width / height / thumbnail_path / tags JSON / source_url /
    notes / timestamps)
- **6 IPC commands** that own image lifecycle:
  - `list_projects` / `create_project` / `delete_project`
  - `list_images` / `update_image` / `delete_image`
  - `save_screenshot` (capture from extension or in-app) — writes
    file to `data/project_<id>/`, generates thumbnail, INSERTs
    image row
  - `check_incoming` — sweeps `data/incoming/*.json` (extension
    handoff payloads) into the project library
- **Renderer-side bespoke gallery** in
  [`packages/desktop/src/app/gallery.ts`](../../packages/desktop/src/app/gallery.ts)
  (~230 LOC) +
  [`project-manager.ts`](../../packages/desktop/src/app/project-manager.ts)
  (~99 LOC) — renders project picker, image grid, tag editor,
  delete affordances. Talks to Tauri IPC directly via the
  generated wrappers in
  [`packages/core/src/utils/tauri-bridge.ts`](../../packages/core/src/utils/tauri-bridge.ts:64-102).
- **No `StorageProvider` mounted** — the desktop renderer never
  goes through `getStorage()` for gallery operations. The
  CLAUDE.md guardrail #3 ("`StorageProvider` is the only way in")
  is the goal state, not the current state.

### Why this is a holdout

The SQLite gallery predates the path-based-storage refactor. When
[`_done/path-based-storage.md`](./_done/path-based-storage.md)
landed, every other StorageProvider implementation
(`BrowserStore`, `DeviceStore`, `DriveStore`, `GitHubStore`,
`VSCodeStore`) migrated from numeric IDs to path-based
identification — but the desktop's SQLite implementation sat
outside the StorageProvider surface and so wasn't touched. It
has stayed numeric-ID-keyed ever since.

This is fine in isolation, but causes friction:

- The desktop renderer's gallery code can't reuse any UI from
  `@ingcreators/annot-editor-shell` /
  `@ingcreators/annot-web` — every other host gets the unified
  `<annot-file-manager-shell>` for free; desktop reimplements.
- New gallery features (search refinements, sort orders, batch
  rename, multi-select bulk-edit, plugin-registered tabs from
  [`_done/plugin-sidebar-tabs.md`](./_done/plugin-sidebar-tabs.md))
  all skip the desktop unless someone manually back-ports them.
- The bespoke desktop gallery has its own thumbnail lifecycle
  (in `commands/capture.rs:save_screenshot` — generates a
  per-image thumbnail at save time and writes the path back to
  the row). The unified `ThumbnailManager` from
  [`_done/unified-thumbnail-cache.md`](./_done/unified-thumbnail-cache.md)
  lives outside the desktop's reach.

### Why it matters now

Two upstream consumers benefit immediately:

1. **The Electron migration**
   ([`desktop-electron-migration.md`](./desktop-electron-migration.md))
   shrinks dramatically when this plan lands first. Phase 1 of
   that plan ("DB + projects + images IPC parity") becomes
   essentially empty: there's no DB to port (gone), no projects
   IPC (folders are filesystem dirs), no images IPC (operations
   route through `DesktopStore` which talks to fs directly via
   the renamed `desktop-bridge`'s fs primitives). The Electron
   surface to port shrinks to: screen capture, Office clipboard,
   XMP read/write helpers (already used by `DeviceStore` analogue),
   tool presets, http server, window controls, file system fs
   primitives. That's a much smaller cross-language port.
2. **A future "desktop hosts the editor shell directly" plan**
   becomes natural: once `DesktopStore` is in place, the desktop
   renderer can mount `EditorShell` against it the same way the
   PWA does, completing the convergence the
   [`_done/editor-session-shell-switchover.md`](./_done/editor-session-shell-switchover.md)
   work started.

### What template are we following?

**`DeviceStore`** ([device-store.ts](../../packages/web/src/storage/device-store.ts)).
Its file-level docstring describes exactly the model the desktop
should adopt:

> Annot-native captures are saved as `annot-<ts>.annot.jpg|png`;
> images coming from outside (dropped into the folder by other
> tools, or imported with an explicit filename) keep their
> original name. Annotations, tags, and original image are
> stored as XMP metadata inside each file. Subfolders on disk =
> gallery folders.

The only thing `DesktopStore` changes is the **filesystem
adapter**: `DeviceStore` uses `FileSystemDirectoryHandle` (browser
API), `DesktopStore` uses Node `fs/promises` exposed via
Tauri/Electron IPC. Everything above the adapter — XMP read/write,
path validation, uniquification on save, `ImageRecord` round-trip,
`ThumbnailManager` integration, contract-test compliance — is
either inheritable or reimplementable from the same
[`device-fs.ts`](../../packages/web/src/storage/device-fs.ts) seam.

## Design

### File system layout

`<userData>/library/` is the new library root.

```
<userData>/library/
  Inbox/                                  ← default folder
    annot-2026-05-06T03-21-44.annot.png  ← annotated capture (XMP-embedded)
    screenshot-from-extension.jpg         ← incoming, original name preserved
  Project A/
    annot-...annot.jpg
    annot-...annot.png
  Project B/
    Subfolder/
      annot-...annot.png
```

Annotated captures use the `*.annot.{png,jpg}` suffix that
`DeviceStore` already writes. Plain images keep their incoming
name. Subfolders on disk are gallery folders 1:1.

`<userData>` resolves via the platform-native location (Tauri's
`portable_dir()/data/` on the current build,
`app.getPath('userData')` on Electron). On first launch the
library directory is created empty (as `Inbox/`); no
auto-import from the legacy `data/project_<id>/` layout
happens.

### Metadata: per-file XMP

Tags / notes / source URL / annotations all live in XMP **inside**
the image file:

- PNG: iTXt chunk keyed `XML:com.adobe.xmp` (existing
  [`xmp.rs`](../../packages/desktop/src-tauri/src/commands/xmp.rs)
  + the eventual JS-side port already do this).
- JPEG: APP1 segment with `http://ns.adobe.com/xap/1.0/` prefix
  (same source).
- Annotated images use the `annot:` namespace established by
  `xmp.rs:XMP_NS_URI` (`https://ingcreators.com/annot/ns/1.0/`).

This is the same scheme `DeviceStore` reads/writes. The host
doesn't need a sidecar `.json` per file (which simplifies the
filesystem reality the user sees) and the metadata travels with
the file when the user copies / moves / shares it.

The single point of integration is a `desktop-fs.ts` module
(parallel to `device-fs.ts`) that exposes:

```ts
export interface DesktopFs {
  readDir(path: string): Promise<DesktopFsEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<DesktopFsStat | undefined>;
}
```

The implementation calls Tauri's `tauri-plugin-fs` today; in the
Electron migration it swaps to `ipcRenderer.invoke('fs.*', …)`
backed by Node `fs/promises`. Both sit under the same TS seam, so
`DesktopStore` itself doesn't change at the Electron cutover.

### `DesktopStore` shape

```ts
export class DesktopStore implements
    StorageProvider,
    StorageWithThumbnailCache,
    StorageWithResync {

  constructor(private fs: DesktopFs, private libraryRoot: string) {}

  async saveImage(record: Omit<ImageRecord, "path">,
                  opts?: { filename?: string }): Promise<string>;
  async getImage(path: string): Promise<ImageRecord | undefined>;
  async listImages(folderPath: string): Promise<ImageRecord[]>;
  async updateImage(path: string, update: ImageRecordUpdate): Promise<void>;
  async deleteImage(path: string): Promise<void>;
  async listFolders(folderPath: string): Promise<FolderRecord[]>;
  async createFolder(parentPath: string, name: string): Promise<string>;
  async renameFolder(path: string, newName: string): Promise<string>;
  async moveFolder(srcPath: string, destParentPath: string): Promise<string>;
  async deleteFolder(path: string): Promise<void>;
  async renameImage(path: string, newName: string): Promise<string>;
  async moveImage(srcPath: string, destFolderPath: string): Promise<string>;
  // … plus the thumbnail-cache + resync surface area
}
```

Most methods route into the corresponding `DesktopFs` call plus
the XMP read/write helpers. The contract-test in
[`device-store.contract.test.ts`](../../packages/web/src/storage/device-store.contract.test.ts)
gets a sibling `desktop-store.contract.test.ts` reusing
[`contract.test-helpers.ts`](../../packages/web/src/storage/contract.test-helpers.ts)
— the same harness the Browser / Device / GitHub backends use.

### Renderer integration

The desktop renderer mounts the unified gallery instead of its
bespoke implementation:

- `packages/desktop/src/app/gallery.ts` (230 LOC) → deleted.
- `packages/desktop/src/app/project-manager.ts` (99 LOC) →
  deleted.
- `packages/desktop/src/app/app.ts` swaps the imports and
  mounts `<annot-file-manager-shell>` (Lit component from
  `@ingcreators/annot-editor-shell`), passing it the
  `DesktopStore` instance produced by the new
  `packages/desktop/src/storage/bootstrap.ts`.
- The path-based URL routes (`/edit/desktop/...`) are
  registered in the storage `bridge.ts` with the same shape
  PWA / Device / GitHub already use.

The `tauri-bridge.ts` exports for `listProjects` /
`createProject` / `deleteProject` / `listImages` /
`updateImage` / `deleteImage` / `saveScreenshot` /
`loadScreenshot` / `checkIncoming` are removed from the
public API. The Tauri commands themselves stay registered for
one cycle (Phase 4 cutover) so a rollback path exists; Phase 5
deletes them.

### Capture → save flow (after cutover)

Today: extension hits `localhost:19530/capture` → Rust HTTP
server emits `capture-from-extension` event → renderer's
listener calls `saveScreenshot(dataUrl, projectId)` → Rust
writes file + INSERT row + thumbnail.

After cutover: extension hits `localhost:19530/capture` →
Rust HTTP server emits the same event → renderer's listener
calls `desktopStore.saveImage({ ... })` → DesktopStore writes
the file (with XMP), `ThumbnailManager` lazily produces the
thumbnail on first display.

Result: one storage path, no schema duplication, the
thumbnail lifecycle is the unified one.

### Folders ≠ projects: a UX simplification

The current desktop has a "Project" abstraction with an
explicit picker. After cutover, projects ARE folders — there's
no separate concept. Users see their library as a tree of
folders, with the default "Inbox" folder serving as the
landing place for incoming captures (the equivalent of
today's `id=1, name='Default'` project).

### Thumbnails

Today: thumbnail PNG generated at save time by
`commands/capture.rs:generate_thumbnail`, path persisted in
`images.thumbnail_path`. Loaded directly via
`load_screenshot(thumbnail_path)`.

After: `ThumbnailManager` produces thumbnails lazily from the
full image, caches them in `IndexedDBThumbnailCache` (the
unified cache established by
[`_done/unified-thumbnail-cache.md`](./_done/unified-thumbnail-cache.md)).
The on-disk per-image thumbnail file is no longer written.
Orphaned `thumb_*.{png,jpg}` files in the legacy `data/`
directory are not touched — the user manages that directory
manually since no migrator runs.

## Phased plan

Each phase is one PR per CLAUDE.md's "one PR per phase" rule.
Phases 0–3 are additive — `DesktopStore` lives alongside the
SQLite stack and a feature flag toggles between them. Phase 4
is the cutover. Phase 5 deletes the legacy code.

### Phase 0 — feature audit + design freeze

- **No code changes**, deliverable is a markdown audit at
  `docs/plans/desktop-storage-provider-audit.md` (reviewed,
  then deleted on archival to `_done/`).
- Walk every UI affordance the bespoke gallery ships
  (project picker, search, tag editor, delete confirmation,
  thumbnail layout, sort order, multi-select, drag-and-drop)
  and confirm parity in `<annot-file-manager-shell>` —
  flagging gaps for follow-up before cutover. The current
  `<annot-file-manager-shell>` already covers most of these
  for PWA / VSCode; the audit confirms desktop-specific
  affordances (e.g. project picker → folder breadcrumb)
  translate cleanly.
- Confirm the resolved decisions (sequencing, per-file XMP
  metadata, `<userData>/library/` root) match the user's
  understanding before locking implementation in.
- No data-migration design needed — confirmed there's no
  legacy data to preserve.

**Verify**: audit doc reviewed by user; gaps in
`<annot-file-manager-shell>` either accepted or follow-up
issues filed.

### Phase 1 — `DesktopStore` core + contract tests

- `packages/desktop/src/storage/desktop-fs.ts` — the `DesktopFs`
  interface + a Tauri-backed implementation calling
  `tauri-plugin-fs`. Pure file-system primitives (no XMP
  knowledge yet).
- `packages/desktop/src/storage/desktop-store.ts` — the
  `DesktopStore` class implementing `StorageProvider` +
  `StorageWithThumbnailCache` + `StorageWithResync`. Methods
  call into `DesktopFs` and reuse the same XMP read/write
  primitives `DeviceStore` does (factor those out of
  `device-store.ts` if needed — likely a small refactor in
  `packages/core/src/xmp/` to widen the seam).
- `packages/desktop/src/storage/desktop-store.contract.test.ts`
  — exercises every `StorageProvider` method against an
  in-memory `DesktopFs` mock using the shared
  `contract.test-helpers.ts`.
- The store is **not yet wired into the bridge** — only
  buildable + testable in isolation.

**Verify**: contract tests green; `pnpm -r typecheck` green;
unit-test only — no UI integration yet.

### Phase 2 — bridge wiring + parallel mount (feature flag)

- Register `DesktopStore` as a storage backend in the
  `packages/web/src/storage/bridge.ts` style — adding a
  `desktop` storage mode (analogous to `device` / `browser`
  / `github` / `drive`).
- Wire bootstrap in `packages/desktop/src/storage/bootstrap.ts`
  that constructs the store from `<userData>/library/` and
  registers it with `bridge.ts`.
- Add a feature flag (`localStorage.annotDesktopStorageMode`
  = `"sqlite" | "fs"`, default `"sqlite"`) that the desktop's
  `app.ts` consults at startup. When `"fs"`, the renderer
  mounts `<annot-file-manager-shell>` against `DesktopStore`
  instead of the bespoke gallery.
- The bespoke gallery + project manager remain in place;
  toggling the flag is a developer affordance for QA.

**Verify**: with the flag set, the unified gallery loads, can
list folders, can create a folder, can save / read / list /
update / delete an image (round-trip via XMP). Both flag
states coexist without crashing.

### Phase 3 — capture pipelines route through `DesktopStore`

- The renderer's `capture-from-extension` handler — when the
  flag is on — calls `desktopStore.saveImage(...)` instead of
  the legacy `saveScreenshot` Tauri IPC.
- Same for the in-app capture entry points (`capture_screen`,
  `capture_window`, `capture_region`, capture-overlay region
  result) — the screenshot bytes go through `saveImage` after
  capture.
- `check_incoming` (extension handoff sweeper) no longer
  inserts DB rows; it `saveImage`s into `Inbox/` and removes
  the source files from `data/incoming/`.
- The legacy IPC commands + DB stay in place for users who
  haven't flipped the flag yet.

**Verify**: with the flag on, captures from all six entry
points (extension HTTP, full screen, window, region, area
overlay, drag-drop import) land as files in
`<userData>/library/Inbox/` with correct XMP metadata. Tags
applied via the unified gallery round-trip on next load.

### Phase 4 — flag flip to default + legacy-data documentation

- Default-flips the feature flag: new launches default to
  `"fs"` (DesktopStore). A "rollback to legacy gallery"
  toggle stays in the desktop's settings UI for one release
  cycle as the rollback path.
- Replace the bespoke gallery's launch sites with the
  unified shell unconditionally for the `"fs"` codepath; the
  bespoke files stay in the tree (referenced only from the
  rollback codepath) until Phase 5.
- The new library at `<userData>/library/` is created empty
  (`Inbox/` only) on first launch. **No auto-import** of the
  legacy `data/project_<id>/` layout.
- A one-time first-launch toast/dialog notes that the
  legacy data is at `<portable_dir>/data/` (path shown
  literally, with a "Reveal in Finder/Explorer" affordance
  on supported platforms) so users who have meaningful
  captures there can back them up or import them manually.
  The toast does NOT delete the legacy directory — the user
  owns that decision.

**Verify**: with the flag at default, a clean upgrade from
the SQLite-era build opens the desktop into an empty
`Inbox/` library. The legacy-data toast surfaces once; the
legacy `data/` directory is untouched. New captures from
all six entry points land correctly in the new library.
The rollback toggle, when flipped, shows the bespoke
gallery against the unchanged legacy `data/`.

### Phase 5 — delete SQLite + bespoke gallery + IPC commands

- Delete `packages/desktop/src/app/gallery.ts`.
- Delete `packages/desktop/src/app/project-manager.ts`.
- Delete `commands/projects.rs`, `commands/images.rs`, and the
  DB-touching parts of `commands/capture.rs`. The
  `save_screenshot` / `load_screenshot` / `check_incoming`
  Tauri IPC commands are removed; the renderer no longer
  calls them.
- Delete `db.rs`, `Database`, `rusqlite` from `Cargo.toml`.
- Remove the `listProjects` / `createProject` / `deleteProject`
  / `listImages` / `updateImage` / `deleteImage` /
  `saveScreenshot` / `loadScreenshot` / `checkIncoming`
  exports from `tauri-bridge.ts` (and from the
  `desktop-bridge.ts` rename in the Electron-migration plan,
  if that's already merged).
- Delete the "rollback to legacy gallery" toggle from the
  settings UI; the legacy gallery codepath is gone.
- The legacy `data/` directory remains untouched. If the
  user has not deleted it manually, the desktop simply
  ignores its existence — Phase 4's one-time toast is the
  only mention this plan ever surfaces.
- Update CLAUDE.md monorepo-layout `desktop` row to drop the
  "SQLite-backed" framing.

**Verify**: `pnpm -r typecheck`, `pnpm test`, `pnpm lint`,
`pnpm --filter @ingcreators/annot-desktop build` all green.
The Tauri build no longer pulls `rusqlite` or the `image`
crate's thumbnail path. Manual: a clean install on a fresh
profile shows an empty `Inbox/`, captures land there
correctly, no DB file is created.

## Verification

Whole-plan acceptance criteria:

- `DesktopStore` passes the same contract-test suite as
  `BrowserStore` / `DeviceStore` / `VSCodeStore` / `GitHubStore`
  (every `StorageProvider` method's documented behaviour
  exercised + every `Storage*Error` class properly thrown).
- The unified gallery (`<annot-file-manager-shell>`) operates
  identically on the desktop as on the PWA against
  `DeviceStore` (modulo the FSA-permission-grant prompt).
- After Phase 4 cutover, a clean upgrade from the SQLite-era
  build opens an empty `Inbox/` library at
  `<userData>/library/`; the legacy `data/` directory is
  untouched on disk; the one-time legacy-data toast surfaces
  exactly once and the path it shows resolves on the
  user's system.
- New captures from all six entry points (extension HTTP
  push, full-screen, window, region, area-overlay, drag-drop
  import) round-trip via `DesktopStore.saveImage` →
  per-file XMP → next-load-via-`getImage` with identical
  tags / source URL / annotations.
- `pnpm -r typecheck` / `pnpm test` / `pnpm lint` all green
  after each phase.
- `pnpm --filter @ingcreators/annot-desktop build` produces
  a working Tauri (and, post-Electron-migration, Electron)
  bundle at every phase boundary.
- After Phase 5, no `rusqlite` import remains; the desktop
  build no longer requires SQLite.

## Migration notes

- **User data**: no auto-import. The legacy `data/` directory
  remains in place; the user owns the back-up / delete
  decision. Phase 4's one-time toast surfaces the path so
  the user can locate it. Rollback via the "legacy gallery"
  toggle is supported for one release cycle (Phase 5 deletes
  it). Pre-release context: the install in active use today
  has no production captures, so the cost of skipping the
  migrator is zero in practice.
- **`PageMetadata` schema**: untouched; this plan is
  storage-side only. CLAUDE.md guardrail #4 holds.
- **`StorageProvider`**: `DesktopStore` is a new implementation
  of the existing interface, no shape changes. CLAUDE.md
  guardrail #3 ("`StorageProvider` is the only way in") is
  *enforced* by this plan rather than violated. No new
  optional methods are added.
- **SVG schema**: untouched. CLAUDE.md guardrail #1 holds; no
  `data-annot-version` bump.
- **Path-based-storage**: this plan completes the desktop's
  delayed migration to path-based identification; numeric IDs
  disappear from the desktop surface entirely.
- **Forward-looking**:
  - **Sequencing recommendation**: land this plan **before**
    [`desktop-electron-migration.md`](./desktop-electron-migration.md).
    Reason: the Electron migration's Phase 1 ("DB + projects
    + images IPC parity") shrinks to "fs primitives only"
    once SQLite is gone, removing the largest cross-language
    port (the `rusqlite` → `better-sqlite3` translation, the
    `Mutex<Connection>` → JS-side equivalent, the SQL DDL
    + queries, the `last_insert_rowid` semantics). Concretely,
    after this plan: Electron Phase 1 covers `fs.read` /
    `fs.write` / `fs.list` / `fs.mkdir` / `fs.rename` /
    `fs.unlink` IPC handlers — a tiny module with no
    storage-format concerns.
  - **Convergence to "desktop hosts EditorShell directly"**:
    once `DesktopStore` is in place, a future plan can
    replace the desktop's per-image editor session boot with
    the same `EditorShell.mountFromRecord` path the PWA uses
    after [`_done/editor-session-shell-switchover.md`](./_done/editor-session-shell-switchover.md).
    That removes the last seam where the desktop renderer
    differs from PWA / VSCode at the EditorShell level.
  - **Plugin storage backends**: every plugin-registered
    storage backend (per
    [`_done/plugin-storage-registration.md`](./_done/plugin-storage-registration.md))
    automatically becomes available to the desktop once
    the desktop renderer goes through `bridge.ts`. The
    `annot-cloud` pointer-commit store, in particular,
    can land on the desktop with no extra work.

## Resolved decisions

- **Sequencing**: this plan lands first; the Electron migration
  follows. Confirmed 2026-05-06.
- **Metadata storage**: per-file XMP, matching `DeviceStore`.
  Confirmed 2026-05-06.
- **Library root location**: `<userData>/library/` (OS
  conventions). Confirmed 2026-05-06. Rationale: works for
  non-admin installs and survives auto-update across
  versions on every platform —
  - Windows: `%APPDATA%/Annot/library/`
  - macOS: `~/Library/Application Support/Annot/library/`
  - Linux: `~/.config/Annot/library/`
  Pairs with a per-user app install
  (`electron-builder`'s `nsis: { oneClick: true,
  perMachine: false }` on Windows, `~/Applications/` on
  macOS, AppImage on Linux) so the entire stack works
  without admin rights. Auto-update writes only the install
  dir, never `userData`, so the library is preserved across
  updates by definition. A future "portable mode"
  (`<exe-dir>/library/` fallback) is out of scope for v1
  but the directory-resolution logic is structured so that
  enabling it later is a single check.
- **Data migration**: none — confirmed 2026-05-06. The
  pre-release install has no production captures worth
  preserving; spending budget on a migrator yields no user
  value. The legacy `data/` directory is left untouched on
  disk; Phase 4's one-time toast tells the user where it
  lives so they can back up or delete manually. Project-name
  → folder-name sanitisation is moot under this decision:
  there are no project names to map, only an empty `Inbox/`
  to create.
