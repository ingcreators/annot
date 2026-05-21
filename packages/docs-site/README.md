# @ingcreators/annot-docs-site

Astro Starlight documentation site for `annot.work/docs`. Took
over the conventional `docs-site/` directory + `@ingcreators/annot-docs-site`
npm name in Phase 7 of
[`docs/plans/_done/annot-work-astro-unification.md`](../../docs/plans/_done/annot-work-astro-unification.md).
The legacy VitePress sibling was deleted in the
"retire VitePress + English-only" follow-up — the one-release-cycle
grace was skipped because no users had started reading the docs
yet.

## Layout

| Path | Purpose |
|---|---|
| `astro.config.mjs` | Starlight + `base: "/docs/"` + sitemap + `productDocsIntegration()` |
| `annot-docs.config.ts` | Living-product-docs project + book config |
| `playwright.config.ts` | Tour config (Chromium, 1280×800) |
| `src/content/docs/` | Starlight content collection (`.mdx` per route) |
| `src/styles/brand.css` | `customCss` brand-tint (minimal — Open Question #3 = (a)) |
| `src/assets/annot-icon.svg` | Logo for Starlight's header chrome |
| `public/favicon.svg` | Browser favicon |
| `tests/docs/annot-app.spec.ts` | Playwright tour that re-syncs the `/docs/app/` snapshot blocks against `annot.work/app/` |
| `worker.js` | Cloudflare Worker — 301 redirects bare `/docs` → `/docs/` plus `/docs/pwa/* → /docs/app/*` legacy redirects |
| `wrangler.jsonc` | Cloudflare Workers Static Assets config — Worker name `annot-docs-site-astro` for now (Phase 7.5 will rename Cloudflare-side after `annot-docs-site` is freed) |

## Commands

```bash
pnpm --filter @ingcreators/annot-docs-site dev        # local dev server (port 4321)
pnpm --filter @ingcreators/annot-docs-site build      # static build → ./dist/docs
pnpm --filter @ingcreators/annot-docs-site preview    # serve the build locally
pnpm --filter @ingcreators/annot-docs-site typecheck  # astro check
pnpm --filter @ingcreators/annot-docs-site docs:tour  # Playwright tour vs ANNOT_APP_URL
```

The build artefact lives in `./dist/docs/` (note the nested
`docs/` segment, mirroring the VitePress predecessor's file
layout). The Cloudflare Workers static-asset binding maps
incoming URL paths to files inside `assets.directory` —
including the route prefix — so a request to
`annot.work/docs/foo/` resolves to
`<assets.directory>/docs/foo/index.html`.

## URL preservation

Every existing `annot.work/docs/<path>` resolves the same after
the migration, **except** the `/docs/pwa/*` section: it was
renamed to `/docs/app/*` in Phase 2 with permanent 301
redirects installed in `worker.js`, because the web app at
`annot.work/app/` no longer ships a service worker or
`manifest.json` — the "PWA" segment was misleading. Page
titles + body copy also drop "PWA" in favour of "Annot web
app" / "Annot Cloud" by context.

## Open Question resolutions

The plan's seven Open Questions resolved as follows:

| # | Question | Resolution |
|---|---|---|
| 1 | Phase 5 dogfood scope | All docs pages that show the Annot web app — `/docs/app/*` plus screenshot-heavy `getting-started` / `recipes` pages. Phase 5 PR landed the `/docs/app/` overview as the proof-of-concept; expansion is follow-up work. |
| 2 | Cutover window | Feature flag — both Workers run in parallel during a 7-day observation; cookie / query param picks. |
| 3 | Starlight customisation depth | Minimal — accent palette via `customCss`, defaults everywhere else. |
| 4 | Trailing-slash policy | `ignore` (matches marketing's `trailingSlash: "ignore"`). |
| 5 | RSS / sitemap | Sitemap.xml emitted via `@astrojs/sitemap`; RSS deferred. |
| 6 | Temporary parallel name | `docs-site-astro` through Phase 6, renamed in Phase 7 (this one). |
| 7 | `/docs/pwa/*` URL rename | Phase 2 ported under `/docs/app/*` + installed 301 redirects. |

## Cutover state

This Worker claims `annot.work/docs/*` directly via the
`routes` block in `wrangler.jsonc`. The legacy VitePress
worker entry may still exist on the Cloudflare dashboard with
no route claim of its own — the operator can delete it from
the dashboard at any time without affecting traffic.
