# Desktop Browser Mode (full extension parity, shared core)

> **Status:** Queued
>
> **Compatibility:** New shared package `@ingcreators/annot-capture`
> extracted from `packages/extension`. `packages/extension` and
> `packages/desktop` both consume it as host adapters. No public
> API change to `@ingcreators/annot-core`. New runtime surface in
> `packages/desktop` (a second Tauri WebView for arbitrary URLs,
> per-OS native capture commands).
>
> **Risk:** Largest cross-cutting refactor since the Lit migration.
> Extracting capture orchestration without breaking the live
> extension is the dominant risk; mitigated by shipping the
> shared package with the extension as the first consumer
> (Phase 1) before adding the desktop consumer (Phase 3+).
> Per-OS capture API parity (DPR, full-page support, sticky
> handling) is the second risk — the plan picks a Windows-first
> path (Phases 3–5) and treats macOS/Linux as Phase 6, with
> the macOS/Linux Rust commands returning `NotImplemented`
> until then. Phases 1–2 are pure refactors that the user
> has explicitly accepted, including the brief feature-freeze
> on the extension during that period.

## Context

The Chrome MV3 extension (`packages/extension`, ~4k LOC) is
currently the only host that can capture arbitrary web pages. It
implements six capture modes (visible / area / full-page scroll /
per-page scroll / click / hotkey), DOM metadata extraction,
sticky/scrollbar hide-restore, viewport emulation by window
resize, and a smart PNG-8 / PNG / JPEG encoding pipeline.

Tauri's WebView (WebView2 / WKWebView / WebKitGTK) cannot host
Chrome MV3 extensions, so embedding the extension as-is is not
viable. But the extension's capture logic is mostly DOM- and
canvas-based; only a handful of touchpoints actually depend on
`chrome.*` APIs:

- `chrome.tabs.captureVisibleTab` (the actual screenshot)
- `chrome.windows.update` (window-resize emulation)
- `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`
  (transport between background ↔ content ↔ offscreen)
- `chrome.storage.sync` (settings persistence)
- `chrome.scripting.executeScript` (content-script injection)

Everything else — sticky handling, scroll control, area
selection, page metadata extraction, encoding, stitching, mosaic,
crop — is pure DOM / canvas / `OffscreenCanvas` code that runs
unmodified in any modern WebView.

The desktop already has native screen-capture commands
([`screen_capture.rs`](../../packages/desktop/src-tauri/src/commands/screen_capture.rs))
for capturing the full desktop, but no equivalent of the
extension's "navigate any URL → capture" flow.

This plan replaces the per-host duplication with a single
`@ingcreators/annot-capture` package and adds a Tauri host
adapter that brings the desktop to feature parity with the
extension.

## Design

### Package layout after the split

```
packages/
  capture/       NEW. Host-agnostic capture orchestration.
                 npm name: @ingcreators/annot-capture
  extension/     Chrome MV3 host adapter (thin glue around
                 capture).
  desktop/       Tauri host adapter + browser-mode Rust
                 commands.
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
  // Logging hook (extension uses console; desktop forwards to Rust)
  log(level: "info" | "warn" | "error", ...args: unknown[]): void;
}
```

Rationale for shape:

- **One `captureViewport`, no full-page primitive.** Full-page
  is built by the orchestrator out of `scrollTo` (content) +
  `captureViewport` (host) + stitch (shared). This keeps the
  host adapter minimal and matches what each OS API offers
  natively (see "Per-OS capture API" below).
- **`setEmulatedViewport` is async + reversible.** The caller
  always pairs `set(target)` ... `set(null)` to restore. On
  Chrome this maps to `chrome.windows.update` with a saved
  geometry; on Tauri it maps to `Window::set_size`/`set_position`
  with a saved geometry on the Rust side.
- **Transport is request/response + event stream.** Mirrors
  what `chrome.runtime.sendMessage` (with `sendResponse`) and
  `chrome.runtime.onMessage` already provide. Tauri implements
  the same shape via `webview.eval` (request) +
  `Window::emit` / `Window::listen` (events).

### Per-OS capture API (Tauri host)

Implemented as Rust Tauri commands; the JS host adapter calls
them via `invoke`.

