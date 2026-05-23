// Re-export shim — Phase 3i of
// `docs/plans/living-spec-authoring-roadmap.md` (Phase 3
// follow-up #2) relocated the diff primitive itself to
// `@ingcreators/annot-annotator/diff`. The function is pure
// (`pngBytes + pngBytes → DiffResult`) with no MCP-specific
// surface, and non-MCP callers (Playwright visual regression
// fixtures, Astro pixel drift CI, custom reporters) need to
// consume it without dragging the MCP server's dep footprint.
//
// This file stays as a thin shim so existing MCP-internal
// imports (`../compare/diff.js` from `tools/compare-screenshots.ts`)
// and the public `@ingcreators/annot-mcp` re-export both keep
// working byte-identical. Future cleanup could collapse callers
// onto the annotator import directly and delete this file;
// deliberately left in place for now to keep the relocation a
// no-behaviour-change refactor.

export {
  type DiffOptions,
  type DiffResult,
  DimensionMismatchError,
  diffScreenshots,
} from "@ingcreators/annot-annotator";
