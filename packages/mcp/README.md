# `@ingcreators/annot-mcp`

Model Context Protocol server exposing the
[`@ingcreators/annot-annotator`](../annotator/README.md) headless
annotator as agent-callable tools. Drop into Claude Desktop /
Claude Code / Cursor / Continue and an AI agent can compose Annot
with `@playwright/mcp` + GitHub MCP into autonomous
browser-driven workflows:

- **Bug-report autopilot** — agent navigates to a staging URL,
  identifies a broken element, files a GitHub issue with an
  annotated screenshot in one conversation turn.
- **Visual-diff PR review** — agent screenshots the same page on
  two branches, posts the diff with changed regions highlighted.
- **Locator-first annotation** — agent says `{ type: "rect",
  locator: "button:has-text('Submit')", intent: "error" }` in a
  single MCP call; the server handles capture + locator
  resolution + render.

> Phase 6 (PPTX export) is deferred indefinitely per the
> design plan in
> [`docs/plans/_done/agent-mcp-integration.md`](../../docs/plans/_done/agent-mcp-integration.md),
> pending the `pptx-export` `ImageRecord[]`-driven refactor noted
> in [`CLAUDE.md`](../../CLAUDE.md) §2.

## Installation

```sh
# Once globally (or via npx per-call)
npm install -g @ingcreators/annot-mcp

# Chromium runtime for `_url` tools — one-time, ~150 MB download
npx playwright install chromium
```

