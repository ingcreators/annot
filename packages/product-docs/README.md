# `@ingcreators/annot-product-docs`

[![npm](https://img.shields.io/npm/v/@ingcreators/annot-product-docs.svg)](https://www.npmjs.com/package/@ingcreators/annot-product-docs)
[![license](https://img.shields.io/npm/l/@ingcreators/annot-product-docs.svg)](https://github.com/ingcreators/annot/blob/main/LICENSE)

Living product docs core. Turn a Playwright tour suite into
always-fresh user manuals + Japanese 画面設計書, with drift
between MDX and live UI caught as a CI lint step.

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

test("login flow", async ({ page, screen }) => {
  await page.goto("/login");
  await screen.capture({
    id: "login",
    mdxPath: "docs/books/example/SC-001-login.mdx",
  });
});
```

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
- [`@ingcreators/annot-product-docs-xlsx`](../product-docs-xlsx) emits Excel 画面設計書.

## Tier

Tier A — Node-only, no DOM. Loads `playwright-core` at CLI
runtime for `sync` / `lint`. The library surface (parser,
match resolver, drift detector) is DOM-free.

## License

Apache-2.0.
