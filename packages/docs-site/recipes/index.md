# Recipes

End-to-end working examples for both the Playwright-test and
the AI-agent workflows.

## Playwright tests

| Recipe | What it shows |
| ------ | ------------- |
| **[Annotate on assertion failure](./assertion-failure.md)** | Wrap an assertion in try/catch and annotate the locator that misbehaved. |
| **[Annotate on failure with the DSL](./dsl-on-failure.md)** | Same flow with the typed [annotation DSL](../api/dsl) — `intent: "error"` instead of raw hex, `callout` instead of three string-concatenated helpers. |
| **[Draw by DOM locator](./dom-locator.md)** | Use `locator.boundingBox()` + `rectForBoundingBox` to draw an exact overlay rectangle. |
| **[Attach to the HTML report](./html-report.md)** | Land the annotated PNG inline next to the failing step. |

## AI agents (MCP)

| Recipe | What it shows |
| ------ | ------------- |
| **[Agent bug-report autopilot](./agent-bug-report.md)** | Locator-first MCP workflow: navigate → identify broken element → file a GitHub issue with annotated screenshot in one turn. |
| **[Generate a manual from screenshots](./manual-from-screenshots.md)** | Combine MCP capture + DSL annotations + the [encode pipeline](../api/encode) (`format: "smart"` + `saveSizePreset`) for ~3–5× smaller per-step bytes. |

Each recipe is self-contained — copy-paste it into a new
`example.spec.ts` (or paste the MCP payload into your agent's
prompt), install the packages, and it works against any URL.
