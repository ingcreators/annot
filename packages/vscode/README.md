# @ingcreators/annot-vscode

VSCode extension that opens [Annot](../../README.md) annotation
files (`*.annot.svg` / `*.annot.png` / `*.annot.jpeg` /
`*.annot.jpg`) directly inside the editor.

## Status

**Phase 4 skeleton** of [`docs/plans/_done/vscode-extension-host.md`](../../docs/plans/_done/vscode-extension-host.md).
The extension entry registers a custom editor for the file glob,
the webview boots an `EditorShell` against
`<div id="annot-shell-container">` with a webview-side
`MessageProxyStorageProvider` that forwards every `getImage` /
`updateImage` call to the extension host via a postMessage RPC
protocol. All XMP encoding / decoding lives in the webview (where
the canvas + the `@ingcreators/annot-core/xmp` helpers run); the
extension's role is plain `vscode.workspace.fs` I/O.

What works:

- `code --extensionDevelopmentPath=packages/vscode` opens a
  workspace; double-clicking any `*.annot.{svg,png,jpeg,jpg}`
  file opens the Annot editor in a tab.
- The webview hosts a real `EditorShell` against a host-supplied
  container — proves the architecture from the opposite side
  (PWA being the first consumer).
- **Save is wired end-to-end.** Editing fires `dirty` →
  debounced (500 ms) `shell.saveNow()` → webview proxy renders
  + encodes (raster: full XMP round-trip via
  `createEditableImage`; SVG: text encode of `exportSVGString`)
  → extension writes via `vscode.workspace.fs.writeFile`. Status
  bar transitions through `Saving…` → `Saved` (or
  `Save failed`).
- **XMP round-trip for raster files**:
  `*.annot.{png,jpeg,jpg}` re-edit cleanly: `readEditableImage`
  recovers the original screenshot + the annotation SVG on
  open; `createEditableImage` re-embeds them on save. Files
  without an XMP packet load with the raster bytes as a plain
  background (the editor still works; saving will add the XMP
  packet on the way out).
- Status bar item per webview tracking `Annot` / `Unsaved` /
  `Saving…` / `Saved` / `Save failed`.
- Theme bridging: extension forwards
  `onDidChangeActiveColorTheme` to the webview, which toggles
  `annot-theme-dark` / `annot-theme-light` classes.
- Command palette entries (`Annot: Open annotation`,
  `Annot: Reveal in Explorer` are fully wired; the other
  entries register the surface but their bodies are
  follow-ups).

Follow-ups (out of this package's scope today):

- Implementation bodies for `Annot: New annotation from
  clipboard image`, `New annotation from image…`,
  `Save as PNG…`, `Save as JPEG…`,
  `Export to PowerPoint…`. The command IDs are registered and
  discoverable; their handlers currently surface a "lands in
  a follow-up" info message.
- README screenshots + Marketplace publish step.

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
│  │     - handles fs.read / fs.write / dirty messages    │   │
│  │       via vscode.workspace.fs (no Annot-format       │   │
│  │       knowledge — plain bytes I/O)                   │   │
│  │     - status bar item + theme forwarding             │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                │
│        postMessage RPC ↕   │   correlated by id             │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Webview (sandboxed iframe)                           │   │
│  │ webview/main.ts                                      │   │
│  │   MessageProxyStorageProvider                        │   │
│  │     getImage(path)  → fs.read → readEditableImage    │   │
│  │                                  (raster) or text    │   │
│  │                                  decode (svg)        │   │
│  │     updateImage(path) → render + createEditableImage │   │
│  │                         (raster) or exportSVGString  │   │
│  │                         (svg) → fs.write             │   │
│  │                                                      │   │
│  │   const shell = new EditorShell({                    │   │
│  │     container: #annot-shell-container,               │   │
│  │     storage: proxyStorage,                           │   │
│  │     features: { capture: false, ... },               │   │
│  │     themeOverrides: { --annot-* → --vscode-* },      │   │
│  │   });                                                │   │
│  │   on "open" message → shell.open(path)               │   │
│  │   on shell.dirty → debounced shell.saveNow() → write │   │
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

| Extension | Source of truth | Status |
|-----------|----------------|--------|
| `*.annot.svg` | The SVG itself (with embedded `<image href="data:...">` for the screenshot). | Open + edit + save round-trips via `exportSVGString` ↔ text decode. |
| `*.annot.png` / `*.annot.jpeg` / `*.annot.jpg` | The raster file with the annotation SVG embedded as XMP (round-tripped via `@ingcreators/annot-core/xmp`). | Open + edit + save round-trips via `readEditableImage` ↔ `createEditableImage`. |

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
