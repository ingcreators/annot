---
"@ingcreators/annot-annotator": minor
"@ingcreators/annot-mcp": minor
---

Retire the `@ingcreators/annot-imagequant` (GPL-3.0) dynamic-import
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
