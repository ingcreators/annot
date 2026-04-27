# @ingcreators/annot-desktop

The Tauri 2 desktop host for [Annot](../../README.md). Wraps the
PWA frontend in a native window, adds Office-clipboard paste
support, and provides the Tauri IPC bridge for filesystem access.

What lives here:

- **Frontend** ([`src/`](./src/)) — Tauri-side TypeScript. Pulls
  the editor session from [`@ingcreators/annot-editor`](../editor)
  and the PWA shell from [`@ingcreators/annot-web`](../web), and
  wires them to native commands.
- **Tauri crate** ([`src-tauri/`](./src-tauri/)) — Rust side. As
  of [`docs/plans/_done/office-paste-shared-drawing-builder.md`](../../docs/plans/_done/office-paste-shared-drawing-builder.md)
  phase 3, the Rust crate is **packaging-only** for the Office
  clipboard path: it receives pre-built DrawingML XML from the TS
  side (built via the shared
  [`@ingcreators/annot-render`](../render) builder) and wraps it
  in the OOXML / GVML clipboard envelope. **Don't add per-shape
  OOXML to the Rust side** — TypeScript is the single source of
  truth.
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
pnpm --filter @ingcreators/annot-desktop dev            # tauri dev (full app)
pnpm --filter @ingcreators/annot-desktop build          # tauri build (release)
pnpm --filter @ingcreators/annot-desktop dev:frontend   # vite dev only (no Tauri shell)
pnpm --filter @ingcreators/annot-desktop build:frontend # vite build only
pnpm --filter @ingcreators/annot-desktop typecheck      # tsc --noEmit
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
