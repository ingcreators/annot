# @ingcreators/annot-desktop

The desktop host for [Annot](../../README.md). Currently a Tauri 2
application; mid-migration to Electron per
[`docs/plans/desktop-electron-migration.md`](../../docs/plans/desktop-electron-migration.md).
Wraps the PWA frontend in a native window, adds Office-clipboard
paste support, and provides the IPC bridge for filesystem access.

What lives here:

- **Frontend** ([`src/`](./src/)) — Renderer-side TypeScript. Pulls
  the editor session from [`@ingcreators/annot-editor`](../editor)
  and the PWA shell from [`@ingcreators/annot-web`](../web), and
  wires them to native commands.
- **Tauri crate** ([`src-tauri/`](./src-tauri/)) — Rust side
  (default through Phase 4 of the Electron migration). As of
  [`docs/plans/_done/office-paste-shared-drawing-builder.md`](../../docs/plans/_done/office-paste-shared-drawing-builder.md)
  phase 3, the Rust crate is **packaging-only** for the Office
  clipboard path: it receives pre-built DrawingML XML from the TS
  side (built via the shared
  [`@ingcreators/annot-render`](../render) builder) and wraps it
  in the OOXML / GVML clipboard envelope. **Don't add per-shape
  OOXML to the Rust side** — TypeScript is the single source of
  truth.
- **Electron scaffold** ([`src-electron/`](./src-electron/)) —
  Phase 0 of the Tauri-to-Electron migration. Side-by-side with
  the Tauri crate; opt-in via `pnpm dev:electron`. The current
  scaffold opens an Electron `BrowserWindow`, mounts the renderer,
  and exposes a placeholder `window.electronAPI.invoke` over
  contextBridge (only `ping → "pong"` is wired today; functional
  channels land in Phases 1–4). The renderer's existing Tauri
  IPC calls fail under Electron until the bridge swap in Phases
  1–5 — that's expected for Phase 0.
- **Capture overlay** ([`capture-overlay.html`](./capture-overlay.html)) —
  native-area-select overlay window.

## Requirements

- Rust toolchain (stable).
- Tauri 2 prerequisites for your OS — see the
  [Tauri docs](https://tauri.app/start/prerequisites/).
- Node 24+ and pnpm 9+ (same as the rest of the workspace).

The desktop host is **excluded from the default CI build** (it
needs Rust + platform-specific Win32 APIs); a dedicated release
workflow handles it.

## Scripts

```bash
pnpm --filter @ingcreators/annot-desktop dev            # tauri dev (default; Phases 0–4)
pnpm --filter @ingcreators/annot-desktop build          # tauri build (release)
pnpm --filter @ingcreators/annot-desktop dev:frontend   # vite dev only (no native shell)
pnpm --filter @ingcreators/annot-desktop build:frontend # vite build only
pnpm --filter @ingcreators/annot-desktop dev:electron   # electron-vite dev (Phase 0 scaffold)
pnpm --filter @ingcreators/annot-desktop build:electron # electron-vite build (Phase 0 scaffold)
pnpm --filter @ingcreators/annot-desktop typecheck      # tsc --noEmit (renderer + src-electron)
pnpm --filter @ingcreators/annot-desktop tauri          # invoke the tauri CLI directly
```

## Depends on

- [`@ingcreators/annot-core`](../core)
- [`@ingcreators/annot-editor`](../editor)
- [`@ingcreators/annot-web`](../web)

## See also

- [`docs/plans/desktop-browser-mode.md`](../../docs/plans/desktop-browser-mode.md) — queued
  plan for full extension-capture parity in the desktop host.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
