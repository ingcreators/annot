# Desktop StorageProvider migration — Phase 0 audit

> **Status:** Done (2026-05-06)
>
> **Companion to:** [`desktop-storage-provider-migration.md`](./desktop-storage-provider-migration.md)
>
> **Lifecycle:** This is the Phase 0 deliverable per the parent
> plan's "feature audit + design freeze" task. After the user
> reviews and the implementation moves into Phase 1, archive this
> file alongside the parent under `_done/` (or delete it; the
> findings will have been folded into the parent plan if any
> require design changes).

## Scope

Confirm parity (or surface gaps) between:

1. The bespoke desktop gallery / project manager that the
   migration replaces:
   - [`packages/desktop/src/app/gallery.ts`](../../packages/desktop/src/app/gallery.ts)
     (~230 LOC) — project picker + search + thumbnail grid +
     delete affordance.
   - [`packages/desktop/src/app/project-manager.ts`](../../packages/desktop/src/app/project-manager.ts)
     (~99 LOC) — modal dialog for create / delete / list
     projects.
   - The 6 IPC commands feeding them
     ([`commands/projects.rs`](../../packages/desktop/src-tauri/src/commands/projects.rs),
     [`commands/images.rs`](../../packages/desktop/src-tauri/src/commands/images.rs),
     [`commands/capture.rs`](../../packages/desktop/src-tauri/src/commands/capture.rs)).

2. The unified gallery surface the migration mounts in its
   place:
   - [`<annot-file-manager-shell>`](../../packages/web/src/gallery/file-manager-shell.ts)
     — breadcrumb + refresh + view-mode toggle + selection bar +
     footer.
   - [`FileManager`](../../packages/web/src/gallery/file-manager.ts)
     orchestrator — sidebar + main content + breadcrumb wiring.
   - [`<annot-sidebar>`](../../packages/web/src/gallery/sidebar.ts)
     — storage tree + folder tree + "New" menu.
   - [`<annot-gallery-page>`](../../packages/web/src/gallery/annot-gallery-page.ts)
     — folder + file grid with multi-select / context menu /
     keyboard nav.

The exit criterion the parent plan names is "audit doc reviewed
by user; gaps in `<annot-file-manager-shell>` either accepted or
follow-up issues filed."

## Affordance inventory

### Bespoke desktop gallery

The desktop today exposes — combining the in-app
[`gallery-view`](../../packages/desktop/index.html) DOM and the
JS in `gallery.ts` / `project-manager.ts`:

| Affordance | Surface | Notes |
|---|---|---|
| **Project picker** | Native `<select>` in the gallery header (`gallery.ts:38–54`) | Lists `All projects` + every row from `list_projects` (with `(image_count)` suffix). Switching reloads the grid. |
| **Project manager modal** | `project-manager.ts` (top-right "Projects" button injected at `app.ts:459`) | Lists projects with image counts; lets the user create a new project (text input + Enter / Add) and delete non-default projects. Default project (id=1) is undeletable. |
| **Search** | `<input>` in the gallery header (`gallery.ts:57–70`) | 300 ms debounce. Server-side `LIKE` over `filename` / `tags` / `notes` (`commands/images.rs:32–53`). |
| **Thumbnail grid** | `gallery.ts:114–184` | One DIV per row in `images`. Lazy-loaded `<img>` reads `thumbnail_path` via the Tauri asset protocol with a `loadScreenshot` fallback. Card label is `filename`; meta line is `WxH • date`. |
| **Per-card delete** | × button in `gallery-item-info` (`gallery.ts:167–175`) | No confirm dialog. Calls `delete_image(id)` and refreshes locally. |
| **Single-click open** | `gallery.ts:180` | Loads the full image via `loadScreenshot(path)` and swaps to `editor-view`. |
| **Action bar buttons** | `index.html:42–48` | Capture Screen / Window / Region (Tauri-only), Open Image, Paste from Clipboard. |
| **Capture entry points** | `app.ts:355–396` | (a) `capture_screen`, (b) `capture_window` via overlay, (c) `capture_region` via overlay, (d) `chrome-capture` event from the Rust HTTP server, (e) `check_incoming` poll for Native-Messaging handoff, (f) `paste` keyboard event in gallery view. All six end up calling `saveScreenshot(dataUrl, activeProjectId())`. |
| **Active project tracking** | `gallery.ts:21–23` + `app.ts:340–342` | Selected project ID is the save target for every capture/paste from the gallery view. Defaults to `1` when "All projects" is selected. |
| **Empty state** | `gallery.ts:186–192` | "No screenshots yet. Use the Chrome extension to capture, or open an image file." |

