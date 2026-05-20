---
"@ingcreators/annot-mcp": minor
"@ingcreators/annot-playwright": minor
---

Both packages now accept an optional `encode` option that flows through to `@ingcreators/annot-annotator@0.3.0`'s `toEncoded()` / `decodeAndEncodeImage()` pipeline. Achieves feature parity with the Chrome extension's "Save size" + "Format smart" capture settings for AI-agent (`annot-mcp`) and Playwright-test (`annot-playwright`) flows.

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
