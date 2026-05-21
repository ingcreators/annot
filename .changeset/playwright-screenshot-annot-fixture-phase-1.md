---
"@ingcreators/annot-core": minor
"@ingcreators/annot-product-docs-astro": minor
---

**`@ingcreators/annot-product-docs-astro` — new `/playwright`
subpath** that re-exports an extended Playwright `test` fixture
whose `page.screenshot()` accepts a compositional `annot: { … }`
option:

```ts
import { test } from "@ingcreators/annot-product-docs-astro/playwright";

test("login flow", async ({ page }) => {
  await page.goto("/login");
  await page.screenshot({
    path: "public/login.png",
    annot: {
      mdx: { id: "login", path: "src/content/docs/login.mdx" },
      tags: { source: "docs-tour", capturedAt: new Date().toISOString() },
    },
  });
});
```

The `annot` option is compositional — each field is an
independent contribution to the embedded XMP record:

- `mdx: { id, path }` — refresh the MDX's `annot:snapshot` block
  against the current page, then resolve `<Overlay match>` blocks
  for the named `<Screen>`.
- `overlays: BboxAnnotation[]` — caller-supplied annotations
  (same DSL `@ingcreators/annot-annotator` accepts). Merged with
  MDX-derived overlays when both are present.
- `tags: Record<string, string>` — provenance metadata written
  verbatim into the XMP. No auto-fill — callers write the
  `WELL_KNOWN_TAG_KEYS` they want.
- `editable: boolean` (default `true`) — toggle between
  "annotations preserved as SVG layer + embedded original"
  (re-editable in Annot Cloud) and "annotations baked into
  visible pixels" (flat PNG, no XMP layer).

`page.screenshot()` calls WITHOUT `annot` fall through to
vanilla Playwright byte-for-byte — codegen / DevTools Recorder
output keeps working unedited.

Phase 1 of
`docs/plans/playwright-screenshot-annot-fixture.md`. Phase 2 will
add the same interception on `locator.screenshot()` with
coordinate rebasing for sub-region overlays.

Two helpers also exported from the main `@ingcreators/annot-product-docs-astro`
entry for callers who want to compose annotations themselves:

- `resolveMdxAnnotations({ mdxPath, screenId, dims })` — extract
  the MDX's `<Overlay>` blocks into a typed `BboxNumberedBadgeAnnotation[]`
  (the underlying step the fixture uses internally).
- `svgFromBboxAnnotations(annotations)` — wrap a
  `BboxAnnotation[]` into a single-root `<svg>` ready for
  `Annotator.toEditablePng()` / `toPng()`.

**`@ingcreators/annot-core` — new `writePngWithTagsOnly`
helper** exported from `/xmp-bytes` (and re-exported from
`/xmp`). Writes `tags` into a PNG's XMP iTXt chunk without
embedding an original capture or annotations layer — for the
"PNG with provenance metadata sidecar" path (CI failure
screenshots, VRT references, etc.). The resulting bytes are
still a valid PNG and the Annot editor treats them as a normal
PNG (no `<annot:annotations>` element → not editable round-trip;
opens as fresh canvas).
