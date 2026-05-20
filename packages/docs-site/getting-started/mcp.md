# Install `annot-mcp`

The MCP server is the entry point for **driving Annot from an
AI agent**. If you're writing Playwright tests, start with
[`annot-playwright`](./playwright.md) instead — the MCP server
is for runtime agents (Claude Desktop / Claude Code / Cursor),
not for embedding in test code.

## Install

```sh
npm install -g @ingcreators/annot-mcp

# Chromium runtime for `_url` tools — one-time, ~150 MB.
npx playwright install chromium
```

## Wire into Claude Desktop

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "annot": {
      "command": "npx",
      "args": ["@ingcreators/annot-mcp"]
    }
  }
}
```

Restart Claude Desktop. Five `annot_*` tools become available.

## What ships

| Tool | Use case |
| --- | --- |
| `annot_annotate_screenshot` | Overlay annotations on a captured PNG |
| `annot_annotate_url` | Capture + annotate via Playwright locator strings |
| `annot_redact_screenshot` | Destructively burn redactions on a PNG |
| `annot_redact_url` | Live-capture + redact via locator strings |
| `annot_compare_screenshots` | Pixel-perfect visual diff |

## Next steps

- [AI agents overview](../ai-agents/) — composition with
  `@playwright/mcp`, agent transcripts, friendly errors.
- [Tools reference](../ai-agents/tools) — full input schema per
  tool.
- [Recipe: agent bug-report autopilot](../recipes/agent-bug-report)
- [Annotation DSL](../api/dsl) — the typed shape the tools
  accept.
