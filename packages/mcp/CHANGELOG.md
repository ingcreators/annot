# @ingcreators/annot-mcp

## 0.3.4

### Patch Changes

- Updated dependencies
  - @ingcreators/annot-annotator@0.7.0
  - @ingcreators/annot-product-docs@0.5.1

## 0.3.3

### Patch Changes

- @ingcreators/annot-annotator@0.6.0
- @ingcreators/annot-product-docs@0.4.1

## 0.3.2

### Patch Changes

- 0c7ac26: **Relocate `burnRedactions` from `@ingcreators/annot-mcp` to
  `@ingcreators/annot-annotator`** — Phase 3e of
  `docs/plans/living-spec-authoring-roadmap.md` (Phase 3 follow-up).

  The destructive raster burn primitive (solid / mosaic / blur over
  a PNG buffer, built on `@napi-rs/canvas`) historically lived in
  `@ingcreators/annot-mcp` because the MCP server's
  `annot_redact_screenshot` tool was the first caller. The function
  itself has no MCP-specific surface — it's pure
  (`pngBytes + regions → pngBytes`). To let non-MCP callers consume
  it without dragging the MCP server's dep footprint (Playwright,
  `@modelcontextprotocol/sdk`, etc.), the primitive moves to
  `@ingcreators/annot-annotator` — the canonical Node-side raster
  home, which already depends on `@napi-rs/canvas` for its encode
  pipeline (so the move adds **zero** transitive deps).

  ### `@ingcreators/annot-annotator` — new public surface

  ```ts
  import {
    burnRedactions,
    type RedactRegion,
  } from "@ingcreators/annot-annotator";

  const out = await burnRedactions(pngBytes, [
    {
      bbox: { x: 10, y: 20, width: 100, height: 30 },
      style: "solid",
      color: "#000000",
    },
    { bbox: { x: 200, y: 100, width: 80, height: 40 }, style: "mosaic" },
    { bbox: { x: 0, y: 0, width: 64, height: 64 }, style: "blur" },
  ]);
  ```

  `RedactRegion` is exposed as an alias of `BboxRedactRegion`
  (structurally identical, already declared in the DSL types) so
  existing MCP-side consumers see no shape change.

  ### `@ingcreators/annot-mcp` — no public API change

  The existing `burnRedactions` + `RedactRegion` re-exports from
  the package root keep working byte-identical, sourced from the
  annotator instead of the old MCP-local file. MCP's
  `annot_redact_screenshot` / `annot_redact_url` tools continue
  to import from `../redact/burn.js`, which is now a one-line
  re-export from annotator.

  ### Compatibility

  Additive on annotator's side; zero behaviour change on MCP's
  side. Tests move with the code (annotator 64 → 71 passed; MCP
  91 → 84 passed — same scenarios at the new home).

  ### Out of scope

  `@napi-rs/canvas` stays as an MCP direct dep — `compare/diff.ts`
  and several other MCP tool tests still use it directly, so
  collapsing it onto a transitive-via-annotator import is a
  separate cleanup.

