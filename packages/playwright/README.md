# `@ingcreators/annot-playwright`

Playwright fixture for [`@ingcreators/annot-annotator`](../annotator/README.md).
Emit annotated screenshots from test failures without leaving the
test file.

> **Status:** Workspace package, not yet published to npm. Becomes
> installable in Phase 3 of the headless-annotator track (gated on
> Changesets). The Phase 1 annotator it depends on is also
> workspace-only until then.

## Install (post-publish)

```sh
pnpm add -D @playwright/test @ingcreators/annot-playwright
```

(`@playwright/test` is a peer dependency.)

## Usage

```ts
import {
  test,
  expect,
  rectForBoundingBox,
} from "@ingcreators/annot-playwright";

test("submit button is enabled", async ({ page, annotator }, testInfo) => {
  await page.goto("/login");
  const submitBtn = page.getByRole("button", { name: "Submit" });
  try {
    await expect(submitBtn).toBeEnabled();
  } catch (err) {
    const bbox = await submitBtn.boundingBox();
    if (bbox) {
      const png = await annotator.annotateScreenshot(page, {
        annotationsSvg: rectForBoundingBox(bbox, { stroke: "red" }),
      });
      await testInfo.attach("failure.png", {
        body: Buffer.from(png),
        contentType: "image/png",
      });
    }
    throw err;
  }
});
```

The `test` import is `@playwright/test`'s `test`, extended with an
`annotator` fixture. Everything else (`test.describe`,
`test.beforeEach`, `expect`, …) passes straight through.

## Compose annotations with the helpers

```ts
import {
  rectForBoundingBox,
  arrowBetween,
  textAt,
} from "@ingcreators/annot-playwright";

const bbox = await element.boundingBox();
const annotationsSvg = [
  rectForBoundingBox(bbox!, { stroke: "red" }),
  arrowBetween({ x: 250, y: 100 }, { x: bbox!.x, y: bbox!.y }),
  textAt({ x: 250, y: 90 }, "expected enabled"),
].join("");

const png = await annotator.annotateScreenshot(page, { annotationsSvg });
```

Each helper returns an SVG fragment string. Concatenate them to
build up the overlay. For shapes the helpers don't cover, drop in
raw SVG strings — the underlying annotator accepts anything resvg
can render.

## API

### Re-exports from `@playwright/test`

- `test` — Playwright's base test, extended with the `annotator`
  fixture.
- `expect` — passthrough.

### Fixture surface

```ts
interface PlaywrightAnnotator {
  /** Underlying Phase 1 annotator. Use for direct toPng / toSvg. */
  raw: Annotator;
  /** Take a screenshot of the page and overlay annotations. */
  annotateScreenshot(
    page: PageLike,
    opts: { annotationsSvg: string; fullPage?: boolean },
  ): Promise<Uint8Array>;
}
```

Available as `{ annotator }` in any test.

### Helpers

| Function | Returns | Defaults |
|---|---|---|
| `rectForBoundingBox(bbox, opts?)` | `<rect>` fragment | red stroke, 2px, no fill |
| `arrowBetween(from, to, opts?)` | `<defs>` + `<marker>` + `<line>` | red, 2px |
| `textAt(at, content, opts?)` | `<text>` fragment | red, 14px, start-anchored |

Each call to `arrowBetween` generates a unique marker id, so
multiple arrows on the same screenshot don't collide.

### Escape hatch — `annotateScreenshot` standalone

If you compose your own Playwright fixture (e.g. adding extra
auth fixtures), you can use `annotateScreenshot` directly:

```ts
import { createAnnotator } from "@ingcreators/annot-annotator";
import { annotateScreenshot } from "@ingcreators/annot-playwright";

const annotator = createAnnotator();
const png = await annotateScreenshot(annotator, page, {
  annotationsSvg: rectForBoundingBox(bbox),
});
```

## How dimensions are picked

`annotateScreenshot` parses the screenshot's PNG IHDR chunk to
extract the actual pixel dimensions, then passes those to the
annotator. This works correctly for clipped screenshots and
full-page captures — `page.viewportSize()` would be wrong in
both cases.

## Limitations

- **PNG output only.** Same constraint as the underlying
  annotator. JPEG via `sharp` is planned for a follow-up release.
- **Font registration is the caller's job.** The fixture passes
  no fonts to the annotator by default. If your annotations
  contain CJK / Arabic / Indic / Thai text, construct the
  annotator yourself with `fontFiles` and pass it via
  `annotateScreenshot(yourAnnotator, page, ...)`:

```ts
import { createAnnotator } from "@ingcreators/annot-annotator";
const annotator = createAnnotator({
  fontFiles: ["./fonts/NotoSans-Regular.ttf"],
});
// then use the standalone `annotateScreenshot` helper, not the
// fixture's auto-constructed annotator.
```

  A future release will surface this on the fixture too.

## See also

- [`docs/plans/_done/headless-annotator-spike.md`](../../docs/plans/_done/headless-annotator-spike.md)
  — Phase 0 feasibility report.
- [`docs/plans/_done/annot-annotator-package.md`](../../docs/plans/_done/annot-annotator-package.md)
  — Phase 1 annotator design.
- [`docs/plans/annot-playwright-fixture.md`](../../docs/plans/annot-playwright-fixture.md)
  — Phase 2 design (this package).
- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — strategic
  context.
