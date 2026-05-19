# @ingcreators/annot-marketing

Astro static site for **annot.work** — the landing page that frames
the Playwright + headless story for the first-time visitor, plus
the press kit, privacy / terms, and (later) localised landing
copy.

Phase 8 of the
[Excalidraw-route cloud roadmap](../../docs/plans/annot-cloud-roadmap.md);
plan in [`docs/plans/launch-prep.md`](../../docs/plans/launch-prep.md).

## Status

**Phase 8b — scaffolded but not deployed.**

The site builds and serves locally; the static artefact lands in
`dist/`. There is no Cloudflare Workers binding for `annot.work/`
yet — Phase 8d does the atomic URL switchover that moves the PWA
from `annot.work/*` to `annot.work/app/*` and mounts this site at
the root.

## Develop

```bash
pnpm --filter @ingcreators/annot-marketing dev      # http://localhost:4321
pnpm --filter @ingcreators/annot-marketing build    # → dist/
pnpm --filter @ingcreators/annot-marketing preview  # serves dist/
```

## What's here

| Path                 | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `src/layouts/Base.astro` | Shared `<head>` + header + footer.        |
| `src/pages/index.astro`  | Landing page — hero, flows, install CTAs. |
| `src/styles/global.css`  | Brand palette + layout primitives.        |
| `public/favicon.svg`     | App icon mirrored from `brand/`.          |

The marketing pages live as plain Astro components — no framework
adapters, no JavaScript at runtime, pure static HTML output. Add
new pages by dropping `.astro` files into `src/pages/`.

## Out of scope (deferred)

- **Open Graph image generation** — best-effort in 8c, full audit
  post-launch.
- **i18n / Japanese locale** — follow-up after the English Show HN.
- **Press kit page + assets** — Phase 8g.
- **Privacy / Terms placeholders** — Phase 8e.