| OS | Viewport capture | Window resize | Notes |
|---|---|---|---|
| Windows | `WebView2.CallDevToolsProtocolMethod("Page.captureScreenshot", { captureBeyondViewport:false })` | `Window::set_size` | CDP returns base64 PNG; no extra paint sync needed; DPR returned in result. Rich fallback path: `Dwm*`/`BitBlt` against the WebView HWND if CDP fails. |
| macOS | `WKWebView.takeSnapshot(with:)` via `objc2` bridge | `Window::set_size` | Native API, returns `NSImage`; convert to PNG in Rust. Caveat: video-frame contents may be black during playback (WebKit limitation). |
| Linux | `webkit_web_view_get_snapshot(VISIBLE)` via `webkit2gtk-rs` | `Window::set_size` | Returns `cairo::Surface`; encode to PNG. |

Full-page captures are NOT a separate API — they reuse
`captureViewport` in a scroll loop. This avoids the
`captureBeyondViewport` parity problem (only Windows CDP
supports it well) and keeps the orchestrator's behavior bit-
identical to the extension's stitch path.

DPR is **always returned by the host** alongside the PNG.
Orchestrators stop calling `window.devicePixelRatio` from JS
and trust the value from the host. This fixes a long-standing
extension bug where DPR drift between content/background mid-
capture corrupts the stitched output.

### Browser mode UX (desktop)

A **separate Tauri window** ("Browse window") hosts the
arbitrary URL, distinct from the app's main library/editor
window. The Browse window itself owns the capture entry points;
the main window does NOT trigger captures (avoids the "which
browse tab am I capturing?" UX problem when multiple Browse
windows are open).

Browse window layout:

