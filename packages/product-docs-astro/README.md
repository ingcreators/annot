# `@ingcreators/annot-product-docs-astro`

[![npm](https://img.shields.io/npm/v/@ingcreators/annot-product-docs-astro.svg)](https://www.npmjs.com/package/@ingcreators/annot-product-docs-astro)
[![license](https://img.shields.io/npm/l/@ingcreators/annot-product-docs-astro.svg)](https://github.com/ingcreators/annot/blob/main/LICENSE)

Astro integration for
[`@ingcreators/annot-product-docs`](../product-docs). Wires the
docs-MDX components into an Astro site and ships an Image Service
that renders annotated PNGs from `<Screen>` blocks at build time.

Phase 2 of
[`docs/plans/_done/living-product-docs.md`](https://github.com/ingcreators/annot/blob/main/docs/plans/_done/living-product-docs.md).

## Install

```sh
pnpm add astro @astrojs/mdx
pnpm add @ingcreators/annot-product-docs-astro
```

## Usage

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import { productDocsIntegration } from "@ingcreators/annot-product-docs-astro";

export default defineConfig({
  integrations: [mdx(), productDocsIntegration()],
});
```

```mdx
---
annot:
  id: SC-001
  title: Login
---

import Screen from "@ingcreators/annot-product-docs-astro/components/Screen.astro";
import Overlay from "@ingcreators/annot-product-docs-astro/components/Overlay.astro";

# Login

<Screen id="login" src="./shots/login.png">
<Overlay match={{ role: "textbox", name: "Email" }} number={1}>
Email — enter your registered address.
</Overlay>
</Screen>
```

## Components

| Component | Purpose |
|---|---|
| `<Screen>` | Annotated screenshot block with `<Overlay>` children. |
| `<Overlay>` | Numbered callout caption with persistent `match` key. |
| `<Transition>` | Inline screen-to-screen transition (trigger / event / target). |
| `<TransitionTable>` | Tabular list of transitions. |
| `<HistoryEntry>` | Revision-history row. |
| `<ScreenList>` | Auto-enumerated screen index across a book. |
| `<TransitionGraph>` | Mermaid-rendered cross-screen flowchart. |

Each is a single-root `.astro` file with a typed `Props`
interface; data attributes flow through to the rendered DOM
for CSS / JS hooks.

## Image Service

`renderAnnotatedScreen({ mdxPath, screenId, cache? })` composes
the base screenshot with overlay callouts derived from the
stored `annot:snapshot` bbox markers. SHA-keyed
`createFileCache(dir)` / `createMemoryCache()` short-circuit
no-change rebuilds.

```ts
import { renderAnnotatedScreen, createFileCache } from "@ingcreators/annot-product-docs-astro";

const cache = createFileCache("./node_modules/.annot-cache");
const { bytes, fromCache, hadBoundingBoxes } = await renderAnnotatedScreen({
  mdxPath: "docs/books/spec/SC-001.mdx",
  screenId: "login",
  cache,
});
```

When the stored snapshot lacks `[box=x,y,w,h]` markers (no
Playwright tour has run yet), the function returns the base
PNG verbatim with `hadBoundingBoxes: false`.

## Tier

Tier B-render — Astro build-time, no live editor.

## License

Apache-2.0.
