# `@ingcreators/annot-product-docs`

[![npm](https://img.shields.io/npm/v/@ingcreators/annot-product-docs.svg)](https://www.npmjs.com/package/@ingcreators/annot-product-docs)
[![license](https://img.shields.io/npm/l/@ingcreators/annot-product-docs.svg)](https://github.com/ingcreators/annot/blob/main/LICENSE)

Living product docs core. Turn a Playwright tour suite into
always-fresh user manuals + Excel screen specifications, with
drift between MDX and live UI caught as a CI lint step.

Phase 1 of
[`docs/plans/_done/living-product-docs.md`](https://github.com/ingcreators/annot/blob/main/docs/plans/_done/living-product-docs.md).

## Install

```sh
pnpm add @ingcreators/annot-product-docs
# Plus your Playwright install (peer dep)
pnpm add -D @playwright/test
```

## Quickstart

```sh
pnpm annot-docs init
```

Scaffolds:

```
annot-docs.config.ts
tests/docs/example.spec.ts
docs/books/example/SC-001-login.mdx
```

The MDX is one screen with three example `<Overlay>` blocks.
The tour file calls `screen.capture(...)` against the
Playwright `screen` fixture — once you point it at your real
app, every CI run refreshes the stored `annot:snapshot` and
`annot:attributes` blocks.

## Authoring an MDX

```mdx
---
annot:
  id: SC-001
  title: Login screen
  xlsx:
    book: Screen spec
    sheet: SC-001 Login
    role: screen
---

import Screen from "@ingcreators/annot-product-docs-astro/components/Screen.astro";
import Overlay from "@ingcreators/annot-product-docs-astro/components/Overlay.astro";

# Login screen

<Screen id="login" src="./shots/login.png">

<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**Email** — Enter your registered email.
</Overlay>

<Overlay match={{ role: "button", name: "Sign in" }} intent="action" number={2}>
Click to sign in.
</Overlay>

</Screen>
```

`<Overlay match>` keys persist; Playwright `ref=eN` markers
don't. The resolver re-finds each element on every run.

## Tour file

```ts
// tests/docs/auth.spec.ts
import { test } from "@ingcreators/annot-product-docs";

test("login flow", async ({ page, productDocs }) => {
  await page.goto("/login");
  await productDocs.sync({
    id: "login",
    mdxPath: "docs/books/example/SC-001-login.mdx",
  });
});
```

## `page.screenshot({ annot })` Playwright fixture

The package's `test` extends
[`@ingcreators/annot-playwright`](../playwright)'s test with the
`productDocs.sync(...)` fixture above AND registers an MDX-aware
resolver into the `annotSourceResolvers` registry. Pass
`annot: { mdx }` on `page.screenshot()` to bundle the
refresh-snapshot + take-screenshot + bake-overlays + write-PNG
sequence into one call — the same `<Screen id>` block in the
target MDX gets re-synced before the screenshot fires, and the
output PNG is re-editable in Annot Cloud:

```ts
test("app overview", async ({ page }) => {
  await page.goto("https://annot.work/app/");
  await page.screenshot({
    path: "public/app/shots/app-overview.png",
    annot: {
      mdx: { id: "app-overview", path: "src/content/docs/app/index.mdx" },
      tags: { source: "docs-tour", capturedAt: new Date().toISOString() },
    },
  });
});
```

Calls without `annot` (or with `annot: true` / `{}`) fall
through to vanilla Playwright byte-for-byte — codegen-emitted
calls keep working unedited. The generic `annot.overlays` /
`annot.tags` / `annot.editable` fields are handled by
annot-playwright; this package contributes the MDX-aware
`annot.mdx` field on top via the hook registry. See
[`annot.work/docs/product-docs/playwright-fixture/`](https://annot.work/docs/product-docs/playwright-fixture/)
for the compositional vocabulary, locator screenshot semantics,
and the codegen→hand-edit workflow.

## CLI

```sh
annot-docs init                          # scaffold config + sample
annot-docs sync --url http://localhost:5173  # refresh snapshot/attrs across MDXs
annot-docs lint --url http://localhost:5173  # report drift; non-zero exit on errors
annot-docs lint --json --ci              # CI-shaped output (JSON + warnings fail)
annot-docs lint --fix                    # auto-refresh stored blocks for files with drift
```

The companion adapters consume the MDXs:
- [`@ingcreators/annot-product-docs-astro`](../product-docs-astro) renders an Astro docs site.
- [`@ingcreators/annot-product-docs-xlsx`](../product-docs-xlsx) emits Excel screen specifications.

## Tier

Tier A — Node-only, no DOM. Loads `playwright-core` at CLI
runtime for `sync` / `lint`. The library surface (parser,
match resolver, drift detector) is DOM-free.

## License

Apache-2.0.
