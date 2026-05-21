---
"@ingcreators/annot-product-docs-astro": minor
---

`renderAnnotatedScreen()` gains an optional `editable?: boolean |
{ tags?: Record<string, string> }` field. Pass `true` (or an
object) and the function routes through the new
`Annotator.toEditablePng()` path: the returned PNG carries the
same visible callouts plus the original capture + the
annotations SVG embedded in XMP / custom `svGo` chunk, so
re-opening the file in the Annot editor / Cloud restores the
overlays as selectable / movable / restylable objects rather
than a flat bitmap.

```ts
const result = await renderAnnotatedScreen({
  mdxPath: "docs/app/index.mdx",
  screenId: "app-overview",
  basePngBytes,
  editable: {
    tags: {
      source: "docs-tour",
      capturedAt: new Date().toISOString(),
    },
  },
});
await writeFile("public/app/shots/app-overview.png", result.bytes);
```

The cache key folds in the `editable` flag, so flat and editable
variants of the same screen don't collide. Existing flat-raster
callers are byte-for-byte unaffected — the option defaults to
`undefined` (flat).

The `CacheKeyInput` type gains a parallel `editable?: boolean`
field; pure helpers that compute the cache key directly should
forward the bit when threading the flag through.

Internal note: this PR also adds `@ingcreators/annot-core` as a
devDependency so tests can import `readEditablePngBytes` from
`/xmp-bytes` for round-trip verification. Runtime dependencies
are unchanged.
