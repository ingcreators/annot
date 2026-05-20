# `@ingcreators/annot-product-docs-astro`

Astro integration for the
[`@ingcreators/annot-product-docs`](../product-docs) core. Wires
the docs-MDX components (`<Screen>` / `<Overlay>` /
`<Transition>` / `<HistoryEntry>` / `<ScreenList>` /
`<TransitionGraph>`) into an Astro site, and ships a custom
Image Service that renders annotated PNGs from `<Screen>` blocks
at build time.

Phase 2 of [`docs/plans/living-product-docs.md`](../../docs/plans/living-product-docs.md).
This PR (Phase 2 PR 1) ships the scaffold + the
`productDocsIntegration()` factory only — the Image Service +
the seven components land in PRs 2–3 of Phase 2.

## Usage (planned)

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import { productDocsIntegration } from "@ingcreators/annot-product-docs-astro";

export default defineConfig({
  integrations: [productDocsIntegration()],
});
```

The integration accepts an options object:

```ts
productDocsIntegration({
  contentDir: "docs",                // default
  configPath: "annot-docs.config.ts",// default
  verbose: false,                    // default
});
```

## Tier

Tier B-render — Astro build-time, no live editor.

## Status

`private: true` in the workspace until Phase 7 flips it for
publication via the existing Trusted Publishing pipeline.

## License

Apache-2.0.
