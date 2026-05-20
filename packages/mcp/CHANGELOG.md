# @ingcreators/annot-mcp

## 0.1.0

### Minor Changes

- Initial public release of `@ingcreators/annot-mcp` — Model Context Protocol stdio server exposing the Annot headless annotator as five agent-callable tools: `annot_annotate_screenshot`, `annot_annotate_url` (locator-first), `annot_redact_screenshot`, `annot_redact_url`, `annot_compare_screenshots`. Pairs naturally with `@playwright/mcp` for multi-step browser flows; runs standalone for single-URL annotation + redaction + visual-diff workflows. See `docs/ai-agents.md`.
