# `workflow-app` example

Workflow approval SPA + dogfooded living product docs against
[`@ingcreators/annot-product-docs`](https://www.npmjs.com/package/@ingcreators/annot-product-docs)
+
[`@ingcreators/annot-product-docs-astro`](https://www.npmjs.com/package/@ingcreators/annot-product-docs-astro).

Plan:
[`docs/plans/workflow-app-example.md`](../../docs/plans/workflow-app-example.md).

## Phase 1 — what's here

This is the **scaffold** PR. The app boots, the hash router
resolves every planned route, the i18n toggle flips header copy
between English and Japanese, and every "screen" renders a
placeholder card. No login, no application form, no docs site
yet — those land in subsequent phases.

```
examples/workflow-app/
  package.json             # Standalone (NOT a workspace package)
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.ts                # Bootstrap
    router.ts              # Hash-based router
    i18n.ts                # Tiny dictionary lookup (en + ja)
    state.ts               # In-memory store shape (seed data lands in Phase 2)
    components/
      app-shell.ts         # <wf-app-shell>: header + outlet
      lang-toggle.ts       # <wf-lang-toggle>: en/ja switcher
    styles/
      tokens.css           # CSS custom properties (colour + spacing + radius)
      base.css             # Reset + shared layout helpers + shell rules
```

## How to run

```sh
cd examples/workflow-app
npm install
npm run dev    # http://localhost:5173/
```

Click the language toggle in the header to flip locales; click
any route link in the placeholder body to navigate.

## What lands next

- **Phase 2** — applicant flow (login → menu → apply → confirm → submitted)
- **Phase 3** — approver flow (menu → list → detail → decided)
- **Phase 4** — MDX docs (operation manual + screen design document)
- **Phase 5** — Astro `docs-site/` sub-package
- **Phase 6** — Playwright docs tour
- **Phase 7** — CI + final README + plan archival

Track progress on the linked plan.
