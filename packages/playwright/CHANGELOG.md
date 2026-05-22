# @ingcreators/annot-playwright

## 0.3.1

### Patch Changes

- Updated dependencies [806badc]
- Updated dependencies [df1a429]
  - @ingcreators/annot-annotator@0.5.0

## 0.3.0

### Minor Changes

- b3e8e53: Both packages now accept an optional `encode` option that flows through to `@ingcreators/annot-annotator@0.3.0`'s `toEncoded()` / `decodeAndEncodeImage()` pipeline. Achieves feature parity with the Chrome extension's "Save size" + "Format smart" capture settings for AI-agent (`annot-mcp`) and Playwright-test (`annot-playwright`) flows.

  ## `annot-playwright`

  ```ts
  await annotator.annotateScreenshot(page, {
    annotations: [...],
    encode: { format: "smart", saveSizePreset: "standard" },
  });
  ```

  Returned bytes shrink to PNG-8 / JPEG / resized PNG-32 per the smart heuristic; default behaviour when `encode` is omitted matches v0.2.x (raw PNG-32 from the annotator).

  ## `annot-mcp`

  All five tools (`annot_annotate_screenshot`, `annot_annotate_url`, `annot_redact_screenshot`, `annot_redact_url`, `annot_compare_screenshots`) accept the same `encode` shape on their MCP `inputSchema`. Agents can specify any subset:

  ```jsonc
  {
    "url": "https://...",
    "annotations": [...],
    "encode": {
      "format": "smart",
      "saveSizePreset": "light",
      "smartFallback": "jpeg"
    }
  }
  ```

  `format`: `"smart"` (default — PNG-8 for UI / PNG / JPEG for photos) / `"png"` / `"jpeg"`.
  `saveSizePreset`: `"light"` 1280px / `"standard"` 1920px / `"highQuality"` 2560px / `"original"` no resize.
  `smartFallback`, `smartColorThreshold`, `jpegPercent` all configurable.

  Output `mimeType` flips to `image/jpeg` when the chosen path emits JPEG, so MCP clients render inline correctly. The text confirmation when `output` is set now includes the chosen format and any `reason` (`png-8` / `photo-fallback-jpeg` / `imagequant-missing` / …) for observability.

  Backwards-compatible: when `encode` is omitted, all tools emit PNG-32 bytes verbatim (no decode/encode round-trip, same as v0.1.x / v0.2.x).

### Patch Changes

- Updated dependencies [86d0853]
  - @ingcreators/annot-annotator@0.3.0

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
