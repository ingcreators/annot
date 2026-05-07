# @ingcreators/annot-capture

Host-agnostic capture orchestration for [Annot](../../README.md).

The Chrome MV3 extension (`packages/extension`) and the Electron
desktop's Browse window (`packages/desktop`, future) both need to
turn an arbitrary web page into an `ImageRecord` — drag-select an
area, scroll-stitch a long page, capture-on-click, and so on. The
DOM-/canvas-side code that does this is mostly host-neutral; only a
handful of touchpoints actually need `chrome.*` (or, on the desktop,
Electron `webContents`). This package owns the host-neutral parts.

What lives here:

- **Content modules** ([`src/content/`](./src/content/)) — DOM-side
  helpers the host injects into the captured page: sticky / scrollbar
  hide-restore, scroll controller, drag-select area picker, floating
  progress overlay. The `ContentBus` interface
  ([`content-bus.ts`](./src/content/content-bus.ts)) abstracts the
  back-channel a content module uses to post events to its host
  (`chrome.runtime.sendMessage` for the extension; an
  `ipcRenderer.send`-bridged equivalent for Electron).
- **Encode pipeline** ([`src/encode/`](./src/encode/)) — pure-canvas
  image-ops (stitch / crop / mosaic) and the worker-pool source for
  parallel libimagequant / JPEG / PNG re-encoding.
- **Shared types** ([`src/shared/`](./src/shared/)) — `Settings`
  shape + DEFAULT / merge / parseSelectorList /
  shouldHideOverlaysFor; capture-message envelopes; encode adapter.
- **Orchestrate** ([`src/orchestrate/`](./src/orchestrate/)) — pure
  capture-strategy math (segment plan, per-page step decision, chrome
  delta math). Phase 1B will grow this directory with the six
  state-machine modules (`runVisibleCapture` / `runAreaCapture` /
  `runScrollCapture` / `runPerPageCapture` / `runClickCapture` /
  `runHotkeyCapture`) lifted from the extension's `service-worker.ts`.
- **`CaptureHost` interface** ([`src/host.ts`](./src/host.ts)) — the
  seam every host implements. Phase 1A defines the shape; Phase 1B
  wires the orchestrators to consume it.

What deliberately stays out:

- `chrome.*` / `webContents.*` calls — those go in the host adapter
  (extension or desktop renderer). The package intentionally avoids
  importing `chrome-types` so the bundler can never accidentally
  pull host-specific globals into the shared output.
- Persistence (IDB / DesktopStore writes). Hosts implement
  `appendCapture()` against whatever storage they own.
- Editor / gallery routing. Hosts implement their own "open the
  editor on this new record" flow.

## Status

Stable. Landed via [`docs/plans/_done/desktop-browser-mode.md`](../../docs/plans/_done/desktop-browser-mode.md)
(nine phase-PRs, [#478](https://github.com/ingcreators/annot/pull/478)–[#487](https://github.com/ingcreators/annot/pull/487)).
Both `packages/extension` and `packages/desktop` consume the package
as host adapters; the orchestrators in [`src/orchestrate/`](./src/orchestrate/)
own the per-mode state machines, with `chrome.*` bookkeeping
delegated to the host's `CaptureHost` implementation.

## Scripts

```bash
pnpm --filter @ingcreators/annot-capture typecheck
pnpm --filter @ingcreators/annot-capture build
```

## Depends on

- [`@ingcreators/annot-core`](../core) — `PageMetadata`,
  `CaptureRect`, `CaptureSegment`, encoder.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
