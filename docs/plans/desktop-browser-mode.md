# Desktop Browser Mode (full extension parity, shared core)

> **Status:** Queued (Phases 1–2 + the new Phases 3–5; the original
> Phases 3–6 that allocated per-OS WebView API work are deleted —
> superseded by [`_done/desktop-electron-migration.md`](./_done/desktop-electron-migration.md)
> Phase 6, which shipped a minimum-viable Browse window
> (`browse.html` + [`packages/desktop/src/browse/browse.ts`](../../packages/desktop/src/browse/browse.ts)
> + [`packages/desktop/src-electron/ipc/browse.ts`](../../packages/desktop/src-electron/ipc/browse.ts))
> on uniform Chromium).
>
> **Compatibility:** New shared package `@ingcreators/annot-capture`
> extracted from `packages/extension`. `packages/extension` and
> `packages/desktop` both consume it as host adapters. No public
> API change to `@ingcreators/annot-core`. The Phase 6 MVP IPC
> surface (`browse.open` / `browse.captureVisible` /
> `browse.persistVisible`) gets reframed as a `CaptureHost`
> implementation; the renderer-side `<webview>` chrome stays in
> place. The capture-overlay window (Phase 3 of the Electron
> migration) for screen / window / region capture is unaffected —
> Browser mode targets the *embedded* `<webview>`, not the OS
> desktop.
>
> **Risk:** Largest cross-cutting refactor since the Lit migration.
> Extracting capture orchestration without breaking the live
> extension is the dominant risk; mitigated by shipping the
> shared package with the extension as the first consumer
> (Phase 1) before adding the Electron consumer (Phase 3+).
> The earlier per-OS API parity risk (WebView2 / WKWebView /
> WebKitGTK each having different snapshot APIs and gaps such as
> WKWebView's black-frame video bug) **is gone**: every Electron
> renderer is a Chromium `webContents`, so
> `webContents.capturePage()` and `webContents.debugger.attach()`
> + CDP `Page.captureScreenshot { captureBeyondViewport: true }`
> work uniformly on Win / Mac / Linux. Phases 1–2 are pure
> refactors that the user has explicitly accepted, including the
> brief feature-freeze on the extension during that period.

## Context

The Chrome MV3 extension (`packages/extension`, ~4k LOC) is
currently the only host that can capture **arbitrary web pages**.
It implements six capture modes (visible / area / full-page scroll
/ per-page scroll / click / hotkey), DOM metadata extraction,
sticky/scrollbar hide-restore, viewport emulation by window
resize, and a smart PNG-8 / PNG / JPEG encoding pipeline.

The desktop already has:

- **OS-level screen capture** (full screen / window / region) via
  `desktopCapturer` + a transparent overlay `BrowserWindow` in
  [`packages/desktop/src-electron/ipc/screen-capture.ts`](../../packages/desktop/src-electron/ipc/screen-capture.ts).
- **Browse window MVP** ([`browse.html`](../../packages/desktop/browse.html)
  + [`src/browse/browse.ts`](../../packages/desktop/src/browse/browse.ts)
  + [`src-electron/ipc/browse.ts`](../../packages/desktop/src-electron/ipc/browse.ts))
  that opens a separate `BrowserWindow` with an `<webview>` tag,
  navigates to a URL, and captures the visible viewport via
  `webContents.capturePage()`. Single tab, visible mode only. The
  saved PNG lands in `<userData>/library/Inbox/` and shows up in
  the gallery's `<annot-file-manager-shell>`.

What the Browse window MVP **doesn't** do (the gap this plan
fills):

- The other five capture modes (area / full-page / per-page /
  click / hotkey).
- DOM metadata extraction (the `PageMetadata` walker the editor's
  Elements panel consumes).
- Sticky / scrollbar handling that the extension performs around
  every capture.
- Multi-tab / `window.open` routing (today the MVP denies all
  popups).
- Viewport emulation presets (Mobile / iPad / etc.) that the
  extension popup exposes.

