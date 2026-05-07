# Host convergence: desktop on EditorShell, gallery + orchestrators in editor-shell

> **Status:** Draft
>
> **Compatibility:** No public API change to `@ingcreators/annot-core`.
> Adds new subpath exports on `@ingcreators/annot-editor-shell`. Phase
> 2 moves gallery modules from `@ingcreators/annot-web/gallery/*` to
> `@ingcreators/annot-editor-shell/gallery/*` — PWA's import paths
> change; the workspace dep absorbs it. No published-package consumers
> exist yet (pre-release), so no compat shim is needed.
>
> **Risk:** Medium. Each phase is reversible and lands as its own PR;
> the live PWA, VSCode webview, and extension keep working at every
> commit. Phase 1 (desktop adopts EditorShell) is the biggest single
> phase but the surface is small (`packages/desktop/src/app/app.ts` +
> `index.html` + `app.css`) and gated by feature parity with the
> current desktop editor.

## Context

Through Apr–May 2026 a sequence of plans converged the four hosts
onto shared machinery, but unevenly:

| Plan | Outcome |
|---|---|
| [`vscode-extension-host.md`](./_done/vscode-extension-host.md) | Created `@ingcreators/annot-editor-shell` and proved it from VSCode |
| [`editor-session-shell-switchover.md`](./_done/editor-session-shell-switchover.md) | PWA's `EditorSession` boots via `EditorShell.mountFromRecord` |
| [`desktop-storage-provider-migration.md`](./_done/desktop-storage-provider-migration.md) | Desktop gallery uses PWA's `<annot-file-manager-shell>` against `DesktopStore` |
| [`desktop-electron-migration.md`](./_done/desktop-electron-migration.md) | Tauri → Electron with no editor-side changes |
| [#464](https://github.com/ingcreators/annot/pull/464) – [#467](https://github.com/ingcreators/annot/pull/467) | Post-merge fixes — CSS imports, vertical toolbar, OS menu cleanup, Browser Capture in unified New menu |

The visible chrome gaps are now closed. The remaining unevenness is
**structural**: the same code paths take different shapes in different
hosts, which keeps surfacing as "we just realised the desktop has no
autosave / no breadcrumb / no file-details drawer / no save-status
indicator." This plan organises the unevenness into a target shape and
phases the work to get there.

The plan complements but does not absorb
[`desktop-browser-mode.md`](./desktop-browser-mode.md) (capture
extraction); see Phase 5 below.

## Current state (audit)

### Per-host responsibilities

| Host | Capture | Gallery | Editor | Plugin loading | Storage backends |
|---|---|---|---|---|---|
| PWA | `getDisplayMedia` + paste | ✅ via `<annot-file-manager-shell>` | ✅ via `EditorShell` + `HeaderHost`/`StatusHost`/`SavePipeline` orchestrators | ✅ | Browser, Device, Drive, GitHub, Extension proxy |
| Desktop | Native screen / window / region (Electron) + Browse window + clipboard paste | ✅ via `<annot-file-manager-shell>` | ❌ Imperative `new CanvasManager` / `new Toolbar` / `new PropertyPanel` (no `EditorShell`) | ❌ | DesktopStore (filesystem + per-file XMP) |
| VSCode | None (custom-editor opens a single image per tab) | ❌ Explorer is the gallery | ✅ via `EditorShell`; orchestration partially **inlined** in `webview/main.ts` | ❌ | VSCodeStore (`workspace.fs`) |
| Extension | ✅ Six modes (visible / area / full-page / per-page / click / hotkey) | ❌ | ❌ | ❌ | IDB cache; captures handed off to PWA / Desktop |

### Module ownership today

| Module | Current home | Used by |
|---|---|---|
| `EditorShell` (per-image lifecycle, save, dirty event bus) | `@ingcreators/annot-editor-shell` | PWA, VSCode |
| `Toolbar` (vertical / horizontal) | `@ingcreators/annot-editor-shell/toolbar` | PWA, VSCode, Desktop |
| `<annot-file-details-drawer>` | `@ingcreators/annot-editor-shell` | PWA, VSCode |
| `<annot-editor-statusbar>` | `@ingcreators/annot-editor-shell` | PWA, VSCode |
| `right-panel` (`<annot-editor-right-panel>` + sections) | `@ingcreators/annot-editor-shell` | PWA, VSCode |
| `keyboard-help` | `@ingcreators/annot-editor-shell` | PWA, VSCode |
| `HeaderHost` / `StatusHost` / `SavePipeline` / `EditorSession` orchestrators | `packages/web/src/app/` | PWA only; **VSCode reimplements inline subset**; Desktop has no equivalent |
| Gallery (`<annot-file-manager-shell>`, `<annot-sidebar>`, `<annot-gallery-page>`, `<annot-context-menu>`, `FileManager`) | `packages/web/src/gallery/` | PWA, Desktop |
| Plugin host (loader + types) | `packages/web/src/app/plugin-host.ts` | PWA only |
| PWA capture predicates (`isScreenCaptureSupported` etc.) | `packages/web/src/capture/pwa-capture.ts` | PWA, gallery (sidebar New menu) |
| Capture pipeline (sticky / scroll / area selector / encode worker) | `packages/extension/src/{content,background,offscreen}/` | Extension only |
| Native screen / window / region capture | `packages/desktop/src-electron/` | Desktop only |

### Where each host's editor boot lives

- PWA: [`packages/web/src/app/editor-session.ts`](../../packages/web/src/app/editor-session.ts) — calls `EditorShell.mountFromRecord`, then constructs `Toolbar` / `EditorRightPanel` / drawer / `HeaderHost.build` / `StatusHost.build` / `SavePipeline`.
- VSCode: [`packages/vscode/src/webview/main.ts`](../../packages/vscode/src/webview/main.ts) — same `EditorShell` mount, then INLINE construction of toolbar / right-panel / statusbar / drawer + a custom save flow tied to VSCode's `CustomEditorProvider` lifecycle.
- Desktop: [`packages/desktop/src/app/app.ts:openEditor`](../../packages/desktop/src/app/app.ts) — direct `new CanvasManager` / `new History` / `new SelectionManager` / `new Toolbar` / `new PropertyPanel`. No `EditorShell`, no editor-header, no right-panel, no drawer, no autosave, no dirty tracking.

## Convergence target

```
packages/
  core/             (unchanged)
  editor/           (unchanged)
  render/           (unchanged)
  editor-shell/     EXPANDS:
                      + gallery/  ← from annot-web/gallery
                      + orchestrators (HeaderHost / StatusHost /
                        SavePipeline as host-neutral primitives)
                          ← from annot-web/app
                      + plugin host types (SidebarTab,
                        StorageRegistration, NewMenuItem already)
                          ← from annot-web/app/plugin-host
                      + capture predicates
                          ← from annot-web/capture/pwa-capture
  capture/          NEW (per desktop-browser-mode.md):
                      content modules + orchestrators + encode
                      + CaptureHost interface
  web/              SHRINKS:
                      stays the PWA host adapter — routing, service
                      worker, PWA-only storage backends
                      (Browser/Device/Drive/GitHub), plugin runtime
                      loader
  desktop/          GAINS the EditorShell consumer + (later)
                      the capture host adapter
  vscode/           ADJUSTS:
                      drops the inline orchestration in favour of
                      shared HeaderHost / StatusHost / SavePipeline
                      from editor-shell
  extension/        SHRINKS later (per desktop-browser-mode.md) into
                      a thin Chrome MV3 host adapter around
                      @ingcreators/annot-capture
```

## Gaps to close (priority-ordered)

| # | Gap | Phase |
|---|---|---|
| 1 | Desktop has no `EditorShell` — no editor-header / right-panel / drawer / autosave / dirty tracking / breadcrumb / save-status indicator | 1 |
| 2 | Gallery + plugin-host types live in `annot-web` (desktop reaches across packages; future hosts have no clean import) | 2 |
| 3 | `HeaderHost` / `StatusHost` / `SavePipeline` PWA-only; VSCode reimplements inline; Desktop will need the same | 3 |
| 4 | Plugin host structural types (`SidebarTab`, `StorageRegistration`) only as PWA exports — works because gallery is also PWA-side, but blocks Phase 2 | 2 (folded in) |
| 5 | Extension capture pipeline duplicated (covered by separate plan) | 5 (defer) |

## Phasing

**Sequencing principle.** Each phase lands as its own PR, merged before the next phase starts (per CLAUDE.md "phased plans: one PR per phase"). Each phase is independently revertable. Phases 1, 2, 3 are largely independent — they can land in any order, but the recommended sequence below maximises early user-visible value (Phase 1 first) and minimises rework (Phase 2 before Phase 3 means the orchestrator extraction has the gallery already in editor-shell).

### Phase 1 — Desktop adopts `EditorShell`

> **Goal:** desktop's `openEditor` becomes `EditorShell.mountFromRecord` + the orchestration the PWA uses (subset). Adds editor-header / right-panel / file-details drawer / autosave / dirty tracking / save-status indicator to desktop.

**Scope.** Touches only `packages/desktop` + (if Phase 3 hasn't landed yet) imports `HeaderHost` / `StatusHost` / `SavePipeline` from `@ingcreators/annot-web/app/*` directly as a stopgap. The stopgap is removed when Phase 3 lands.

**Steps.**

1. Add `<div id="editor-header">` and `<div id="editor-right-panel">` to `packages/desktop/index.html` (mirror PWA's `index.html`). The existing `<div id="editor-sidebar">` (vertical Toolbar from #465) and `<div id="canvas-container">` stay unchanged.
2. Replace `openEditor`'s imperative chain (`new CanvasManager(...)` / `new Toolbar(...)` / `new PropertyPanel(...)`) with:
   - `EditorShell.mountFromRecord(path, record)` — owns the canvas, history, selection.
   - `new Toolbar(sidebarEl, shell.getCanvas(), shell.getHistory(), shell.getSelection(), ...)` against `#editor-sidebar`. Same `orientation: "vertical"` + `showGalleryButton: false` from #465.
   - `<annot-editor-right-panel>` mounted into `#editor-right-panel` for selection + tool-properties.
   - `<annot-file-details-drawer>` attached to `document.body`, populated with the current image's metadata.
   - `HeaderHost`-equivalent populating `#editor-header` (brand + breadcrumb + save-status + save+copy + theme + help).
   - `StatusHost`-equivalent populating the existing `#statusbar` (zoom menu, size readout, active-tool indicator). The current desktop statusbar markup stays; `StatusHost` builds its content imperatively.
   - `SavePipeline`-equivalent listening to `shell.on("dirty", ...)` and debouncing `shell.saveNow()`.
3. Wire `shell.on("error", ...)` to a desktop-side error banner (reuse `.fs-legacy-notice`-style banner).
4. Toggle `body.editor-mode` on entry / exit (already wired in #465).
5. Update the back-button + Browse window flow to call `shell.destroy()` before reopening the gallery.

**Decisions locked-in for this phase** (per Resolved decisions 1 + 2):

- **Editor-header**: yes. Brand + breadcrumb + save status + save/copy + theme + help. The desktop's `app.css` editor-mode overrides shipped in #465 (`top: 0` on `#editor-sidebar` + `#canvas-container`) get reverted to make room for the 48 px header.
- **Autosave**: yes. Desktop-local debounce shipped here; collapses into the shared `SavePipeline` when Phase 3 lands.
- **Right-panel**: yes. Replaces the floating-popover `PropertyPanel` with the persistent `<annot-editor-right-panel>` from `editor-shell`.

**Verification.**

- `pnpm -r typecheck`, `pnpm test`, `pnpm lint`.
- Manual smoke: open captured image → annotate → modify → confirm dirty indicator → close window → reopen → annotations restored. Confirm autosave behaviour matches PWA.

**Deliverable.** Desktop has feature parity with PWA's editor surface (gallery navigation aside — desktop's gallery + editor are still toggle-based by design).

### Phase 2 — Move gallery to `editor-shell`

> **Goal:** `<annot-file-manager-shell>` / `<annot-sidebar>` / `<annot-gallery-page>` / `<annot-context-menu>` / `FileManager` move from `@ingcreators/annot-web/gallery/*` to `@ingcreators/annot-editor-shell/gallery/*`. PWA + Desktop update their imports; VSCode now has the gallery available too (still unused — VSCode tabs ARE the gallery — but the option exists for plugin-built secondary surfaces).

**Pre-move audit.**

The gallery has these intra-`annot-web` deps that need to move with it (or be inverted):

| Import | Resolution |
|---|---|
| `../app/plugin-host.js` (`SidebarTab`, `StorageRegistration` types) | Move types-only to `editor-shell/gallery/plugin-host-types.ts`. Runtime loader stays in web. |
| `../capture/pwa-capture.js` (`isScreenCaptureSupported`, `isClipboardReadSupported`) | Move to `editor-shell/capture-predicates.ts`. They're feature-detection predicates; not tied to PWA implementation. |
| `../storage/bridge.js` (`StorageMode` type) | The gallery only needs the string-union shape. Re-export from `editor-shell/gallery/storage-mode.ts` or accept an opaque `string`. |
| `../storage/thumbnail-manager.js` (`ThumbnailManager` interface) | Move to `editor-shell/thumbnail-manager.ts`. Or leave the implementation in web and move only the type. |
| `../ui/dialog.js` (`showAlertDialog` etc.) | Move to `editor-shell/ui/dialog.ts`. |
| `../ui/annot-icon-imperative.js` (`createBuiltinIcon`) | Move to `editor-shell/ui/annot-icon-imperative.ts`. |
| `../lit.js` | Already aliased; gallery files re-import from `editor-shell/lit.ts`. |

**Steps.**

1. Move source files under `packages/editor-shell/src/gallery/`.
2. Move CSS — `packages/web/src/styles/file-manager.css` → `packages/editor-shell/styles/file-manager.css` (or `packages/core/styles/`; see Open Questions). Update consumers' import paths.
3. Move dialog + icon-imperative + thumbnail-manager helpers as bullet-listed above.
4. Add new subpath exports to `packages/editor-shell/package.json`.
5. PWA (`packages/web/src/app/app.ts` etc.): rewrite imports from `@ingcreators/annot-web/gallery/*` → `@ingcreators/annot-editor-shell/gallery/*`. Drop the `./gallery/*` and `./styles/*` exports from web's `package.json`.
6. Desktop (`packages/desktop/src/storage/bootstrap.ts`, `packages/desktop/src/app/app.ts`): same import-path rewrite.
7. Storybook glob in `packages/web/.storybook/main.ts` already covers `editor-shell/src/**/*.stories.ts`; the moved gallery stories surface there automatically.

**Risk.** Low. Pure file move + import-path rewrite. CI catches any missed reference.

**Deliverable.** Gallery is host-agnostic. Plugin authors targeting either PWA or Desktop import the same package + path.

### Phase 3 — Extract editor orchestrators (`HeaderHost` / `StatusHost` / `SavePipeline`)

> **Goal:** the orchestrators that wire `EditorShell` events to the chrome (header, statusbar, save-status indicator, dirty-debounce-save loop) move from `@ingcreators/annot-web/app/*` to `@ingcreators/annot-editor-shell/orchestrators/*` (or similar). PWA + VSCode + Desktop all consume the same primitives.

**Pre-move audit.**

| Class | Today's PWA-specific deps | Genuinely host-agnostic? |
|---|---|---|
| `HeaderHost` | Builds `#editor-header` content; depends on `Toolbar` (already in editor-shell), `<annot-file-details-drawer>` (editor-shell), routing helpers (PWA-only) | Most logic is host-agnostic; the routing helpers thread through as host-supplied callbacks. |
| `StatusHost` | Builds `<annot-editor-statusbar>` (already in editor-shell); reads `CanvasManager` zoom + size | Fully host-agnostic. |
| `SavePipeline` | Listens for `EditorShell.dirty` events, debounces `shell.saveNow()`, surfaces save-status to `HeaderHost` | Fully host-agnostic. |
| `EditorRightPanel` | Mounts `<annot-editor-right-panel>` (editor-shell); routes selection + tool-id changes to its sections | Mostly host-agnostic; plugin-section sourcing thread through as a callback. |

**Steps.**

1. Move classes under `packages/editor-shell/src/orchestrators/`. Inject host-specific concerns (routing, current-folder lookup, etc.) as constructor `deps`.
2. PWA: update imports + drop the in-package copy. Existing `EditorSession` keeps its glue role.
3. VSCode webview: replace the inline implementations in `main.ts` with imports from `editor-shell/orchestrators/*`. The reduction should be ~100–200 LOC less inline orchestration.
4. Desktop: Phase 1's stopgap (importing from `@ingcreators/annot-web`) replaced by direct `editor-shell` imports.

**Risk.** Medium. PWA's tests cover orchestrator behaviour, but the move is a structural change with three live consumers post-move. Mitigation: per-orchestrator PR (one orchestrator per landed PR), each with PWA + VSCode + Desktop migrated together so no host is left with a stale import.

**Deliverable.** One implementation of dirty-tracking / autosave / save-status indicator / breadcrumb / save-menu, used by every editor host.

### Phase 4 — Plugin host structural types in editor-shell

> **Goal:** `SidebarTab`, `StorageRegistration`, `NewMenuItem`, plugin manifest types live in editor-shell so the gallery (post-Phase 2) can import them without a back-channel through `annot-web`. **Types only**; the `PluginHost` class itself stays in `annot-web` for now and moves later under [`plugin-host-extraction.md`](./plugin-host-extraction.md) (Draft, trigger: "Desktop or VSCode wants to load plugins").

**Steps.**

1. Move type-only declarations (`SidebarTab`, `StorageRegistration`, `NewMenuItem`, `UISection*`, `ExternalLink*`, save / route / editor-ready event payloads, manifest schema types) to `packages/editor-shell/src/plugin-host-types.ts`.
2. `annot-web/app/plugin-host.ts` re-imports the types and continues to own the `PluginHost` class.
3. Gallery (now in editor-shell after Phase 2) imports types from the new home rather than reaching back into `annot-web/app/plugin-host`.
4. (Naturally folds into Phase 2 if Phase 2 lands first; otherwise lands as a small standalone PR.)

**Risk.** Low. Type-only move.

### Phase 5 — Capture extraction (defer to existing plan)

[`desktop-browser-mode.md`](./desktop-browser-mode.md) (Queued) covers
the extension → `@ingcreators/annot-capture` → desktop Browse-window
adoption. This plan does NOT replace it; instead it sequences
**after** Phase 4 so the capture extraction lands on a stable editor /
gallery convergence base.

**Note.** That plan's design references Tauri + Rust capture commands;
those parts need a refresh-pass when the plan is queued (the
[`desktop-electron-migration.md`](./_done/desktop-electron-migration.md)
landed after `desktop-browser-mode.md` was drafted, so the per-OS
sections need updating to Electron's `webContents.capturePage` and
`<webview>` model).

## Out of scope

- The Chrome extension becoming a Lit app. Today it's a service-worker + content scripts + offscreen page + popup; this plan doesn't restructure that.
- Per-OS native capture API parity. That sits inside `desktop-browser-mode.md`.
- The plugin runtime (loader, sandbox, lifecycle) becoming its own package. Defer until a non-PWA host needs to load plugins.
- Renaming `@ingcreators/annot-web` to `@ingcreators/annot-pwa` post-extraction. Cosmetic; defer until after Phases 2 + 3 ship.
- Headless / Playwright integration. Already a queued idea elsewhere; this plan unblocks it (a Playwright host would mount `EditorShell` + an in-memory `StorageProvider`) but doesn't deliver it.

## Resolved decisions

1. **Desktop editor-header — adopt PWA's full editor-header.** Phase 1 wires `<div id="editor-header">` and populates it with brand + breadcrumb + save-status + save+copy + theme + help, mirroring the PWA. The desktop's `app.css` overrides the editor-sidebar / canvas-container `top` offsets to make room for it (replacing the `top: 0` overrides shipped in #465). Without an editor-header the desktop has no save-status indicator at all, which conflicts with decision 2 below.
2. **Desktop autosave — introduce in Phase 1.** PWA + VSCode both autosave on dirty; manual-save-only on desktop is the odd one out. Phase 1 writes a small desktop-local debounce + `shell.saveNow()` loop that Phase 3 collapses into the shared `SavePipeline` once that's extracted. The throwaway debounce is ~30 LOC; the cost of writing-then-collapsing is less than the cost of shipping desktop without autosave for 2 plan iterations.
3. **Gallery CSS lives in `editor-shell/styles/`.** When `file-manager.css` moves with the gallery in Phase 2, its new home is `packages/editor-shell/styles/file-manager.css`. Core's `styles/` stays the home for editor-canvas-level concerns (`editor.css`, `toolbar.css`, `property-panel.css`, `fonts.css` — all design tokens or canvas-coupled). Gallery is a higher-level surface; co-locating it with the gallery's Lit elements in editor-shell is the cleaner split.
4. **Plugin host extraction — separate follow-up plan.** [`plugin-host-extraction.md`](./plugin-host-extraction.md) (Draft) captures the move of the `PluginHost` class itself (today in `packages/web/src/app/plugin-host.ts`) into editor-shell. The trigger to flip Draft → Queued is "Desktop or VSCode wants to load plugins"; until then the plan stays warm but unscheduled. Phase 4 of the present plan is narrowed to **structural types only** (`SidebarTab`, `StorageRegistration`, `NewMenuItem`, manifest schema types) — those move with the gallery in Phase 2 because the gallery imports them, and follow naturally without waiting on the trigger.
5. **`@ingcreators/annot-web` rename — see Open Question Q1 below**, which subsumes the rename decision. (Q1 asks whether `web` should drop the PWA aspect entirely, in which case the rename to `annot-pwa` is moot — `web` becomes "just the web app".)
6. **Phase ordering confirmed: 1 → 2 → 3 → 4 → 5.** Phase 1 first because it carries the highest user-visible value (desktop gains parity with PWA's editor surface). Phase 2 before Phase 3 because moving the gallery first means the orchestrator extraction in Phase 3 already has the gallery types living in editor-shell.

## Open questions

1. **`packages/web` PWA strategy**: today the web app ships as a PWA (manifest + workbox service worker + install prompt + apple-touch-icon). With Desktop covering the "installed app" experience, Browser Extension covering capture, and the web app being a "browser-tab editor" for users without Desktop, the PWA layer adds maintenance overhead (service-worker update flow, manifest, install promotion) without clear user-visible benefit. Three options:
   - **A) Status quo** — keep full PWA (manifest + SW + install prompt). Pro: marginal cold-start benefit; install option for users on platforms without Desktop. Con: SW complexity is a real bug source ([#464](https://github.com/ingcreators/annot/pull/464) was an SW-induced fix); maintenance overhead.
   - **B) Drop PWA entirely** — remove `vite-plugin-pwa`, the service worker, the manifest, the `registerSW` flow. Web app is just a SPA at a URL. Pro: simplest; least surface area; no SW update flow to debug. Con: small cold-start regression (precache gone); users who installed lose the install (browsers handle this gracefully).
   - **C) Service worker for caching only** — keep `vite-plugin-pwa` precache but drop the manifest / install prompt. Pro: cold-start preserved; install promotion gone. Con: still has SW complexity; halfway state.
   - **Recommendation:** **B** (drop PWA entirely). Strategic context: Desktop is positioned as the native install; Extension is positioned as the capture tool; Web is positioned as a tab-based fallback for users without Desktop. PWA-install of Web overlaps with Desktop and adds nothing the user couldn't get from Desktop. The SW update flow ([#464](https://github.com/ingcreators/annot/pull/464)) has been a real bug source — every reduction of moving parts pays back. If this is chosen, a separate small PR (~30–50 LOC change) drops the PWA infrastructure independent of the host-convergence phases.
   - Side-effect on the previous Q5: if PWA is dropped, the speculated rename `@ingcreators/annot-web` → `@ingcreators/annot-pwa` becomes moot — the package stays `annot-web` because that's what it is.

## Forward-looking notes

After this plan lands:

- Headless / Playwright integration becomes a small follow-up: a new "host adapter" mounting `EditorShell` against a Playwright-supplied container + an in-memory `StorageProvider`. The same shape every other host already takes.
- A rename of `@ingcreators/annot-web` to `@ingcreators/annot-pwa` becomes a single-PR cosmetic change — no package contains anything but PWA-specific code at that point.
- The "editor surface as a publishable library" idea in `PRODUCT_DIRECTION.md` becomes concrete: `@ingcreators/annot-editor-shell` is the headless library; the four hosts are reference adapters.
