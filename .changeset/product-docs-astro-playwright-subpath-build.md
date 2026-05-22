---
"@ingcreators/annot-product-docs-astro": patch
---

**Fix `./playwright` subpath build.** The published `0.1.0`
and `0.2.0` tarballs shipped `dist/playwright/*.d.ts` (type
declarations) but NOT the runtime `dist/playwright/index.js`,
because `vite.config.ts`'s `lib.entry` was single-entry —
only the top-level `src/index.ts` got built.

Multi-entry library mode now emits both bundles:

```
dist/
  index.js                # main entry (re-exports integration + components + render)
  playwright/index.js     # `test`, `expect`, `patchScreenshot`, `rebaseAnnotations`
```

Any consumer doing `import { test } from
"@ingcreators/annot-product-docs-astro/playwright"`
previously got `Cannot find module ...dist/playwright/index.js`
at runtime; the `0.2.1` republish makes the subpath actually
loadable.

Also marks `@playwright/test` as external in the Rollup
config (matches the package.json `peerDependencies` shape;
prevents accidentally bundling Playwright into the playwright
adapter).

No public-API change — same exports, same call shapes,
same TypeScript types. Pure packaging fix.
