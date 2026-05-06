# @ingcreators/annot-desktop

The desktop host for [Annot](../../README.md). **Default**: an
Electron app since Phase 5 of
[`docs/plans/desktop-electron-migration.md`](../../docs/plans/desktop-electron-migration.md).
A legacy Tauri 2 build is kept runnable as a rollback path
through Phase 9.

Wraps the PWA frontend in a native window, adds Office-clipboard
paste support, and provides the IPC bridge for filesystem access.

What lives here:

- **Frontend** ([`src/`](./src/)) — Renderer-side TypeScript.
  Pulls the editor session from
  [`@ingcreators/annot-editor`](../editor) and the PWA shell from
  [`@ingcreators/annot-web`](../web), and wires them to the host
  via [`@ingcreators/annot-core/desktop-bridge`](../core/src/utils/desktop-bridge.ts).
  The bridge transparently dispatches to Electron's
  `window.electronAPI.invoke` (default) or Tauri's
  `__TAURI_INTERNALS__.invoke` (rollback path).
- **Electron main process** ([`src-electron/`](./src-electron/))
  — Node-side TypeScript. IPC handlers for `fs.*` (Phase 1),
  settings / XMP / http-server / window controls (Phase 2),
  screen capture (Phase 3), and Office clipboard (Phase 4).
  Uses `desktopCapturer` for cross-platform screen grab and
  `clipboard.writeBuffer` for the GVML envelope; no native
  addons.
- **Tauri crate** ([`src-tauri/`](./src-tauri/)) — Rust side.
  Functional through Phase 9 as the rollback target; deleted in
  Phase 9. As of
  [`docs/plans/_done/office-paste-shared-drawing-builder.md`](../../docs/plans/_done/office-paste-shared-drawing-builder.md)
  phase 3, the Rust crate is **packaging-only** for the Office
  clipboard path — TypeScript builds the per-shape OOXML
  ([`@ingcreators/annot-render`](../render)). **Don't add
  per-shape OOXML to the Rust side.**
- **Capture overlay** ([`capture-overlay.html`](./capture-overlay.html)) —
  fullscreen overlay window for region / window selection.
  Detects whichever transport is active
  (`window.electronAPI.invoke` or `__TAURI_INTERNALS__.invoke`)
  and uses it identically.

## Requirements

- **Electron build** (default): Node 24+ and pnpm 9+. No Rust
  toolchain needed.
- **Tauri rollback build** (`pnpm dev:tauri` /
  `pnpm build:tauri`): Rust toolchain (stable) and Tauri 2
  prerequisites for your OS — see the
  [Tauri docs](https://tauri.app/start/prerequisites/).

The desktop host is **excluded from the default CI build** (it
needs platform-specific build tooling); a dedicated release
workflow handles it.

## Scripts

```bash
pnpm --filter @ingcreators/annot-desktop dev            # electron-vite dev (default)
pnpm --filter @ingcreators/annot-desktop build          # electron-vite build (release)
pnpm --filter @ingcreators/annot-desktop dev:tauri      # tauri dev (rollback path)
pnpm --filter @ingcreators/annot-desktop build:tauri    # tauri build (rollback release)
pnpm --filter @ingcreators/annot-desktop dev:frontend   # vite dev only (no native shell)
pnpm --filter @ingcreators/annot-desktop build:frontend # vite build only
pnpm --filter @ingcreators/annot-desktop typecheck      # tsc --noEmit (renderer + src-electron)
pnpm --filter @ingcreators/annot-desktop tauri          # invoke the tauri CLI directly
```

## Depends on

- [`@ingcreators/annot-core`](../core)
- [`@ingcreators/annot-editor`](../editor)
- [`@ingcreators/annot-editor-shell`](../editor-shell)
- [`@ingcreators/annot-web`](../web)

## See also

- [`docs/plans/desktop-electron-migration.md`](../../docs/plans/desktop-electron-migration.md)
  — the active migration plan.
- [`docs/plans/desktop-browser-mode.md`](../../docs/plans/desktop-browser-mode.md)
  — superseded by Phase 6 of the Electron migration.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
