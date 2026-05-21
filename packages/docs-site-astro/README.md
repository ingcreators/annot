# @ingcreators/annot-docs-site-astro

Astro Starlight documentation site for `annot.work/docs`. **Phases
1-5 of `docs/plans/annot-work-astro-unification.md` run this
package in parallel with the legacy VitePress site at
`packages/docs-site/`**; the production `/docs/*` route still
belongs to VitePress until Phase 6 cuts over via Cloudflare
feature flag. Phase 7 retires the VitePress package and renames
this one to `docs-site` to reclaim the conventional name.

## Why a parallel package?

Two reasons the migration ships side-by-side rather than rewriting
`packages/docs-site/` in place:

1. **Rollback stays trivial.** The legacy `docs-site/dist/` build
   keeps deploying through every migration phase. Phase 6's
   cutover swaps the Cloudflare static-asset binding; if anything
   blows up, reverting that single PR restores production.
2. **Build commands diverge.** VitePress (`vitepress build`)
   writes to `.vitepress/dist/`; Astro (`astro build`) writes to
   `./dist/`. Side-by-side avoids churning `package.json` scripts,
   `pnpm-workspace.yaml`, and `.github/workflows/` during the
   content port phase where reviewers want the diff focused on
   prose.

Precedent: `docs/plans/_done/desktop-electron-migration.md` used
the same parallel-then-rename pattern when moving the desktop app
from Tauri to Electron.

## Layout

| Path | Purpose |
|---|---|
| `astro.config.mjs` | Starlight integration + `base: "/docs/"` + sitemap |
| `src/content/docs/` | Starlight content collection (`.mdx` per route) |
| `src/styles/brand.css` | `customCss` brand-tint override (minimal — Open Question #3 = (a)) |
| `src/assets/annot-icon.svg` | Logo for Starlight's header chrome |
| `public/favicon.svg` | Browser favicon (same as marketing + legacy docs) |
| `worker.js` | Cloudflare Worker — 301 redirects bare `/docs` → `/docs/` |
| `wrangler.jsonc` | **Preview-only** until Phase 6; production route swap is in the Phase 6 PR |

## Commands

```bash
pnpm --filter @ingcreators/annot-docs-site-astro dev        # local dev server
pnpm --filter @ingcreators/annot-docs-site-astro build      # static build → ./dist/docs
pnpm --filter @ingcreators/annot-docs-site-astro preview    # serve the build locally
pnpm --filter @ingcreators/annot-docs-site-astro typecheck  # astro check
```

The build artefact lives in `./dist/docs/` (note the nested
`docs/` segment, mirroring the VitePress predecessor). The
Cloudflare Workers static-asset binding maps incoming URL paths
to files inside `assets.directory` — including the route
prefix — so a request to `annot.work/docs/foo/` resolves to
`<assets.directory>/docs/foo/index.html`.

## URL preservation

The migration is bound by a strict URL preservation contract
(see plan). Every existing `annot.work/docs/<path>` keeps the
same pathname after cutover, **except** the `/docs/pwa/*`
section: it's renamed to `/docs/app/*` in Phase 2 (with 301
redirects in the Worker) because the web app no longer ships
as a PWA — there's no manifest or service worker, just an SPA
at `annot.work/app/`. The page titles + body copy also drop
"PWA" in favour of "Annot web app" or "Annot Cloud" depending
on context.

## Open Question resolutions (Phase 0)

The plan's six Open Questions resolved as follows (user
confirmation captured at Phase 1 kick-off):

| # | Question | Resolution |
|---|---|---|
| 1 | Phase 5 dogfood scope | All docs pages that show the Annot web app — `/docs/app/*` plus screenshot-heavy `getting-started` / `recipes` pages |
| 2 | Cutover window | Feature flag (both Workers run in parallel; header/cookie picks which) |
| 3 | Starlight customisation depth | Minimal — accent palette via `customCss`, defaults everywhere else |
| 4 | Trailing-slash policy | `ignore` (matches marketing's `trailingSlash: "ignore"`) |
| 5 | RSS / sitemap | Sitemap.xml emitted via `@astrojs/sitemap`; RSS deferred |
| 6 | Temporary parallel name | `docs-site-astro` through Phase 6, renamed in Phase 7 |

## Phase 1 acceptance

This scaffold passes when:

- `pnpm --filter @ingcreators/annot-docs-site-astro typecheck`
  succeeds.
- `pnpm --filter @ingcreators/annot-docs-site-astro build`
  produces `./dist/docs/index.html` with the placeholder home
  page rendered.
- `astro dev` serves the home page at `/docs/` with the brand
  accent applied and the sidebar / search chrome visible.

Production deploy is **out of scope for Phase 1**. The
`wrangler.jsonc` runs in preview mode; flipping it to the
production route is the Phase 6 PR's job.
