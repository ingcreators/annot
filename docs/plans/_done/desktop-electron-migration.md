# Desktop: migrate from Tauri to Electron

> **Status:** Done. Phase 0 → Phase 9 landed in PRs
> [#446](https://github.com/ingcreators/annot/pull/446) (Phase 0),
> [#447](https://github.com/ingcreators/annot/pull/447) (Phase 1),
> [#448](https://github.com/ingcreators/annot/pull/448) (Phase 2),
> [#449](https://github.com/ingcreators/annot/pull/449) (Phase 3),
> [#450](https://github.com/ingcreators/annot/pull/450) (Phase 4),
> [#451](https://github.com/ingcreators/annot/pull/451) (Phase 5),
> [#452](https://github.com/ingcreators/annot/pull/452) (Phase 6),
> [#453](https://github.com/ingcreators/annot/pull/453) (Phase 7),
> [#454](https://github.com/ingcreators/annot/pull/454) (Phase 8),
> and the Phase 9 PR landing this status flip.
>
> **Compatibility:** Replaces the entire `packages/desktop/src-tauri`
> Rust crate with a Node-side Electron main process. The renderer-
> side TypeScript (`packages/desktop/src/`) and its dependence on
> `@ingcreators/annot-host-ui` / `@ingcreators/annot-web` /
> `@ingcreators/annot-editor` / `@ingcreators/annot-core` is
> preserved. The IPC surface defined in
> [`packages/core/src/utils/tauri-bridge.ts`](../../packages/core/src/utils/tauri-bridge.ts)
> is renamed and re-implemented over `ipcRenderer.invoke`, but
> contracts (JSON shapes) stay identical so call sites in
> `@ingcreators/annot-editor` and downstream don't change.
> Existing queued plan
> [`desktop-browser-mode.md`](./desktop-browser-mode.md) is
> superseded by Phase 6 here — its WebView2/WKWebView/WebKitGTK
> per-OS branches collapse onto Chromium's uniform CDP path,
> and the Phase 6 ("macOS + Linux capture commands") work
> disappears as a parity gate.
>
> **Sequencing prerequisite:** This plan assumes
> [`desktop-storage-provider-migration.md`](./desktop-storage-provider-migration.md)
> has landed first — i.e. the desktop renderer talks to a
> `DesktopStore` (`StorageProvider` implementation) over fs
> primitives, and the SQLite-backed gallery + projects/images
> IPC commands are gone. Under that prerequisite, the Electron
> migration's Phase 1 collapses from "port SQLite + 6
> command modules" to "fs primitives + 1 small IPC module". If
> for any reason the storage-provider plan is deferred, the
> alternative-Phase-1 outline below ("If `DesktopStore` is NOT
> yet landed") describes the larger port that replaces this
> phase.
>
> **Risk:** Largest single architectural shift in `packages/desktop`
> since its inception. Three categories of risk:
>
> 1. **Behaviour parity** for existing Windows users (screen
>    capture, Office clipboard paste, XMP round-trip, DB-backed
>    library) — mitigated by phased landing with the Tauri build
>    kept buildable until Phase 9 ("Tauri removal").
> 2. **Cross-platform reach** (the explicit motivation): the
>    Tauri stack failed to deliver Mac capture parity because each
>    OS WebView ships a different snapshot API; Electron bundles
>    Chromium so `desktopCapturer` / `webContents.capturePage` /
>    CDP `Page.captureScreenshot` work uniformly on Win / Mac /
>    Linux. This trades a per-OS API problem for a per-OS
>    *signing* problem (notarization on macOS, code signing on
>    Windows) — which still has to be solved but is a packaging
>    issue, not a feature-availability issue.
> 3. **Bundle size + memory**: Electron ships Chromium per app
>    (~80–120 MB compressed installer, ~250–400 MB on disk;
>    ~150–250 MB resident at idle) vs Tauri's ~10 MB / ~80 MB
>    ranges. Acceptable price for an internal-tool desktop
>    surface; called out explicitly so it isn't a surprise.
>
> Phases 0–4 are pure additions / parallel implementations. Phase 5
> is the cutover to Electron-default for `pnpm dev` / CI release.
> Phases 6–8 are feature work that *was* queued under
> `desktop-browser-mode.md`. Phase 9 deletes the Tauri sources.

## Context

### Why we're switching

The desktop host is a Tauri 2 application with a Rust crate at
[`packages/desktop/src-tauri/`](../../packages/desktop/src-tauri/)
exposing 18 IPC commands across 7 modules. It does its job today
— but it does it on **Windows only** for the parts that need
native APIs:

- [`commands/screen_capture.rs`](../../packages/desktop/src-tauri/src/commands/screen_capture.rs)
  — `#[cfg(windows)]` GDI / DwmGetWindowAttribute implementation;
  `#[cfg(not(windows))]` returns `Err("Not implemented")`.
- [`commands/clipboard.rs`](../../packages/desktop/src-tauri/src/commands/clipboard.rs)
  — Windows-only OOXML / GVML clipboard envelope via the `windows`
  crate's `Win32_System_DataExchange`.

Tauri's WebView is per-OS (WebView2 on Windows, WKWebView on
macOS, WebKitGTK on Linux). Each has its own snapshot /
window-emulation / DevTools-protocol surface; the queued
[`desktop-browser-mode.md`](./desktop-browser-mode.md) plan
allocated *three of its seven phases* to per-OS API plumbing
(Phase 3 Windows-first WebView2 CDP, Phase 4 browser shell
on Windows only, Phase 6 macOS + Linux capture). Each
non-Windows arm is a different research project (`objc2` for
WKWebView, `webkit2gtk-rs` for Linux), and at least one of the
APIs has known gaps (WKWebView returns black frames during
video playback).

Electron sidesteps the per-OS snapshot problem entirely:

- Chromium is bundled and identical on every platform.
- `desktopCapturer.getSources()` + `getUserMedia({video:{
  mandatory: { chromeMediaSource: 'desktop' } }})` works the
  same on Win / Mac / Linux for screen / window / region
  capture.
- For the "browse window" mode, every renderer is a Chromium
  `webContents` instance: `webContents.capturePage()` and
  `webContents.debugger.sendCommand('Page.captureScreenshot')`
  work uniformly. No per-OS branching for the snapshot,
  scroll-loop, or DPR handling.
- Content-script injection is uniform via `webContents.executeJavaScript`
  / `preload` scripts, and the existing extension's content-side
  code (sticky-handler, area-selector, page-metadata walker)
  runs *unmodified* in a regular Chromium context — no
  isolated-world / MAIN-world kludges (cf. CLAUDE.md "DOM
  metadata collection runs in MAIN world").

### What we keep

The renderer-side architecture stays the same:

- `@ingcreators/annot-host-ui` mounts the editor surface.
- `@ingcreators/annot-web`'s editor session, gallery, and
  capture-overlay UI stay as-is.
- `@ingcreators/annot-render` builds the DrawingML XML for
  Office paste (per CLAUDE.md guardrail: TS is the single source
  of truth; Rust was packaging-only since
  [`_done/office-paste-shared-drawing-builder.md`](./_done/office-paste-shared-drawing-builder.md)
  Phase 3). The Electron main process inherits that
  packaging-only role.
- The IPC contracts in
  [`packages/core/src/utils/tauri-bridge.ts`](../../packages/core/src/utils/tauri-bridge.ts)
  stay byte-equivalent at the JSON layer — same field names,
  same shapes. Only the transport (Tauri `invoke` →
  `ipcRenderer.invoke`) and the file's name change.

### What changes

- `packages/desktop/src-tauri/` (Rust crate) → deleted.
- `packages/desktop/src-electron/` (Node main process) → new.
- Renderer code in `packages/desktop/src/app/*.ts` swaps out
  the `@tauri-apps/api` / `@tauri-apps/plugin-*` calls for an
  `electronAPI` exposed via a contextBridge in the preload
  script; the call-site shape is preserved by re-exporting
  the same function names from `tauri-bridge.ts` (which is
  renamed `desktop-bridge.ts` in the same PR).
- `package.json` swaps `@tauri-apps/*` for `electron`,
  `electron-builder`, `better-sqlite3`, `js-yaml`, and one
  N-API addon for the Office clipboard.
- `docs/plans/desktop-browser-mode.md` is rewritten on top of
  this plan in Phase 6+ (the Browse window becomes a regular
  `BrowserWindow` with a `<webview>` or nested `BrowserView`).

### What's explicitly out of scope

- **Mobile**. Tauri's mobile entry point isn't being preserved;
  there's no Annot mobile target on the roadmap.
- **macOS notarization automation** at the CI level. Phase 7 ships
  a manual notarization recipe. Automation is a follow-up plan.
- **Auto-update**. Tauri didn't have it wired up either; deferred.
- **Multi-window PWA-style routing**. Out of scope until Phase 6's
  Browse window lands.

## Design

### Process model

Electron's standard two-process model:

```
┌─ Main process (Node) ───────────────────────────────────────┐
│ packages/desktop/src-electron/                              │
│   main.ts            App lifecycle, window creation, tray   │
│   ipc/                                                       │
│     screenshots.ts  save_screenshot / load_screenshot /      │
│                     check_incoming                           │
│     projects.ts     list_projects / create_project / delete  │
│     images.ts       list_images / update_image / delete      │
│     clipboard.ts    copy_as_office (calls N-API addon)       │
│     screen-capture.ts capture_screen / list_windows /        │
│                     capture_window / capture_region /        │
│                     start_capture_overlay / get_capture_     │
│                     params / capture_overlay_result          │
│     settings.ts     load_tool_presets / save_tool_presets /  │
│                     get_portable_dir                         │
│     xmp.ts          save_with_xmp / read_xmp                 │
│     window.ts       minimize_main_window / restore_main_     │
│                     window                                   │
│   db.ts             better-sqlite3 wrapper (replaces db.rs)  │
│   http-server.ts    Node http (replaces http_server.rs)      │
│   addons/                                                    │
│     office-clipboard/  N-API addon (Win first; Mac later)    │
│   preload.ts        contextBridge surface                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                           ↑ ipcRenderer.invoke / contextBridge
                           │
┌─ Renderer process (Chromium) ───────────────────────────────┐
│ packages/desktop/src/                                       │
│   app/app.ts         (unchanged shape; uses desktop-bridge) │
│   app/gallery.ts     (unchanged)                             │
│   app/project-manager.ts (unchanged)                         │
│   app/capture-overlay.ts (mostly unchanged)                  │
│ packages/core/src/utils/desktop-bridge.ts  (renamed from     │
│                                tauri-bridge.ts; same exports)│
└──────────────────────────────────────────────────────────────┘
```

The renderer's `desktop-bridge.ts` calls
`window.electronAPI.invoke<T>(channel, args)`, which the
preload script defines as
`(channel, args) => ipcRenderer.invoke(channel, args)`. Channel
names match the Tauri command names (`save_screenshot`,
`copy_as_office`, …) so the renamed IPC layer is a pure
transport swap.

### IPC channel mapping (Tauri → Electron)

The renderer continues to call the same logical operations.
Each Tauri command maps to one IPC channel; the main-process
handler is registered in `app.whenReady()` via
`ipcMain.handle(channel, async (_evt, args) => …)`.

**With `DesktopStore` already landed** (recommended), the
renderer's gallery / projects / images / capture lifecycle
goes through `DesktopStore` → `DesktopFs` → fs IPC primitives,
**not** through the legacy SQLite-backed commands. The Tauri
SQLite commands are already deleted by the time this plan
starts.

| Tauri command (today, post-DesktopStore) | Electron channel (after) | Implementation |
|---|---|---|
| `fs.read` / `fs.write` / `fs.list` / `fs.mkdir` / `fs.rename` / `fs.unlink` / `fs.stat` (the `DesktopFs` primitive set) | identical names | Node `fs/promises` |
| `copy_as_office` | `copy_as_office` | N-API addon → Win32 `OpenClipboard` / `SetClipboardData` |
| `capture_screen` / `capture_window` / `list_windows` / `capture_region` / `start_capture_overlay` / `get_capture_params` / `capture_overlay_result` | identical names | `desktopCapturer` + a `BrowserWindow` overlay (replaces `capture-overlay.html` Tauri window) |
| `load_tool_presets` / `save_tool_presets` / `get_portable_dir` | identical names | `fs` + `js-yaml` |
| `save_with_xmp` / `read_xmp` | identical names | Pure-JS port of `commands/xmp.rs` (PNG iTXt + JPEG APP1/APP2 handling). The Rust impl is straightforward byte manipulation; porting is mechanical. The `DesktopStore` reuses the same JS-side helpers internally. |
| `minimize_main_window` / `restore_main_window` | identical names | `BrowserWindow.minimize()` / `restore()` / `show()` / `focus()` |

**If `DesktopStore` is NOT yet landed** (fallback path), the
Phase 1 surface expands to include a `better-sqlite3` port
of `db.rs` plus the eight legacy IPC commands
(`save_screenshot`, `load_screenshot`, `check_incoming`,
`list_projects` / `create_project` / `delete_project`,
`list_images` / `update_image` / `delete_image`). This plan
strongly recommends landing the storage-provider migration
first to avoid this work.

The HTTP server (extension handoff on `localhost:19530`) maps
to a Node `http.createServer` instance started during
`app.whenReady()`, with the request body capped at 50 MB to
match the Rust impl. On `POST /capture` the main process
emits an IPC event to the renderer (mirrors today's
`Emitter::emit("capture-from-extension", …)`).

### Office clipboard via N-API addon

Today's
[`commands/clipboard.rs`](../../packages/desktop/src-tauri/src/commands/clipboard.rs)
is Windows-only, registers two clipboard formats
(`Object Descriptor` + `Embedded Object`) with the OOXML
GVML envelope, and writes a ZIP-packaged drawing into the
Win32 clipboard. Per CLAUDE.md, **the per-shape OOXML is
TS-side** (`@ingcreators/annot-render`); the native code only
packages the pre-built drawing XML into a clipboard envelope
and writes it.

The migration:

- **Phase 4**: a small Rust+`napi-rs` module
  `packages/desktop/src-electron/addons/office-clipboard/`
  exposing `writeOfficeClipboard(drawingXml, mediaList,
  pngDataUrl?)`. Windows-only at landing; prebuilt for
  `x86_64-pc-windows-msvc`.
- The packaging logic (ZIP build + format registration) is
  ported line-by-line from `clipboard.rs`. The TS surface
  (`copyAsOffice`) doesn't change.
- macOS support is **not in this plan**; today it isn't
  supported either. A follow-up plan adds an `NSPasteboard`
  variant to the same addon.
- Linux remains unsupported (matches today).

**Distribution**: built from source on every release via
GitHub Actions (`windows-latest` runner) and published as
platform-specific subpackages (`@ingcreators/annot-office-clipboard-win32-x64`)
following the standard `napi-rs` workflow. The main package
detects the platform at install time and pulls the matching
prebuilt binary. Contributors do **not** need a Rust toolchain
to develop the desktop host — they receive the prebuilt
`.node` binary at `pnpm install` time. A `verify-office-clipboard`
job (analogous to `verify-wasm` from
[`_done/vendor-libimagequant.md`](./_done/vendor-libimagequant.md))
rebuilds from source on every PR that touches the addon
directory and asserts byte-equivalence with the published
prebuilt. Marginal CI cost for the `ingcreators` org (private
repo, Team plan with 3,000 GitHub Actions minutes/month
included): ~20–60 Windows billing-minutes per month at
expected release cadence — under 2% of quota; effectively $0.
If the repo migrates to public per
[`oss-cloud-split.md`](./oss-cloud-split.md), GitHub-hosted
standard runners become free/unlimited.

Why not a fresh Rust *standalone binary* invoked via subprocess?
Considered and rejected: clipboard ownership in Win32 is
process-bound; spawning a child to write the clipboard means
the data evaporates when the child exits. The N-API addon
runs inside the Electron main process which stays alive.

Why not pure Win32 from Node via `koffi` / `node-ffi-napi`?
Considered: it works for simple FFI but not for Win32 COM
patterns the GVML write needs. An addon is cleaner.

Why not check in prebuilt binaries instead of CI build?
Considered and rejected: the supply-chain audit cost (a
reviewer can't easily verify the binary matches source) and
staleness risk (developer must remember to rebuild + commit
on every change) outweigh the few-minute CI wallclock saved
per release. Same reasoning as
[`_done/vendor-libimagequant.md`](./_done/vendor-libimagequant.md).

### Screen capture: Chromium-uniform path

`desktopCapturer.getSources({ types: ['screen', 'window'] })`
returns a list of capturable surfaces with thumbnails and
`id` strings. To capture a specific surface:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: false,
  video: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: source.id,
      maxWidth: 7680,
      maxHeight: 4320,
    },
  } as MediaTrackConstraints,
});
const track = stream.getVideoTracks()[0];
const imageCapture = new ImageCapture(track);
const bitmap = await imageCapture.grabFrame();
// → draw to OffscreenCanvas → toDataURL("image/png")
```

This works identically on Win / Mac / Linux (with the platform's
permission prompt). The renderer-side capture-overlay
(`packages/desktop/src/app/capture-overlay.ts`) keeps its
existing structure; only the source acquisition swaps.

For region capture, the overlay window stays — but it becomes
a transparent fullscreen `BrowserWindow` with
`{ transparent: true, frame: false, alwaysOnTop: true,
fullscreen: true }`, which works on every platform Electron
ships on.

For per-window capture, the source list is filtered by
`type === 'window'`. macOS users get the OS-managed capture
permission prompt on first use. Linux Wayland uses
PipeWire (Electron 22+ handles this transparently).

DPR is read from the `MediaStreamTrack.getSettings()` width
vs. the source's logical size — same approach the
extension uses, kept centralized in the host adapter.

### Storage layer: `DesktopStore` over fs primitives

Under the recommended sequencing, **there is no SQLite layer**
to port — [`desktop-storage-provider-migration.md`](./desktop-storage-provider-migration.md)
deletes the SQLite-backed gallery before this plan starts.
The desktop's storage path is:

```
<annot-file-manager-shell>  (UI)
   ↓
DesktopStore (StorageProvider)  (renderer)
   ↓
DesktopFs (interface)  (renderer)
   ↓
ipcRenderer.invoke('fs.*', …)  (transport)
   ↓
Node fs/promises  (Electron main)
   ↓
<userData>/library/<folders>/<files.{png,jpg}>  (with XMP metadata)
```

Files are byte-identical to what `DeviceStore` writes for the
PWA's "Device" mode; per-file XMP carries tags / notes /
source URL / annotations. No database, no schema migration
between Tauri and Electron — the file tree carries forward
as-is.

`<userData>` resolves via `app.getPath('userData')` on the
Electron side. Per the
[storage-provider plan](./desktop-storage-provider-migration.md)'s
"no data migration" decision, the Tauri-era library at
`<portable_dir>/library/` is NOT auto-imported into the
Electron-era library at `<userData>/library/` — the user is
shown the legacy path via a one-time toast (mirroring the
storage-provider plan's Phase 4 toast) and decides whether to
copy / move / delete manually. Under the typical pre-release
install (no production captures), the toast is informational
only and the user simply proceeds with an empty Electron-era
`Inbox/`.

**Fallback note**: if for any reason the storage-provider
migration is deferred and SQLite must be ported, the original
`better-sqlite3` design (synchronous API matching the
`rusqlite` call sites; bundles SQLite; Electron-rebuild
compatible) is the right pick. This section's prior wording
documenting that path is preserved in the plan history.

### Build & packaging

- **Dev**: `electron-vite` (or `vite-plugin-electron`) so the
  renderer keeps Vite. `pnpm --filter @ingcreators/annot-desktop dev`
  runs the renderer in Vite + the main process in a watcher
  with auto-restart.
- **Build**: `electron-builder` for installers — NSIS for
  Windows, DMG for macOS, AppImage / deb for Linux.
- **CI**: `packages/desktop` stays excluded from the default
  CI build (per [`README.md`](../../packages/desktop/README.md)).
  A dedicated release workflow runs on `release/desktop-*` tags
  and produces per-OS artefacts.
- **Code signing**: Windows uses the existing certificate
  setup. macOS uses Apple Developer ID + notarization (manual
  in Phase 7; automated in a follow-up).

### Settings, paths, and userData

Electron's `app.getPath('userData')` resolves to the
platform-appropriate location:
- Windows: `%APPDATA%/Annot`
- macOS: `~/Library/Application Support/Annot`
- Linux: `~/.config/Annot`

Tauri's "portable" model (`current_exe()/data/`) is dropped
in the migration — Electron's first-class userData path is
better-behaved across platforms (works for unprivileged user
installs, survives app-bundle moves on macOS, etc.). The
`get_portable_dir` IPC keeps its name and contract (returns a
path string) but now returns the userData root.

**Non-admin install + auto-update**: paired with an
`electron-builder` config that targets per-user install
locations:

- Windows: `nsis: { oneClick: true, perMachine: false }`
  installs to `%LOCALAPPDATA%\Programs\Annot` — no UAC
  prompt, no admin needed. Same scheme VSCode's "User
  Installer" uses.
- macOS: distributed as a `.dmg` whose drag-to-`Applications`
  target is `~/Applications/` (per-user) by default.
- Linux: AppImage (per-user `~/.local/bin/` or wherever the
  user drops it), deb / rpm for system-wide installs.

Auto-update via `electron-updater` writes to the install
directory only — never to `userData`. Because the install
dir is per-user, updates never need admin either. The
library at `<userData>/library/` is preserved across
versions by Electron's userData-survives-updates contract.

### Developer ergonomics: the Tauri detection global

[`packages/core/src/utils/tauri-bridge.ts:1`](../../packages/core/src/utils/tauri-bridge.ts:1)
gates IPC calls on `window.__TAURI_INTERNALS__`. After the
rename:

- The detection global becomes
  `window.__ANNOT_DESKTOP__ = true`, set by the preload script.
- The exported `isTauri` re-exports as `isDesktop` (with
  back-compat alias `isTauri = isDesktop` for one PR cycle —
  removed in Phase 9 cleanup).
- All renderer-side `if (isTauri)` checks in
  `@ingcreators/annot-editor` / `@ingcreators/annot-web` are
  renamed in the Phase 5 cutover.

### Tauri-side resources

- [`tauri.conf.json`](../../packages/desktop/src-tauri/tauri.conf.json)
  — replaced by `electron-builder` config in `package.json`.
- [`capabilities/default.json`](../../packages/desktop/src-tauri/capabilities/default.json)
  — Tauri permission system; Electron's permission model is
  IPC-handler-explicit, so this file just goes away.
- Icons under `src-tauri/icons/` — copied to
  `packages/desktop/build/` for `electron-builder`.
- [`resources/tool-presets.yml`](../../packages/desktop/src-tauri/resources/tool-presets.yml)
  — bundled into the Electron app via `extraResources` in
  builder config; same role.
- `Cargo.toml` / `Cargo.lock` — deleted in Phase 9.

## Phased plan

Each phase is one PR per CLAUDE.md's "one PR per phase" rule.
Phases 0–4 land while keeping Tauri buildable; Phase 5 flips
the default. Phases 6–8 supersede the existing
`desktop-browser-mode.md`; Phase 9 deletes the Tauri sources.

### Phase 0 — Electron scaffold side-by-side, opt-in

- Add `packages/desktop/src-electron/` with a minimal `main.ts`
  that creates a `BrowserWindow`, loads the existing Vite-built
  renderer, and exposes a placeholder `electronAPI` via preload
  (echoes `pong` on `ping`).
- Add `electron`, `electron-builder`, `electron-vite` to
  `packages/desktop/package.json` `devDependencies`.
- New scripts in `packages/desktop/package.json`:
  `dev:electron`, `build:electron`. Existing `dev` / `build`
  remain Tauri.
- Tauri sources untouched.
- Renderer untouched (still calls Tauri `invoke`); the Electron
  preload exposes a stub that throws "not yet implemented" so
  the app at least loads.

**Verify**: `pnpm --filter @ingcreators/annot-desktop dev:electron`
opens an Electron window with the renderer. Tauri build still
works. CI changes: none (desktop excluded from default).

### Phase 1 — fs primitives IPC parity (assumes `DesktopStore` already landed)

Under the recommended sequencing (storage-provider migration
done first), this phase is small:

- Implement `fs.read` / `fs.write` / `fs.list` / `fs.mkdir` /
  `fs.rename` / `fs.unlink` / `fs.stat` IPC handlers in
  `src-electron/ipc/fs.ts`. Each is a thin wrapper over the
  matching Node `fs/promises` call, with path-traversal
  validation rooted at `<userData>/library/`.
- The renderer-side `DesktopFs` interface from
  [`desktop-storage-provider-migration.md`](./desktop-storage-provider-migration.md)
  Phase 1 swaps its Tauri-backed implementation for an
  Electron-backed one. The `DesktopStore` class on top
  doesn't change.
- Add `desktop-bridge.ts` next to `tauri-bridge.ts` (NOT
  renaming yet — the `tauri-bridge.ts` file stays in place
  and untouched in this phase). The new file calls
  `window.electronAPI.invoke` and re-exports the same symbol
  names. Because the SQLite-era commands are gone, the
  re-exports are the smaller post-DesktopStore surface
  (XMP, screen capture, Office clipboard, tool presets, http
  server emit, window controls).
- No automatic library migration. On Electron first launch
  the new library at `<userData>/library/` is created empty
  (just `Inbox/`); a one-time toast surfaces the legacy
  Tauri-era library path so the user can copy / move /
  delete manually. Mirrors the storage-provider plan's
  "no migrator" decision.

**Fallback (if `DesktopStore` is not yet landed)**:
extends to porting `db.rs` to `better-sqlite3`, implementing
the eight SQLite-backed IPC handlers, and shipping a one-shot
DB-file copy migration. This is the larger Phase 1 outlined
in the IPC mapping section above.

**Verify**: a renderer harness in `packages/desktop` mounts
`<annot-file-manager-shell>` against a `DesktopStore` rooted
at the Electron `<userData>/library/`. List/create/save/read/
delete a folder + image round-trips against a fixture
library. (Fallback: the SQLite version of this verification
matches the original plan's wording.)

### Phase 2 — Settings, XMP, http-server, window controls

- Port `settings.rs` (`load_tool_presets` / `save_tool_presets`
  / `get_portable_dir`) to `src-electron/ipc/settings.ts`.
  Bundle `resources/tool-presets.yml` via
  `electron-builder.extraResources`.
- Port `xmp.rs` to `src-electron/ipc/xmp.ts`. Pure-JS
  PNG iTXt + JPEG APP1/APP2 manipulation; `pngjs` /
  `piexifjs` handle the parsing primitives. Crucial:
  preserve byte-equivalence on round-trip — add a goldens
  test that reads a fixture saved by the Tauri version and
  re-writes it identically.
- Port `http_server.rs` to Node's `http`; same port (19530),
  same body cap, same `/capture` payload shape, same
  IPC-event dispatch into the renderer.
- Implement `minimize_main_window` / `restore_main_window`
  via `BrowserWindow.minimize()` / `.restore()` / `.show()`
  / `.focus()`.

**Verify**: tool-presets save/load round-trip; an XMP-laden
PNG saved by the Tauri build reads identically in the
Electron build (and vice versa); the existing extension's
"send to local desktop" handoff arrives in the Electron
renderer when `dev:electron` is running.

### Phase 3 — Screen capture (cross-platform from day one)

- Port `screen_capture.rs` to `src-electron/ipc/screen-capture.ts`.
  - `list_windows` → `desktopCapturer.getSources({ types: ['window'] })`.
  - `capture_screen` → `desktopCapturer.getSources({ types: ['screen'] })`
    + `getUserMedia` against the primary source.
  - `capture_window` → same against the picked window source.
  - `capture_region` → full-screen capture + crop in
    `OffscreenCanvas`.
  - `start_capture_overlay` → spawn a transparent fullscreen
    `BrowserWindow` loading `capture-overlay.html`. The overlay's
    drag-rect emit becomes an `ipcRenderer.send` to the main,
    which forwards to the original requester via
    `capture_overlay_result`.
- DPR sourced from `MediaStreamTrack.getSettings()`, returned
  alongside the PNG to match the existing
  `CaptureResult { data_url, width, height }` shape.
- macOS first-launch: walk the user through the Screen
  Recording permission prompt with a one-time dialog.

**Verify**: visible / window / region capture all work on
the Electron build on Windows (parity check vs. Tauri
build) AND on macOS / Linux (new functionality). HiDPI test:
captured PNG dimensions match the source's logical-size ×
DPR. Permission denial path on macOS surfaces a clean error
dialog instead of a black image.

### Phase 4 — Office clipboard N-API addon (Windows-first)

- New addon `packages/desktop/src-electron/addons/office-clipboard/`
  using `napi-rs`. Implements `writeOfficeClipboard(drawingXml,
  mediaList, pngDataUrl?)` against the same Win32 GVML
  envelope as `clipboard.rs`. Prebuilt binary for
  `x64-pc-windows-msvc`; `electron-rebuild` not needed since
  napi-rs ABI is stable.
- macOS / Linux: addon stubs throw `NotSupportedError`; the
  Electron-side `copy_as_office` IPC catches and surfaces a
  user-facing "Office paste is currently Windows-only" toast
  (matches today's behavior — Tauri silently no-ops on
  non-Windows; this is a slight UX improvement).
- Verify byte-equivalence: the existing
  `clipboard_test.rs::test_clipboard_envelope` golden is
  ported to `office-clipboard.test.ts` against the addon.

**Verify**: paste into PowerPoint round-trips an annotated
shape from the Electron build identically to the Tauri build.

### Phase 5 — Default-to-Electron cutover

- Rename `tauri-bridge.ts` → `desktop-bridge.ts`. Phase 1's
  parallel file is deleted (renderer call sites already use
  it; the old `tauri-bridge.ts` re-exports for one PR cycle).
- Rename the detection global (`__TAURI_INTERNALS__` →
  `__ANNOT_DESKTOP__`); update the renderer's `isTauri` /
  `isDesktop` import sites in `@ingcreators/annot-editor` /
  `@ingcreators/annot-web` (it's a small number — the
  `tauri-bridge.ts` indirection isolates them).
- Flip the package's `dev` / `build` scripts to the Electron
  variants.
- Update [`packages/desktop/README.md`](../../packages/desktop/README.md)
  to describe the Electron architecture.
- Drop `@tauri-apps/*` runtime dependencies from
  `package.json`. Keep `@tauri-apps/cli` as a `devDependency`
  for one more cycle so the Tauri build stays runnable until
  Phase 9.
- Update CLAUDE.md guardrail #5 (currently mentions
  `@ingcreators/annot-core/tauri-bridge`) to refer to
  `desktop-bridge`.

**Verify**: a clean clone, `pnpm install`, then
`pnpm --filter @ingcreators/annot-desktop dev` opens the
Electron app by default. Existing Tauri build still works
via explicit `dev:tauri` script (kept for one cycle as a
rollback path).

### Phase 6 — Browse window (Electron-native rewrite of `desktop-browser-mode.md`)

This phase **supersedes** the queued
[`desktop-browser-mode.md`](./desktop-browser-mode.md) plan. The
shared `@ingcreators/annot-capture` package extraction (its
Phases 1–2) is independently valuable and lands as written
— that work is host-agnostic and benefits the extension. But
its Phases 3–6 (per-OS WebView2 / WKWebView / WebKitGTK
capture) collapse onto a single Electron implementation:

- Browse window is a regular `BrowserWindow` whose chrome
  (address bar, tab bar, capture toolbar) is a Lit-rendered
  `/browse` route in the desktop frontend.
- Each tab's target is a child `BrowserView` (or a `<webview>`
  tag — `BrowserView` is preferred for performance and
  isolation).
- Content-script injection uses `webContents.executeJavaScript`
  on every navigation, or a `preload` script attached at
  `BrowserView` creation time. Same script across all OSes.
- `webContents.capturePage()` for visible-mode capture;
  `webContents.debugger.attach()` + CDP `Page.captureScreenshot`
  for full-page (Chromium's `captureBeyondViewport: true`
  works on every platform).
- `window.open` / OAuth popup handling: hook
  `webContents.setWindowOpenHandler` and route to a new tab
  in the same Browse window (with `{ action: 'allow' }` and
  the platform's deny/allow contract).
- Global hotkey: Electron's `globalShortcut` API.

**Verify**: visible / area / full-page / per-page / click /
hotkey capture all work on the same set of reference pages
across Win / Mac / Linux. No OS-specific code paths.

### Phase 7 — macOS notarization recipe

- Document the manual notarization flow in
  `packages/desktop/docs/notarization.md` (Apple Developer ID
  setup, `electron-builder` `mac.notarize: true`,
  app-specific password, expected `electron-notarize` output).
- One-time signed + notarized macOS build cut as a manual
  release candidate; smoke-tested by the user.
- CI automation deferred to a follow-up plan (needs Apple
  credentials in the CI secrets, which has organisational
  prerequisites).

**Verify**: an `.app` produced on a developer Mac, notarized,
opens on a fresh Mac without the "unidentified developer"
warning.

### Phase 8 — Linux packaging polish

- AppImage + deb + rpm via `electron-builder`.
- Smoke-test on the user's preferred distro (Ubuntu LTS).
- File a follow-up if Wayland-specific issues appear (e.g.
  PipeWire screen capture flow, fractional-DPI rendering).

**Verify**: AppImage launches and captures work end-to-end on
Ubuntu LTS.

### Phase 9 — Tauri removal

- Delete `packages/desktop/src-tauri/` (Cargo.toml,
  Cargo.lock, src/, capabilities/, gen/, resources/, icons/
  — the icons are migrated to `packages/desktop/build/` in
  Phase 5).
- Remove `@tauri-apps/cli` from `package.json`; remove
  `dev:tauri` script.
- Remove the `isTauri` back-compat alias from `desktop-bridge.ts`.
- Update [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)
  if it references Tauri (a quick scan in Phase 0 to confirm
  what needs changing).
- Move `desktop-electron-migration.md` to `_done/` with
  links to the landing PRs.

**Verify**: `pnpm install` no longer downloads any
`@tauri-apps/*` package; the repo has no Rust toolchain
prerequisite for the desktop host; CI release workflow runs
green and produces installers for Win / Mac / Linux.

## Verification

Whole-plan acceptance criteria:

- `pnpm -r typecheck` passes after each phase.
- `pnpm test` passes.
- `pnpm lint` reports 0 findings.
- `pnpm --filter @ingcreators/annot-desktop build:electron` produces
  a working installer on the developer's Windows box from Phase 5
  onward; on macOS from Phase 7 onward; on Linux from Phase 8.
- IPC contract goldens: every renamed channel keeps its JSON
  contract verified by a contract-test (`desktop-bridge.contract.test.ts`)
  exercising request + response shape against fixture data.
- XMP byte-equivalence: round-trip a fixture between Tauri-saved
  and Electron-saved variants in Phase 2.
- Office paste byte-equivalence: ZIP envelope diff against a
  golden PPTX target in Phase 4.
- Screen capture parity: 5 reference scenarios (full screen,
  specific window, region, HiDPI, multi-monitor) captured by
  both Tauri and Electron builds in Phase 3 produce visually
  matching PNGs (modulo unavoidable DPR differences flagged
  in the test).
- No-migration confirmation: a clean Electron first launch
  opens an empty `<userData>/library/Inbox/`; the legacy
  Tauri `<portable_dir>/library/` directory is untouched on
  disk; the one-time legacy-data toast surfaces exactly
  once with the path resolvable on the user's system.

## Migration notes

- **User data**: no auto-import. Per the storage-provider
  plan's "no migration" decision, Phase 1's Electron first
  launch creates an empty `<userData>/library/` and surfaces
  a one-time toast pointing to the legacy
  `<portable_dir>/library/` path so the user can copy / move
  / delete manually. The legacy directory is never touched
  by the app.
- **Bundle size**: ~10 MB → ~80–120 MB installer; ~80 MB →
  ~250–400 MB on disk; ~80 MB → ~150–250 MB resident memory
  at idle. Acceptable trade for cross-platform parity.
- **Rust toolchain**: no longer required for desktop builds.
  The N-API addon is prebuilt + checked-in CI artefacts;
  contributors can `pnpm install` and run the desktop host
  without a Rust install. (The `imagequant` package still
  needs Rust for its WASM build; that's separate.)
- **`PageMetadata` schema**: untouched; this plan is
  packaging-side only. CLAUDE.md guardrail #4 holds.
- **`StorageProvider`**: untouched. CLAUDE.md guardrail #3
  holds.
- **SVG schema**: untouched. CLAUDE.md guardrail #1 holds; no
  `data-annot-version` bump.
- **Office paste OOXML**: produced by `@ingcreators/annot-render`
  (TS) — single source of truth. The N-API addon is
  packaging-only, mirroring the previous Rust crate's role
  per CLAUDE.md guardrail #5.
- **Existing `desktop-browser-mode.md`**: superseded by
  Phase 6 here. The plan doc is updated in Phase 6's PR
  with a banner pointing here; it's NOT moved to `_done/`
  until its Phase-1/2 (the `@ingcreators/annot-capture`
  extraction) lands separately.
- **CLAUDE.md updates**:
  - Guardrail #5 wording (`@ingcreators/annot-core/tauri-bridge`)
    → renamed reference in Phase 5.
  - Monorepo layout table — Phase 5 updates the `desktop/`
    line to mention "Electron desktop wrapper" instead of
    "Tauri desktop wrapper".
- **Forward-looking**:
  - The headless-annotator spike (CLAUDE.md "Queued work")
    is unaffected — that path runs in Node directly and
    doesn't touch the desktop host.
  - Multi-account / sandboxed userData partitions become
    feasible via Electron's `session.fromPartition`, but
    out of scope here.
  - Auto-update via `electron-updater` is a natural follow-up
    once code signing + notarization are stable.

## Resolved decisions

All sign-off questions resolved 2026-05-06:

- **Sequencing with `desktop-storage-provider-migration.md`**:
  storage-provider lands first, then this plan. Phase 1
  collapses from "DB + 8 IPC commands" to "fs primitives".
- **Bundle-size acceptance**: ~10× installer-size jump
  accepted (10 MB → 80–120 MB; ~250–400 MB on disk;
  ~150–250 MB resident). Trade is worthwhile for
  cross-platform parity.
- **N-API addon prebuild policy**: CI build via GitHub
  Actions (`windows-latest` runner; later `macos-latest`
  for the NSPasteboard variant); published as platform-
  specific `napi-rs` subpackages. Marginal cost ~20–60
  Windows billing-min/month at expected cadence —
  effectively $0 against the `ingcreators` Team plan's
  3,000 included minutes/month. Goes free/unlimited if the
  repo migrates to public. Same supply-chain rationale as
  [`_done/vendor-libimagequant.md`](./_done/vendor-libimagequant.md).
- **macOS notarization timing**: Phase 7 lands as a
  follow-up after Phase 5 cutover, not bundled with it.
  Acceptable that the Phase 5 Electron build shows the
  "unidentified developer" warning on macOS until Phase 7;
  the developer's Mac box accepts unsigned builds for
  test purposes.
