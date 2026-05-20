# Annot MCP server — AI agent integration

> **Status:** Partially landed —
>   Phases 1 ([#830](https://github.com/ingcreators/annot/pull/830)) /
>   2 ([#831](https://github.com/ingcreators/annot/pull/831)) /
>   3a ([#832](https://github.com/ingcreators/annot/pull/832)) /
>   3b ([#833](https://github.com/ingcreators/annot/pull/833)) /
>   4 ([#834](https://github.com/ingcreators/annot/pull/834)) /
>   5 ([#835](https://github.com/ingcreators/annot/pull/835)) /
>   7 (this PR) landed. Five tools live:
>   `annot_annotate_screenshot`, `annot_annotate_url`,
>   `annot_redact_screenshot`, `annot_redact_url`,
>   `annot_compare_screenshots`. Phase 6 (PPTX export) deferred
>   indefinitely pending the pptx-export `ImageRecord[]`-driven
>   refactor in CLAUDE.md §2; Phase 8 (first npm publish) gated
>   on [`headless-annotator-publish.md`](./headless-annotator-publish.md).
> **Compatibility:** Builds on the headless-annotator track —
>   [`_done/annot-annotator-package.md`](./_done/annot-annotator-package.md)
>   (Phase 1) provides `createAnnotator()`, and
>   [`_done/annot-playwright-fixture.md`](./_done/annot-playwright-fixture.md)
>   (Phase 2) provides the SVG-fragment helpers (`rectForBoundingBox`
>   / `arrowBetween` / `textAt`) the MCP layer reuses. New workspace
>   package; no changes to existing public APIs. Independent from
>   [`headless-annotator-publish.md`](./headless-annotator-publish.md)
>   for development, but publishing the MCP package piggy-backs on
>   the same Changesets bootstrap.
> **Risk:** Medium. The MCP protocol is young (v0.1 spec; breaking
>   changes still possible). Tool schemas exposed here become an
>   API contract for agents AFTER the first npm publish; before
>   that, breaking changes are allowed (we'll iterate the shape
>   pre-1.0). Treat the v1.0 schema review as the one-shot
>   "shape we can live with" exercise — not Phase 1.

## Context

The strategic vector in [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)
calls for extracting Annot's SVG-first core as a headless library
usable from Playwright / Node. The headless-annotator track delivered
that. The Playwright fixture track delivered the **test-engineer**
consumer (humans writing Playwright tests, or AI agents writing them
via codegen).

This plan delivers the **runtime AI-agent** consumer: a Model
Context Protocol server that lets Claude Desktop, Claude Code,
Cursor, Continue, etc. compose Annot into autonomous browser-driven
workflows by piping MCP tool calls:

```
playwright-mcp          annot-mcp             github-mcp
─────────────────       ──────────────         ──────────────
browser_navigate   ─→   ─                ─→   ─
browser_snapshot   ─→   ─                ─→   ─
browser_screenshot ─→   annotate_screenshot ─→ create_issue
browser_locator    ─→   ─                ─→   ─
```

Three concrete workflows the plan targets:

1. **Bug-report autopilot.** Agent navigates to a staging URL,
   identifies a broken element, produces a PNG with a red rect +
   callout pointing at it, opens a GitHub issue with the image
   attached.
2. **Visual-diff PR review.** Agent screenshots the same page on
   two branches, runs `compare_screenshots` to highlight changed
   regions, posts the annotated diff to the PR.
3. **Demo + onboarding artefact generation.** Agent walks a
   feature flow, captures key steps, exports a multi-slide PPTX
   suitable for a sales deck or runbook.

The first workflow exists today only as a manual process; the MCP
surface collapses it to a single agent conversation turn.

### Why MCP rather than HTTP / SDK

MCP is the lingua franca emerging across agent runtimes. A single
MCP server reaches Claude Desktop, Claude Code, Cursor, Continue,
and an increasing list of agent shells without per-tool plumbing.
A raw HTTP API would require each shell to write a bespoke adapter;
an SDK would require each shell to load and run our code in-process.

### How this relates to the Annot Cloud roadmap

Local MCP — runs on the user's machine, free, no cloud dependency.
Cloud-hosted MCP (`https://annot.work/mcp` with auth) is **out of
scope** for this plan. If demand surfaces post-launch it grows as a
new phase on [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md),
not here. Keeping the v1 local-only also keeps the security
surface small — no auth, no rate limit, no PII concerns.

## Goals

- Ship `@ingcreators/annot-mcp` as a new workspace package
  (Tier A, Node-only).
- Expose six MCP tools (see Design — Tools): three pairs of
  `_screenshot` (pre-captured bytes, bbox-only) and `_url` (live
  capture, locator-or-bbox) variants for annotate / redact, plus
  one compare tool and one PPTX tool.
- Locator-first composition: the `_url` tools accept Playwright
  locator strings directly (`button:has-text("Submit")`,
  `[data-testid="email"]`, `role=button[name="Sign in"]`), so an
  agent can request "redact the password field on this page"
  in one call without manually chaining `browser_screenshot` +
  `browser_locator` from `@playwright/mcp`. Locator resolution
  uses an internally-bundled `playwright-core` headless browser.
- Provide a `npx @ingcreators/annot-mcp` CLI entrypoint so users
  can wire it into their MCP client config without installing
  globally.
- Document a recommended composition recipe with the upstream
  `@playwright/mcp` server, including a copy-paste
  `claude_desktop_config.json` snippet — both the pure-MCP
  composition (Annot consumes Playwright MCP's screenshot output)
  and the standalone `_url` workflow (Annot drives its own
  browser).
- Keep the package publishable via the same Changesets pipeline
  that [`headless-annotator-publish.md`](./headless-annotator-publish.md)
  stands up.

## Non-goals

- A "general AI assistant inside the Annot editor" (right-click
  → "Ask AI for annotation suggestions"). That's a separate
  product surface — sibling plan, not part of this one.
- A general-purpose Playwright MCP server. We bundle
  `playwright-core` for one specific purpose: resolving locators
  on a single page load to support `*_url` tools. We do NOT
  expose browser-control primitives (no `navigate`, `click`,
  `fill`, `evaluate`, multi-step session state, …); compose with
  the upstream `@playwright/mcp` for those workflows.
- Cloud-hosted MCP / authenticated remote MCP. Local-only at v1.
- A "Annot Cloud OAuth bridge for MCP". Defer.

## Design

### Package structure

```
packages/mcp/
├── README.md
├── package.json                  ({ "bin": "./bin/annot-mcp.mjs" })
├── tsconfig.json
├── vite.config.ts                (library build, esm only)
├── bin/
│   └── annot-mcp.mjs             (CLI shim — boot the server over stdio)
└── src/
    ├── index.ts                  (barrel — createServer + types)
    ├── server.ts                 (createServer({ annotator, ... }))
    ├── tools/
    │   ├── annotate-screenshot.ts
    │   ├── annotate-screenshot.test.ts
    │   ├── annotate-url.ts
    │   ├── annotate-url.test.ts
    │   ├── redact-screenshot.ts
    │   ├── redact-screenshot.test.ts
    │   ├── redact-url.ts
    │   ├── redact-url.test.ts
    │   ├── compare-screenshots.ts
    │   ├── compare-screenshots.test.ts
    │   ├── export-pptx.ts
    │   └── export-pptx.test.ts
    ├── dsl/
    │   ├── types.ts              (TypeScript types for the DSL)
    │   ├── schema.ts             (JSON Schema literal for MCP `inputSchema`)
    │   ├── to-svg.ts             (DSL → SVG fragment string)
    │   └── to-svg.test.ts
    ├── browser/
    │   ├── capture.ts            (playwright-core launch + goto + screenshot)
    │   ├── resolve-locator.ts    (locator string → bbox via Locator.boundingBox())
    │   └── resolve-locator.test.ts
    └── transport.ts              (stdio transport wiring)
```

Tier classification: **Tier A** (Node-only, no DOM). The package
imports `@ingcreators/annot-annotator` (which is also Tier A),
`@modelcontextprotocol/sdk`, `@napi-rs/canvas` (for redact + diff
canvas ops), and `playwright-core` (for `_url` tool locator
resolution). **MUST NOT** depend on `@ingcreators/annot-editor`
or `@ingcreators/annot-render`.

`playwright-core` is a regular `dependencies` entry rather than
an optional peer-dep — a user who installs `@ingcreators/annot-mcp`
gets the URL-driven tools out of the box. The Chromium runtime
is a separate `postinstall` step (`npx playwright install
chromium`) documented in the README; without it, the `_url`
tools fail fast with a friendly error pointing to the install
command. We deliberately don't run `playwright install` in our
own `postinstall` to keep `npx @ingcreators/annot-mcp@latest`
cold-start fast — first invocation of an `_url` tool prompts
the user to run the one-time install.

npm name: `@ingcreators/annot-mcp`.

### MCP transport

v1 ships **stdio only**. That covers Claude Desktop, Claude Code,
Cursor, Continue. HTTP SSE transport is a one-config-flag addition
later if a use case lands that needs it.

The CLI shim (`bin/annot-mcp.mjs`) is the only entry point users
touch. It constructs the server with default options and pipes
stdin/stdout to the MCP `StdioServerTransport`. Power users who
want to embed the server in their own process import
`createServer` directly from the barrel.

### Tools

Six tools at v1. Schemas below are illustrative — the real JSON
Schema lives in `src/dsl/schema.ts`.

All tool inputs accept image data via two forms (used by the
`_screenshot` tools and as the input of `annot_compare_screenshots`):

- `data:image/png;base64,...` URL string
- absolute filesystem path string

PNG is the only supported output format at v1. The `_screenshot`
tools' annotation positions accept bbox only; the `_url` tools'
annotation positions accept either bbox OR Playwright locator
strings (`button:has-text("Submit")`, `[data-testid="email"]`,
`role=button[name="Sign in"]`, …).

#### `annot_annotate_screenshot`

Compose annotations onto an existing screenshot.

```ts
{
  name: "annot_annotate_screenshot",
  description: "Overlay annotations (rectangles, arrows, callouts, " +
               "text) on a PNG screenshot. Returns the annotated PNG.",
  inputSchema: {
    type: "object",
    required: ["image", "annotations"],
    properties: {
      image: { type: "string", description: "data: URL or absolute path" },
      annotations: { type: "array", items: { $ref: "#/$defs/BboxAnnotation" } },
      output: { type: "string", description: "optional output path" },
    },
    $defs: { BboxAnnotation: <see DSL below — bbox required> },
  },
}
```

The tool result is an MCP `content` block carrying the annotated
PNG. MCP's standard `image` content type handles base64-encoded
PNGs natively, so agents see the image directly in their
conversation (Claude Desktop renders it inline).

#### `annot_annotate_url`

Capture a live page and compose annotations using locator strings
(or bboxes). This is the headline tool for the agent-friendly
workflow — one MCP call instead of `playwright-mcp.browser_navigate`
→ `browser_screenshot` → `browser_locator` × N → `annot_annotate_screenshot`.

```ts
{
  name: "annot_annotate_url",
  description: "Open a URL in a headless browser, capture a " +
               "screenshot, and overlay annotations positioned by " +
               "Playwright locator strings or bounding boxes. " +
               "Returns the annotated PNG.",
  inputSchema: {
    type: "object",
    required: ["url", "annotations"],
    properties: {
      url: { type: "string", format: "uri" },
      annotations: { type: "array", items: { $ref: "#/$defs/LocatorAnnotation" } },
      viewport: {
        type: "object",
        properties: {
          width: { type: "integer", default: 1280 },
          height: { type: "integer", default: 800 },
          deviceScaleFactor: { type: "number", default: 1 },
        },
      },
      fullPage: { type: "boolean", default: false },
      waitFor: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "load",
      },
      output: { type: "string" },
    },
    $defs: { LocatorAnnotation: <see DSL below — bbox OR locator> },
  },
}
```

Locator resolution: each annotation's `locator` string is passed
through `page.locator(locator).boundingBox()`. Locator syntax
follows Playwright's standard grammar — CSS selectors,
`role=`, `text=`, `nth=`, chained `>>` operators all work. If a
locator fails to resolve (zero matches, multiple matches, or
out-of-viewport when `fullPage: false`), the tool returns a
structured error indicating which locator failed and why, so the
agent can correct + retry.

#### `annot_redact_screenshot`

Burn redactions destructively into a screenshot.

```ts
{
  name: "annot_redact_screenshot",
  description: "Destructively redact regions of a screenshot " +
               "(solid / mosaic / blur). Returns a PNG with original " +
               "pixels under each region irrecoverably replaced.",
  inputSchema: {
    type: "object",
    required: ["image", "regions"],
    properties: {
      image: { type: "string", description: "data: URL or absolute path" },
      regions: {
        type: "array",
        items: {
          type: "object",
          required: ["bbox"],
          properties: {
            bbox: { $ref: "#/$defs/BBox" },
            style: { enum: ["solid", "mosaic", "blur"], default: "solid" },
            color: { type: "string", description: "CSS color, solid style only" },
          },
        },
      },
    },
  },
}
```

Reuses the existing `burnRedactionsIntoBitmap` from
`@ingcreators/annot-render` modulo the dependency direction
constraint — Node has no `<canvas>`, so the MCP package inlines
the burn logic over [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas).

#### `annot_redact_url`

Live-capture variant of `annot_redact_screenshot`. The agent's
"redact the password field on this page" workflow in one call.

```ts
{
  name: "annot_redact_url",
  description: "Open a URL in a headless browser, capture a " +
               "screenshot, and destructively burn redactions onto " +
               "regions identified by locators or bboxes. Returns the " +
               "redacted PNG.",
  inputSchema: {
    type: "object",
    required: ["url", "regions"],
    properties: {
      url: { type: "string", format: "uri" },
      regions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            locator: { type: "string" },
            bbox: { $ref: "#/$defs/BBox" },
            style: { enum: ["solid", "mosaic", "blur"], default: "solid" },
            color: { type: "string" },
          },
          /* oneOf: requires exactly one of locator | bbox */
        },
      },
      viewport: { /* same as annot_annotate_url */ },
      fullPage: { type: "boolean", default: false },
      waitFor: { /* same as annot_annotate_url */ },
    },
  },
}
```

Internally composes the same playwright-core capture path as
`annot_annotate_url` then routes through `annot_redact_screenshot`'s
burn path.

#### `annot_compare_screenshots`

Visual diff between two screenshots, with changed regions
highlighted.

```ts
{
  name: "annot_compare_screenshots",
  description: "Compare two screenshots; return a PNG of the second " +
               "with changed regions highlighted as red rectangles.",
  inputSchema: {
    type: "object",
    required: ["before", "after"],
    properties: {
      before: { type: "string" },
      after:  { type: "string" },
      threshold: { type: "number", default: 0.1 },
      includeChangeList: { type: "boolean", default: false },
    },
  },
}
```

Backed by `pixelmatch` (well-trodden, MIT, no native deps).
Aggregates the per-pixel diff into bounding rectangles of
contiguous changed regions, then composes them through
`annot_annotate_screenshot`'s internal path. A URL-variant
(`annot_compare_urls`) is deliberately omitted at v1 — the agent
can compose `annot_annotate_url` (with empty annotations, just
for capture) × 2 + `annot_compare_screenshots` to get the same
effect, and the explicit composition keeps the timing semantics
clear to the agent.

#### `annot_export_pptx`

Export a sequence of annotated screenshots as a PPTX deck.

```ts
{
  name: "annot_export_pptx",
  description: "Export a sequence of annotated screenshots as a " +
               "PowerPoint file (one slide per image).",
  inputSchema: {
    type: "object",
    required: ["slides"],
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          required: ["image"],
          properties: {
            image: { /* image input */ },
            annotations: { type: "array", items: { $ref: "#/$defs/Annotation" } },
            title: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      output: { type: "string" },
    },
  },
}
```

This one **depends on the pptx-export refactor** mentioned in
[`CLAUDE.md`](../../CLAUDE.md) §2 ("future home for gallery
bulk-export and the eventual `pptx-export` ImageRecord refactor").
Current `pptx-export` is Tier C (CanvasManager-coupled); a data-
driven `ImageRecord[]`-taking variant is the prerequisite. The
phased plan below treats Phase 4 (this tool) as gated.

### The annotation DSL

Two flavours: `BboxAnnotation` (used by `_screenshot` tools, bbox
required) and `LocatorAnnotation` (used by `_url` tools, accepts
either bbox or locator).

```ts
// Base shape — shared properties across all annotation types.
type AnnotationBase = {
  intent?: Intent;
  // Optional explicit overrides win over `intent`-derived defaults.
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  color?: string;
};

type BboxAnnotation =
  | (AnnotationBase & { type: "rect"; bbox: BBox })
  | (AnnotationBase & { type: "circle"; center: Point; radius: number })
  | (AnnotationBase & { type: "arrow"; from: Point; to: Point })
  | (AnnotationBase & { type: "text"; at: Point; content: string;
                        fontSize?: number; anchor?: "start" | "middle" | "end" })
  | (AnnotationBase & { type: "callout"; at: Point; targetBbox: BBox; content: string })
  | { type: "raw"; svgFragment: string };

// LocatorAnnotation: same shapes, but positions accept locators.
// Exactly one of bbox / locator (or from / fromLocator etc.) is required.
type LocatorAnnotation =
  | (AnnotationBase & { type: "rect"; bbox?: BBox; locator?: string })
  | (AnnotationBase & { type: "circle"; center?: Point; radius?: number; locator?: string })
  | (AnnotationBase & { type: "arrow";
                        from?: Point; fromLocator?: string;
                        to?: Point; toLocator?: string })
  | (AnnotationBase & { type: "text"; at?: Point; locator?: string; content: string;
                        fontSize?: number; anchor?: "start" | "middle" | "end" })
  | (AnnotationBase & { type: "callout";
                        at?: Point; atLocator?: string;
                        targetBbox?: BBox; targetLocator?: string;
                        content: string })
  | { type: "raw"; svgFragment: string };

type Intent = "info" | "warning" | "error" | "success" | "neutral";
type BBox = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
```

Design notes:

- **`intent` is the agent-friendly shorthand.** An agent says
  `{ type: "rect", locator: "...", intent: "error" }` instead of
  picking RGB hex values. The DSL resolves intent to the Annot
  design system's semantic colours (`--annot-color-error` etc.,
  see [`docs/design-system.md`](../design-system.md)). Explicit
  `stroke` / `color` / `fill` overrides win when set.
- **`raw` is the escape hatch** for both flavours. Power users
  can drop in arbitrary SVG. The annotator sanitiser handles it
  like any other input.
- **`callout` composes** a rect on the target + an arrow from the
  callout text position to the target edge + text at the position.
  One DSL entry, three drawn elements — saves agents from
  sequencing three calls. In the locator flavour, both ends
  (callout text + target) can independently be locator-based or
  coordinate-based.
- **Locator semantics for non-rect shapes.** When a `locator`
  resolves to a bounding box on a non-rect annotation:
    - `circle` — center = bbox centroid; radius = `min(width,
      height) / 2` unless explicit.
    - `arrow` from-locator — start = bbox centroid (or nearest
      edge midpoint when the other end is also positioned).
    - `text` locator — `at` = bbox top-left, with the text
      placed directly above the bbox by default.
    - `callout` — `targetLocator` becomes the rect; `atLocator`
      becomes the caption anchor.
  These behaviours are explicit in the README so agents can rely
  on them without inspecting source.
- The DSL → SVG conversion lives in `src/dsl/to-svg.ts` and reuses
  the SVG-fragment helpers from
  `@ingcreators/annot-playwright` (`rectForBoundingBox`,
  `arrowBetween`, `textAt`). The composition direction is
  `annot-mcp → annot-playwright/helpers → annot-core`. Acceptable
  because the helpers are pure SVG-string builders, no Playwright
  runtime dependency.
- For `_url` tools, locator → bbox resolution happens in
  `src/browser/resolve-locator.ts` BEFORE the DSL → SVG path —
  i.e., the URL tool collapses to "capture + resolve + delegate
  to bbox-flavour", keeping the SVG conversion path single-
  sourced.

### Composition with `@playwright/mcp`

The README documents this `claude_desktop_config.json` snippet:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "annot": {
      "command": "npx",
      "args": ["@ingcreators/annot-mcp@latest"]
    }
  }
}
```

And two illustrative agent transcripts (paraphrased — actual MCP
tool calls).

**Transcript A — locator-first standalone workflow.** Recommended
when the agent doesn't need browser interaction beyond a single
capture:

```
USER: Go to https://staging.example.com/login, find any disabled
      submit button, and file a GitHub issue against
      ingcreators/example with an annotated screenshot.

AGENT → playwright.browser_navigate({ url: "https://staging.example.com/login" })
AGENT → playwright.browser_snapshot()
        ← snapshot reveals button[name="Submit"][aria-disabled="true"]
AGENT → annot.annot_annotate_url({
          url: "https://staging.example.com/login",
          annotations: [
            { type: "rect", locator: "button:has-text('Submit')", intent: "error" },
            { type: "callout",
              atLocator: "form",
              targetLocator: "button:has-text('Submit')",
              content: "Submit button is disabled — form validation may be broken" }
          ]
        })
        ← annotated PNG (Annot's own playwright-core capture)
AGENT → github.create_issue({
          repo: "ingcreators/example",
          title: "Login form: Submit button disabled on staging",
          body: "...", // with image embedded
        })
        ← issue URL
AGENT: Filed https://github.com/ingcreators/example/issues/42.
```

Three MCP calls instead of five. The locator strings stay
verbatim in the agent's reasoning — no manual bbox arithmetic.

**Transcript B — composing with `@playwright/mcp` for multi-step
flows.** Recommended when the agent needs to click / fill / wait
before capture:

```
USER: Log in as alice@example.com on staging, navigate to the
      dashboard, and produce an annotated screenshot pointing at
      the "team analytics" panel for the onboarding doc.

AGENT → playwright.browser_navigate({ url: "https://staging.example.com/login" })
AGENT → playwright.browser_fill({ selector: "[name=email]", text: "alice@example.com" })
AGENT → playwright.browser_fill({ selector: "[name=password]", text: <from secret manager> })
AGENT → playwright.browser_click({ selector: "button:has-text('Sign in')" })
AGENT → playwright.browser_wait_for_url({ pattern: "**/dashboard" })
AGENT → playwright.browser_screenshot({ fullPage: true })
        ← bytes: <PNG>
AGENT → playwright.browser_locator({ selector: "[data-testid='team-analytics']" })
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
AGENT: <inserts PNG into the onboarding doc>
```

In this flow the agent owns the browser state via `@playwright/mcp`
and uses `annot_annotate_screenshot` (the bbox-only variant) on
the post-interaction PNG. Annot doesn't try to drive the browser
itself.

The README walks through both transcripts end-to-end with
screenshots of Claude Desktop running them.

### Testing strategy

- **DSL → SVG conversion** is pure functions, unit-tested with
  vitest. Snapshot tests pin the exact SVG output per DSL input
  (so a refactor that changes whitespace fails the test
  intentionally).
- **Per-tool tests** instantiate the server with a stub annotator
  (returns deterministic PNG bytes) and an in-memory MCP
  transport. Each test calls one tool and asserts the result
  block shape.
- **MCP protocol conformance** via
  [`@modelcontextprotocol/inspector`](https://github.com/modelcontextprotocol/inspector)
  as a manual gate, not CI. The inspector validates that tool
  schemas are well-formed JSON Schema and that tool calls
  produce valid MCP responses.
- **End-to-end with Claude Desktop** as a manual gate at Phase 5.
  Reviewer wires the config snippet, runs the bug-report
  transcript, attaches screenshots to the PR.

## Phased plan

Per the landing rules, one PR per phase, merged before the next.
The locator-first work is **front-loaded** (Phases 3a/3b) so the
agent-facing API is feature-complete before the npm publish locks
the schema. Pre-publish schema iteration is allowed; post-publish
breaking changes require a major bump.

### Phase 0 — Plan doc (this file)

Status: this PR. Lands as Draft until a reviewer signs off on
shape; promoted to Queued before Phase 1 starts.

### Phase 1 — Package scaffold + DSL → SVG

New workspace package `packages/mcp/`. Adds:

- `package.json` ({ "private": true }, "bin", deps:
  `@modelcontextprotocol/sdk`, `@ingcreators/annot-annotator`,
  `@napi-rs/canvas`, `playwright-core`, `pixelmatch`).
- `src/dsl/types.ts` + `src/dsl/schema.ts` + `src/dsl/to-svg.ts` +
  tests — BOTH `BboxAnnotation` and `LocatorAnnotation` shapes
  authored upfront (locator-resolution path is empty for now;
  the DSL just describes the union).
- A do-nothing `src/server.ts` that constructs an MCP server
  with zero tools registered, just enough to validate the
  `@modelcontextprotocol/sdk` integration.

**Verification:** typecheck / test / lint green; `pnpm --filter
@ingcreators/annot-mcp build` produces a runnable bin.

### Phase 2 — `annot_annotate_screenshot`

The bbox baseline. Wires up:

- `src/tools/annotate-screenshot.ts` + test.
- DSL parsing via Phase 1's schema (BboxAnnotation flavour).
- Image input resolution (data URL → bytes; absolute path → bytes).
- Width/height extraction from PNG IHDR (reuses the same helper
  the Playwright fixture uses — promote to shared if not already).
- `createAnnotator()` call.
- MCP `content` block emission.

**Verification:** the in-memory transport test produces a valid
PNG from `{ type: "rect", bbox: { ... }, intent: "error" }`
against a fixture screenshot.

### Phase 3a — `playwright-core` integration + locator resolution

Introduces the browser-side infrastructure that both `_url` tools
need. No new MCP tools land here — the user-visible surface is
unchanged, but the internal capability matures.

- `src/browser/capture.ts` — launch `playwright-core` Chromium,
  goto, screenshot, return PNG bytes + a `Page` handle for
  follow-up locator resolution. Browser instance pooling
  (reuse one Chromium across N calls within a 30-second idle
  window) lives here.
- `src/browser/resolve-locator.ts` — `resolveLocator(page,
  locatorString): Promise<BBox>` plus the non-rect adaptation
  rules (circle / arrow / text / callout) documented in the DSL
  section.
- "Chromium not installed" error path: when `chromium.launch()`
  fails, the tool returns a structured error with `install_hint:
  "Run: npx playwright install chromium"` so agents can surface
  the actionable next step.

**Verification:** unit tests for `resolveLocator` against a
synthetic fixture page (HTML string → `page.setContent` →
locator resolution → bbox assertion). CI runs in headless mode
with Chromium pre-installed via the existing Playwright
test infrastructure (the monorepo already has Playwright
installed transitively via `@ingcreators/annot-playwright`'s
peer-dep — Phase 3a piggy-backs on the same Chromium runtime).

### Phase 3b — `annot_annotate_url`

The headline locator-first tool. Wires up:

- `src/tools/annotate-url.ts` + test.
- LocatorAnnotation parsing (the locator flavour from Phase 1's
  DSL).
- Compose Phase 3a's `capture` + `resolveLocator` with Phase 2's
  delegate-to-bbox path: capture → resolve every locator → swap
  locators for bboxes → call the SVG conversion → rasterise.
- Structured error surface for locator-resolution failures
  (zero matches, multiple matches, out-of-viewport).

**Verification:** in-memory transport test against a fixture
page asserts an `annot_annotate_url` call with locator-only
annotations produces a valid PNG and that an unresolvable
locator produces a structured error tool result (not a thrown
exception).

### Phase 4 — `annot_redact_screenshot` + `annot_redact_url`

Bundled because both need the same redact-burn primitive over
`@napi-rs/canvas`. Adds:

- `src/tools/redact-screenshot.ts` + test (bbox-only regions).
- `src/tools/redact-url.ts` + test (reuses Phase 3a's capture +
  locator-resolve, then delegates to the screenshot variant's
  burn path).
- Redact-burn primitive at `src/redact/burn.ts` (~100 LOC over
  `@napi-rs/canvas`; mirrors `@ingcreators/annot-render`'s
  `burnRedactionsIntoBitmap` but pure-Node).

### Phase 5 — `annot_compare_screenshots`

`pixelmatch` for the per-pixel diff; an aggregator (in-tree, ~50
LOC) extracts bounding rectangles per contiguous changed region;
composes through `annot_annotate_screenshot`'s internal path
with `intent: "warning"` rects.

### Phase 6 — `annot_export_pptx` (gated)

Gated on the pptx-export `ImageRecord[]`-driven refactor flagged
in CLAUDE.md §2. If that refactor lands before Phase 6, this
phase slots in. If not, defer indefinitely — the other five
tools cover the headline workflows. Phase 7 (docs/release prep)
can ship without Phase 6.

### Phase 7 — Docs + Claude Desktop recipe + release prep

- `packages/mcp/README.md` — installation, Chromium one-time
  install note, config snippet, six (or five if Phase 6 deferred)
  tool reference sections, two end-to-end transcripts (the
  locator-first standalone workflow + the playwright-mcp
  composition workflow).
- Top-level docs entry — short "Working with AI agents" guide
  under `docs/` linking to the package README.
- Changesets entry — `0.1.0` initial version.
- Move this plan to `_done/` and update `docs/plans/README.md`.

### Phase 8 — First npm publish (gated)

Gated on [`headless-annotator-publish.md`](./headless-annotator-publish.md).
**Prep work landed**: that plan's "package flips" table now lists
`@ingcreators/annot-mcp` as a fourth publishable package, so when
the operator runs the publish workflow with `workflow_dispatch`,
the MCP package ships alongside `annot-core` / `annot-annotator` /
`annot-playwright` via the same Changesets pipeline.

**Remaining operator-driven steps (not autonomous):**

1. Land [`headless-annotator-publish.md`](./headless-annotator-publish.md)'s
   Vite library build wiring + per-package metadata flips +
   `publish.yml` workflow (its Stages 1–3).
2. Flip `packages/mcp/package.json`'s `"private": true` →
   `"private": false`. The `publishConfig` block already contains
   the `dist/` entry-point mapping needed for the published
   tarball.
3. Write a Changeset entry: `pnpm changeset` → pick
   `@ingcreators/annot-mcp` → version `0.1.0` → describe the
   initial publish.
4. Run `pnpm changeset version` (rolls up the pending changesets),
   commit the resulting version bumps + CHANGELOG entries.
5. Trigger the publish workflow via `gh workflow run publish.yml`
   (or the GitHub UI). The workflow runs `pnpm changeset publish`
   under `NPM_TOKEN` for the first publish, falling back to
   Trusted Publishing (OIDC) on subsequent releases.
6. After the first publish succeeds, move this plan to `_done/`
   and update [`docs/plans/README.md`](./README.md).

**This is the schema-freeze gate:** breaking changes after the
first publish require a major bump.

## Verification

Per the landing rules:

- `pnpm -r typecheck` green.
- `pnpm test` green; per-tool tests in the count.
- `pnpm lint` exit 0.
- `pnpm --filter @ingcreators/annot-mcp build` green; `npm pack`
  output reviewed (files allowlist + entry-point resolution).
- MCP Inspector validates the four tool schemas (manual gate).
- Claude Desktop end-to-end transcript runs successfully against
  a real staging URL (manual gate at Phase 5).

## Migration notes

None — new package. Existing consumers of `@ingcreators/annot-annotator`
and `@ingcreators/annot-playwright` see no API change.

## Resolved decisions

Locked in during 2026-05-20 plan review with the user. These
inform the phases above:

1. **`@napi-rs/canvas` dependency accepted.** The ~80 MB
   postinstall is acceptable for the redact / diff tools. No
   `@ingcreators/annot-mcp-extras` split needed.
2. **PNG-only output at v1.** No JPEG knob; no `sharp`
   dependency. Revisit only if a concrete agent workflow needs
   JPEG.
3. **Image input: data URL + filesystem path only.** No
   `resource://` URI support at v1. Add later if it composes
   cleanly with how the upstream MCP ecosystem evolves.
4. **Tool naming: `annot_*` prefix locked in.** Verbose but
   discoverable in flat tool listings; consistent across all six
   tools.
5. **Locator-first is a v1 feature, not a "later" follow-up.**
   `playwright-core` is bundled as a regular `dependencies` entry
   and `_url` tool variants ship in Phase 3 (before the npm
   publish in Phase 8). Pre-publish breaking changes to the DSL
   are accepted; post-publish breaking changes require a major
   bump.

## Open questions

Flagged for resolution during the relevant phase's review, not
blockers for the plan landing as Draft:

1. **Chromium runtime install UX.** `playwright-core` ships with
   no browser binaries; the user runs `npx playwright install
   chromium` once (~150 MB download). Three sub-options:
   (a) Document the install step in the README only — friendly
   error on first `_url` tool call points to the command. (b)
   Run `npx playwright install chromium` ourselves in `postinstall`
   — heavyweight, slows `npx @ingcreators/annot-mcp@latest`.
   (c) Detect missing Chromium AND offer to install via a
   prompted MCP tool (`annot_install_browser`) — interactive.
   **Default at Phase 3a: option (a).** Revisit if user-friction
   reports surface.
2. **Browser instance pooling lifetime.** Reusing a single
   Chromium across `_url` tool calls saves ~500 ms per call but
   holds ~150 MB of RAM idle. Default at Phase 3a: 30-second
   idle timeout, killed on `SIGINT`/`SIGTERM`. Tunable via env
   var if the default doesn't fit.
3. **`annot_annotate_url` `cookie` / `localStorage` injection.**
   For locator-first workflows against authenticated pages, the
   agent may need to seed cookies / storage before the goto.
   Defer to a Phase 3b follow-up if a concrete workflow lands;
   the agent can also use `@playwright/mcp` for that path and
   feed the resulting PNG into `annot_annotate_screenshot`
   (Transcript B above).
4. **`annot_compare_urls`** — explicit URL-pair compare tool vs
   composition of two `annot_annotate_url` calls + one
   `annot_compare_screenshots`. Composition keeps timing
   semantics clear, so the explicit tool stays deferred. Revisit
   if agents struggle with the composition.

## References

- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — strategic
  vector for headless / Playwright / agent integration.
- [`_done/annot-annotator-package.md`](./_done/annot-annotator-package.md)
  — Phase 1 of the headless-annotator track.
- [`_done/annot-playwright-fixture.md`](./_done/annot-playwright-fixture.md)
  — Phase 2 of the headless-annotator track; this plan reuses
  the SVG-fragment helpers.
- [`headless-annotator-publish.md`](./headless-annotator-publish.md)
  — Phase 3 (publish). Phase 6 of this plan piggy-backs on the
  Changesets pipeline that lands there.
- [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md) — for
  context on where Cloud-hosted MCP would slot in if/when
  demand surfaces post-launch.
- Upstream `@playwright/mcp`:
  https://github.com/microsoft/playwright-mcp
- Model Context Protocol spec: https://modelcontextprotocol.io/
