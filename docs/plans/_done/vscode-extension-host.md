# VSCode extension as a first-class editor host

> **Status:** Done — landed 2026-05-04 across PRs [#395](https://github.com/ingcreators/annot/pull/395)–[#404](https://github.com/ingcreators/annot/pull/404).
>
> **Carry-overs deferred to follow-up tickets:**
> - PWA `EditorSession` still constructs `CanvasManager` / `History` /
>   `SelectionManager` directly. The plan called for it to "shrink to
>   a thin adapter" via the `EditorShell`; doing so cleanly requires a
>   coordinated CSS update (the PWA's `app.css` targets `#svg-root`,
>   the shell's anonymous `[data-annot-shell-root]` doesn't) plus a
>   record-synthesis refactor of `setupEditor`. The shell architecture
>   is proven by 8 happy-dom tests + the VSCode webview consuming the
>   same surface; PWA switchover queued as a follow-up.
> - Phase 5's command-palette entries (`Annot: New annotation from
>   clipboard image`, `Annot: New annotation from image…`,
>   `Annot: Save as PNG…`, `Annot: Save as JPEG…`,
>   `Annot: Export to PowerPoint…`) register the surface and emit
>   "lands in a follow-up" info messages — full implementation is a
>   follow-up.
> - Webview-side `StorageProvider` proxy (forwarding every `getImage`
>   / `updateImage` to the extension host via postMessage) — Phase 4
>   ships bytes once at boot via `mountFromRecord`; the proxy lands
>   in a follow-up.
> - XMP round-trip for `*.annot.{png,jpeg,jpg}` (recover annotation
>   SVG from the XMP packet on read; embed on write) — `VSCodeStore`
>   currently round-trips the original bytes only.
>
> **Original status:** Draft
> **Compatibility:** Adds new packages (`@ingcreators/annot-editor-shell`,
>                    `@ingcreators/annot-vscode`); no renames to
>                    existing packages. `StorageProvider` unchanged
>                    (VSCodeStore is just another implementation).
>                    SVG schema unchanged. PWA continues to ship from
>                    `packages/web` and consumes the extracted shell as
>                    its first consumer (regression-proof by
>                    construction).
> **Risk:** Phased — every phase is independently revertable. Phase 1
>           is the biggest lift (touches every editor entry point in
>           `packages/web`); Phases 2+ are additive new packages.

## Context

[`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) commits to two
adjacent growth vectors: **Playwright / headless automation** and
**GitHub as the collaboration hub**. Both lean developer-ward. A
VSCode extension that lets users open Annot files directly inside
their editor — alongside the Playwright tests that referenced the
screenshot, alongside the source code that the screenshot
documents — is a natural extension of that direction:

- The annotation file lives in the repo (already enabled by
  `GitHubStore` and the path-based storage refactor) so it's
  already in the workspace.
- Editing should not require a context switch to a separate web
  app — opening `tests/__annotations__/login-flow.annot.svg`
  inside VSCode and editing it in place removes the round-trip.
- The `PageMetadata.locator?: string` field reserved by **P5** in
  `PRODUCT_DIRECTION.md` becomes a clickable link from the
  annotation back to the test source code — uniquely valuable
  inside an IDE that already understands the workspace.

The architectural prerequisite is that the **editor surface** can be
mounted into a non-PWA host. Today, editor lifecycle lives across:

- `@ingcreators/annot-editor` — Tier C primitives (`CanvasManager`,
  `SelectionManager`, `PropertyPanel`, `History`, `ToolBase`, save
  helpers). **Host-neutral already** — needs a real browser context
  and a `StorageProvider`, nothing else.
- `packages/web/src/editor/` — Lit web components for `Toolbar`,
  `right-panel`, `annot-file-details-drawer`, save-menu, scratchpad
  popover. Custom-element prefix is `annot-`, but the elements
  reach into the PWA shell (e.g. `document.getElementById("svg-root")`,
  `document.getElementById("statusbar")`, `document.body.classList`)
  rather than into a passed-in container.
- `packages/web/src/app/editor-session.ts` — orchestrates per-image
  editor lifecycle (canvas + history + selection construction, drawer,
  right panel, toolbar, keyboard shortcuts, scratchpad, fit-observer,
  teardown). Depends on PWA-shell DOM ids (`#canvas-container`,
  `#file-manager`, `#statusbar`, `body.editor-mode` class), the
  PWA's `HeaderHost` / `StatusHost` / `SavePipeline` / `RouterHost`,
  and a deps object that includes capture / extension-transfer /
  plugin-host wiring.