These all live as DOM-/canvas-side code in
`packages/extension/src/content/*`,
`packages/extension/src/background/capture-strategy.ts`, and
`packages/extension/src/offscreen/encode-worker.ts`. **Almost
none of it depends on `chrome.*`** — the touchpoints are:

- `chrome.tabs.captureVisibleTab` (the actual screenshot)
- `chrome.windows.update` (window-resize emulation)
- `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`
  (transport between background ↔ content ↔ offscreen)
- `chrome.storage.sync` (settings persistence)
- `chrome.scripting.executeScript` (content-script injection)

Everything else — sticky handling, scroll control, area
selection, page metadata extraction, encoding, stitching, mosaic,
crop — is pure DOM / canvas / `OffscreenCanvas` code that runs
unmodified in any modern Chromium context. In Electron's Browse
window, the `<webview>` host's `webContents` is a regular
Chromium renderer, so the same content-side code runs there
verbatim.

This plan replaces the per-host duplication with a single
`@ingcreators/annot-capture` package and grows the existing
Electron Browse window into a second consumer that hits feature
parity with the extension.

## Design

### Package layout after the split

```
packages/
  capture/       NEW. Host-agnostic capture orchestration.
                 npm name: @ingcreators/annot-capture
  extension/     Chrome MV3 host adapter (thin glue around
                 capture).
  desktop/       Electron host. Consumes capture from
                 src-electron/ipc/browse.ts (new CaptureHost
                 implementation) plus a renderer-side adapter
                 mounted in src/browse/browse.ts.
```

`@ingcreators/annot-capture` exports:

- **Content modules** (DOM-side, host-injectable as-is):
  `sticky-handler`, `scroll-controller`, `area-selector`,
  `progress-overlay`, `page-metadata`. These already live as
  separate files in `packages/extension/src/content/` and
  reference no `chrome.*` API except the message bus, which is
  abstracted out in this plan.
- **Capture orchestrators** (background-side, host-driven via
  the `CaptureHost` interface):
  `runVisibleCapture`, `runAreaCapture`, `runScrollCapture`,
  `runPerPageCapture`, `runClickCapture`, `runHotkeyCapture`.
- **Encoding pipeline**: `encode.ts` plus the offscreen worker
  source, packaged so hosts can spawn it as a `Worker` URL.
- **Image ops** (stitch / crop / mosaic): pure
  `OffscreenCanvas` code, used as-is by both hosts.
- **Settings types** + `parseSelectorList` / `resolveEmulation`
  / `shouldHideOverlaysFor` helpers. Storage IO is host-owned.

### The `CaptureHost` interface

This is the seam. Every host implements it; orchestrators only
call methods on this interface. Sketch:

```ts
export interface CaptureHost {
  // Imaging
  captureViewport(): Promise<{ pngDataUrl: string; dpr: number }>;
  // Window emulation
  setEmulatedViewport(size: { width: number; height: number } | null): Promise<void>;
  // Content-script transport
  sendToContent<T>(msg: ContentRequest): Promise<T>;
  onContentMessage(handler: (msg: ContentEvent) => void): () => void;
  // Encode worker
  spawnEncodeWorker(): Worker;
  // Settings IO
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  // Persistence (transient capture results)
  appendCapture(record: CaptureRecord): Promise<void>;
  // Logging hook (extension uses console; desktop forwards to main)
  log(level: "info" | "warn" | "error", ...args: unknown[]): void;
}
```

Rationale for shape:

- **One `captureViewport`, no full-page primitive.** Full-page
  is built by the orchestrator out of `scrollTo` (content) +
  `captureViewport` (host) + stitch (shared). On the extension
  side this maps to `chrome.tabs.captureVisibleTab`; on the
  Electron side to `webContents.capturePage()` against the
  Browse window's child `<webview>` (today already wired in
  [`browse.captureVisible`](../../packages/desktop/src-electron/ipc/browse.ts)).
  An orchestrator-level alternative — `webContents.debugger.attach()`
  + CDP `Page.captureScreenshot { captureBeyondViewport: true }`
  — is available too, but that's an internal optimisation; the
  cross-host orchestrator stays scroll+stitch so behaviour is
  bit-identical to the extension's existing path.
