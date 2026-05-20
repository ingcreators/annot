# `@ingcreators/annot-mcp`

Model Context Protocol server exposing the
[`@ingcreators/annot-annotator`](../annotator/README.md) headless
annotator as agent-callable tools. Drop into Claude Desktop /
Claude Code / Cursor and an AI agent can compose Annot with
`@playwright/mcp` + GitHub MCP for one-turn bug-report autopilot,
visual-diff PR review, and locator-first annotation workflows.

> **Status:** under construction. This package is `private: true`
> in the workspace until the full tool surface lands. Phase 1
> (this commit) ships the scaffold: package boundary, DSL types,
> DSL → SVG converter, and a do-nothing MCP server. See
> [`docs/plans/agent-mcp-integration.md`](../../docs/plans/agent-mcp-integration.md)
> for the design.

## Phase 1 contents

| File | Purpose |
|---|---|
| `bin/annot-mcp.mjs` | CLI shim — boots the server over stdio |
| `src/server.ts` | `createServer()` factory (zero tools registered) |
| `src/transport.ts` | `runStdioServer()` — wires stdio transport |
| `src/dsl/types.ts` | TypeScript types for the annotation DSL |
| `src/dsl/schema.ts` | JSON Schema literals for MCP `inputSchema` |
| `src/dsl/to-svg.ts` | `BboxAnnotation[]` → SVG fragment string |

## Future phases

- **Phase 2** — `annot_annotate_screenshot` tool (bbox annotations
  over a captured PNG).
- **Phase 3a/3b** — `playwright-core` integration +
  `annot_annotate_url` tool (locator-first capture + annotate in
  one call).
- **Phase 4** — `annot_redact_screenshot` + `annot_redact_url`
  (destructive burn-in).
- **Phase 5** — `annot_compare_screenshots` (pixelmatch-driven
  visual diff).
- **Phase 6** — `annot_export_pptx` (gated on the pptx-export
  refactor noted in [`CLAUDE.md`](../../CLAUDE.md) §2).
- **Phase 7** — docs + Claude Desktop recipe + release prep.
- **Phase 8** — first npm publish (schema-freeze gate).
