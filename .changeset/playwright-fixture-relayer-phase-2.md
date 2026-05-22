---
"@ingcreators/annot-product-docs": minor
---

**MDX resolver moves home + auto-registers into the screenshot
patch** — Phase 2 of
`docs/plans/playwright-screenshot-fixture-relayer.md`. The
MDX-aware annotation pipeline that powers
`page.screenshot({ annot: { mdx: { id, path } } })` now lives in
`@ingcreators/annot-product-docs` (the package that already owns
MDX parsing + the `screen.capture()` fixture). Calls go through
annot-playwright's generic patch + the new
`annotSourceResolvers` hook registry, so consumers no longer
need an Astro peer dep for the dogfood tour pattern:

```ts
// Was: @ingcreators/annot-product-docs-astro/playwright
import { test } from "@ingcreators/annot-product-docs";

test("docs tour", async ({ page }) => {
  await page.goto(APP_URL);
  await page.screenshot({
    path: "shots/app-overview.png",
    annot: {
      mdx: { id: "app-overview", path: "src/content/docs/app/index.mdx" },
      tags: { source: "docs-tour", screen: "app-overview" },
    },
  });
});
```

The `annot: { mdx }` resolver fires in two stages:

1. `prepare()` — calls `captureScreen(page, { id, mdxPath })`
   internally, refreshing the MDX's `annot:snapshot` +
   `annot:attributes` blocks against the live page BEFORE the
   raw screenshot is taken.
2. `resolveAnnotations(dims)` — reads the freshly-written
   `annot:snapshot` block + `<Overlay match>` entries and
   returns page-space `BboxNumberedBadgeAnnotation[]` which
   annot-playwright merges with any caller-supplied
   `annot.overlays` before rebasing onto the clipped image.

**New public surface**

- `resolveMdxAnnotations({ mdxPath, screenId, dims, cwd? })` —
  pure-data resolver used by both the Playwright hook and the
  Astro Image Service (Phase 4 of the relayer plan switches
  product-docs-astro's `renderAnnotatedScreen` to consume it).
- `parseSnapshotBoxes(yaml)` / `buildBadgeAnnotations(overlays,
  boxed, dims)` — exposed for callers that want to drive
  annotation production from custom snapshot pipelines.
- `svgFromBboxAnnotations(annotations)` /
  `svgFromBadges(badges)` / `emptyAnnotationsSvg()` — single-root
  `<svg>` wrappers that the headless annotator's `annotationsSvg`
  input expects.
- `BoxedEntry` type — parsed aria-snapshot YAML entry with
  `[ref=…]` + `[box=…]` markers.

**Compatibility**

- Module augmentation extends annot-playwright's
  `AnnotScreenshotOptions` with the `mdx?: { id, path }` field
  via `declare module "@ingcreators/annot-playwright"`. Imports
  from `@ingcreators/annot-product-docs/fixture` or the package
  root register the resolver via side-effect.
- The existing
  `@ingcreators/annot-product-docs-astro/playwright` subpath
  continues to work unchanged (it ships its own duplicate
  augmentation + patch — Phase 4 of the plan converts that subpath
  into a deprecated re-export pointing here).
- `packages/docs-site/tests/docs/annot-app.spec.ts` — the
  dogfood tour spec swaps `import { test } from
  "@ingcreators/annot-product-docs-astro/playwright"` to
  `"@ingcreators/annot-product-docs"`. PNG output stays
  byte-identical (same patch → same composer → same encoder).
