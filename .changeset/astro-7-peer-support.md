---
"@ingcreators/annot-product-docs-astro": minor
---

**Astro 7 support** — the `astro` peer range widens from
`^5.0.0 || ^6.0.0` to `^5.0.0 || ^6.0.0 || ^7.0.0`.

No code changes were required: the integration only uses the
stable `astro:config:setup` hook + `updateConfig({ vite })`,
and the Image Service (`renderAnnotatedScreen`) is a plain
build-time renderer with no `astro:assets` dependency, so the
Astro 7 breaking changes (Vite 8, Rust compiler, Sätteri
Markdown pipeline) don't touch this package's surface.

Astro 5 and 6 consumers are unaffected — the range is purely
additive. Verified against `astro@7.0.6` +
`@astrojs/starlight@0.41.2` via the dogfooded
`@ingcreators/annot-docs-site` build.
