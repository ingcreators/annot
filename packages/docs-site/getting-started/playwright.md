# Install `annot-playwright`

The Playwright fixture is the recommended entry point. It composes
the headless annotator into idiomatic `test.extend({ annotator })`
form, and exposes three pure SVG-fragment helpers
(`rectForBoundingBox`, `arrowBetween`, `textAt`) you can combine
with string concatenation.

## Install

```bash
npm install --save-dev @ingcreators/annot-playwright
```

`@playwright/test` is declared as a `peerDependency` — install it
yourself if you haven't already:

```bash
npm install --save-dev @playwright/test
```

## First test

Replace your usual `import { test, expect } from "@playwright/test"`
with:

```ts
import { test, expect, rectForBoundingBox } from "@ingcreators/annot-playwright";
```

`test` is `@playwright/test`'s `test` re-exported with the
`annotator` fixture pre-extended, so existing tests keep working
without further changes.

```ts
import {
  test,
  expect,
  rectForBoundingBox,
} from "@ingcreators/annot-playwright";

test("login form is reachable", async ({ page, annotator }, testInfo) => {
  await page.goto("https://example.com/login");

  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeVisible();

  // Capture, annotate, attach.
  const box = (await signIn.boundingBox())!;
  const annotated = await annotator.annotateScreenshot(page, {
    annotationsSvg: rectForBoundingBox(box, { stroke: "#ff5252" }),
  });

  await testInfo.attach("login-form.png", {
    body: annotated,
    contentType: "image/png",
  });
});
```

## What runs

`annotateScreenshot(page, ...)` is dimension-aware: it reads the
PNG IHDR chunk from the captured screenshot to size the annotation
SVG correctly. Both clipped (`page.locator(...).screenshot()`) and
full-page captures work without manual sizing.

The PNG is returned as a `Buffer` — pass it to `testInfo.attach()`
to land it in Playwright's HTML report, or write it to disk with
`fs.writeFile`.

## Next steps

- [Annotate on assertion failure](../recipes/assertion-failure.md)
- [Draw by DOM locator](../recipes/dom-locator.md)
- [Attach to the HTML report](../recipes/html-report.md)