- **`setEmulatedViewport` is async + reversible.** The caller
  always pairs `set(target)` ... `set(null)` to restore. On
  Chrome this maps to `chrome.windows.update` with a saved
  geometry; on Electron it maps to `BrowserView::setBounds`
  (or `<webview>.setSize` plus the chrome's column-layout
  re-flow) with a saved geometry on the main side.
- **Transport is request/response + event stream.** Mirrors
  what `chrome.runtime.sendMessage` (with `sendResponse`) and
  `chrome.runtime.onMessage` already provide. Electron implements
  the same shape via a content-script preload that exposes a
  `__annot.dispatch` global, paired with `ipcRenderer.send` events
  bridged through the main process.

### Capture path on Electron (Chromium-uniform)

Implemented as `ipcMain.handle` channels in
`packages/desktop/src-electron/ipc/browse.ts`; the renderer-side
adapter calls them via `window.electronAPI.invoke`.

| Operation | Electron primitive | Notes |
|---|---|---|
| Viewport capture | `webContents.capturePage()` returning a `NativeImage` | Already shipped as `browse.captureVisible`. Returns PNG bytes; `nativeImage.getSize()` gives logical pixels and `getScaleFactor()` (or division against the underlying buffer dimensions) yields DPR. |
| Beyond-viewport capture (optional fast path) | `webContents.debugger.attach('1.3')` + `Page.captureScreenshot { captureBeyondViewport: true }` | Electron exposes the full Chromium DevTools Protocol on every `webContents`. Used by the optional CDP fast-path inside `runScrollCapture` for pages where the scroll-stitch loop is slow. |
| Webview window resize / emulation | `BrowserView::setBounds` (or `<webview>.setSize`) — saved-geometry restore | `<webview>` rooted in the Browse-window chrome's flex layout; the chrome owns the saved geometry and restores on `set(null)`. |
| Content-script injection | `webContents.session.setPreloads` (per-session) **or** `webPreferences.preload` per `<webview>` | Single bundle, runs at every navigation. No isolated-/MAIN-world hack needed (cf. CLAUDE.md "DOM metadata collection runs in MAIN world"). |
| Window-open / tab spawn | `webContents.setWindowOpenHandler` returning `{ action: 'allow', overrideBrowserWindowOptions: ... }` | Routes `window.open` / `target="_blank"` / OAuth popups into a sibling `BrowserView` in the same Browse window. |
| Global hotkey | `globalShortcut.register` | Targets the focused Browse window. |

The earlier draft of this plan allocated three of seven phases
to per-OS API plumbing (Phase 3 Windows-first WebView2 CDP,
Phase 4 browser shell on Windows only, Phase 6 macOS + Linux
capture). All three collapse onto the rows above. The macOS-
specific WKWebView black-frame issue during video playback
goes away (Chromium captures video frames fine).

DPR is **always returned by the host** alongside the PNG.
Orchestrators stop calling `window.devicePixelRatio` from JS
and trust the value from the host. This fixes a long-standing
extension bug where DPR drift between content/background mid-
capture corrupts the stitched output.

### Browser mode UX (Electron)

A **separate `BrowserWindow`** ("Browse window") hosts the
arbitrary URL, distinct from the app's main library/editor
window. The Browse window itself owns the capture entry points;
the main window does NOT trigger captures (avoids the "which
browse tab am I capturing?" UX problem when multiple Browse
windows are open). The single-tab / visible-only MVP is already
shipped — this plan grows it.

Browse window layout:

