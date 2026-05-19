# Annotate on assertion failure

When a Playwright assertion fails, the default output is a stack
trace and a screenshot. Adding an annotated overlay on the
locator that misbehaved makes the failing screenshot
self-explanatory in the HTML report.

## Pattern

```ts
import {
  test,
  expect,
  rectForBoundingBox,
} from "@ingcreators/annot-playwright";

test("submit button is enabled", async ({ page, annotator }, testInfo) => {
  await page.goto("https://example.com/checkout");

  const submit = page.getByRole("button", { name: "Place order" });

  try {
    await expect(submit).toBeEnabled({ timeout: 5000 });
  } catch (err) {
    // Capture the misbehaving locator on the failing frame.
    const box = (await submit.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const annotated = await annotator.annotateScreenshot(page, {
      annotationsSvg: rectForBoundingBox(box, { stroke: "#ff5252" }),
    });

    await testInfo.attach("submit-button-disabled.png", {
      body: annotated,
      contentType: "image/png",
    });

    throw err;
  }
});
```

## Notes

- **Always re-throw** after annotating, otherwise Playwright marks
  the test as passing.
- **Fallback bbox** — `boundingBox()` returns `null` when the
  locator isn't in the layout tree (e.g. `display: none`).
  Passing `{ x: 0, y: 0, width: 0, height: 0 }` makes the
  rectangle degenerate but doesn't crash; you'll see the
  attachment is "empty" which itself is a useful diagnostic.
- **Make a helper.** If you do this in three tests, hoist it into
  a `annotateOnFail(page, annotator, testInfo, locator)` utility.

## Variant — pair with an arrow + label

```ts
import {
  arrowBetween,
  rectForBoundingBox,
  textAt,
} from "@ingcreators/annot-playwright";

const rect = rectForBoundingBox(box, { stroke: "#ff5252" });
const arrow = arrowBetween(
  { from: { x: 24, y: 60 }, to: { x: box.x, y: box.y + box.height / 2 } },
  { stroke: "#ff5252" },
);
const label = textAt({ x: 24, y: 56 }, "Expected enabled", {
  fill: "#ff5252",
});

const annotated = await annotator.annotateScreenshot(page, {
  annotationsSvg: rect + arrow + label,
});
```