Then wire into your MCP client config. For Claude Desktop
(`~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on
Windows):

```json
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

Restart the client. The five `annot_*` tools appear alongside
playwright-mcp's `browser_*` tools and any other MCP servers
you've configured.

## The five tools

Each tool returns an MCP `image` content block (base64 PNG)
inline in the agent's conversation, OR — when `output` is set
to an absolute path — writes the PNG to disk and returns a
text confirmation.

### `annot_annotate_screenshot`

Overlay annotations on a pre-captured PNG.

**Inputs:**
- `image` — `data:image/png;base64,...` URL or absolute path.
- `annotations` — array of `BboxAnnotation` (see DSL below).
- `output` (optional) — absolute path.

### `annot_annotate_url`

Open a URL in headless Chromium, capture, overlay annotations
positioned by Playwright locator strings (or bboxes). The
headline locator-first tool — one MCP call replaces the
multi-step `playwright-mcp.browser_navigate` →
`browser_screenshot` → `browser_locator` × N →
`annot_annotate_screenshot` flow.

**Inputs:**
- `url` — page URL.
- `annotations` — array of `LocatorAnnotation` (locator string
  or coordinate).
- `viewport` (optional) — `{ width, height, deviceScaleFactor }`,
  default 1280×800 at 1×.
- `fullPage` (optional, default `false`).
- `waitFor` (optional, default `"load"`) — `"load"` /
  `"domcontentloaded"` / `"networkidle"`.
- `output` (optional).

### `annot_redact_screenshot`

Destructively burn redactions (solid / mosaic / blur) into a
PNG. Original pixels under each region are irrecoverably
replaced.

**Inputs:**
- `image` — same as `annot_annotate_screenshot`.
- `regions` — array of `{ bbox, style?, color? }`. `style` is
  `"solid"` (default) / `"mosaic"` / `"blur"`.
- `output` (optional).

### `annot_redact_url`

Live-capture variant of redact. Regions accept locator strings
or bboxes.

**Inputs:**
- `url` / `viewport` / `fullPage` / `waitFor` / `output` — same
  as `annot_annotate_url`.
- `regions` — array of `{ bbox | locator, style?, color? }`.

### `annot_compare_screenshots`

Pixel-perfect diff between two PNGs of identical dimensions.
Returns a PNG of the `after` image with changed regions
highlighted as `warning`-intent rects.

**Inputs:**
- `before` / `after` — PNG inputs (data URL or absolute path).
- `threshold` (optional, default `0.1`) — pixelmatch
  sensitivity (0 = strict, 1 = permissive).
- `includeChangeList` (optional) — when `true`, append a text
  content block listing the changed-region bboxes.
- `output` (optional).

## The annotation DSL

Two flavours. `BboxAnnotation` (used by `_screenshot` tools)
requires explicit positions; `LocatorAnnotation` (used by `_url`
tools) accepts Playwright locator strings or coordinates.

### Intent shorthand

Every annotation accepts an `intent: "info" | "warning" | "error"
| "success" | "neutral"` that resolves to the Annot design
system's semantic colours:

| Intent | Stroke | Text |
|---|---|---|
| `info` | `#3b82f6` | `#1e40af` |
| `warning` | `#f59e0b` | `#92400e` |
| `error` (default) | `#ef4444` | `#991b1b` |
| `success` | `#10b981` | `#065f46` |
| `neutral` | `#6b7280` | `#374151` |

Explicit `stroke` / `color` / `fill` override the intent
defaults.

### Annotation types

```ts
// BboxAnnotation (for _screenshot tools).
type BboxAnnotation =
  | { type: "rect"; bbox: BBox; intent?: Intent; ... }
  | { type: "circle"; center: Point; radius: number; ... }
  | { type: "arrow"; from: Point; to: Point; ... }
  | { type: "text"; at: Point; content: string; fontSize?: number; ... }
  | { type: "callout"; at: Point; targetBbox: BBox; content: string; ... }
  | { type: "raw"; svgFragment: string };

// LocatorAnnotation (for _url tools). Same shapes — but you can
// substitute `locator` (or `fromLocator` / `toLocator` /
// `atLocator` / `targetLocator`) for any coordinate field.
type LocatorAnnotation =
  | { type: "rect"; bbox?: BBox; locator?: string; ... }
  | { type: "circle"; center?: Point; radius?: number; locator?: string; ... }
  | { type: "arrow"; from?: Point; fromLocator?: string;
                     to?: Point; toLocator?: string; ... }
  | { type: "text"; at?: Point; locator?: string; content: string; ... }
  | { type: "callout"; at?: Point; atLocator?: string;
                       targetBbox?: BBox; targetLocator?: string;
                       content: string; ... }
  | { type: "raw"; svgFragment: string };
```

### Non-rect locator adaptation

When a `locator` resolves to a bounding box on a non-rect shape:

- **circle** — center = bbox centroid; radius = `min(w, h) / 2`.
- **arrow** endpoint — bbox centroid.
- **text** — `at` = bbox top-left, raised one font line above so
  the caption sits above the element.
- **callout** — `targetLocator` becomes the highlighted rect;
  `atLocator` becomes the caption anchor (also centroid).

## Two end-to-end transcripts

### A. Locator-first standalone — bug-report autopilot

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
        ← annotated PNG inline
AGENT → github.create_issue({
          repo: "ingcreators/example",
          title: "Login form: Submit button disabled on staging",
          body: "...", // PNG attached
        })
        ← issue URL
AGENT: Filed https://github.com/ingcreators/example/issues/42.
```

### B. Composing with `@playwright/mcp` — multi-step flow

For workflows that need interactivity (sign-in, click, wait)
before the capture, drive the browser through
`@playwright/mcp` and feed its screenshot output to
`annot_annotate_screenshot`:

```
USER: Log in as alice@example.com on staging, navigate to the
      dashboard, annotate the "team analytics" panel for the
      onboarding doc.

AGENT → playwright.browser_navigate({ url: ".../login" })
AGENT → playwright.browser_fill({ selector: "[name=email]",
                                  text: "alice@example.com" })
AGENT → playwright.browser_fill({ selector: "[name=password]",
                                  text: <secret> })
AGENT → playwright.browser_click({ selector: "button:has-text('Sign in')" })
AGENT → playwright.browser_wait_for_url({ pattern: "**/dashboard" })
AGENT → playwright.browser_screenshot({ fullPage: true })
        ← bytes
AGENT → playwright.browser_locator({
          selector: "[data-testid='team-analytics']" })
        ← bbox
AGENT → annot.annot_annotate_screenshot({
          image: <PNG>,
          annotations: [
            { type: "rect", bbox, intent: "success" },
            { type: "callout", at: { x: 20, y: bbox.y - 40 },
              targetBbox: bbox,
              content: "Team analytics — review weekly" }
          ]
        })
        ← annotated PNG
```

The MCP server stays browser-free in this flow — Annot's
`annot_annotate_url` is the one-shot path, `annot_annotate_screenshot`
is the composable primitive.

## Package boundaries

| File / module | Role |
|---|---|
| `bin/annot-mcp.mjs` | CLI shim — boots the server over stdio |
| `src/server.ts` | `createServer()` factory — wires tools + dispatch |
| `src/transport.ts` | `runStdioServer()` — stdio transport |
| `src/dsl/types.ts` | `BboxAnnotation` + `LocatorAnnotation` unions |
| `src/dsl/schema.ts` | JSON Schema literals for MCP `inputSchema` |
| `src/dsl/to-svg.ts` | DSL → SVG fragment converter |
| `src/dsl/svg-primitives.ts` | Tier A SVG fragment builders |
| `src/io/png-dimensions.ts` | PNG IHDR width/height parser |
| `src/io/read-image.ts` | data URL / filesystem → bytes + dims |
| `src/browser/pool.ts` | `BrowserPool` — refcounted lifecycle |
| `src/browser/capture.ts` | `capturePage()` — Chromium navigate + screenshot |
| `src/browser/resolve-locator.ts` | locator string → bbox + per-shape adaptation |
| `src/redact/burn.ts` | `burnRedactions()` — canvas-side destructive overlay |
| `src/compare/diff.ts` | `diffScreenshots()` — pixelmatch wrapper |
| `src/compare/aggregate.ts` | `aggregateDiffRegions()` — flood-fill bbox extraction |
| `src/tools/annotate-screenshot.ts` | `annot_annotate_screenshot` |
| `src/tools/annotate-url.ts` | `annot_annotate_url` |
| `src/tools/redact-screenshot.ts` | `annot_redact_screenshot` |
| `src/tools/redact-url.ts` | `annot_redact_url` |
| `src/tools/compare-screenshots.ts` | `annot_compare_screenshots` |

## Runtime dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation.
- `@ingcreators/annot-annotator` — Tier A headless rasteriser.
- `@napi-rs/canvas` — Node canvas for redact + diff (~80 MB
  native binding, prebuilt binaries per OS).
- `playwright-core` — Chromium driver for `_url` tools. The
  Chromium binary is a separate `npx playwright install chromium`
  step the user runs once.
- `pixelmatch` — pixel-perfect diff for `annot_compare_screenshots`.

## Friendly errors

The `_url` tools detect missing Chromium and return a structured
error pointing to the install command:

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

The agent sees these as MCP tool errors and can correct + retry.

## See also

- [`docs/ai-agents.md`](../../docs/ai-agents.md) — short intro
  guide + "which doc do I want?" map; start here if you're new
  to the MCP integration.
- [`docs/plans/_done/agent-mcp-integration.md`](../../docs/plans/_done/agent-mcp-integration.md)
  — full design + phase ledger.
- [`@ingcreators/annot-annotator`](../annotator/README.md) — the
  underlying Tier A headless renderer.
- [`@ingcreators/annot-playwright`](../playwright/README.md) — the
  test-engineer-facing Playwright fixture (sibling consumer of
  the annotator).
- Model Context Protocol spec: https://modelcontextprotocol.io/
- Upstream `@playwright/mcp`: https://github.com/microsoft/playwright-mcp
