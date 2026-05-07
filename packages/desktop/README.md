# @ingcreators/annot-desktop

The desktop host for [Annot](../../README.md). An Electron app
that wraps the PWA frontend in a native window, adds Office-
clipboard paste support, and provides the IPC bridge for
filesystem access.

What lives here:

- **Frontend** ([`src/`](./src/)) — Renderer-side TypeScript.
  Pulls the editor session from
  [`@ingcreators/annot-editor`](../editor) and the PWA shell from
  [`@ingcreators/annot-web`](../web), and wires them to the host
  via [`@ingcreators/annot-core/desktop-bridge`](../core/src/utils/desktop-bridge.ts)
  (`window.electronAPI.invoke`).
- **Electron main process** ([`src-electron/`](./src-electron/))
  — Node-side TypeScript. IPC handlers for `fs.*`, settings,
  XMP read/write, http-server (extension handoff), window
  controls, screen capture (cross-platform via
  `desktopCapturer`), Office clipboard (Win32 GVML via
  `clipboard.writeBuffer`; no native addon), Browse-window
  capture, and shell / extension drain helpers. Each handler
  lives in its own file under
  [`src-electron/ipc/`](./src-electron/ipc/) and takes
  dependency-injection callbacks for the bits that need real
  Electron access — tests construct against fakes.
- **Capture overlay** ([`capture-overlay.html`](./capture-overlay.html))
  — fullscreen overlay window for region / window selection.
- **Browse window** ([`browse.html`](./browse.html)) — separate
  `BrowserWindow` with an embedded `<webview>`. Address bar +
  capture toolbar drive a one-click capture flow into the
  gallery's Inbox folder. Multi-tab + per-page / area / scroll
  modes are queued behind the
  [`@ingcreators/annot-capture`](../../docs/plans/desktop-browser-mode.md)
  package extraction.

## Requirements

- Node 24+ and pnpm 9+ (same as the rest of the workspace).
- No Rust toolchain — the Tauri-era Rust crate was removed in
  Phase 9 of the Electron migration.

The desktop host is **excluded from the default CI build** (it
needs platform-specific build tooling); a dedicated release
workflow handles it.

## Scripts

```bash
pnpm --filter @ingcreators/annot-desktop dev          # electron-vite dev
pnpm --filter @ingcreators/annot-desktop build        # electron-vite build (renderer + main + preload bundles)
pnpm --filter @ingcreators/annot-desktop typecheck    # tsc --noEmit (renderer + src-electron)
```

`electron-builder` (the next layer on top of `electron-vite`'s
output) packages installers — see Distribution below.

## Depends on

- [`@ingcreators/annot-core`](../core)
- [`@ingcreators/annot-editor`](../editor)
- [`@ingcreators/annot-host-ui`](../editor-shell)
- [`@ingcreators/annot-web`](../web)

## Distribution

[`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml)
runs a Win / macOS / Linux matrix build on every
`release/desktop-*` tag push (and on manual
`workflow_dispatch`), uploads the per-OS installers as
artifacts, and on tag pushes attaches them to a draft GitHub
Release. macOS notarization + Windows code-signing happen
automatically when the matching repo secrets are configured;
absent secrets degrade gracefully to unsigned outputs so forks
can still iterate on the workflow.

Per-OS detail:

- **Windows**: `electron-builder` produces NSIS installer + zip.
  Code signing via `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`
  secrets when present.
- **macOS**: see [`docs/notarization.md`](./docs/notarization.md)
  for the signing + notarization recipe (Apple Developer ID
  setup, required CI secrets, manual + automated build steps,
  troubleshooting). Hardened-runtime entitlements live at
  [`build/entitlements.mac.plist`](./build/entitlements.mac.plist)
  with each key justified inline.
- **Linux**: see [`docs/linux-packaging.md`](./docs/linux-packaging.md)
  for AppImage + deb + rpm build instructions
  (`electron-builder` config in
  [`package.json`](./package.json)), smoke-test recipe on
  Ubuntu LTS, and known Wayland / PipeWire / fractional-DPI
  compatibility notes.

## See also

- [`docs/plans/_done/desktop-electron-migration.md`](../../docs/plans/_done/desktop-electron-migration.md)
  — the migration plan that landed this stack.
- [`docs/plans/desktop-browser-mode.md`](../../docs/plans/desktop-browser-mode.md)
  — superseded by Phase 6 of the Electron migration; the
  remaining `@ingcreators/annot-capture` package extraction
  (its Phases 1–2) is queued separately.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
