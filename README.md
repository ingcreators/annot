# Annot

Screenshot annotation system built around a portable SVG format —
shipped today as a PWA and Chrome extension, with an Electron desktop
host and a shared SVG-first core. The long-term direction is a headless
annotator callable from Playwright / Node and tight GitHub integration.

See [PRODUCT_DIRECTION.md](./PRODUCT_DIRECTION.md) for the strategic
north star, and [CLAUDE.md](./CLAUDE.md) for operational guidance.

## For evaluators

If you're vetting Annot for internal adoption — security review, IT
sign-off, vendor selection — this section points at the artefacts you
need without making you read the rest of the repo first.

**What it is.** A monorepo housing the editor core
(`@ingcreators/annot-core`) plus four first-party hosts (web PWA,
Chrome extension, Electron desktop, VSCode extension). Annotations are
persisted as SVG; storage backends are pluggable (browser IDB, local
filesystem, Google Drive, GitHub, and the hosted Annot Cloud). Every
host shares the same editor and the same SVG format, so an annotation
captured in the extension opens identically in the desktop app. The
core additionally ships as headless npm packages (`annot-annotator` /
`annot-playwright` / `annot-mcp`) and a living-product-docs pipeline
(`annot-product-docs` + `-astro` + `-xlsx`).

**Who it targets.** Individuals and small teams that want to annotate
screenshots without sending them to a third-party SaaS. The codebase
is OSS (Apache-2.0). The hosted product `annot.work` runs from this
repo (`packages/worker` + `packages/cloud-store`); only paid
billing / SSO connectors live in a separate private `annot-cloud`
repo — see
[`docs/plans/oss-cloud-split.md`](./docs/plans/oss-cloud-split.md) for
the long-form rationale and the guardrails that already apply.

**Engineering posture (snapshot, 2026-07-04).**

| Signal | Value |
|--------|-------|
| Test suite | 286 test files, ~4,180 Vitest cases, green on every PR via the `typecheck + build` workflow |
| Lint | Biome 2; CI blocks on errors (a small number of non-blocking warnings are tracked for cleanup) |
| TypeScript | strict + `override` + `noFallthroughCasesInSwitch` + `noUncheckedIndexedAccess`, every package |
| Public API | two stable entry points: `@ingcreators/annot-core` (full) and `/headless` (DOM-free) |
| Dependency hygiene | Dependabot (npm + github-actions) + `pnpm audit --audit-level=high` on every PR |
| Documentation | `PRODUCT_DIRECTION.md` (strategy), per-feature `docs/plans/*` design docs, `CLAUDE.md` (operational guide) |

**Documents an auditor will want.**

- [`LICENSE`](./LICENSE) — Apache-2.0, with the explicit patent grant
  that lands on most enterprise approved-license lists.
