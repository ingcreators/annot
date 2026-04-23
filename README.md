# Annot

Screenshot annotation system built around a portable SVG format —
shipped today as a PWA and Chrome extension, with a Tauri desktop host
and a shared SVG-first core. The long-term direction is a headless
annotator callable from Playwright / Node and tight GitHub integration.

See [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md) for the strategic
north star, and [CLAUDE.md](./CLAUDE.md) for operational guidance.

## Monorepo layout

| Package | npm name | Role |
|---------|----------|------|
| [`packages/core`](./packages/core) | `@ingcreators/annot-core` | Editor core — SVG tools, PPTX export, storage types. Shared by every host. |
| [`packages/web`](./packages/web) | `@ingcreators/annot-web` | PWA host. Routing, storage implementations, right panel. |
| [`packages/extension`](./packages/extension) | `@ingcreators/annot-extension` | Chrome MV3 extension. Capture pipeline + content-script DOM metadata. |
| [`packages/desktop`](./packages/desktop) | `@ingcreators/annot-desktop` | Tauri desktop wrapper. |

`@ingcreators/annot-core` exposes two public entry points:

- `@ingcreators/annot-core` — full surface, includes browser-only UI
- `@ingcreators/annot-core/headless` — DOM-free subset, safe to import
  from Node / Playwright

## Requirements

- Node.js 20+
- pnpm 9+ (pinned via `packageManager` in the root `package.json`)
- Rust toolchain + Tauri prerequisites, only if building the desktop host

## Getting started

```bash
pnpm install
pnpm -r typecheck
pnpm -r build
```

### Per-package dev

```bash
pnpm --filter @ingcreators/annot-web dev          # PWA dev server
pnpm --filter @ingcreators/annot-extension dev    # extension build (watch)
pnpm --filter @ingcreators/annot-desktop dev      # Tauri dev (requires Rust)
```

## Documentation

- [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) — strategic north star + principles
- [`CLAUDE.md`](./CLAUDE.md) — operational guide (also consulted by Claude Code)
- [`docs/svg-format.md`](./docs/svg-format.md) — canonical SVG annotation format
- [`docs/url-schemes.md`](./docs/url-schemes.md) — web routes + reserved `annot://` scheme
- [`docs/plans/`](./docs/plans/) — queued / in-progress design plans

## License

Unpublished. All rights reserved © ingcreators.
