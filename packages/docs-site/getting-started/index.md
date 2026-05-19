# Getting started

Annot publishes three packages on npm. Pick the one that matches
how you want to use it.

| Package | Use it when | npm |
| ------- | ----------- | --- |
| **[`@ingcreators/annot-playwright`](./playwright.md)** | You run Playwright tests and want to attach annotated screenshots to the HTML report. | [![npm](https://img.shields.io/npm/v/@ingcreators/annot-playwright)](https://www.npmjs.com/package/@ingcreators/annot-playwright) |
| **[`@ingcreators/annot-annotator`](./annotator.md)** | You want the headless annotator from any Node script — CI, a CLI, a build pipeline. | [![npm](https://img.shields.io/npm/v/@ingcreators/annot-annotator)](https://www.npmjs.com/package/@ingcreators/annot-annotator) |
| **[`@ingcreators/annot-core`](./core.md)** | You're building a new host (extension, editor, plugin) and need the SVG annotation format + storage types. | [![npm](https://img.shields.io/npm/v/@ingcreators/annot-core)](https://www.npmjs.com/package/@ingcreators/annot-core) |

If in doubt, start with **annot-playwright** — it's the highest-
leverage entry point and pulls the rest in transitively.

## What you get

A single call shape on every package:

```ts
import { test, rectForBoundingBox } from "@ingcreators/annot-playwright";

test("login form is reachable", async ({ page, annotator }) => {
  await page.goto("https://example.com/login");

  const box = (await page.getByRole("button", { name: "Sign in" }).boundingBox())!;

  await annotator.annotateScreenshot(page, {
    annotationsSvg: rectForBoundingBox(box, { stroke: "#ff5252" }),
  });
});
```

The resulting PNG attaches to the Playwright HTML report next to
the failing step.

## Requirements

- **Node 20+** for `annot-annotator` (it uses native ESM and
  `@resvg/resvg-js` prebuilds).
- **Playwright 1.50+** as a peer dep of `annot-playwright`.
- No browser at runtime — the annotator runs entirely in Node.
