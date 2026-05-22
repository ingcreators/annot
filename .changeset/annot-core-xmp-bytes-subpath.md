---
"@ingcreators/annot-core": patch
---

**Expose `./xmp-bytes` subpath on the published tarball.**
The workspace `package.json#exports` declared
`"./xmp-bytes": "./src/xmp/xmp-bytes.ts"` from day one, but
`publishConfig.exports` only declared `.` + `./styles/*` —
so every workspace subpath (`./headless`, `./editor/*`,
`./xmp-bytes`, etc.) was stripped from the published
tarball.

This patch unblocks the `./xmp-bytes` subpath specifically.
`@ingcreators/annot-product-docs-astro@0.2.1`'s playwright
fixture imports `@ingcreators/annot-core/xmp-bytes` (via
the bundled `writePngWithTagsOnly` helper); without this
patch, any consumer doing
`import { test } from "@ingcreators/annot-product-docs-astro/playwright"`
hits `Package subpath './xmp-bytes' is not defined`.

## Fix

`vite.config.ts` switches to multi-entry library mode:

```ts
lib: {
  entry: {
    index: resolve(__dirname, "src/index.ts"),
    "xmp-bytes": resolve(__dirname, "src/xmp/xmp-bytes.ts"),
  },
  formats: ["es"],
},
```

`package.json#publishConfig.exports` gains the matching
`./xmp-bytes` entry:

```json
"./xmp-bytes": {
  "types": "./dist/xmp/xmp-bytes.d.ts",
  "default": "./dist/xmp-bytes.js"
}
```

Bundle landing in the tarball:

```
dist/xmp-bytes.js          7.55 kB │ gzip: 2.67 kB
dist/xmp/xmp-bytes.d.ts    declarations colocated by the dts plugin
```

## Other subpaths still missing

The workspace `exports` map declares 17+ subpaths (`./headless`,
`./editor`, `./editor/*`, `./icons`, `./xmp`, `./zip`,
`./utils`, `./desktop-bridge`, `./storage`, `./encode/*`,
`./auto-capture-options`, …). Most are Tier C (browser-only)
and shouldn't ship as standalone published bundles — Tier C
code lives in `@ingcreators/annot-editor` / `-render` for
npm consumers. The few Tier A subpaths that DO make sense
on npm (`./headless`, `./storage`, `./utils`, `./zip`,
`./zip-bytes`) can ship in a separate follow-up patch
when a concrete downstream consumer needs them.

## After this PR republishes

`@ingcreators/annot-product-docs-astro` needs a `0.2.2`
republish that bumps its `@ingcreators/annot-core` dep
from `0.2.0` to `^0.2.1` so the playwright fixture can
finally resolve `./xmp-bytes` at consumer install time.
Once both land, the `examples/workflow-app/` tour can
migrate from the hybrid `captureScreen + page.screenshot`
pair to the unified `page.screenshot({ annot: { mdx } })`
single call.
