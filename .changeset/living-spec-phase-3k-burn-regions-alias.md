---
"@ingcreators/annot-annotator": minor
"@ingcreators/annot-mcp": patch
---

**Export `burnRegions` as an operation-aligned alias for
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
