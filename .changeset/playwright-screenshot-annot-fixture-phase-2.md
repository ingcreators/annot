---
"@ingcreators/annot-product-docs-astro": minor
---

**`locator.screenshot({ annot: { … } })` support** — Phase 2 of
`docs/plans/playwright-screenshot-annot-fixture.md`. The fixture
now patches `Locator.prototype.screenshot` alongside
`Page.prototype.screenshot`, and overlay coordinates are
automatically rebased into the cropped image's coordinate space:

```ts
await page.locator("header").screenshot({
  path: "header.png",
  annot: {
    overlays: [
      // page-space bbox — rebased onto the header-locator's clip
      { type: "rect", bbox: { x: 120, y: 60, width: 50, height: 30 } },
    ],
  },
});
```

Overlays whose page-space bbox falls outside the locator's
bounding box are dropped (warning + skip per Open Question 4)
and surfaced via:

- `console.warn(...)` to stderr — always
- `test.info().annotations` as a `warning` entry when running
  under Playwright — best-effort, guarded so vitest unit tests
  don't crash

`page.screenshot({ clip, annot })` honours `clip` the same way —
explicit clip + auto rebase. Mirrors vanilla
`page.screenshot({ clip })` semantics; only the overlay-rebase
behaviour is annot-specific.

When the locator has no bounding box (off-screen / hidden), the
fixture throws a friendly diagnostic asking the caller to use
a stable selector / `waitFor()`.

**Coordinate-rebase API** — exported alongside the fixture for
callers who want to compose annotations themselves:

```ts
import { rebaseAnnotations } from "@ingcreators/annot-product-docs-astro/playwright";
// Or for direct algorithmic use without the fixture:
//   import { rebaseAnnotations } from "@ingcreators/annot-product-docs-astro/playwright/rebase";

const { kept, dropped } = rebaseAnnotations(annotations, clip);
```

Returns `{ kept, dropped }` for each shape in the
`BboxAnnotation` union (rect / numberedBadge / circle / arrow /
text / callout). Raw SVG fragments (`type: "raw"`) pass through
unchanged — the caller is responsible for emitting clip-space
coords inside arbitrary SVG.

`numberedBadge`'s `imageWidth` / `imageHeight` are also rebased
to the clip dimensions so `placement: "auto"` picks the corner
against the cropped image edge rather than the page edge.
