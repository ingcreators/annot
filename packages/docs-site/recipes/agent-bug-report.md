# Agent bug-report autopilot

The locator-first MCP workflow: an AI agent navigates to a
staging URL, identifies a broken element, and files a GitHub
issue with an annotated screenshot — **in one conversation
turn**.

## Prerequisites

- [Install `annot-mcp`](../ai-agents/install) into Claude
  Desktop (or your preferred MCP client).
- `@playwright/mcp@latest` configured alongside (for the
  `browser_snapshot` step that finds the broken element).
- GitHub MCP server configured (`@modelcontextprotocol/server-github`
  or equivalent) with a personal access token scoped to issues.

## What you ask

```
Go to https://staging.example.com/login, find any disabled
submit button, and file a GitHub issue against
ingcreators/example with an annotated screenshot.
```

## What the agent does

| Step | Tool | Why |
| --- | --- | --- |
| 1 | `playwright.browser_navigate` | Go to the URL |
| 2 | `playwright.browser_snapshot` | Find the disabled submit button via the DOM tree (the agent reasons over the snapshot's accessibility info) |
| 3 | **`annot.annot_annotate_url`** | One call: capture + locator resolve + render + return PNG |
| 4 | `github.create_issue` | File the issue with the PNG embedded |

The Annot tool call looks like:

```jsonc
{
  "url": "https://staging.example.com/login",
  "annotations": [
    { "type": "rect",
      "locator": "button:has-text('Submit')",
      "intent": "error" },
    { "type": "callout",
      "atLocator": "form",
      "targetLocator": "button:has-text('Submit')",
      "content": "Submit button is disabled" }
  ]
}
```

Three MCP calls instead of five+. Locator strings stay verbatim
in the agent's reasoning trace — easier to debug after the
fact.

## Composing with `@playwright/mcp` for multi-step flows

When the agent needs to interact (sign-in, click, wait) before
capturing, drive the browser through `@playwright/mcp` and feed
the resulting PNG to `annot_annotate_screenshot`:

```
playwright.browser_navigate → fill → click → wait_for_url →
playwright.browser_screenshot → (PNG bytes)
                              ↓
playwright.browser_locator(s) → (bbox)
                              ↓
annot.annot_annotate_screenshot({ image: <PNG>, annotations: [{ bbox, ... }] })
                              ↓
                              annotated PNG
```

In that flow, `@playwright/mcp` owns the browser session;
Annot is browser-free. The `annot_annotate_url` shortcut is for
**single-shot** captures where the agent doesn't need to drive
interaction.

## See also

- [Annotation DSL](../api/dsl) — the JSON shape the tools
  accept.
- [MCP tools reference](../ai-agents/tools) — full schema for
  every tool, including the redact + compare pair.
- The MCP package's own README at
  [`@ingcreators/annot-mcp`](https://www.npmjs.com/package/@ingcreators/annot-mcp)
  for installation details and the friendly-error catalogue.
