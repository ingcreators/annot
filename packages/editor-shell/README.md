# @ingcreators/annot-editor-shell

Host-neutral editor surface for [Annot](../../README.md). This is
**Tier C** — code here constructs `CanvasManager` /
`SelectionManager` / Lit elements that need a real browser context,
but it does **not** depend on the PWA shell. The package exists so
hosts other than the PWA (the upcoming VSCode extension; eventually
the Tauri desktop without the PWA wrapper) can mount the editor by
passing a container element + a `StorageProvider` and nothing else.

## Status

Phase 1 of [`docs/plans/_done/vscode-extension-host.md`](../../docs/plans/_done/vscode-extension-host.md)
landed the package scaffold + the documented `EditorShell` class
shape. Every method on the class is a stub that throws / no-ops
until Phase 2 (move toolbar / right-panel / drawer / scratchpad /
keyboard-help out of `packages/web/`) and Phase 3 (PWA's
`EditorSession` consumes the shell as the regression-proof first
user) fill the bodies.

## Public entry points

| Subpath | Surface |
|---------|---------|
| `@ingcreators/annot-editor-shell` | `EditorShell` class + `EditorShellHost` / `EditorShellFeatures` / `EditorShellEvent` types |
| `@ingcreators/annot-editor-shell/<file>` | Per-file deep imports for shell internals (sparingly) |

## Depends on

- [`@ingcreators/annot-core`](../core) — Tier A + Tier B surface.
- [`@ingcreators/annot-editor`](../editor) — Tier C primitives
  (`CanvasManager`, `SelectionManager`, `PropertyPanel`, …).

**Must NOT depend on `@ingcreators/annot-web`** — that's the PWA
host; the whole point of this package is letting *other* hosts
mount the same editor.

## Build

```bash
pnpm --filter @ingcreators/annot-editor-shell build      # vite library build
pnpm --filter @ingcreators/annot-editor-shell typecheck  # tsc --noEmit
```

## See also

- [`docs/plans/_done/vscode-extension-host.md`](../../docs/plans/_done/vscode-extension-host.md) —
  why this package exists.
- [`docs/plans/_done/three-package-split.md`](../../docs/plans/_done/three-package-split.md) —
  the precedent split (`annot-core` → `annot-editor` +
  `annot-render`) this package extends.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
