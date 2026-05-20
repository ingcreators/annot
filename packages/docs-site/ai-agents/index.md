# AI agents

`@ingcreators/annot-mcp` is a Model Context Protocol stdio server
that exposes the Annot headless annotator as **agent-callable
tools**. Drop into Claude Desktop / Claude Code / Cursor /
Continue (or any other MCP client) and an AI agent can compose
Annot with `@playwright/mcp` + GitHub MCP into autonomous
browser-driven workflows:

- **Bug-report autopilot** — agent navigates to a staging URL,
  identifies a broken element, files a GitHub issue with an
  annotated screenshot in one conversation turn.
- **Visual-diff PR review** — agent screenshots the same page on
  two branches, posts the diff with changed regions highlighted.
- **Locator-first annotation** — `{ type: "rect", locator:
  "button:has-text('Submit')", intent: "error" }` in a single
  MCP call; the server captures the URL, resolves the locator,
  renders the annotation.

## Three things to know first

1. **The server runs locally** — no network round-trip to a
   hosted service, no auth. Cloud-hosted MCP is out of scope at
   v1.
2. **The DSL is shared with the rest of Annot.** The same
   `BboxAnnotation` shape (`rect` / `circle` / `arrow` / `text`
   / `callout` / `raw` with the [`intent` shorthand](../api/dsl#intent-shorthand))
   that `@ingcreators/annot-playwright` accepts is what agents
   produce on MCP tool calls. Browser-driving agents add
   locator-flavour variants.
3. **`@playwright/mcp` is a partner, not a competitor.** For
   single-shot capture, `annot_annotate_url` is the simplest
   path. For multi-step browser flows (sign-in, click, wait,
   then capture), drive the browser through `@playwright/mcp`
   and feed the screenshot bytes to `annot_annotate_screenshot`.

## Where to next

| If you want to … | Read |
| --- | --- |
| Wire Claude Desktop / Claude Code to the server | [Install](./install) |
| Learn the five tools' schemas | [Tools reference](./tools) |
| Understand the annotation DSL | [DSL reference](../api/dsl) |
| See a one-turn bug-report transcript | [Recipe: agent bug report](../recipes/agent-bug-report) |
