# @ingcreators/annot-core

[![npm](https://img.shields.io/npm/v/@ingcreators/annot-core.svg)](https://www.npmjs.com/package/@ingcreators/annot-core)
[![license](https://img.shields.io/npm/l/@ingcreators/annot-core.svg)](https://github.com/ingcreators/annot/blob/main/LICENSE)

The shared core of [Annot](../../README.md). Two tiers live here:

- **Tier A** — pure Node, DOM-free. Storage types, SVG format
  versioning, path utilities, ZIP builder, capability predicates,
  encode helpers.
- **Tier B** — jsdom-friendly element-takers. SVG-element helpers
  (`arrow-markers`, `transform-utils`, `shape-utils`, `text-utils`,
  `gradient-utils`), the `TOOL_REGISTRY` / `PROPERTY_CONTROLS`
  registries, the OOXML shape mapping (`svg-to-annotation-shapes`).
  No `<canvas>`, no live editor.

Live-browser editor primitives (CanvasManager, SelectionManager,
PropertyPanel, tools) live in [`@ingcreators/annot-editor`](../editor).
Data-driven canvas rendering (gallery thumbnails, the shared OOXML
DrawingML builder) lives in [`@ingcreators/annot-render`](../render).

## Install (npm)

```sh
npm install @ingcreators/annot-core
# or
pnpm add @ingcreators/annot-core
```

Most consumers will install the higher-level
[`@ingcreators/annot-annotator`](https://www.npmjs.com/package/@ingcreators/annot-annotator)
or [`@ingcreators/annot-playwright`](https://www.npmjs.com/package/@ingcreators/annot-playwright)
instead — those packages inline the parts of `annot-core` they
need. Install `annot-core` directly only when building a custom
headless tool against the SDK.

## Public entry points

| Subpath | Tier | Surface | Available on npm? |
|---------|------|---------|---|
| `@ingcreators/annot-core` | A | Re-exports everything from `/headless` — DOM-free root entry | ✅ |
| `@ingcreators/annot-core/headless` | A | Same as root, kept as an alias for callers that want to be explicit | workspace only (v0.1.0) |
| `@ingcreators/annot-core/storage` | A | `ImageRecord`, `FolderRecord`, `StorageProvider` | workspace only (v0.1.0) |
| `@ingcreators/annot-core/utils` | A | `assertNonNull`, `computeDasharray`, `newIdB58`, defaults | workspace only (v0.1.0) |
| `@ingcreators/annot-core/zip` | A | ZIP builder used by PPTX export | workspace only (v0.1.0) |
| `@ingcreators/annot-core/encode` | A | Image encode helpers | workspace only (v0.1.0) |
| `@ingcreators/annot-core/editor` | B | jsdom-friendly element helpers + `TOOL_REGISTRY` / `PROPERTY_CONTROLS` | workspace only (v0.1.0) |
| `@ingcreators/annot-core/xmp` | browser | `createEditableImage` / `readEditableImage` round-trip | workspace only (v0.1.0) |
| `@ingcreators/annot-core/desktop-bridge` | browser | Electron desktop-host IPC + `isDesktop` detection | workspace only (v0.1.0) |

Subpath imports for npm consumers land in a later minor — the
v0.1.0 published tarball bundles everything into the root
`./dist/index.js` entry. Workspace consumers (within this
monorepo) keep using the full subpath map via the source-side
exports.

The Tier A surface is CI-enforced by
[`src/headless.test.ts`](./src/headless.test.ts): it imports every
documented subpath in a pure-Node Vitest environment and asserts no
DOM globals leak in. It also walks the loader cache to prove that
no `annot-core` module transitively pulls `annot-editor` or
`annot-render` (cycle invariant).

## Build

```bash
pnpm --filter @ingcreators/annot-core build      # vite library build
pnpm --filter @ingcreators/annot-core typecheck  # tsc --noEmit
```

## See also

- [Root README](../../README.md) — monorepo overview, getting started.
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — strategic north star (this package is the future
  headless library boundary).
- [`CLAUDE.md`](../../CLAUDE.md) — Tier model rationale and the rules for adding new symbols.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
