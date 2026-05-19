# @ingcreators/annot-docs-site

VitePress documentation site for **annot.work/docs** — the
public-facing API + recipes reference for the published npm
packages, plus the PWA / contributing guides.

Phase 8 of the
[Excalidraw-route cloud roadmap](../../docs/plans/annot-cloud-roadmap.md);
plan in [`docs/plans/launch-prep.md`](../../docs/plans/launch-prep.md).

## Status

**Phase 8c — scaffolded but not deployed.**

The site builds and serves locally; the static artefact lands in
`.vitepress/dist/`. There is no Cloudflare Workers binding for
`annot.work/docs` yet — Phase 8d does the atomic URL switchover
that mounts the marketing site at the root and the docs site at
`/docs`.

## Develop

```bash
pnpm --filter @ingcreators/annot-docs-site dev      # http://localhost:5173/docs/
pnpm --filter @ingcreators/annot-docs-site build    # → .vitepress/dist/
pnpm --filter @ingcreators/annot-docs-site preview  # serves the built site
```

## Layout

```
.vitepress/
  config.ts                Site config (nav, sidebar, theme)
public/
  favicon.svg              App icon, mirrored from brand/
index.md                   Home (VitePress hero layout)
getting-started/           Install walkthroughs for each package
api/                       API reference
recipes/                   End-to-end Playwright recipes
pwa/                       Annot Cloud (PWA) guide
contributing/              Local setup + PR workflow
```

## Why `base: "/docs/"`

The site will eventually be served under `annot.work/docs/`. The
`base` config makes every internal link resolve against that
prefix during the build, so the static HTML doesn't need a
deploy-time rewrite step.

In local dev the dev server respects the base too — the local
URL is `http://localhost:5173/docs/`.

## Out of scope (deferred)

- **Typedoc-generated API entries** — the current API reference
  is hand-written. We'll wire typedoc against `annot-core` /
  `annot-annotator` / `annot-playwright` exports in a follow-up
  PR, post-launch.
- **Screenshots / GIFs** — currently text-only. A Phase 8g
  follow-up records the assets.
- **i18n / Japanese locale** — post Show HN.
