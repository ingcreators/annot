# @ingcreators/annot-playwright

## 0.2.0

### Minor Changes

- 35e3ad7: `annotateScreenshot()` now accepts the annotation DSL added in `@ingcreators/annot-annotator@0.2.0`:

  ```ts
  import {
    test,
    expect,
    type BboxAnnotation,
  } from "@ingcreators/annot-playwright";

  test("login form", async ({ page, annotator }, testInfo) => {
    const submit = page.getByRole("button", { name: "Sign in" });
    const box = (await submit.boundingBox())!;
    const annotated = await annotator.annotateScreenshot(page, {
      annotations: [
        { type: "rect", bbox: box, intent: "error" },
        {
          type: "callout",
          at: { x: 50, y: 50 },
          targetBbox: box,
          content: "Failing",
        },
      ] satisfies BboxAnnotation[],
    });
    await testInfo.attach("failure.png", { body: annotated });
  });
  ```

  The existing `annotationsSvg: string` shape still works; the new `annotations: BboxAnnotation[]` is an additive overload. `intent` shorthand (`"info"` / `"warning"` / `"error"` / `"success"` / `"neutral"`) maps to the Annot design system's semantic colours so callers no longer think in raw hex values, and `callout` composes the rect + arrow + caption in a single entry.

  `rectForBoundingBox` / `arrowBetween` / `textAt` are now thin re-exports from `@ingcreators/annot-annotator` rather than local helpers. Cosmetic delta: `arrowBetween`'s marker id prefix changed from `annot-pw-arrow-N` to `annot-arrow-N`; snapshot-on-SVG tests should expect this.

  Also re-exports the bbox-flavour DSL types (`BboxAnnotation`, `BBox`, `Point`, `Intent`, `AnnotationStyle`, `BboxRedactRegion`, `RedactStyle`, …) from `@ingcreators/annot-annotator` so callers keep a single import line.

### Patch Changes

- Updated dependencies [92378f9]
  - @ingcreators/annot-annotator@0.2.0

## 0.1.0

### Minor Changes

- 408791f: Initial public release — headless annotator + Playwright fixture + SDK.

### Patch Changes

- Updated dependencies [408791f]
  - @ingcreators/annot-annotator@0.1.0