- [`SECURITY.md`](./SECURITY.md) — responsible-disclosure policy; primary
  intake is GitHub Private Vulnerability Reporting, fallback is a DM
  to [@ingmrn](https://github.com/ingmrn). Includes scope, response
  targets, and a "hardening that already ships" section.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch / PR / commit
  conventions, quality gates, and the architectural guardrails new
  contributions must respect.
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [`CHANGELOG.md`](./CHANGELOG.md) — a date-grouped log of landed PRs.
  Note: hand-maintained entries currently trail `main` (they stop
  around PR #98); the authoritative running history is the squash-merge
  `git log` / the GitHub PR list until a changeset-driven changelog is
  wired up.
- [`docs/plans/_done/`](./docs/plans/_done/) — design docs for landed
  work (Lit migration, app decomposition, plugin API MVP, Storybook
  introduction, plugin-storage / sidebar-tabs / UI-slots — full list
  in [`docs/plans/README.md`](./docs/plans/README.md)).
- [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) — strategy, including
  the deliberate OSS / commercial-cloud boundary.

**What's coming but isn't here yet.** A hosted Storybook URL (the build
runs in CI today; deploy is queued behind a separate plan), a published
Chrome Web Store listing, and the `annot-cloud` cohort of paid features
(separate private repo, no current ETA).

If something an auditor would expect is missing, please open an issue —
the gaps are usually "we haven't gotten to it" rather than deliberate
omissions.

## Monorepo layout

| Package | npm name | Role |
|---------|----------|------|
| [`packages/core`](./packages/core) | `@ingcreators/annot-core` | Editor core — SVG tools, PPTX export, storage types. Shared by every host. |
| [`packages/annotator`](./packages/annotator) | `@ingcreators/annot-annotator` | Headless annotator — Node-side `createAnnotator({ toPng, toSvg })`. |
| [`packages/playwright`](./packages/playwright) | `@ingcreators/annot-playwright` | Playwright fixture composing the headless annotator. |
| [`packages/mcp`](./packages/mcp) | `@ingcreators/annot-mcp` | MCP server exposing the annotator + docs tools to AI agents. |
| [`packages/product-docs`](./packages/product-docs) | `@ingcreators/annot-product-docs` | Living product docs core — MDX parser + match resolver + `productDocs` Playwright fixture + `annot-docs` CLI. |
| [`packages/product-docs-astro`](./packages/product-docs-astro) | `@ingcreators/annot-product-docs-astro` | Astro integration + Image Service + 7 docs components. |
| [`packages/product-docs-xlsx`](./packages/product-docs-xlsx) | `@ingcreators/annot-product-docs-xlsx` | Excel adapter — template + placeholder + named ranges + `annot-docs-xlsx` CLI. |
| [`packages/editor`](./packages/editor) | `@ingcreators/annot-editor` | Tier C live-browser primitives — CanvasManager, SelectionManager, History, PropertyPanel, ToolBase + tools. |
| [`packages/render`](./packages/render) | `@ingcreators/annot-render` | Tier C-render — `renderImageRecord` + the shared OOXML DrawingML builder. |
| [`packages/host-ui`](./packages/host-ui) | `@ingcreators/annot-host-ui` | Host-neutral editor surface — `EditorShell`, toolbar, drawer, right-panel, the `<annot-*>` Lit components. |
| [`packages/doc`](./packages/doc) | `@ingcreators/annot-doc` | Card / HTML-document core — `injectDocumentStyles` + the theme registry. |
| [`packages/capture`](./packages/capture) | `@ingcreators/annot-capture` | Shared capture-pipeline logic — the MAIN-world `walkElementTree` the extension host injects. |
| [`packages/web`](./packages/web) | `@ingcreators/annot-web` | PWA host. Routing, storage implementations, right panel. |
| [`packages/extension`](./packages/extension) | `@ingcreators/annot-extension` | Chrome MV3 extension. Capture pipeline + content-script DOM metadata. |
| [`packages/desktop`](./packages/desktop) | `@ingcreators/annot-desktop` | Electron desktop wrapper. |
| [`packages/vscode`](./packages/vscode) | `@ingcreators/annot-vscode` | VSCode extension host — custom editor for `*.annot.{svg,png,jpeg,jpg}` files. |
| [`packages/worker`](./packages/worker) | `@ingcreators/annot-worker` | Cloudflare Worker serving `annot.work/api/*` — OAuth, D1, R2, share/embed endpoints. |
| [`packages/cloud-store`](./packages/cloud-store) | `@ingcreators/annot-cloud-store` | `AnnotCloudStore` — the `StorageProvider` for the hosted `annot.work` backend. |
| [`packages/embed-protocol`](./packages/embed-protocol) | `@ingcreators/annot-embed-protocol` | Tier A embed-editor protocol — request-URL codec + origin-validated postMessage messengers. |
| [`packages/marketing`](./packages/marketing) | `@ingcreators/annot-marketing` | Astro 6 marketing site at `annot.work/`. |
| [`packages/docs-site`](./packages/docs-site) | `@ingcreators/annot-docs-site` | Astro Starlight docs site at `annot.work/docs/*`. Dogfoods `@ingcreators/annot-product-docs-astro` for the `/docs/app/` page (Playwright tour against `annot.work/app/`). |

`@ingcreators/annot-core` exposes two public entry points:

- `@ingcreators/annot-core` — full surface, includes browser-only UI
- `@ingcreators/annot-core/headless` — DOM-free subset, safe to import
  from Node / Playwright

## Requirements

- Node.js 24+ (pinned via `.nvmrc`; CI builds on the same version)
- pnpm 9+ (pinned via `packageManager` in the root `package.json`)

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
pnpm --filter @ingcreators/annot-desktop dev      # Electron dev (electron-vite)
pnpm --filter @ingcreators/annot-web storybook    # component stories (Storybook)
```

## Documentation

- [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) — strategic north star + principles
- [`CLAUDE.md`](./CLAUDE.md) — operational guide (also consulted by Claude Code)
- [`docs/svg-format.md`](./docs/svg-format.md) — canonical SVG annotation format
- [`docs/url-schemes.md`](./docs/url-schemes.md) — web routes + reserved `annot://` scheme
- [`docs/plans/`](./docs/plans/) — active design plans
- [`docs/plans/_done/`](./docs/plans/_done/) — landed plans (historical reference)

## License

[Apache License, Version 2.0](./LICENSE) © ingcreators 2026.
See [`NOTICE`](./NOTICE) for the third-party attribution required by
Apache §4(d).
