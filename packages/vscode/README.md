# @ingcreators/annot-vscode

VSCode extension that opens [Annot](../../README.md) annotation
files (`*.annot.svg` / `*.annot.png` / `*.annot.jpeg` /
`*.annot.jpg`) directly inside the editor.

## Status

**Phase 4 skeleton** of [`docs/plans/_done/vscode-extension-host.md`](../../docs/plans/_done/vscode-extension-host.md).
The package builds, the extension entry registers a custom
editor for the file glob, the webview boots an `EditorShell`
against `<div id="annot-shell-container">`, and the
extension-host receives a `{type: "ready"}` message + responds
with the file's bytes via `{type: "open", path, filename, bytes}`.

What works in Phase 4:

- `code --extensionDevelopmentPath=packages/vscode` opens a
  workspace; double-clicking `foo.annot.svg` (or `.annot.png` /
  `.annot.jpeg` / `.annot.jpg`) opens the Annot editor in a tab.
- The webview hosts a real `EditorShell` against a host-supplied
  container — proves the architecture from the opposite side
  (PWA being the first consumer).
- `VSCodeStore` (`src/storage/vscode-store.ts`) implements the
  `getImage` / `updateImage` methods of `StorageProvider` over
  `vscode.workspace.fs` so the shell's standard `open(path)` /
  `saveNow()` calls work end-to-end. The remaining 11
  `StorageProvider` methods throw `NotImplementedError` — Phase 5
  fills them as the gallery / multi-file UX expands.

What lands in Phase 5:

- Full message protocol (webview ↔ extension `getImage` /
  `updateImage` / save / dirty / error notifications).
- Status bar item driven by shell `dirty` / `saved` events.
- Command palette entries (`Annot: New annotation from
  clipboard image`, `Annot: New annotation from image…`,
  `Annot: Save as PNG…`, `Annot: Save as JPEG…`,
  `Annot: Export to PowerPoint…`, `Annot: Reveal in
  Explorer`).
- Theme bridging: receive `vscode.window.onDidChangeActiveColorTheme`
  events and update the shell's `themeOverrides`.
- README screenshots + marketplace metadata.

## Architecture

The extension uses VSCode's CustomEditorProvider pattern:

```
┌─────────────────────────────────────────────────────────────┐
│  Extension host (Node)                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ extension.ts                                         │   │
│  │   AnnotEditorProvider implements                     │   │
│  │   CustomReadonlyEditorProvider                       │   │
│  │     - resolveCustomEditor → builds a webview         │   │
│  │     - reads + rewrites dist/webview/index.html       │   │
│  │     - handles webview messages (read/write file)     │   │
│  │                                                      │   │
│  │ storage/vscode-store.ts                              │   │
│  │   VSCodeStore implements StorageProvider over        │   │
│  │   vscode.workspace.fs                                │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                │
│                postMessage │ onDidReceiveMessage            │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Webview (sandboxed iframe)                           │   │
│  │ webview/main.ts                                      │   │
│  │   const shell = new EditorShell({                    │   │
│  │     container: #annot-shell-container,               │   │
│  │     storage: messageProxyStorage,  // Phase 5        │   │
│  │     features: { capture: false, ... },               │   │
│  │     themeOverrides: { --annot-* → --vscode-* },      │   │
│  │   });                                                │   │
│  │   on "ready" → extension sends file bytes            │   │
│  │   shell.mountFromRecord(path, record)                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Build

```bash
pnpm --filter @ingcreators/annot-vscode build      # extension + webview bundles
pnpm --filter @ingcreators/annot-vscode typecheck  # tsc --noEmit
```

The `build` script runs the extension config (CJS bundle for the
extension host) and the webview config (ESM bundle for the
sandboxed iframe) sequentially. Output:

- `dist/extension.js` — loaded by VSCode via `package.json#main`.
- `dist/webview/index.html` + `dist/webview/index.js` — loaded
  by the webview.

## File extension convention

Per the plan's "double-extension" convention, the custom-editor
selector matches `**/*.annot.{svg,png,jpeg,jpg}` exactly. Files
without the `.annot.` infix (`screenshot.png`,
`drawing.svg`, …) continue to open in their default editor — no
content sniffing, no `*.svg` blanket-grab.

| Extension | Source of truth | Phase 4 status |
|-----------|----------------|----------------|
| `*.annot.svg` | The SVG itself (with embedded `<image href="data:...">` for the screenshot). | Loads end-to-end; extension reads bytes, webview mounts via `EditorShell.mountFromRecord`. |
| `*.annot.png` / `*.annot.jpeg` / `*.annot.jpg` | The raster file with the annotation SVG embedded as XMP (round-tripped via `@ingcreators/annot-core/xmp`). | Loads bytes; XMP recovery wired in Phase 5. |

## Depends on

- [`@ingcreators/annot-core`](../core) — Tier A storage types.
- [`@ingcreators/annot-editor`](../editor) — Tier C primitives.
- [`@ingcreators/annot-editor-shell`](../editor-shell) — the
  host-neutral editor surface this package consumes.

## See also

- [`docs/plans/_done/vscode-extension-host.md`](../../docs/plans/_done/vscode-extension-host.md) —
  the plan this package implements.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
