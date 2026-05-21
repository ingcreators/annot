# `workflow-app` example

Workflow approval SPA + dogfooded living product docs against
[`@ingcreators/annot-product-docs`](https://www.npmjs.com/package/@ingcreators/annot-product-docs)
+
[`@ingcreators/annot-product-docs-astro`](https://www.npmjs.com/package/@ingcreators/annot-product-docs-astro).

Plan:
[`docs/plans/workflow-app-example.md`](../../docs/plans/workflow-app-example.md).

## What's here (Phases 1–5)

```
examples/workflow-app/
  package.json             # Standalone (NOT a workspace package)
  vite.config.ts
  tsconfig.json
  index.html
  annot-docs.config.ts     # annot-docs CLI config (two books)
  src/                     # SPA source
    main.ts
    router.ts              # Hash-based router
    i18n.ts                # Tiny dictionary lookup (en + ja)
    state.ts               # In-memory store + seed users + seed applications
    format.ts              # Currency / date / display-name formatters
    components/
      app-shell.ts         # <wf-app-shell>: header + outlet + guards
      lang-toggle.ts       # <wf-lang-toggle>: en/ja switcher
    screens/               # Eight LitElement screens
      login.ts
      menu.ts
      application-form.ts
      application-confirm.ts
      application-submitted.ts
      approval-list.ts
      approval-detail.ts
      approval-decided.ts
    styles/
      tokens.css
      base.css
  docs/
    books/
      operation-manual/    # 10 MDX files (cover + OM-001..OM-009)
      screen-design/       #  9 MDX files (cover + SD-001..SD-008)
  docs-site/               # Astro 5 docs site (Phase 5)
    package.json           # Separate npm project
    astro.config.mjs
    src/
      content.config.ts    # Glob loaders for both books
      layouts/DocsLayout.astro
      _components/         # Local vendored <Screen>/<Overlay>/<Transition>
      pages/
        index.astro                          # Landing
        operation-manual/index.astro         # Book TOC
        operation-manual/[...slug].astro     # Per-screen page
        screen-design/index.astro
        screen-design/[...slug].astro
    public/
      shots/               # Base PNGs captured by scripts/capture-shots.mjs
      styles.css
  scripts/
    capture-shots.mjs      # One-off Playwright helper (Phase 5 stop-gap; retired by Phase 6)
```

## How to run the SPA

```sh
cd examples/workflow-app
npm install
npm run dev    # http://localhost:5173/
```

Click the language toggle in the header to flip locales. Sign
in as one of the seed accounts (every account uses
`password`):

| Email | Role |
|-------|------|
| `yamada@example.com` | Applicant |
| `suzuki@example.com` | Applicant |
| `tanaka@example.com` | Approver |

## How to run the docs site

```sh
cd examples/workflow-app
npm install
cd docs-site
npm install
npm run dev    # http://localhost:4321/
```

The site reads MDX from `../docs/books/{operation-manual,screen-design}/`
via Astro 5's `glob()` content loader, so editing an MDX file
hot-reloads the matching docs route.

## How to refresh the base screenshots

```sh
cd examples/workflow-app
# Terminal A — start Vite
npm run dev
# Terminal B — capture
npx playwright-core install chromium    # one-time
npm run shots:capture
```

The script walks every screen end-to-end in the en locale and
overwrites `docs-site/public/shots/*.png`. The Phase 6 tour
replaces this manual script with a proper Playwright
`screen.capture` fixture wired to
[`@ingcreators/annot-product-docs`](https://www.npmjs.com/package/@ingcreators/annot-product-docs).

## Upstream-publish blocker

The npm-published `@ingcreators/annot-product-docs@0.1.0` and
`-astro@0.1.0` tarballs are missing their `dist/` directory
(fixed at the source by
[#947](https://github.com/ingcreators/annot/pull/947); needs a
`0.1.1` republish before consumers can pull them).

Workarounds in this example until `0.1.1` lands:

- `annot-docs.config.ts` is a plain object literal instead of
  using `defineConfig` — the runtime CLI's Zod schema validates
  the same shape either way.
- `docs-site/astro.config.mjs` aliases
  `@ingcreators/annot-product-docs-astro/components/*.astro` to
  vendored copies under `docs-site/src/_components/`. The MDX
  `import` statements stay unchanged — only the resolution
  changes. Drop the alias block once the package republishes.

## What lands next

- **Phase 6** — Playwright docs tour replacing the
  `scripts/capture-shots.mjs` stop-gap and populating
  `annot:snapshot` blocks in every MDX.
- **Phase 7** — Advisory CI workflow + final README polish +
  plan archival to `docs/plans/_done/`.

Track progress on the linked plan.
