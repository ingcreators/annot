# @ingcreators/annot-mcp

## 0.3.0

### Minor Changes

- 806badc: Retire the `@ingcreators/annot-imagequant` (GPL-3.0) dynamic-import
  boundary that gated PNG-8 output in the headless annotator and the
  MCP server. `Annotator.toEncoded()`'s smart mode now routes PNG-8
  through the pure-TS Median Cut + Floyd–Steinberg dither at
  `@ingcreators/annot-core/encode/quantize-median-cut` directly.

  ### Removed public API
  - `isImagequantAvailable()` is no longer exported from
    `@ingcreators/annot-annotator`. PNG-8 is now unconditionally
    available — callers that previously gated `format: "smart"` on
    this can drop the check.
  - `Annotator.toEncoded()` no longer emits
    `EncodeResult.reason === "imagequant-missing"`. The
    graceful-PNG-32-fallback path that produced this reason is
    unreachable.

  ### Removed dependency
  - `@ingcreators/annot-imagequant` is dropped from
    `@ingcreators/annot-annotator`'s `dependencies`. Consumers
    that previously installed it as a side-effect of installing
    `annot-annotator` will save the WASM payload from their
    `node_modules`. `annot-mcp` inherits the removal transitively.

  Phase 3 of `docs/plans/replace-libimagequant-with-median-cut.md`.
  Phase 4 deletes the `@ingcreators/annot-imagequant` workspace
  package and deprecates the published 0.1.0 on npm.

### Patch Changes

- Updated dependencies [806badc]
- Updated dependencies [df1a429]
- Updated dependencies [2e92c97]
- Updated dependencies [657a685]
  - @ingcreators/annot-annotator@0.5.0
  - @ingcreators/annot-product-docs@0.2.0

## 0.2.0

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

## 0.1.1

### Patch Changes

- Updated dependencies [92378f9]
  - @ingcreators/annot-annotator@0.2.0

## 0.1.0

### Minor Changes

- Initial public release of `@ingcreators/annot-mcp` — Model Context Protocol stdio server exposing the Annot headless annotator as five agent-callable tools: `annot_annotate_screenshot`, `annot_annotate_url` (locator-first), `annot_redact_screenshot`, `annot_redact_url`, `annot_compare_screenshots`. Pairs naturally with `@playwright/mcp` for multi-step browser flows; runs standalone for single-URL annotation + redaction + visual-diff workflows. See `docs/ai-agents.md`.
