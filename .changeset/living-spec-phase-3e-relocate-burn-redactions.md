---
"@ingcreators/annot-annotator": minor
"@ingcreators/annot-mcp": patch
---

**Relocate `burnRedactions` from `@ingcreators/annot-mcp` to
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
import { burnRedactions, type RedactRegion } from "@ingcreators/annot-annotator";

const out = await burnRedactions(pngBytes, [
  { bbox: { x: 10, y: 20, width: 100, height: 30 }, style: "solid", color: "#000000" },
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