```
┌─ Tauri WebviewWindow (chrome) ─────────────────┐
│ ┌─ Address bar / nav / capture toolbar ───────┐│
│ ├──────────────────────────────────────────────┤│
│ │                                              ││
│ │  ← Child webview (target page)               ││
│ │     Windows: WebView2 child                   ││
│ │     macOS:   nested WKWebView                ││
│ │     Linux:   nested WebKitGTK widget         ││
│ │                                              ││
│ └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

- The outer **chrome** (address bar, nav, **tab bar**, capture
  toolbar) is a normal `packages/desktop` Lit/Vite frontend
  route (`/browse`).
- The inner **target webview** is a child webview created via
  `WebviewWindow::with_webview`. Content scripts are injected
  ONLY into target webviews as init scripts — the chrome
  webview stays clean. Each tab is its own child webview with
  its own Tauri label.
- Chrome UI and target webviews have distinct Tauri labels.
  `CaptureHost` retains the **active tab's** label and routes
  every call (`captureViewport`, `setEmulatedViewport`,
  content messages) to that label. Tab switch = target
  switch.

### Tabs and `window.open` handling

Web apps routinely open new tabs (`<a target="_blank">`,
`window.open`, OAuth popups, Drive Picker, etc.). The Browse
window MUST handle these — without explicit hooks, WebView2
either spawns the OS default browser or silently drops the
request, which would break OAuth flows and "outside the
sandbox" navigations.

Default behavior (configurable):

- **Same Browse window, new tab**: hook `NewWindowRequested`
  (Windows), `webView(_:createWebViewWith:...)` (macOS),
  `create` signal (Linux). Create a new child webview in
  the current Browse window and add a tab for it. **Set
  the platform's `NewWindow` / created webview pointer
  back to the host** so `window.opener` and `postMessage`
  work — required for OAuth popups and any
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

In addition, the **target webview's right-click context menu**
exposes the same six modes — same content-script pattern as
the extension's in-page context menu. This is the "trigger
from inside the page" path that mirrors the extension's
keyboard-shortcut behavior.

**Global hotkey capture** uses `tauri-plugin-global-shortcut`
registered at app level. On press, the currently-focused
Browse window is the target; if no Browse window has focus,
the hotkey is a no-op. Multiple Browse windows are supported;
focus disambiguates.

**Main window role**: stays a library/editor surface only. The
main window's toolbar gets a `[+ New Browse]` button that
spawns a new Browse window (with a blank/start page if no URL
is given). Capture itself is never initiated from the main
window.

Captured images flow into the same SQLite-backed `ImageRecord`
store the desktop already uses
([`db.rs`](../../packages/desktop/src-tauri/src/db.rs)), so
the main window's gallery picks them up with no schema
change.

### Settings storage

The shape stays identical to the extension's `Settings`
([`packages/extension/src/shared/settings.ts`](../../packages/extension/src/shared/settings.ts)).
Persistence is host-owned:

- Extension: `chrome.storage.sync` (existing).
- Desktop: a JSON blob in the app's data dir, written via the
  existing `tauri-plugin-fs` setup. No cross-device sync in v1.

A future consolidation (shared `BrowserModeSettings` schema in
`@ingcreators/annot-core`) is possible but out of scope here.

### Content-script injection

- **Extension**: keeps the existing
  `chrome.scripting.executeScript({ files: ["content.js"] })`
  + IIFE wrapper. The content bundle simply imports
  `@ingcreators/annot-capture/content` instead of local files.
- **Desktop**: Tauri's `WebviewWindow::with_webview` exposes
  `add_script_to_evaluate_on_new_document` (Windows) /
  `evaluateJavaScript` (macOS) / `webkit_user_content_manager_*`
  (Linux). The same content bundle is registered as an
  `init_script` so it runs before page scripts. No re-injection
  guard needed (init scripts run once per navigation).

### Message transport (concrete mapping)

| Operation | Extension | Desktop |
|---|---|---|
| BG → Content request | `chrome.tabs.sendMessage(tabId, msg, cb)` | `webview.eval("window.__annot.dispatch(...)")` returning a promise resolved by Tauri event |
| Content → BG event | `chrome.runtime.sendMessage(msg)` | `window.__TAURI_INTERNALS__.invoke('annot_content_event', msg)` |
| BG → Offscreen (encoder) | `chrome.runtime.sendMessage` to offscreen doc | Direct `Worker` from background webview |
| Settings change broadcast | `chrome.storage.onChanged` | Tauri global event |

The orchestrator never sees these — it only sees the
`CaptureHost` methods.

## Phased plan

Each phase lands as one PR per CLAUDE.md's "one PR per phase"
rule. Phases 1–2 are pure refactors with the live extension as
the only consumer; Phase 3+ adds the desktop consumer.

### Phase 1 — extract `@ingcreators/annot-capture`, extension stays the only consumer

- Create `packages/capture/` with `package.json`, `tsconfig.json`,
  Vite config (library mode, ESM only).
- Move `packages/extension/src/content/*` and the offscreen worker
  source into `packages/capture/src/content/*` and
  `packages/capture/src/encode/*`. Replace `chrome.runtime`
  references with a `MessagePort`-shaped abstraction
  (`ContentBus`).
- Move shared `encode.ts`, `messages.ts`, `settings.ts` into
  `packages/capture/src/shared/*`.
- Define `CaptureHost` interface in
  `packages/capture/src/host.ts`.
- Extract the capture state machines from `service-worker.ts`
  (1.5k LOC → ~6 orchestrator modules) into
  `packages/capture/src/orchestrate/*`. Tested with the
  extension's existing manual capture flows; no new behavior.
- `packages/extension` becomes a thin host adapter:
  - `background/host.ts` implements `CaptureHost` over `chrome.*`.
  - `service-worker.ts` shrinks to wiring + lifecycle (popup
    messages → orchestrator calls).
  - Existing manifest, popup UI, options UI unchanged.

**Verify**: extension installs and all 6 capture modes work
exactly as before; visual regression on the popup; end-to-end
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

### Phase 3 — Tauri host: viewport capture command (Windows first)

- Add Rust command `annot_capture_viewport(window_label)` to
  `packages/desktop/src-tauri/src/commands/`. Windows
  implementation calls WebView2 CDP
  `Page.captureScreenshot`; macOS/Linux return
  `NotImplemented` for now.
- Add `annot_set_emulated_viewport(window_label, size?)`
  with saved-geometry restore.
- Add JS host adapter
  `packages/desktop/src/browser-mode/host.ts` implementing
  `CaptureHost`.

**Verify**: a manual test harness inside `packages/desktop`
that opens example.com in a second WebviewWindow and captures
the viewport, then writes the PNG to `Documents/`. No UI
integration yet.

### Phase 4 — Tauri host: browse window + content-script injection

- New `BrowseWindow` UI in
  `packages/desktop/src/app/browse.ts`: address bar, nav
  controls, **tab bar**, **6-button capture toolbar**
  (visible / area / full-page / per-page / click / hotkey)
  matching the extension popup 1:1. Implemented as a
  `/browse` route in the desktop frontend.
- Spawn each tab's target as a **child webview** (separate
  Tauri label per tab) via `WebviewWindow::with_webview`;
  the chrome remains untouched.
- Hook `NewWindowRequested` (Windows; macOS/Linux in
  Phase 6) so `window.open` / `target="_blank"` / OAuth
  popups open as **new tabs in the same Browse window**
  with `window.opener` preserved. Detach-to-new-window
  is an opt-in user action.
- `CaptureHost` carries the **active tab's** webview label
  and routes every host call to it. Tab switch updates the
  label.
- Wire up content-script injection via Tauri init scripts
  on the target label only (Windows path; macOS/Linux land
  in Phase 6).
- Implement the BG↔Content transport:
  `__annot.dispatch` global on the page side, Tauri event
  bridge on the Rust side.
- Main-window toolbar gets `[+ New Browse]` to open a new
  Browse window. Main window does NOT host capture
  triggers.

**Verify**: navigating to a complex page (e.g. a docs site,
a SPA) shows the same DOM-metadata sidebar entries as the
extension would on the same page. Visible-mode capture
produces identical output to extension on Windows. Multiple
Browse windows open simultaneously each capture
independently into the shared SQLite store. **Tab tests**:
opening a `target="_blank"` link adds a new tab in the same
Browse window; an OAuth popup flow (e.g. Google sign-in on
a test page) completes successfully with `window.opener`
intact; closing the active tab mid-capture cancels with a
visible error; tab switching is locked during a full-page
capture and unlocked on completion.

**Verify**: navigating to a complex page (e.g. a docs site,
a SPA) shows the same DOM-metadata sidebar entries as the
extension would on the same page. Visible-mode capture
produces identical output to extension on Windows.

### Phase 5 — full capture-mode parity on desktop

Bring the remaining 5 modes online by exercising the shared
orchestrators against the Tauri host:

- Area capture (drag-select uses existing `area-selector`
  unchanged).
- Full-page scroll capture (stitch).
- Per-page scroll capture (N independent records).
- Click capture (passes through `__annot.dispatch` event
  channel).
- Hotkey capture via `tauri-plugin-global-shortcut`:
  registered at app level; the currently-focused Browse
  window is the target. No-op when no Browse window has
  focus. Multiple Browse windows disambiguated by focus.
- Right-click context menu inside the target webview
  (content-script-driven, mirrors the extension's in-page
  menu) exposes the same six modes.

**Verify**: each mode tested against three reference pages
(docs site, marketing landing page with sticky header, long
report). Diffs against extension output are documented;
known gaps (e.g. video-frame issue on macOS) noted in the
release notes.

### Phase 6 — macOS + Linux capture commands

- Implement `annot_capture_viewport` for macOS via `objc2` /
  `WKWebView.takeSnapshot`.
- Implement for Linux via `webkit2gtk-rs` /
  `webkit_web_view_get_snapshot`.
- Per-OS DPR handling normalized.

**Verify**: visible-mode + full-page capture succeed on a
macOS and a Linux box. Per-OS sample PNGs committed under
`packages/desktop/test-fixtures/`.

### Phase 7 — settings UI + emulation presets on desktop

- Port the extension's options UI as a Lit component in
  `packages/web` (`<annot-capture-settings>`), backed by the
  shared `Settings` shape. Used by both the desktop browser
  mode and a future PWA settings drawer.
- Persist via host (`chrome.storage.sync` for extension,
  Tauri fs for desktop).

**Verify**: changing the JPEG quality in desktop settings
affects the next capture; `keepFirstSegment` toggle behaves
the same in both hosts.

## Verification

Whole-plan acceptance criteria:

- `pnpm -r typecheck` passes after each phase.
- `pnpm test` passes; new orchestrator unit tests cover the
  state machines extracted from `service-worker.ts`.
- `pnpm lint` 0 findings.
- `pnpm --filter @ingcreators/annot-extension build` produces
  a working extension at every phase boundary.
- `pnpm --filter @ingcreators/annot-desktop build` produces a
  working desktop bundle from Phase 3 onward.
- Manual capture comparison fixtures (extension vs. desktop)
  for each of the 6 modes, on at least one HiDPI page.
- No new DOM dependencies introduced into
  `@ingcreators/annot-core` (browser mode lives in
  `@ingcreators/annot-capture`, which IS DOM-dependent — it
  is meant to run only inside a webview, never headless).

## Migration notes

- **Extension users see no change.** The whole point of
  Phase 1 being a refactor with the extension as sole
  consumer is to land the shared package without disturbing
  the production extension. A canary build is shipped at
  Phase 1 boundary before Phase 2 work begins.
- **Desktop browser mode is opt-in.** The existing native
  desktop capture (`screen_capture.rs`) stays as a separate
  capture mode; browser mode is additive.
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
  - The settings Lit component in Phase 7 is the same one
    the PWA can adopt for its own (future) capture surface.
