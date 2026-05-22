---
"@ingcreators/annot-product-docs": patch
"@ingcreators/annot-product-docs-astro": patch
"@ingcreators/annot-product-docs-xlsx": patch
---

**Republish with `dist/` included.** The `0.1.0` tarballs of all
three packages shipped to npm without their `dist/` directory —
the `publish.yml` workflow's pre-pack `pnpm build` step had only
filtered four other packages, so `pnpm pack` packed the three
`product-docs*` packages against empty `dist/`s. The
`publishConfig.main` (`./dist/index.js`) consequently pointed at
a missing file, breaking `npm install` for every consumer.

The source fix landed in
[#947](https://github.com/ingcreators/annot/pull/947) with two
defences:

1. Three new `--filter` lines in the workflow's build step so
   all seven publishable packages get built before pack.
2. A per-package `prepack` script (`pnpm run build`) so even a
   misconfigured workflow (or a manual `pnpm pack` / `pnpm
   publish`) refreshes `dist/` before packing.

No source-code changes in any of the three packages — only the
packaging is fixed. This patch publish exists solely to deliver
working tarballs to the registry; the public API surface is
byte-identical to `0.1.0`.

Verified locally:

```
$ pnpm --filter @ingcreators/annot-product-docs pack --dry-run
Tarball Contents
  bin/annot-docs.mjs
  dist/cli.d.ts
  dist/config.d.ts
  dist/drift.d.ts
  dist/fixture.d.ts
  dist/index.d.ts
  dist/index.js
  dist/mdx.d.ts
  dist/resolver.d.ts
  dist/types-config.d.ts
  dist/types.d.ts
  LICENSE
  package.json
  README.md
```

Before the fix the same command produced 4 files (LICENSE +
README + package.json + bin/annot-docs.mjs), no compiled code.