### `notes` field — present in the schema, not exposed in the UI

The `images.notes` column exists in
[`db.rs:45`](../../packages/desktop/src-tauri/src/db.rs:45) and
is searched alongside `filename` / `tags` in `list_images`
(`commands/images.rs:33`), but no renderer-side code reads or
writes it — `gallery.ts` and `project-manager.ts` never
reference the field. **Sunset cleanly:** the `ImageRecord` shape
the unified gallery operates on has no `notes` field either, so
dropping the column at Phase 5 is a no-op for any code that
exists today.

### Tag editor

Bespoke desktop gallery has **no tag editor surface**. The
schema persists tags as a JSON string
([`commands/images.rs:43`](../../packages/desktop/src-tauri/src/commands/images.rs:43))
and `update_image` accepts a tag-edit payload, but no UI in
`gallery.ts` / `project-manager.ts` calls it. Captured images
arrive with `tags = '[]'` and stay that way.

The unified gallery DOES surface tags — both as the
`drawer.tags` editor in the file-details drawer
([`packages/editor-shell/src/drawer-sections/tags-section.ts`](../../packages/editor-shell/src/drawer-sections/tags-section.ts))
and as `gallery-tag-chips` on each card
([`annot-gallery-page.ts:261–269`](../../packages/web/src/gallery/annot-gallery-page.ts:261)),
plus tag-aware search via `tagKey:value` syntax
([`annot-gallery-page.ts:824–842`](../../packages/web/src/gallery/annot-gallery-page.ts:824)).
The migration is a **net feature gain**, not a parity break.

### `<annot-file-manager-shell>` + `<annot-sidebar>` +
`<annot-gallery-page>` capabilities

| Affordance | Where it lives | Notes |
|---|---|---|
| **Breadcrumb navigation** | `file-manager-shell.ts:106–145` | Full ancestor chain rendered as buttons; root label keyed off the storage mode. The desktop adds the `desktop` mode → `"Annot library"` (or similar) here. |
| **Folder tree (sidebar)** | `sidebar.ts:541–625` | Recursive, expand/collapse, ARIA-tree semantics, keyboard nav (Enter / Space / Arrow). |
| **Storage chip strip** | `sidebar.ts:339–398` | One chip per backend; the `desktop` mode lands here. Plugin backends piggy-back on the same renderer. |
| **"New" menu** | `sidebar.ts:450–515` | New Folder / Upload Image / Capture Screen / Timed Capture / Paste from Clipboard. Each item is gated on host capability (e.g. `isScreenCaptureSupported()`). |
| **Refresh button** | `file-manager-shell.ts:117–123` | Calls the storage's `forceRefresh()` (or `resync()` fallback) + reloads the grid. |
| **View-mode toggle** | `file-manager-shell.ts:124–144` | Grid / List modes share the same `<annot-gallery-page>` instance. |
| **Search** | `file-manager.ts:127–140` + `annot-gallery-page.ts:288–316` | Recursive across the current folder + descendants when the input has text; collapses back to direct children when cleared. Tag-key search supported. |
| **Thumbnail grid** | `annot-gallery-page.ts:226–280` | Cards include filename + dimensions + date + tag chips. Folders rendered as separate cards in the same grid. |
| **Folder cards** | `annot-gallery-page.ts:193–224` | Same multi-select / context-menu / keyboard model as image cards. |
| **Multi-select** | `annot-gallery-page.ts:751–803` | Click / Cmd-click / Shift-click semantics; selection bar replaces the breadcrumb when active and offers a Delete bulk action. |
| **Per-card "more" menu** | `annot-gallery-page.ts:545–626` | Folder: Open / Rename / Delete. Image: Open / Rename / Delete. Right-click and the explicit `more_vert` button both open it. |
| **Confirm dialogs on destructive ops** | `annot-gallery-page.ts:417–456` | Shared `showConfirmDialog` — desktop currently has no confirm (silent delete). |
| **Empty state** | `annot-gallery-page.ts:138–146` | Two variants: "No images yet" vs "No matches found" depending on whether a query is active. |
| **Folder ops** | `annot-gallery-page.ts:629–689` | Create / rename / delete fall through `StorageProvider.{createFolder,renameFolder,deleteFolder}`. |
| **Keyboard nav** | `annot-gallery-page.ts:488–504, 559–615` | Escape clears selection; Enter opens; Space toggles selection; Tab cycles cards. |

