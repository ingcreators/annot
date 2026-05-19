# Draw by DOM locator

When you want a screenshot with an arrow pointing at an element —
for a docs build, a bug report, or a visual regression baseline —
combine `locator.boundingBox()` with `rectForBoundingBox` +
`arrowBetween`.

## Pattern

```ts
import {
  test,
  rectForBoundingBox,
  arrowBetween,
  textAt,
} from "@ingcreators/annot-playwright";
import { writeFile } from "node:fs/promises";

test("docs: highlight the install command", async ({ page, annotator }) => {
  await page.goto("https://docs.example.com/install");

  const cmd = page.locator("pre", { hasText: "npm install" }).first();
  await cmd.scrollIntoViewIfNeeded();

  const box = (await cmd.boundingBox())!;

  const annotated = await annotator.annotateScreenshot(page, {
    annotationsSvg:
      rectForBoundingBox(box, { stroke: "#7c9cff", strokeWidth: 4 }) +
      arrowBetween(
        { from: { x: 24, y: 80 }, to: { x: box.x, y: box.y + 16 } },
        { stroke: "#7c9cff" },
      ) +
      textAt({ x: 24, y: 76 }, "Copy this", {
        fill: "#7c9cff",
        fontSize: 18,
      }),
  });

  await writeFile("./docs-install.png", annotated);
});
```

## Coordinate space

`boundingBox()` returns CSS pixels in the viewport coordinate
space. The annotator overlays SVG in the same coordinate space as
the captured PNG — which for full-page captures is the full
scrollable height, not just the viewport.

If you're capturing full-page, scroll the locator into view first
or use `locator.screenshot()` for a clipped capture instead.

## Multiple highlights

Concatenate per-locator rects:

```ts
const items = await page.locator("article h2").all();
const boxes = await Promise.all(items.map((l) => l.boundingBox()));

const svg = boxes
  .filter((b): b is Exclude<typeof b, null> => b !== null)
  .map((box) => rectForBoundingBox(box, { stroke: "#b391ff" }))
  .join("\n");

const annotated = await annotator.annotateScreenshot(page, {
  annotationsSvg: svg,
});
```
