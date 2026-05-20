# Working with AI agents

This document is the entry point for **driving Annot from an AI
agent** (Claude Desktop, Claude Code, Cursor, Continue, or any
other Model Context Protocol client). The same SVG-first core
that backs the editor is exposed through a stdio MCP server, so
an agent can compose Annot into autonomous browser-driven
workflows alongside `@playwright/mcp` and GitHub MCP.

The deep reference lives in
[`packages/mcp/README.md`](../packages/mcp/README.md); this guide
is the shorter intro plus a "which doc do I want?" map.

## Three things to know first

1. **Annot ships its own MCP server.** It runs locally on the
   user's machine; no network round-trip to a hosted service,
   no auth. Cloud-hosted MCP is explicitly out of scope at v1.
2. **The headline workflow is locator-first.** One MCP call
   captures a URL with headless Chromium AND overlays
   annotations positioned by Playwright locator strings —
   replacing the multi-step
   `playwright-mcp.browser_navigate` →
   `browser_screenshot` → `browser_locator` × N → annotate
   sequence.
3. **The agent doesn't need to know SVG.** The annotation DSL
   is a small JSON shape (rect / circle / arrow / text /
   callout / raw) with an `intent: "info" | "warning" | "error"
   | "success" | "neutral"` shorthand that resolves to the
   Annot design system's semantic colours.

## Setup

```sh
npm install -g @ingcreators/annot-mcp

# One-time Chromium runtime for the `_url` tools (~150 MB).
npx playwright install chromium
```

Wire into your MCP client. For Claude Desktop on macOS:

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "annot": {
      "command": "npx",
      "args": ["@ingcreators/annot-mcp"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Restart the client; five `annot_*` tools appear alongside
playwright-mcp's `browser_*` tools.

## The five tools at a glance

| Tool | Inputs | Returns |
|---|---|---|
| `annot_annotate_screenshot` | PNG (data URL or absolute path) + bbox annotations | Annotated PNG |
| `annot_annotate_url` | URL + locator-or-bbox annotations | Annotated PNG (Annot drives Chromium) |
| `annot_redact_screenshot` | PNG + bbox regions (solid / mosaic / blur) | PNG with redactions destructively burned in |
| `annot_redact_url` | URL + locator-or-bbox regions | Same, with live capture |
| `annot_compare_screenshots` | Two PNGs of identical dimensions | PNG of the second image with changed regions highlighted |
| `annot_aria_snapshot` | URL + optional `rootSelector` | YAML accessibility tree with `[ref=eN]` markers — same primitive `playwright-mcp` uses, foundational input for the product-docs workflow ([`docs/plans/living-product-docs.md`](./plans/living-product-docs.md)) |

Per-tool input schemas and the full DSL (locator adaptation
rules, intent → colour mapping) are documented in
[`packages/mcp/README.md`](../packages/mcp/README.md).

## A one-turn agent transcript

```
USER: Go to https://staging.example.com/login, find any disabled
      submit button, and file a GitHub issue against
      ingcreators/example with an annotated screenshot.

AGENT → annot.annot_annotate_url({
          url: "https://staging.example.com/login",
          annotations: [
            { type: "rect",
              locator: "button:has-text('Submit')",
              intent: "error" },
            { type: "callout",
              atLocator: "form",
              targetLocator: "button:has-text('Submit')",
              content: "Submit button is disabled" }
          ]
        })
        ← annotated PNG inline in the conversation
AGENT → github.create_issue({
          repo: "ingcreators/example",
          title: "Login form: Submit button disabled on staging",
          body: "...", // PNG embedded
        })
        ← issue URL
AGENT: Filed https://github.com/ingcreators/example/issues/42.
```

Three MCP calls, zero manual bbox arithmetic. Locator strings
stay verbatim in the agent's reasoning, which makes the
chain-of-thought trace much easier to read after the fact.

## When to compose with `@playwright/mcp`

Use **`annot_annotate_url`** when the capture is a single
navigation (the example above). Use **`annot_annotate_screenshot`
+ `@playwright/mcp`** when the agent needs to drive
interactivity (sign-in, click, fill, wait) before the
screenshot:

```
playwright.browser_navigate → fill → click → wait_for_url →
playwright.browser_screenshot → bytes
                              ↓
playwright.browser_locator(s) → bbox
                              ↓
annot.annot_annotate_screenshot({ image: bytes, annotations: [{ bbox, ... }] })
                              ↓
                              annotated PNG
```

The Annot MCP server stays browser-free in that flow —
`@playwright/mcp` owns the browser session; Annot just
renders.

## Where to read next

| If you want to … | Read |
|---|---|
| Set up Claude Desktop / Claude Code with Annot | [`packages/mcp/README.md`](../packages/mcp/README.md) — Installation |
| Learn the full annotation DSL + tool schemas | [`packages/mcp/README.md`](../packages/mcp/README.md) — The five tools / The annotation DSL |
| Understand the design rationale + phase ledger | [`docs/plans/_done/agent-mcp-integration.md`](./plans/_done/agent-mcp-integration.md) |
| See how the headless rasteriser works under the hood | [`packages/annotator/README.md`](../packages/annotator/README.md) |
| Wire Annot into a Playwright test (not an agent) | [`packages/playwright/README.md`](../packages/playwright/README.md) |
| Read the broader product direction | [`PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) |

## Friendly errors agents see

The `_url` tools detect missing Chromium and return a
structured error pointing to the install command:

```
ChromiumUnavailableError: Failed to launch Chromium.
Run `npx playwright install chromium` to download the runtime,
then retry.
```

Locator failures surface as `LocatorResolutionError` with the
offending selector embedded:

```
LocatorResolutionError: Locator "button:has-text('Submit')"
resolved to no visible element. Check the selector matches at
least one element and the element is inside the captured
viewport.
```

These come back as MCP tool errors (`isError: true`), so the
agent can correct the locator and retry without crashing the
turn.

## Out of scope at v1

- **Cloud-hosted MCP** at `annot.work/mcp`. The local-only model
  keeps the security surface small (no auth, no PII concerns).
  Demand-driven follow-up on [`docs/plans/annot-cloud-roadmap.md`](./plans/annot-cloud-roadmap.md).
- **A general-purpose Playwright MCP server.** Annot bundles
  `playwright-core` only for locator resolution on a single
  page load; navigation / click / fill / multi-step state stay
  the upstream `@playwright/mcp`'s job.
- **JPEG output.** All five tools emit PNG only.
- **A right-click "Ask AI" inside the editor.** Sibling product
  surface, not part of this track.
- **PPTX export from the agent (`annot_export_pptx`).** Deferred
  on `pptx-export`'s `ImageRecord[]`-driven refactor (see
  CLAUDE.md §2).
