---
"@ingcreators/annot-playwright": minor
---

**`page.screenshot({ annot: { … } })` patch relocated to
annot-playwright** — Phase 1 of
`docs/plans/playwright-screenshot-fixture-relayer.md`. The
prototype patch that lets Playwright tests emit annotated PNGs by
adding a nested `annot:` option to `page.screenshot()` /
`locator.screenshot()` lives here now (it shipped first in
`@ingcreators/annot-product-docs-astro/playwright` but is not
Astro-specific). VRT / marketing-screenshot / AI-agent flows pick
up the API without taking an Astro dependency.

```ts
import { test, expect } from "@ingcreators/annot-playwright";

test("login form callouts", async ({ page }) => {
  await page.goto("/login");
  await page.screenshot({
    path: "login.png",
    annot: {
      overlays: [
        { type: "rect", bbox: { x: 10, y: 10, width: 200, height: 30 }, intent: "warning" },
        { type: "numberedBadge", bbox: { x: 10, y: 10, width: 24, height: 24 }, number: 1 },
      ],
      tags: { source: "vrt-failure", testId: "login" },
      // editable: true is the default → output PNG is re-editable
      //   in Annot Cloud.
    },
  });
});
```

Three independent contributions compose into the output PNG:

- `overlays: BboxAnnotation[]` — inline annotations (rect /
  circle / arrow / text / callout / numberedBadge / raw SVG).
- `tags: Record<string, string>` — provenance metadata
  serialised into the PNG's XMP (or iTXt sidecar when no
  overlays are present).
- `editable: boolean` (default `true`) — re-editable wrap
  (annotations + original capture in XMP) vs. flat baked PNG.

`Locator.prototype.screenshot` and `Page.prototype.screenshot({
clip })` both go through the same pipeline; page-space overlay
coordinates are automatically rebased into the clipped image's
coordinate space. Overlays whose bbox falls outside the clip are
dropped with a warning annotation on `test.info()`.

**Extension hook registry** — `annotSourceResolvers` is a
module-level array of resolvers that downstream packages push
into to claim extra `annot.*` fields:

```ts
import { annotSourceResolvers } from "@ingcreators/annot-playwright";

annotSourceResolvers.push(async ({ annot, page }) => {
  if (!annot.figma) return null;
  return {
    prepare: () => refreshFigmaCache(annot.figma),
    resolveAnnotations: (dims) => readFigmaOverlays(annot.figma, dims),
  };
});
```

The resolver's `prepare()` hook fires before the raw screenshot
is taken (so MDX-aware adapters can refresh `annot:snapshot`
blocks against the live DOM); `resolveAnnotations(dims)` runs
after with the page-space dimensions and returns
`BboxAnnotation[]` to merge into the output. annot-playwright
stays MDX-unaware — the matching MDX resolver moves into
`@ingcreators/annot-product-docs` in Phase 2 of the parent plan.

**Coordinate-rebase API** — `rebaseAnnotations` /
`describeAnnotation` / `Clip` / `RebaseResult` exported for
callers who want to rebase annotations themselves without going
through the patch (e.g. building custom test reporters):

```ts
import { rebaseAnnotations } from "@ingcreators/annot-playwright";

const { kept, dropped } = rebaseAnnotations(annotations, clip);
```

**Compatibility** — additive. The existing
`@ingcreators/annot-product-docs-astro/playwright` subpath stays
working unchanged for this release; Phase 4 of the parent plan
converts it into a deprecated re-export.