- `packages/web/src/app.ts` — top-level shell that owns routing
  (`?p=<path>` URLs), the file-manager / gallery view, capture flows
  (paste / extension transfer / desktop), the plugin host, the
  scratchpad store, and the storage-bridge over five built-in
  backends.

The first three live under `packages/web/` because that's where they
landed historically. The last is genuinely PWA-specific. The shape of
this plan is to lift the first three into a host-neutral shell
package, and have `packages/web` consume it as the first user. The
VSCode extension then becomes the second user — same shell, different
host, different `StorageProvider`.

## Design

### New packages

```
@ingcreators/annot-editor-shell   NEW: per-image editor lifecycle,
                                   host-neutral. Mounts into a host-
                                   provided HTMLElement; takes a
                                   StorageProvider and a feature-flag
                                   bag; emits save / state events.
@ingcreators/annot-vscode          NEW: VSCode extension. Extension-
                                   host (Node) entry plus webview
                                   bundle. Webview hosts the shell;
                                   extension-host implements
                                   VSCodeStore over `vscode.workspace.fs`.
```

Both follow the existing naming convention. `annot-editor-shell` slots
between the Tier C primitives in `annot-editor` and the per-host
shells; the VSCode extension is the second consumer (PWA being the
first).

### Tier placement

`annot-editor-shell` is a Tier C package — it constructs
`CanvasManager` / `SelectionManager` / Lit elements that need a real
browser context. **It does not depend on `annot-render`** (no
canvas-based rasterization); `pptx-export` and `getPngDataUrl` reach
through `annot-editor` already.

Dependency direction: `editor-shell → editor → core`. PWA / VSCode
extension consume `editor-shell`. The CI cycle test in
[`packages/core/src/headless.test.ts`](../../packages/core/src/headless.test.ts)
extends to assert `editor-shell` is not pulled into `core` /
`render` chains.

### Host contract

`annot-editor-shell` exports an `EditorShell` class with a narrow
constructor signature:

```ts
interface EditorShellHost {
  /** The container element the shell mounts into. The shell owns
   *  this element's children — host code must not mutate them
   *  while the shell is active. */
  container: HTMLElement;
  /** Storage backing the editor. Reads/writes annotations, image
   *  records, page metadata. */
  storage: StorageProvider;
  /** Optional UI sections registered by the host (drawer +
   *  right-panel). Same shape as the existing PluginHost UISection
   *  contract; the shell doesn't care whether they came from a
   *  plugin or the host itself. */
  drawerSections?: () => UISection[];
  rightPanelSections?: () => UISection[];
  /** Feature opt-out. The PWA enables everything; the VSCode
   *  extension disables capture (no extension capture pipeline
   *  available) and the file-manager-shell (VSCode's own Explorer
   *  is the file manager). */
  features?: {
    capture?: boolean;        // default true
    fileManager?: boolean;    // default true
    scratchpad?: boolean;     // default true
    keyboardHelp?: boolean;   // default true
  };
  /** Theme override. PWA uses the design-system foundations theme
   *  (light / dark via CSS vars). VSCode passes through the
   *  active workbench theme via CSS-var injection. */
  themeOverrides?: Record<string, string>;
}

class EditorShell {
  constructor(host: EditorShellHost);

  /** Open an image at the given storage path. Resolves once the
   *  canvas + selection + history + toolbar + right panel are
   *  mounted and the first annotation render has completed. */
  open(path: string): Promise<void>;

  /** Save the current annotations through the host StorageProvider.
   *  Idempotent; no-op if there are no unsaved changes. */
  saveNow(): Promise<void>;

  /** Tear down all per-session DOM listeners and remove the shell's
   *  children from `host.container`. The shell is single-use after
   *  destroy(); construct a new one for the next image. */
  destroy(): void;

  /** Event subscription. The shell emits 'dirty' / 'saved' /
   *  'error' / 'selection-change' so the host can drive its own
   *  UI (PWA's SaveStatusIndicator, VSCode's titlebar dirty mark,
   *  …). */
  on(event: EditorShellEvent, handler: (...args: unknown[]) => void): () => void;
}
```

The shape is intentionally narrow. The host owns:

