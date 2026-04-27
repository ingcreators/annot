# @ingcreators/annot-web

The PWA host for [Annot](../../README.md). Owns:

- App shell, routing, gallery, file management UI.
- Storage implementations (`device-store`, `google-drive-store`,
  `github-store`, `extension-bridge`) wired through the
  `StorageProvider` interface from
  [`@ingcreators/annot-core/storage`](../core).
- The toolbar (`toolbar.ts`) — instantiates tools from
  [`@ingcreators/annot-editor`](../editor) using the per-tool
  factories declared here in `tool-factories.ts`.
- The right-side property panel sections, the file-details
  drawer, the save menu, the canvas context menu.
- The PluginHost MVP (drawer + right-panel UI slots,
  storage-backend registration, sidebar tabs).
- Lit web components (prefix: `annot-`) and their co-located
  Storybook stories (`*.stories.ts`).

UI framework: **Lit 3**. Import Lit only via
[`@ingcreators/annot-web/lit`](./src/lit.ts) so built-in modules
and plugin authors share one `LitElement` identity. Reactive
properties use Lit's runtime `static properties` API (no
experimental decorators — see [`CLAUDE.md`](../../CLAUDE.md) for
why).

## Public entry points

| Subpath | Surface |
|---------|---------|
| `@ingcreators/annot-web/lit` | The `lit` re-export (use this, not `import "lit"` directly) |
| `@ingcreators/annot-web/editor/*` | Per-file deep imports for editor wiring (used by [`@ingcreators/annot-desktop`](../desktop)) |

## Scripts

```bash
pnpm --filter @ingcreators/annot-web dev              # Vite dev server (PWA)
pnpm --filter @ingcreators/annot-web build            # production build
pnpm --filter @ingcreators/annot-web typecheck        # tsc --noEmit
pnpm --filter @ingcreators/annot-web storybook        # component stories on :6006
pnpm --filter @ingcreators/annot-web build-storybook  # static Storybook bundle
pnpm --filter @ingcreators/annot-web icons            # regenerate app icons from brand SVG
```

## Environment variables

See [`./.env.example`](./.env.example) for the full list (Google
Drive integration + GitHub integration). Copy to `.env.local` and
fill in the values you need; both integrations are optional for
local development.

## Depends on

- [`@ingcreators/annot-core`](../core)
- [`@ingcreators/annot-editor`](../editor)
- [`@ingcreators/annot-render`](../render)

## See also

- [`CLAUDE.md`](../../CLAUDE.md) — Lit conventions, Storybook
  expectations, the schema-driven toolbar / property-panel
  patterns this package consumes.
- [`docs/plans/_done/lit-migration.md`](../../docs/plans/_done/lit-migration.md) — the multi-phase
  migration that moved this package off imperative DOM.
- [`docs/plans/_done/app-decomposition.md`](../../docs/plans/_done/app-decomposition.md) — how
  `app.ts` was broken into collaborator modules.

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
