# `astro-docs-site` example

Phase 2 PR 4 dogfood for
[`docs/plans/_done/living-product-docs.md`](../../docs/plans/_done/living-product-docs.md).
A minimal Astro site demonstrating
`@ingcreators/annot-product-docs-astro` end-to-end against one
sample screen.

## Files

```
examples/astro-docs-site/
  package.json              Standalone — not a workspace package
  astro.config.mjs          Wires productDocsIntegration()
  annot-docs.config.ts      defineConfig({ meta, xlsx })
  src/
    pages/
      index.astro           Landing — lists available screens
    content/
      docs/
        SC-001-login.mdx    Sample screen MDX
  public/
    shots/                  (your annotated PNGs go here)
```

## How to run (post-publication)

```sh
cd examples/astro-docs-site
npm install
npm run dev
```

The example depends on `@ingcreators/annot-product-docs` +
`@ingcreators/annot-product-docs-astro` at `^0.1.0`. Both
packages were published 2026-05-21 (Phase 7 of
[`_done/living-product-docs.md`](../../docs/plans/_done/living-product-docs.md));
`npm install` resolves them from the registry directly.

Workspace-link alternative for local hacking on the deps:

```sh
# from repo root
pnpm install
pnpm --filter @ingcreators/annot-product-docs build
pnpm --filter @ingcreators/annot-product-docs-astro build
cd examples/astro-docs-site
npm install \
  ../../packages/product-docs \
  ../../packages/product-docs-astro
npm run dev
```

## What the example shows

- `annot:` frontmatter — id / title / xlsx role / meta.
- `<Screen>` block wrapping `<Overlay>` children, each with a
  persistent `match={{ role, name }}` key + intent + number.
- The Image Service path: at build time
  `productDocsIntegration()` could resolve `<Screen src=...>`
  through the `renderAnnotatedScreen` helper to produce an
  annotated PNG (the integration's hookup for that lands in
  Phase 4 polish — this PR ships only the static example).
- `annot:snapshot` comment block as the placeholder for the
  Playwright tour's output.

## Out of scope for this example

- The full Phase 4 wiring that makes the integration auto-walk
  `src/content/docs/` for MDX files and feed each `<Screen>`
  through the Image Service.
- A real Playwright tour file — the snapshot block is empty
  intentionally, so `<Screen>` falls back to the base PNG.
- An actual base PNG. Drop your own under
  `public/shots/login.png` to see the example render against a
  real screenshot.
