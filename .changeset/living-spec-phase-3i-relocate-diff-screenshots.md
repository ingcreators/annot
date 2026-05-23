---
"@ingcreators/annot-annotator": minor
"@ingcreators/annot-mcp": patch
---

**Relocate `diffScreenshots` from `@ingcreators/annot-mcp` to
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