- 64dc6e8: **Relocate `diffScreenshots` from `@ingcreators/annot-mcp` to
  `@ingcreators/annot-annotator`** — Phase 3i of
  `docs/plans/living-spec-authoring-roadmap.md` (Phase 3
  follow-up #2). Same pattern as 3e's `burnRedactions` relocate.

  The pixelmatch-driven PNG comparison + contiguous-region bbox
  aggregation lived in `@ingcreators/annot-mcp/compare/` for
  historical reasons (the MCP server's
  `annot_compare_screenshots` tool was the first caller). The
  function itself has no MCP-specific surface — it's pure
  (`pngBytes + pngBytes → DiffResult`). Relocating it to
  `@ingcreators/annot-annotator` lets non-MCP callers
  (Playwright visual regression fixtures, Astro pixel drift CI,
  custom test reporters, editor before/after preview) consume
  it without dragging the MCP server's dep footprint.

  ### `@ingcreators/annot-annotator` — new public surface

  ```ts
  import {
    diffScreenshots,
    aggregateDiffRegions,
    DimensionMismatchError,
    type DiffResult,
    type DiffOptions,
  } from "@ingcreators/annot-annotator";

  const result = await diffScreenshots(beforePng, afterPng, { threshold: 0.1 });
  // → { mismatchedPixels: number, regions: BBox[], width, height }
  ```

  annotator gains `pixelmatch` (~4 KB, no transitive deps) as a
  runtime dep.

  ### `@ingcreators/annot-mcp` — no public API change

  The existing `compare/diff.ts` + `compare/aggregate.ts` modules
  become one-line re-export shims forwarding from annotator. MCP's
  internal callers (`tools/compare-screenshots.ts`) and any
  external consumer importing from `@ingcreators/annot-mcp` keep
  working byte-identical.

  ### Compatibility

  Additive on annotator's side; zero behaviour change on MCP's
  side. Tests move with the code (annotator 71 → 81 passed; MCP
  84 → 78 passed — same scenarios at the new home, plus a new
  `diffScreenshots` smoke test that the MCP-side aggregate-only
  test didn't cover).

  ### Out of scope

  `pixelmatch` stays as a direct MCP dep — even though MCP no
  longer imports it from the moved code, it's a tiny package
  and removing the explicit dep would force consumers to rely
  on a transitive resolution through annotator, which is more
  fragile than declaring the intent directly.

- 9697f27: **Export `burnRegions` as an operation-aligned alias for
  `burnRedactions`** — Phase 3k of
  `docs/plans/living-spec-authoring-roadmap.md`
  (Phase 3 follow-up #2). Closes the follow-up.

  `burnRedactions` is named for its first caller's intent (MCP's
  `annot_redact_screenshot`), but the underlying primitive is a
  `pngBytes + region[] → pngBytes` raster transform — generic
  over the caller's purpose. The new export surfaces the
  operation-aligned name alongside the intent-named original.

  ### `@ingcreators/annot-annotator` — new public export

  ```ts
  import { burnRegions } from "@ingcreators/annot-annotator";

  // Identical signature + behaviour to burnRedactions.
  const out = await burnRegions(pngBytes, [
    { bbox: { x: 10, y: 20, width: 100, height: 30 }, style: "mosaic" },
  ]);
  ```

  Identity-equal to `burnRedactions` (`burnRegions === burnRedactions`
  at the export level) — picking one name over the other is purely
  a docs-readability choice.

  ### Use cases that motivated the alias

  The function isn't redact-specific — the JSDoc on `burnRedactions`
  now enumerates:
  - Editor-side "highlight this region with a translucent colour
    and ship it baked" workflow.
  - Visual-regression pre-processing — burn dynamic content
    (timestamps, login state badges) into the screenshot so pixel
    diffs stay deterministic.
  - Watermark / overlay burn for downstream distribution.
  - Privacy hardening at non-redact regions (e.g. blur a logo in
    a publicly-shared screenshot).

  For any of these, `burnRegions` reads as the natural name.
  Redact callers stay on `burnRedactions` (still the recommended
  name when the intent IS redaction); no migration forced.

  ### `@ingcreators/annot-mcp` — no public API change

  MCP's `compare/burn.ts` re-export shim + `index.ts` forward both
  names. Existing `burnRedactions` callers see no change.

  ### Compatibility

  Additive. `burnRedactions` keeps its public API + JSDoc; the
  alias is purely additive.

- Updated dependencies [6124d59]
- Updated dependencies [b5d52f6]
- Updated dependencies [fa712fd]
- Updated dependencies [0c7ac26]
- Updated dependencies [f09a6b1]
- Updated dependencies [0d19345]
- Updated dependencies [64dc6e8]
- Updated dependencies [691bec5]
- Updated dependencies [9697f27]
  - @ingcreators/annot-annotator@0.6.0
  - @ingcreators/annot-product-docs@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [5778902]
- Updated dependencies [96e7625]
- Updated dependencies [85d40e6]
  - @ingcreators/annot-product-docs@0.3.0

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