## Mapping desktop affordances → unified shell

| Desktop affordance | Unified-shell equivalent | Status |
|---|---|---|
| Project picker (`<select>` in header) | Folder breadcrumb + Folder tree in sidebar | **Replaced**, not gap. Projects → folders, navigation lives in the sidebar tree + breadcrumb, the selected folder is the implicit "active project" for new captures. |
| Project manager modal (create / delete) | "New > New Folder" in the sidebar; Delete via folder context menu | **Replaced**. No modal — folder creation lives next to where folders are listed. |
| Default project semantics (id=1, undeletable) | Default `Inbox/` folder; not pinned as undeletable today | **Minor gap (acceptable).** The unified shell does not protect any folder from deletion. The plan's Phase 4 creates `Inbox/` empty on first launch; if the user deletes it, the next capture re-creates it (`saveImage` falls back to root then; see follow-up below). |
| Server-side search over filename / tags / notes | Client-side recursive search over `path` / `sourceUrl` / tags | **Replaced**. Search is now per-tag-key (`status:reviewing`) and substring on path / source URL. `notes` is dropped (column was already orphaned from the UI). |
| Thumbnail grid (320×180 PNG generated at save) | `ThumbnailManager` lazy + IDB-cached | **Replaced** by the unified cache (`_done/unified-thumbnail-cache.md`). The migration plan covers the on-disk thumbnail file becoming dead data in Phase 5. |
| Per-card delete (no confirm) | Per-card delete via context menu (with confirm dialog) | **Behaviour change, acceptable.** Adds a confirm step. Matches PWA / VSCode behaviour. |
| Single-click open | Double-click open (single-click selects) | **Behaviour change.** The unified gallery follows Drive-style single-click-selects / double-click-opens. Worth surfacing to the user — desktop users who muscle-memoried single-click-opens will notice. |
| Capture-entry-point routing through `saveScreenshot` | Capture-entry-point routing through `desktopStore.saveImage` | **Replaced** by Phase 3 of the parent plan. |
| Active-project tracking on `gallery.currentProjectId` | Active-folder tracking on `FileManager.currentFolderPath` | **Replaced**. Same shape, path-based instead of id-based. |
| Empty state copy | Empty state copy (different wording) | **Behaviour change, cosmetic.** "No images yet. Upload an image or capture with the extension." vs the desktop's current "No screenshots yet. Use the Chrome extension to capture, or open an image file." Acceptable. |
| Header action buttons (Capture Screen / Window / Region / Open Image / Paste) | "New" menu in sidebar (Capture Screen / Timed Capture / Upload Image / Paste from Clipboard) + (no built-in equivalent for Window / Region) | **Partial gap.** See "Capture-mode coverage" below. |

### Gaps that need a decision before Phase 1

1. **Capture-mode coverage in the "New" menu.** The unified
   sidebar's "New" menu offers Capture Screen / Timed Capture /
   Paste from Clipboard, but **does not surface "Window" or
   "Region"** — those are desktop-only modes the PWA can't
   express because it's bound to `getDisplayMedia`. The desktop
   needs all three modes (full-screen / window / region).
   - **Options:**
     - (A) Inject the additional menu items via the
       `getSidebarTabs` / "New" menu extension surface, if the
       sidebar exposes one (it does not today — the menu items
       are hardcoded in `sidebar.ts:469–494`).
     - (B) Keep an extra desktop-only action row in the
       `index.html` shell (outside the unified gallery) for
       Window / Region. Cleanest in the short term; matches the
       fact that those buttons live in the desktop-shell area
       today.
     - (C) Extend the sidebar's "New" menu with a host-supplied
       extra-items callback (`getNewMenuExtras?: () =>
       NewMenuItem[]`). This is the path that keeps the desktop
       inside the unified gallery's chrome and is the right
       follow-up if we want Electron / future hosts to share
       the affordance.
   - **Recommendation:** Pick (B) for Phase 2 (smallest blast
     radius), file (C) as a follow-up before deleting the
     bespoke header in Phase 5. Leaving (B) in place permanently
     is also fine if the host-extras hook never becomes worth it
     for other consumers.