```
┌─ Electron BrowserWindow ───────────────────────────────────┐
│ ┌─ Address bar / nav / capture toolbar ────────────────────┐│
│ ├──────────────────────────────────────────────────────────┤│
│ │                                                          ││
│ │  ← Embedded child renderer (target page)                 ││
│ │     <webview> tag (preferred; isolated webContents) OR   ││
│ │     BrowserView (more performant, less DOM-controllable) ││
│ │                                                          ││
│ │  Content-script preload: @ingcreators/annot-capture/content
│ │                                                          ││
│ └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

- The outer **chrome** (address bar, nav, **tab bar**, capture
  toolbar) is a normal Vite/Lit route loaded into the
  `BrowserWindow`'s renderer. `browse.html` already serves this
  role for the MVP.
- The inner **target webview** is a `<webview>` element today
  (MVP). Phase 5 reconsiders `BrowserView` as a tab is added —
  it's a simpler webContents lifecycle for multi-tab — but the
  capture path is identical across the two: both expose a
  `webContents` instance addressable by id from the main
  process. Each tab has a distinct `webContentsId` and the
  active tab's id flows through every host call.
- Content scripts inject ONLY into target webviews via the
  per-webview preload — the chrome webview stays clean.

### Tabs and `window.open` handling

Web apps routinely open new tabs (`<a target="_blank">`,
`window.open`, OAuth popups, Drive Picker, etc.). The Browse
window MUST handle these — without explicit hooks, Electron
silently denies them (the MVP's current behaviour:
`setWindowOpenHandler(() => ({ action: "deny" }))`), which
breaks OAuth flows and "outside the sandbox" navigations.

Default behavior (configurable):

- **Same Browse window, new tab**: replace the MVP's blanket
  deny with a `setWindowOpenHandler` callback that returns
  `{ action: 'allow', outlivesOpener: false, overrideBrowserWindowOptions: ... }`
  and is paired with a `did-create-window` (for `BrowserView`)
  or `new-window` (for `<webview>`) listener that adopts the
  spawned `webContents` as a sibling tab in the *current*
  Browse window. `window.opener` is preserved by Electron's
  default chain — required for OAuth popups and any
  postMessage-based parent/child app communication.
- **Detach to new Browse window**: opt-in alternative for
  the user (right-click tab → "Open in new window"), or for
  links that arrive with `noopener`.

Capture interaction with tabs:

- The capture toolbar always targets the **active tab**.
- During multi-segment captures (full-page, per-page),
  tab switching is **disabled** in the chrome UI to avoid
  mid-capture target swaps. Re-enabled when the orchestrator
  signals completion.
- Closing the active tab during capture cancels the
  capture and surfaces an error in the progress overlay.
- Each tab has independent settings emulation state — if
  Tab A is in iPhone preset and Tab B is native, switching
  tabs swaps the emulated viewport accordingly.

**Capture entry points** on the Browse window's toolbar map
1:1 to the extension popup:

| Toolbar button | Orchestrator call | Extension parity |
|---|---|---|
| 📷 Visible | `runVisibleCapture(host)` | Capture Visible |
| ⬚ Area | `runAreaCapture(host)` (drag-select inside target) | Capture Area |
| 📄 Full Page | `runScrollCapture(host)` | Full Page |
| 🗒 Per Page | `runPerPageCapture(host)` | Per-Page |
| 🖱 Click ▶/■ | `runClickCapture(host)` toggle | Click Capture |
| ⌨ Hotkey ▶/■ | `runHotkeyCapture(host)` toggle | Hotkey Capture |

The MVP's "📷 Capture Visible" button maps directly to
`runVisibleCapture` once Phase 3 lands; the other five become
visible only after the orchestrators are wired up.

In addition, the **target webview's right-click context menu**
exposes the same six modes — same content-script pattern as
the extension's in-page context menu. This is the "trigger
from inside the page" path that mirrors the extension's
keyboard-shortcut behavior.

**Global hotkey capture** uses Electron's `globalShortcut`
registered at app level. On press, the currently-focused
Browse window is the target; if no Browse window has focus,
the hotkey is a no-op. Multiple Browse windows are supported;
focus disambiguates.

**Main window role**: stays a library/editor surface only. The
existing main-window gallery sidebar already has a "+ New
Browse" entry under its New menu (added in
[`_done/desktop-electron-migration.md`](./_done/desktop-electron-migration.md)
Phase 6) that spawns a Browse window via `browse.open`. Capture
itself is never initiated from the main window.

Captured images flow into the existing `DesktopStore` /
`DesktopFs` filesystem-backed library
(`<userData>/library/Inbox/<filename>.annot.png` plus the
JSON sidecar — see
[`_done/desktop-storage-provider-migration.md`](./_done/desktop-storage-provider-migration.md)),
so the main window's gallery picks them up with no schema
change. The MVP's `browse.persistVisible` IPC already does this
for the visible-mode path; the orchestrator-driven modes route
through the same primitive.

### Settings storage

The shape stays identical to the extension's `Settings`
([`packages/extension/src/shared/settings.ts`](../../packages/extension/src/shared/settings.ts)).
Persistence is host-owned:

- Extension: `chrome.storage.sync` (existing).
- Desktop: a JSON blob in the app's data dir, written via the
  existing `settings.ts` IPC layer
  ([`packages/desktop/src-electron/ipc/settings.ts`](../../packages/desktop/src-electron/ipc/settings.ts)).
  No cross-device sync in v1.

A future consolidation (shared `BrowserModeSettings` schema in
`@ingcreators/annot-core`) is possible but out of scope here.

### Content-script injection

- **Extension**: keeps the existing
  `chrome.scripting.executeScript({ files: ["content.js"] })`
  + IIFE wrapper. The content bundle simply imports
  `@ingcreators/annot-capture/content` instead of local files.
- **Desktop**: the Browse window mounts the same content
  bundle as a per-`<webview>` `preload` script (or as a
  per-session preload via `session.setPreloads`). It runs at
  every navigation in any target webview without re-injection
  bookkeeping. The chrome's own `webContents` does NOT load
  the preload; capture preloads target the content webview
  exclusively.

### Message transport (concrete mapping)

| Operation | Extension | Desktop |
|---|---|---|
| BG → Content request | `chrome.tabs.sendMessage(tabId, msg, cb)` | Renderer-side adapter calls the chrome's `<webview>.send(...)` (or the equivalent for `BrowserView`); the preload bridges incoming events through `__annot.dispatch` and replies via `ipcRenderer.send`. The main process forwards back to the originating renderer. |
| Content → BG event | `chrome.runtime.sendMessage(msg)` | `ipcRenderer.send('annot.content.event', msg)` from the preload; main rebroadcasts to the chrome's `webContents`. |
| BG → Offscreen (encoder) | `chrome.runtime.sendMessage` to offscreen doc | Direct `Worker` from the chrome's renderer (no offscreen-document indirection needed; the chrome is itself a regular renderer). |
| Settings change broadcast | `chrome.storage.onChanged` | `ipcMain.emit('settings.changed', ...)` → renderer event. |

The orchestrator never sees these — it only sees the
`CaptureHost` methods.

### Relationship to existing host-ui work

The recently-extracted [`@ingcreators/annot-host-ui`](../../packages/host-ui)
package owns the editor surface (`EditorShell`, `HeaderHost`,
`SavePipeline`, `StatusHost`) and the unified gallery shell
(`<annot-file-manager-shell>`). Browser mode does NOT live in
host-ui — it's a *capture* host, not an editor host. The two
boundaries are deliberately distinct:

- `@ingcreators/annot-capture` (this plan): producing image
  records by driving a webview / browser tab.
- `@ingcreators/annot-host-ui`: editing image records the
  user has opened.

The captured image records flow from capture → DesktopStore →
host-ui's gallery + editor without either package importing
the other. (Specifically, a successful Phase 4 capture writes
through `host.appendCapture(...)` which the Electron host
implements as `DesktopStore.put(...)`; the gallery picks it up
via the standard storage-provider observer chain.)

## Phased plan

Each phase lands as one PR per CLAUDE.md's "one PR per phase"
rule. Phases 1–2 are pure refactors with the live extension as
the only consumer; Phase 3+ adds the Electron consumer.

### Phase 1 — extract `@ingcreators/annot-capture`, extension stays the only consumer

The extraction is split into two PRs because the capture
state-machine code in `service-worker.ts` (~1.9k LOC, with deep
`chrome.*` coupling) is too large to land safely in one
mechanical move. The split keeps each PR independently
revertable per CLAUDE.md's "one PR per phase" rule (we treat
the two sub-PRs as a phase pair the way other plans split
big phases into PR A / PR B / PR C).

**Phase 1A — Scaffolding + chrome-free moves.** Lands the
package, the seam, and every piece that doesn't need
`chrome.*` to compile.

- Create `packages/capture/` with `package.json`, `tsconfig.json`,
  Vite config (library mode, ESM only) and subpath exports
  (`./content`, `./encode`, `./shared`, `./orchestrate`,
  `./host`).
- Move shared types: `messages.ts` (verbatim — pure types),
  `encode.ts` (verbatim — already pure), and the **pure half**
  of `settings.ts` (the `Settings` shape, `DEFAULT_SETTINGS`,
  `mergeSettings`, `parseSelectorList`, `resolveEmulation`,
  `shouldHideOverlaysFor`, `EMULATION_PRESETS` and their
  types). The chrome.storage-bound `loadSettings` /
  `saveSettings` / `onSettingsChange` stay in
  `packages/extension/src/shared/settings.ts` as a thin
  re-export layer, since they're host I/O.
- Move content modules: `sticky-handler.ts`,
  `scroll-controller.ts`, `progress-overlay.ts` move verbatim
  (no `chrome.*` references in their bodies).
  `area-selector.ts` moves with its `chrome.runtime.sendMessage`
  call abstracted into a `ContentBus` parameter (interface
  defined in `packages/capture/src/content/content-bus.ts`).
- Move encode pipeline: `offscreen/encode-worker.ts` moves
  verbatim. The worker pool + `handleStitch` / `handleCrop` /
  `handleMosaic` move into `packages/capture/src/encode/image-ops.ts`
  as pure functions; the chrome.runtime.onMessage listener
  in `offscreen.ts` stays in extension and dispatches to the
  moved functions.
- Move `capture-strategy.ts` to
  `packages/capture/src/orchestrate/strategy.ts` (already pure).
- Define `CaptureHost` interface in `packages/capture/src/host.ts`
  (consumed by Phase 1B's orchestrators; not yet wired from
  the service worker).
- Extension's content `index.ts` keeps the `chrome.runtime.onMessage`
  listener wiring; it imports the moved pieces from
  `@ingcreators/annot-capture/content/*`.
- Extension's offscreen `offscreen.ts` keeps the
  `chrome.runtime.onMessage` listener wiring; it imports the
  moved pieces from `@ingcreators/annot-capture/encode/*`.
- **No service-worker.ts orchestrator extraction yet** — the
  state machines (visible / area / scroll / perPage / click /
  hotkey) stay in the extension and call into the moved
  helpers. They'll move in Phase 1B.

**Verify (Phase 1A)**: extension installs and all 6 capture
modes work exactly as before; the bundled `content.js` /
`offscreen.js` / `service-worker.js` byte-diff against the
pre-PR build is small and obviously mechanical (just the
import paths change). `pnpm -r typecheck` + `pnpm test` pass.

**Phase 1B — Orchestrator extraction + extension as thin host
adapter.** Lifts the six state machines from `service-worker.ts`
into `packages/capture/src/orchestrate/*` and rewires the
extension as a thin `CaptureHost` consumer.

- Extract the capture state machines from
  `service-worker.ts` (~1.5k LOC across `captureVisible` /
  `captureArea` / `captureFullPageInner` / `capturePagesInner` /
  `handleClickDetected` / `hotkeyCaptureShot` plus their
  helpers) into `packages/capture/src/orchestrate/*` (one file
  per mode plus a shared `runCapture.ts` for the common
  setup / teardown / persistence dance).
- Page metadata walker (`requestPageMetadata`'s inline `func`
  in `service-worker.ts`) moves to
  `packages/capture/src/content/page-metadata-walker.ts` as a
  self-contained, closure-free function so
  `chrome.scripting.executeScript({ func, world: "MAIN" })`
  picks it up via `func.toString()` without bundler-injected
  references.
- `packages/extension/src/background/host.ts` implements
  `CaptureHost` over `chrome.*` (tabs, windows, scripting,
  runtime, offscreen). The chrome-side persistence layer
  (`idbStore.saveImage` + thumbnail + tags) is exposed
  through `host.appendCapture(record)`.
- `service-worker.ts` shrinks to wiring + lifecycle: popup
  / external / command listener → orchestrator call. Existing
  manifest, popup UI, options UI unchanged.

**Verify (Phase 1B)**: extension installs and all 6 capture
modes still work. Service-worker LOC drops from ~1.9k to a
few hundred lines (wiring + lifecycle only). End-to-end
capture saved to PWA arrives byte-equivalent to pre-refactor.

### Phase 2 — DPR-from-host correction

- Migrate orchestrators off `window.devicePixelRatio` to the
  DPR returned by `host.captureViewport()`.
- Extension host adapter: derive DPR from the captured image
  size vs. reported viewport size (current behavior). No
  semantic change; this just centralizes it.
- Add a regression test capturing a known-DPR fixture.

**Verify**: scroll-stitched captures on a HiDPI display match
pixel-for-pixel pre-Phase-2 output. This phase is decoupled
from desktop landing so a regression here doesn't block
desktop work.

### Phase 3 — Electron host: `CaptureHost` over the Browse window MVP

Replace the bespoke `browse.captureVisible` /
`browse.persistVisible` IPC pair with a `CaptureHost`
implementation that calls `runVisibleCapture` from
`@ingcreators/annot-capture` against the active tab's
`webContents`.

- Add `packages/desktop/src/browse/host.ts` — renderer-side
  `CaptureHost` implementation. `captureViewport()` round-
  trips through a renamed/extended IPC channel
  (`browse.host.captureViewport`) that calls
  `webContents.capturePage()` on the resolved
  `webContentsId`. `appendCapture()` routes through
  `DesktopStore` (which the gallery already observes), so the
  Phase 6 MVP's filesystem-write IPC becomes a
  storage-provider call rather than a one-off.
- Wire up content-script injection via `<webview>`'s
  `preload` attribute (single bundle from
  `@ingcreators/annot-capture/content`).
- `browse.captureVisible` is removed in this phase; its
  callsites in [`packages/desktop/src/browse/browse.ts`](../../packages/desktop/src/browse/browse.ts)
  become `runVisibleCapture(host)` calls. `browse.persistVisible`
  is removed in favor of `DesktopStore.put`.
- Visible-mode capture must remain byte-equivalent to the
  Phase 6 MVP. Add a regression test: `webContents.capturePage()`
  on a fixture URL, compared between the MVP path and the
  orchestrator path.

**Verify**: visible capture still writes a PNG into
`<userData>/library/Inbox/` and the gallery picks it up. The
MVP's "Capture Visible" button now flows through the shared
orchestrator instead of the bespoke IPC.

### Phase 4 — full capture-mode parity on Electron

Bring the remaining 5 modes online by exercising the shared
orchestrators against the Electron host:

- Area capture (drag-select uses existing `area-selector`
  unchanged).
- Full-page scroll capture (stitch).
- Per-page scroll capture (N independent records).
- Click capture (passes through `__annot.dispatch` event
  channel).
- Hotkey capture via Electron's `globalShortcut` API:
  registered at app level; the currently-focused Browse
  window is the target. No-op when no Browse window has
  focus. Multiple Browse windows disambiguated by focus.
- Right-click context menu inside the target webview
  (content-script-driven, mirrors the extension's in-page
  menu) exposes the same six modes.
- Capture toolbar in `browse.html` grows from one button (📷
  Visible) to six.

**Verify**: each mode tested against three reference pages
(docs site, marketing landing page with sticky header, long
report). Diffs against extension output are documented;
remaining gaps (if any) noted in the release notes. Cross-
platform smoke: at least one full-page run on a macOS box +
one on Linux confirms uniform behaviour (no per-OS branches
to gate on).

### Phase 5 — multi-tab + `window.open` routing

Replace the MVP's "deny all popups" `setWindowOpenHandler`
with the multi-tab plumbing:

- Tab bar component in `browse.html` (Lit) showing per-tab
  favicon + title + close affordance.
- `setWindowOpenHandler` returns `{ action: 'allow', ... }`
  and the spawned `webContents` is adopted as a new tab in
  the current Browse window. `window.opener` preserved.
- Detach-to-new-window context-menu action per tab.
- `CaptureHost` carries the **active tab's** webview id
  internally; tab switch updates the id atomically.
- During a multi-segment capture, tab-switching UI is
  disabled.

**Verify**: opening a `target="_blank"` link adds a new tab
in the same Browse window; an OAuth popup flow (e.g. Google
sign-in on a test page) completes successfully with
`window.opener` intact; closing the active tab mid-capture
cancels with a visible error; tab switching is locked during
a full-page capture and unlocked on completion.

### Phase 6 — settings UI + emulation presets

- Port the extension's options UI as a Lit component in
  `packages/host-ui` (`<annot-capture-settings>`), backed by
  the shared `Settings` shape. Used by both the desktop
  Browse window and a future PWA capture surface.
- Persist via host (`chrome.storage.sync` for extension,
  `settings.ts` IPC for desktop).

**Verify**: changing the JPEG quality in desktop settings
affects the next capture; `keepFirstSegment` toggle behaves
the same in both hosts.

## Verification

Whole-plan acceptance criteria:

- `pnpm -r typecheck` passes after each phase.
- `pnpm test` passes; new orchestrator unit tests cover the
  state machines extracted from
  `service-worker.ts` + `capture-strategy.ts`.
- `pnpm lint` 0 findings.
- `pnpm --filter @ingcreators/annot-extension build` produces
  a working extension at every phase boundary.
- `pnpm --filter @ingcreators/annot-desktop build` produces a
  working Electron bundle at every phase boundary; from Phase 3
  onward the Browse window's capture path runs through the
  shared orchestrator.
- Manual capture comparison fixtures (extension vs. desktop)
  for each of the 6 modes, on at least one HiDPI page.
- No new DOM dependencies introduced into
  `@ingcreators/annot-core` (browser mode lives in
  `@ingcreators/annot-capture`, which IS DOM-dependent — it
  is meant to run only inside a Chromium renderer, never
  headless).

## Migration notes

- **Extension users see no change.** The whole point of
  Phase 1 being a refactor with the extension as sole
  consumer is to land the shared package without disturbing
  the production extension. A canary build is shipped at
  Phase 1 boundary before Phase 2 work begins.
- **Desktop Browse window users**: the MVP's visible-mode
  capture continues to work after every phase. Phases 3–4
  grow the toolbar; Phase 5 enables multi-tab; the existing
  single-tab muscle memory (one window, one URL, one click)
  is preserved as the default flow.
- **OS-level desktop capture is untouched**. The `screen-
  capture.ts` IPC + `capture-overlay.html` window
  ([`_done/desktop-electron-migration.md`](./_done/desktop-electron-migration.md)
  Phase 3) remain as a separate "capture the screen / a window /
  a region" path. Browser mode is purely about the *embedded
  webview*; the two flows coexist.
- **No SVG schema change.** This plan touches capture, not
  the annotation format. `data-annot-version` does not need
  to bump.
- **`PageMetadata` schema unchanged at landing.** A
  `viewport?: { scrollY, height }` field for per-page scroll
  capture is mentioned in `desktop-browser-mode-perpage`
  thinking but deferred — current per-page mode already
  ships without it on the extension. If we later add it,
  it's additive (CLAUDE.md guardrail honored).
- **Future hooks**:
  - Once the headless-annotator spike (CLAUDE.md "Queued
    work") lands, a third `CaptureHost` implementation over
    Playwright becomes natural — no orchestrator changes.
  - The settings Lit component in Phase 6 is the same one
    the PWA can adopt for its own (future) capture surface.
  - The CDP `captureBeyondViewport` fast-path for full-page
    capture is an internal optimisation to revisit if the
    scroll-stitch loop becomes a bottleneck on long pages;
    Electron exposes it via `webContents.debugger.attach()`
    on every platform without additional plumbing.