- The window chrome (PWA: editor header + statusbar; VSCode: workbench).
- File browsing (PWA: FileManager; VSCode: Explorer).
- Capture intake (PWA: paste / extension transfer / desktop;
  VSCode: drag-drop a `.png` onto the editor area, or "Annotate
  Image" command palette entry).
- Routing (PWA: `?p=<path>`; VSCode: `vscode://` URIs and the
  custom-editor activation contract).
- Plugin host (PWA: existing; VSCode: deferred to a future plan —
  the `UISection` contract is already host-neutral so plugins
  authored against PWA can run inside VSCode once a plugin loader
  exists).

### What stays in `packages/web`

After the extraction, `packages/web` is the **PWA host** for the
shell:

- `app.ts` keeps owning routing / capture / file-manager / extension-
  transfer / plugin-host / scratchpad-store / storage-bridge.
- `editor-session.ts` shrinks to ~30 LOC — it constructs an
  `EditorShell`, passes the PWA's `HeaderHost` / `StatusHost` /
  `SavePipeline` event wiring, and handles the page-metadata-passthrough
  that's PWA-specific.
- `editor/right-panel.ts`, `editor/toolbar.ts`,
  `editor/annot-file-details-drawer.ts`, `editor/keyboard-help.ts`,
  `editor/scratchpad-*.ts` move out of `packages/web/` into the
  shell package. Their custom-element names stay `annot-*`.
- The `editor.css` styles that the shell needs move alongside it
  (or get inlined as Lit `static styles` opportunistically per the
  existing hybrid-CSS convention).

### What changes in `packages/extension` and `packages/desktop`

Nothing in this plan. Capture remains an extension concern; desktop
remains a Tauri wrap of the PWA. A future plan can teach the desktop
to host the shell directly (no PWA wrapper) once the VSCode work has
proven the extraction's boundaries.

### File extensions and the custom-editor association

Annot files use a **double-extension** convention so the VSCode
custom-editor association can be filename-based — no content
sniffing, no risk of grabbing every `.svg` / `.png` in the
workspace:

| Extension | Meaning |
|-----------|---------|
| `*.annot.svg` | Annotation source. The canonical SVG with `data-annot-version` on the root + the embedded base64 image (current `<image href="data:...">` carrier) + every `<g data-type="...">` annotation layer. The "source of truth" per **P1** in `PRODUCT_DIRECTION.md`. |
| `*.annot.png` | Editable PNG export. Carries the SVG annotation source inside an XMP packet via the existing `xmp` subpath round-trip (`createEditableImage` / `readEditableImage`). Opening one in VSCode reads the XMP back, edits the annotations, and re-encodes the PNG on save. |
| `*.annot.jpeg` / `*.annot.jpg` | Same as `*.annot.png` but JPEG-encoded; XMP packet preserved by the encoder. Both extensions are first-class so the convention matches whatever the user named the upstream screenshot. |

The `.annot.` infix is the disambiguator. Files without it are
ordinary images / SVGs and continue to open in their default
editors. The custom-editor `contributes.customEditors.selector`
entries glob exactly `**/*.annot.{svg,png,jpeg,jpg}` — VSCode
matches on filename, no in-process content inspection needed.

Save semantics differ by extension:

- `*.annot.svg` — write the SVG string directly via
  `vscode.workspace.fs.writeFile`. Round-trip is byte-stable for
  the SVG itself (the editor's existing `exportSVGString` is
  deterministic).
- `*.annot.png` / `*.annot.jpeg` / `*.annot.jpg` — re-render the
  current canvas to a bitmap, embed the SVG annotation source as
  XMP, and write the encoded image. The PNG / JPEG path goes
  through the existing `saveAsEditableImage` helper in
  `@ingcreators/annot-editor`.

**New annotation creation** in VSCode is a "Save As" step from one
of the command-palette entries below — picking the extension picks
the storage shape (raw SVG vs. editable raster).

### VSCode-specific surfaces

- **Custom editor for `*.annot.{svg,png,jpeg,jpg}` files.**
  Activation event: opening any file matching the glob (per the
  table above). Files lacking the `.annot.` infix continue to
  open in their default editors.
- **Command palette entries.** `Annot: New annotation from clipboard
  image`, `Annot: New annotation from image…` (open + save-as +
  XMP recovery — see Phase 5 image-import flow below),
  `Annot: Open annotation`, `Annot: Save as PNG…`
  (writes `*.annot.png`), `Annot: Save as JPEG…`
  (writes `*.annot.jpeg`), `Annot: Export to PowerPoint…`,
  `Annot: Reveal in Explorer`.
- **Status bar item.** Save status (synced / dirty / saving / error)
  mirroring the PWA's `<annot-save-status>` element.
- **Workspace contribution.** The extension contributes a default
  `tests/__annotations__/` folder convention to the Playwright
  integration story. Documented; no hard dependency.
- **Theme integration.** VSCode's `workbench.colorTheme` exposes a
  `--vscode-*` CSS variable family inside the webview; the shell
  receives a host-supplied `themeOverrides` map mapping `--annot-*`
  tokens to the matching `--vscode-*` variables (e.g.
  `--annot-bg-canvas` → `var(--vscode-editor-background)`).

### Storage: VSCodeStore over `vscode.workspace.fs`

`VSCodeStore` implements `StorageProvider` and lives in the
extension-host (Node) side, exposed to the webview through
VSCode's `Webview.postMessage` JSON-RPC bridge. The webview-side
shim presents the standard `StorageProvider` interface to the
shell; the host-side implementation translates each call to a
`vscode.workspace.fs.{readFile,writeFile,readDirectory,delete,
rename,createDirectory}` call.

Path semantics match the existing path-based storage convention
(`/folder/file.svg`); the workspace root is `/`. Multi-root
workspaces map to top-level folders. Thumbnails go through the
existing `IndexedDBThumbnailCache` inside the webview (no host-
side persistence needed — VSCode's webview-state survives reloads
within an editor lifetime; longer-term thumbnail persistence can
use VSCode's `workspaceState` later if it matters).

Save / save-as / rename / delete trigger `workspace.fs.*`
mutations directly; VSCode's file-watcher picks up the change and
the Explorer view refreshes for free. No Annot-side file watcher
is needed.

### Playwright integration touchpoint

A separate `docs/plans/playwright-integration.md` (TBD) covers the
headless annotator + locator round-trip. This plan only commits to
two preconditions:

1. The `PageMetadata.locator?: string` field reserved by **P5**
   stays additive-only (existing CLAUDE.md guardrail #4).
2. The shell exposes a `getCurrentPageMetadata(): PageMetadata`
   method on `EditorShell` so a future VSCode-side command can
   read the locator of the currently-selected element and "Reveal
   in test file" it. Extension-host implementation lives outside
   this plan.

## Phased plan

### Phase 0 — Coupling audit + boundary doc

Before moving any code, produce a `editor-shell-coupling.md`
audit doc inventorying every place in `packages/web/src/editor/`
and `packages/web/src/app/editor-session.ts` that reaches into
PWA-shell DOM ids (`#canvas-container`, `#file-manager`,
`#statusbar`, `editor-mode` body class, etc.) or PWA-shell
collaborators (`HeaderHost`, `StatusHost`, `SavePipeline`,
`RouterHost`, `PluginHost`).

Each coupling site gets one of three tags:

- **Move** — the responsibility belongs in the shell.
- **Inject** — the shell needs the value but the host owns it
  (e.g. the container element, the `StorageProvider`, the page-
  metadata passthrough).
- **Stay** — the responsibility is genuinely PWA-only (capture
  pipeline, file manager, route push).

Output: a single doc + a `EditorShellHost` interface draft. No
code changes. **One PR.**

This phase exists because the extraction is large enough that
guessing wrong about the boundary will cause Phase 1 to balloon.
A dedicated read-only pass de-risks the rest.

### Phase 1 — Scaffold `@ingcreators/annot-editor-shell`

Create the package with:

- `package.json` (npm name, `private: true` initially), `tsconfig`
  extending `tsconfig.lib.json`, Vite library config, Vitest config.
- `src/index.ts` re-exporting `EditorShell` (initially a stub class
  with the agreed signature, throwing in `open()`).
- A round-trip test that asserts `import { EditorShell } from
  "@ingcreators/annot-editor-shell"` resolves and the constructor
  type-checks against the documented `EditorShellHost` shape.
- CI workspace-build entry; the pnpm filter recognises the new
  package.

No PWA changes yet. **One small PR.**

### Phase 2 — Move toolbar / right-panel / drawer / scratchpad / keyboard-help into the shell

Move the leaf editor components (`packages/web/src/editor/`) into
`packages/editor-shell/src/` one Lit component cluster at a time.
Each move is a sub-PR; each preserves the existing `annot-*`
custom-element name and the existing co-located `*.stories.ts`
file (the Storybook bundle in `packages/web/.storybook/` updates
its include glob to pull from the new package).

Order (least-coupled first):

- Phase 2a: `keyboard-help.ts` (zero PWA-shell coupling).
- Phase 2b: `annot-file-details-drawer.ts` + `tag-editor.ts` (the
  drawer reads from `document.body` for absolute positioning;
  switch to a host-supplied `mountPoint` parameter).
- Phase 2c: `right-panel.ts` + the per-tool / per-section panel
  files.
- Phase 2d: `toolbar.ts` + `toolbar-canvas-menu.ts` +
  `toolbar-preset-helpers.ts` + `tool-factories.ts` +
  `tool-property-renderer.ts`. The biggest single sub-PR; this is
  the cluster the schema-driven refactor (`_done/toolbar-schema.md`)
  recently passed through, which makes the move easier.
- Phase 2e: `annot-scratchpad-section.ts` +
  `scratchpad-paste-tool.ts` + `scratchpad-utils.ts`. The
  `ScratchpadStore` (the IndexedDB persistence) stays in
  `packages/web/` since it's host-state; the popover UI moves.

DOM byte-equivalence (existing Storybook goldens + the renderer
goldens in [`property-panel-renderer.test.ts`](../../packages/editor/src/property-panel-renderer.test.ts)
and [`tool-property-renderer.test.ts`](../../packages/web/src/editor/tool-property-renderer.test.ts))
is the contract. Story `title:` strings stay
`Editor / FooBar` so Storybook navigation doesn't shift.

### Phase 3 — Construct `EditorShell` from `EditorSession`

Inside `packages/web/src/app/editor-session.ts`, replace the
imperative `setupEditor` body with `new EditorShell({...})` +
`shell.open(path)`. The `EditorSession` class shrinks to a thin
adapter that:

- Constructs the shell with the PWA's `StorageProvider` and the
  `#canvas-container` element.
- Subscribes to `dirty` / `saved` / `error` / `selection-change`
  events and bridges them to `HeaderHost` / `StatusHost` /
  `SavePipeline` (no behavioural change vs. today).
- Forwards page-metadata captured by the extension transfer flow
  into the shell via a host-only `setPageMetadata` setter.

Regression bar: a manual click-test of the editor (open image,
draw rect, change colour, undo, save, reopen, verify round-trip)
plus the existing test suite. **One PR.**

### Phase 4 — `packages/vscode/` skeleton

Create the VSCode extension package:

- `package.json` with VSCode `engines` + `contributes.customEditors`
  globbing `**/*.annot.{svg,png,jpeg,jpg}` (one custom-editor
  contribution covers all four; the webview branches on extension
  to pick the SVG-direct vs. XMP-embedded read path) + commands.
- `src/extension.ts` — extension-host entry. Activates on the
  custom-editor contribution; opens a webview per editor.
- `src/webview/index.html` + `src/webview/main.ts` — webview entry
  that constructs an `EditorShell` against a `WebviewStorageBridge`
  (the webview-side shim talking to `VSCodeStore` over
  `postMessage`).
- `src/storage/vscode-store.ts` — `StorageProvider` impl over
  `vscode.workspace.fs`.
- Bundle config: webview bundle is built by Vite; extension-host
  bundle by tsup or Vite library mode (Node target).

Acceptance: `code --extensionDevelopmentPath=packages/vscode`
opens a workspace; double-clicking each of `foo.annot.svg`,
`bar.annot.png`, and `baz.annot.jpg` opens the Annot editor in a
tab; a freehand stroke survives save + reload on all three
extensions; opening a plain `screenshot.png` (no `.annot.`
infix) still opens in the default image viewer. **One PR.**

### Phase 5 — VSCode UX polish

- Status bar item driven by shell `dirty` / `saved` events.
- Command palette entries (`Annot: New annotation from clipboard
  image`, `Annot: Save as PNG…`, `Annot: Export to PowerPoint…`,
  `Annot: Reveal in Explorer`).
- Theme bridging: shell `themeOverrides` populated from
  `--vscode-*` CSS vars at activation and on
  `vscode.window.onDidChangeActiveColorTheme`.
- Image-import flow via command palette
  (`Annot: New annotation from image…`). Mirrors the PWA's
  existing `CaptureHost.openFileDialog` →
  [`openFile(file)`](../../packages/web/src/app/capture-host.ts:188)
  flow exactly:
    1. `vscode.window.showOpenDialog` lets the user pick an image
       (`*.png` / `*.jpg` / `*.jpeg` / `*.svg`).
    2. The extension reads the file bytes; if the source is an
       editable image with an XMP-embedded annotation, the
       annotation is recovered via the existing `readEditableImage`
       round-trip (PWA does the same).
    3. `vscode.window.showSaveDialog` asks where to save the new
       Annot file, defaulting the filename to the source's
       basename with the `.annot.` infix inserted before the
       extension (`screenshot.png` → `screenshot.annot.png`). The
       user is free to change the path / name / extension before
       confirming — no implicit sibling file ever appears without
       explicit confirmation.
    4. `VSCodeStore.saveImage` writes the new file via
       `vscode.workspace.fs.writeFile` and the editor opens it.
    5. The source file is never modified. Same model as PWA:
       "import as a new ImageRecord; the upstream file is the
       user's, not Annot's."

  No drag-drop intake in this plan. PWA does not implement
  drag-drop today (verified — the `.upload-area.dragover` CSS
  selector in [`app.css`](../../packages/web/src/styles/app.css)
  has no JS handler binding); adding one to VSCode unilaterally
  would put the two hosts out of sync. A follow-up plan can add
  drag-drop **simultaneously to both PWA and VSCode** so the
  intake UX stays consistent across hosts.
- README + extension marketplace metadata.

Each bullet is a sub-PR.

### Phase 6 — Plan archival + CLAUDE.md guardrail

- Move this plan to `_done/` with a one-line entry in the recent-
  landed table.
- Add a CLAUDE.md guardrail: "the editor shell mounts into a
  host-supplied container and never reaches into PWA-shell DOM
  ids; new editor UI lives in `@ingcreators/annot-editor-shell`,
  not in `packages/web/src/editor/`".
- Add a CI invariant to the `headless.test.ts` family: load
  `editor-shell` under jsdom with a synthetic container; assert
  it doesn't touch `document.getElementById("canvas-container")`
  or any other PWA-shell id.

## Verification

Per phase:

- Phase 0: coupling audit doc reviewed; no code changes.
- Phase 1: `pnpm -r typecheck` + `pnpm -r build` green;
  `import { EditorShell } from "@ingcreators/annot-editor-shell"`
  resolves.
- Phase 2 (each sub-PR): `pnpm -r typecheck`, Storybook bundle
  builds, renderer goldens unchanged, manual click-test of the
  editor surface still works in the PWA.
- Phase 3: full editor click-test (paste image → draw → undo →
  save → reload → verify round-trip), `pnpm test` pass count
  steady.
- Phase 4: VSCode dev-host launch opens the editor and round-
  trips a freehand stroke through `vscode.workspace.fs`.
- Phase 5: each polish sub-PR ships its own click-test.
- Phase 6: `pnpm -r typecheck` + `pnpm -r build` green; new CI
  invariant in `headless.test.ts` passes; CLAUDE.md guardrail
  added.

## Migration notes

- **No SVG schema change.** This plan does not bump
  `data-annot-version`.
- **No `StorageProvider` change.** `VSCodeStore` is a fifth
  built-in implementation behind the existing interface. Plugin
  authors who registered storage backends via Phase C of
  `_done/plugin-storage-registration.md` continue to work in the
  PWA; whether they work in the VSCode webview depends on whether
  the plugin's runtime needs (Chrome extension API, `window.open`
  OAuth popups, etc.) are available there. Documented as a
  future concern; not blocking.
- **No `PageMetadata` change.** The `locator?: string` field
  reservation from **P5** is unchanged.
- **PWA continues to ship from `packages/web`.** No URL change,
  no routing change, no user-visible PWA regression.
- **Pre-release.** Annot is pre-1.0; no published consumers of
  the moved-out symbols. The migration is internal-only.

## Forward-looking notes

This plan is intentionally scoped to "VSCode extension hosts the
editor". Three adjacent bodies of work that this enables but does
not deliver:

- **`docs/plans/playwright-integration.md`** (TBD) — headless
  annotator producing annotated screenshots from
  `page.locator(...)` references. The `EditorShell` boundary
  defined here is the natural seam for the shell to render an
  annotated image at test-time without launching a window.
- **Desktop hosts the shell directly.** Today, `packages/desktop`
  is a Tauri wrap of the PWA. Once the shell is extracted, a
  follow-up plan can have the desktop host the shell directly
  (skipping the PWA layer) so it can offer a native file manager,
  native menu items, and a Tauri-backed `StorageProvider`. No
  user-visible regression — the existing wrap continues to work
  until it's replaced.
- **Plugin loader inside VSCode.** The `UISection` contract is
  already host-neutral. A future plan can stand up a VSCode-
  flavoured `PluginHost` (using VSCode's extension-loading
  primitives) so PWA plugins run inside the VSCode editor too.
  Out of scope here — the first VSCode build ships without a
  plugin host.