2. **`<annot-file-manager-shell>` + `FileManager` are
   `@ingcreators/annot-web`-resident, not
   `@ingcreators/annot-editor-shell`.** The parent plan's
   Design / Renderer-integration section says "mounts
   `<annot-file-manager-shell>` (Lit component from
   `@ingcreators/annot-editor-shell`)." Today the unified
   gallery shell, sidebar, gallery-page, and file-manager
   orchestrator all live under
   [`packages/web/src/gallery/`](../../packages/web/src/gallery/).
   The `editor-shell` package only re-exports the editor
   surface (toolbar / drawer / right-panel / scratchpad /
   status bar). The desktop's `package.json` already depends
   on `@ingcreators/annot-web` (see
   [packages/desktop/package.json:23](../../packages/desktop/package.json:23)),
   so the import will resolve — but the plan's path strings
   need correcting.
   - **Decision needed:** Two acceptable paths:
     - (A) Update the parent plan to reference
       `@ingcreators/annot-web/gallery/...` directly (smallest
       change). The desktop becomes a third consumer of
       `@ingcreators/annot-web`'s gallery alongside the PWA
       itself, with no new editor-shell surface.
     - (B) File a "move file-manager into editor-shell"
       follow-up plan first (parallel to
       `_done/vscode-extension-host.md`'s editor-surface
       extraction), then resume this migration. The "future
       desktop hosts EditorShell directly" convergence the
       parent plan calls out in `Why it matters now` would
       benefit. But it's a separate ~3-phase plan in its own
       right and the desktop migration shouldn't block on it.
   - **Recommendation:** (A) for this plan. File (B) as a
     follow-up in `docs/plans/` — the file-manager extraction
     belongs in the same family as the editor-shell extraction
     and is the natural next step once
     `desktop-electron-migration.md` lands. Marking the import
     path as `annot-web` today is honest about where the code
     lives; the future move can be a one-line import edit.

3. **Sidebar storage chip for the desktop mode.** `<annot-sidebar>`'s
   storage chip strip is hardcoded in
   [`BUILTIN_CHIP_DESCRIPTORS`](../../packages/web/src/gallery/sidebar.ts:85).
   Adding a `desktop` chip is a one-entry edit BUT the desktop
   doesn't really benefit from showing the other built-in
   chips (Browser / Device / Drive / GitHub) — for the
   desktop, "the library" is the only storage and the chip
   strip is noise.
   - **Recommendation:** Use the existing
     `disableBuiltinStorage` / `isBuiltinDisabled` callback
     (see [packages/web/src/app.ts:282–288](../../packages/web/src/app.ts:282))
     to filter every non-`desktop` chip out of the desktop's
     sidebar at boot. The `desktop` mode itself goes into
     `BUILTIN_CHIP_DESCRIPTORS` (Phase 2 of the parent plan).
     If the sidebar ends up with one chip the design stays
     consistent — it's the same single-chip layout VSCode
     already uses with `vscode` mode.

4. **Tag editor — surface, not gap.** Note for the user that
   the unified gallery activates two surfaces the desktop
   has never had: the file-details drawer's `Tags` section
   (Lit `<annot-drawer-tags-section>`) and the per-card tag
   chips. This is a feature win, not a gap, but worth calling
   out because users will see new UI on first launch after
   Phase 4.

5. **Confirm dialog on per-card delete.** The bespoke gallery
   deletes silently; the unified gallery prompts. This is the
   desired direction (matches every other host), so no design
   change — flag it only because users who have built muscle
   memory around silent delete will notice.

6. **Single-click vs double-click open.** Same shape as #5 —
   unified follows Drive-style and matches every other host.
   No design change recommended; surface it in the Phase 4
   user-facing changelog notes.

### Affordances with full parity (no action needed)

- Folder creation, rename, delete (with confirm).
- Recursive folder tree with expand/collapse.
- Search (UX changes, but the affordance exists).
- Per-image rename and delete.
- Multi-select and bulk delete.
- Capture pipeline routing (Phase 3 swaps the IPC for the
  `StorageProvider` call; no UI change).
- Empty / loading states.
- Keyboard navigation.
- Right-click context menu on cards.

## Resolved decisions — confirmation against the plan

The parent plan's "Resolved decisions" list (lines 569–600 of
[`desktop-storage-provider-migration.md`](./desktop-storage-provider-migration.md))
is internally consistent with the codebase; restating for the
review:

| Decision | Plan says | Codebase agrees |
|---|---|---|
| Sequencing: this plan lands before `desktop-electron-migration.md`. | Yes (line 571) | Yes — `desktop-electron-migration.md` Phase 1 explicitly assumes this plan has landed. |
| Per-file XMP for metadata (matching `DeviceStore`). | Yes (line 573) | Verified — `DeviceStore` uses `readEditableImage` / `buildEditableImageBlob` (XMP-embedded JPG/PNG). The Tauri side already has `xmp.rs` + `read_xmp` / `save_with_xmp` IPC commands and `tauri-bridge.ts` exports. The seam exists. |
| Library root: `<userData>/library/` (OS conventions). | Windows: `%APPDATA%/Annot/library/`; macOS: `~/Library/Application Support/Annot/library/`; Linux: `~/.config/Annot/library/`. (lines 575–582) | **Behaviour change to flag.** The current Tauri build's `portable_dir()` resolves to `current_exe().parent()` (i.e. the install directory itself; see [`packages/desktop/src-tauri/src/lib.rs:14–20`](../../packages/desktop/src-tauri/src/lib.rs:14)), and the SQLite database lives at `<install-dir>/data/annot.db`. Switching to `<userData>/library/` means the new library will land in a different directory than the legacy `data/` regardless of how `portable_dir()` resolves. The plan's "legacy data left untouched on disk; one-time toast surfaces the path" already accounts for this — just flagging that the legacy path is `<install-dir>/data/`, which the toast text needs to compute (not `app.getPath('userData')`). For the Tauri-build cycle of the migration, the toast should literally show `portable_dir() + "/data/"`; for the Electron-build cycle (post `desktop-electron-migration.md`) it'll be `app.getAppPath() + "/data/"` or wherever the install dir resolves on Electron. |
| Data migration: none. Pre-release; legacy `data/` left untouched; Phase 4 toast tells user where. | Yes (lines 592–600) | Confirmed — the install in active use today only has the auto-created `Default` project (verified by reading the empty rows the bespoke gallery shows on this branch). Skipping the migrator is sound. |
| Project-name → folder-name sanitisation. | Moot under no-migration (line 598) | Confirmed — no migration to map names through. |

## Recommendations for Phase 1+

Summary of the pre-implementation actions that should land
before Phase 1 starts:

1. **Update the parent plan's import-path references** from
   `@ingcreators/annot-editor-shell` to
   `@ingcreators/annot-web/gallery/...` (or file the
   file-manager-extraction follow-up plan and decide whether to
   block on it). See gap #2.

2. **Decide capture-mode coverage** for Window / Region in the
   unified gallery surface. See gap #1. Recommended: keep an
   extra desktop-only action row outside the unified gallery
   for the first cycle; file (C) as a follow-up.

3. **Capture the legacy-toast wording** (Phase 4) so the path
   shown matches reality:
   - Tauri-cycle wording: "Your previous Annot library lives
     at `<portable_dir>/data/`." Reveal-in-Finder/Explorer
     button uses `revealItemInDir` from
     `@tauri-apps/plugin-shell`.
   - Electron-cycle wording: substitute the equivalent path
     resolver. (Out of scope for this plan; flagged so the
     follow-up plan inherits the decision.)

4. **Pre-bake the desktop sidebar layout** by passing
   `disableBuiltinStorage: ["browser", "device", "googledrive",
   "github", "extension"]` into the desktop's `App.init` (or
   the equivalent host hook the desktop renderer wires up at
   Phase 2). Leaves only the new `desktop` chip visible.

5. **Sunset the `notes` column** at Phase 5 alongside the
   `images` table deletion. No migration code needed because no
   UI ever populated the field.

## Verification

Phase 0 is verified when:

- [ ] User reads this audit doc.
- [ ] User confirms the gaps in section "Mapping desktop
  affordances → unified shell" are either acceptable as-is or
  have a follow-up plan filed.
- [ ] User confirms the plan-body correction to import paths
  (gap #2) — either by amending the parent plan or by filing
  the file-manager-extraction follow-up.
- [ ] User confirms the toast-path wording for the Tauri
  build cycle (recommendation #3).

After confirmation: amend the parent plan with whichever
recommendations from this audit the user accepts, then move
this audit doc to `_done/desktop-storage-provider-audit.md`
(or delete it; its findings will live in the parent plan from
that point forward).
