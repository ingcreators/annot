// Re-export shim — Phase 3e of
// `docs/plans/living-spec-authoring-roadmap.md` (Phase 3
// follow-up) relocated the burn primitive itself to
// `@ingcreators/annot-annotator/redact-burn`. The function is
// pure (`pngBytes + regions → pngBytes`) with no MCP-specific
// surface, and non-MCP callers (Astro Image Service, future
// Playwright fixtures) need to consume it without dragging the
// MCP server's dep footprint.
//
// This file stays as a thin shim so existing MCP-internal imports
// (`../redact/burn.js`) and the public `@ingcreators/annot-mcp`
// re-export both keep working byte-identical. Future cleanup
// could collapse callers onto the annotator import directly and
// delete this file; deliberately left in place for now to keep
// the relocation a no-behaviour-change refactor.

export { burnRedactions, type RedactRegion } from "@ingcreators/annot-annotator";
