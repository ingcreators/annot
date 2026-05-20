# Puppeteer support for `@ingcreators/annot-mcp`

> **Status:** Draft — memo only. No implementation work scheduled.
>   Flip to `Queued` only when a concrete consumer signals intent
>   (e.g. an org standardised on Puppeteer asks for support, or a
>   Firefox-via-Puppeteer use case lands).
> **Compatibility:** Builds on the engine-agnostic structural
>   interfaces already in
>   [`packages/mcp/src/browser/`](../../packages/mcp/src/browser/)
>   that landed with
>   [`_done/`-ish `agent-mcp-integration.md`](./agent-mcp-integration.md)
>   Phase 3a. No DSL or tool-schema changes; the agent-facing
>   surface stays identical.
> **Risk:** Low. The MCP package's tools already abstract on
>   `PageLike` / `LocatorLike`; adapter selection is opt-in via
>   one server option. Failure mode is "user's chosen engine isn't
>   installed" — handled by the same friendly-error path that
>   already exists for missing Chromium.

## Why this plan exists

[`agent-mcp-integration.md`](./agent-mcp-integration.md) shipped
five MCP tools, two of which (`annot_annotate_url` /
`annot_redact_url`) drive a headless browser via `playwright-core`.
The decision to bundle `playwright-core` was deliberate — locator
grammar in the DSL was designed for Playwright's locator API.

Three plausible future scenarios push toward Puppeteer support:

1. **Org-standardised toolchain.** A potential
   [`@ingcreators/annot-cloud`](./annot-cloud-roadmap.md)
   customer already has Puppeteer everywhere and wants Annot's
   MCP server to fit into the existing CI / agent
   infrastructure without bringing a parallel browser
   automation dep.
2. **Firefox / WebKit captures via Puppeteer.** Puppeteer's
   Firefox support has matured (since 2023); some agents want
   to annotate Firefox-rendered captures specifically (font
   differences, vendor-prefixed CSS, etc.). Playwright also
   supports cross-browser, so this isn't unique — but having
   both adapters means we cover both upstream agent ecosystems.
3. **System-Chrome captures (`channel: "chrome"` UX).**
   Puppeteer's UX around "use the installed Chrome binary
   instead of bundled Chromium" is more established. Some
   corporate environments only permit the installed system
   browser.

None of these scenarios is urgent. This plan stays Draft until
one of them shows up as a concrete user ask.

## Design

### What's already engine-agnostic

The Phase 3a infrastructure in
[`packages/mcp/src/browser/`](../../packages/mcp/src/browser/)
was structurally interfaced from the start:

```ts
// pool.ts — fully generic
interface BrowserLauncher { launch(): Promise<BrowserLike>; }
interface BrowserLike     { close(): Promise<void>; }

// resolve-locator.ts — structural Page interface
interface PageLike    { locator(s): LocatorLike; }
interface LocatorLike { boundingBox(): Promise<BBox | null>; }
```

The concrete `createChromiumPool()` is the **only** Playwright-
specific concrete factory. `BrowserPool`, `capturePage()`,
`resolveLocatorAnnotation()`, and every tool handler operate on
the structural interfaces.

This means the Puppeteer adapter is **additive** — slot a new
factory next to `createChromiumPool()`, no refactoring required.

### Proposed file layout

```
packages/mcp/src/browser/
├── pool.ts                       (existing — unchanged)
├── capture.ts                    (existing — unchanged)
├── resolve-locator.ts            (existing — unchanged)
└── adapters/
    ├── playwright.ts             (move createChromiumPool here;
    │                              re-export from pool.ts)
    └── puppeteer.ts              (NEW — createPuppeteerChromiumPool)
```

The existing `createChromiumPool()` re-export keeps the public
API stable; `pool.ts` becomes a thin barrel.

### Engine selection

Add one option to `createServer()`:

```ts
export interface CreateServerOptions {
  // ...existing options...
  /**
   * Which browser engine drives the `_url` tools. Defaults to
   * `"playwright"` (matches v0.1.x behaviour). Set to
   * `"puppeteer"` to use `puppeteer-core` instead — useful for
   * environments standardised on Puppeteer, or for Firefox /
   * system-Chrome captures via Puppeteer's launch UX.
   *
   * Either engine's package must be installed (declared as
   * `optionalDependencies` on `@ingcreators/annot-mcp`).
   */
  engine?: "playwright" | "puppeteer";
}
```

Auto-detect logic: if the user passes a pre-built `pool` (tests,
embedding), skip detection. Otherwise:

1. Honour explicit `engine` opt.
2. If unset, try the configured default (initially `"playwright"`).
3. If that engine's package fails to load, fall back to the
   other and emit an info log (not an error — many CI setups
   only have one).
4. If neither loads, the friendly `ChromiumUnavailableError`
   surfaces with both install commands.

### Dependency hygiene

```jsonc
// packages/mcp/package.json delta
{
  "dependencies": {
    // ... existing entries minus playwright-core ...
  },
  "optionalDependencies": {
    "playwright-core": "^1.50.0",
    "puppeteer-core": "^22.0.0"
  }
}
```

Moving `playwright-core` from `dependencies` to
`optionalDependencies` is a **packaging change**, not a code
change — the dynamic import in `createChromiumPool()` already
handles "not installed" gracefully.

Risk note: existing v0.1.x consumers that installed
`@ingcreators/annot-mcp` expecting `playwright-core` to come
along will need to add it explicitly post-migration. Mitigation
options:

- (A) Document in CHANGELOG that `npm install playwright-core`
  is now required (clean break, minor bump from 0.1.x → 0.2.0).
- (B) Keep `playwright-core` in `dependencies` AND add
  `puppeteer-core` in `optionalDependencies` — heavier install
  but no migration pain. Drop `playwright-core` from
  `dependencies` later if it becomes load-bearing for many
  users.

Default: **option (B)** at first ship, **option (A)** at the
v0.2.0 cut. Both compatible with the locator-DSL freeze.

### Locator grammar compatibility

The Annot DSL was designed around Playwright locator strings —
`text=`, `role=`, `[data-testid=...]`, `>>` chains,
`:has-text()`, etc.

Puppeteer compatibility:

| Locator form | Playwright | Puppeteer 22+ | Notes |
|---|---|---|---|
| CSS (`button.primary`) | ✓ | ✓ | Both |
| `text=Submit` | ✓ | ✓ | Puppeteer 22+ `page.locator(s)` (Playwright-style) |
| `role=button[name="Sign in"]` | ✓ | ✓ | Puppeteer 22+ |
| `:has-text("Submit")` | ✓ | ✓ | Puppeteer 22+ |
| Chained `>>` | ✓ | ⚠ | Partial — needs verification |
| `nth=N` modifier | ✓ | ⚠ | Differs slightly |

**Strategy:** target Puppeteer 22+ (`page.locator()` API).
Document the small `>>` / `nth=` divergences in the README
with the migration test fixtures. Don't ship a translation
layer — too brittle, too much surface to maintain.

### Capture API differences

| Operation | Playwright | Puppeteer | Adapter delta |
|---|---|---|---|
| Launch | `chromium.launch({ headless: true })` | `puppeteer.launch({ headless: "new" })` | Trivial |
| Context | `browser.newContext({ viewport })` | `browser.createBrowserContext()` + `page.setViewport()` | Slight |
| Goto | `page.goto(url, { waitUntil })` | `page.goto(url, { waitUntil })` | Identical |
| Screenshot | `page.screenshot({ fullPage, type })` | `page.screenshot({ fullPage, type })` | Identical |

The `newContext` divergence is the biggest — Puppeteer's
context model is less granular. The adapter sets viewport at
the page level after creation.

## Phased plan

**Each step its own PR. Total: 3 small PRs.**

### Phase 1 — Extract Playwright adapter, no behavioural change

- Move the body of `createChromiumPool()` from
  [`packages/mcp/src/browser/pool.ts`](../../packages/mcp/src/browser/pool.ts)
  into `packages/mcp/src/browser/adapters/playwright.ts`.
- Re-export from `pool.ts` to preserve the public surface.
- No tests change.

**Verification:** `pnpm -r typecheck` / `pnpm test packages/mcp`
/ `pnpm lint` / `pnpm --filter @ingcreators/annot-mcp build` all
green; byte-identical `dist/index.js` (rollup-types may differ
by file ordering — review for noise only).

### Phase 2 — Puppeteer adapter + engine option

- Add
  [`packages/mcp/src/browser/adapters/puppeteer.ts`](../../packages/mcp/src/browser/adapters/puppeteer.ts):
  `createPuppeteerPool()` factory mirroring the Playwright
  shape over `puppeteer-core` 22+.
- Update [`capture.ts`](../../packages/mcp/src/browser/capture.ts)
  if the structural `PlaywrightContextLike` interface needs
  one-line adjustments for Puppeteer's context model.
  Empirically: the structural typing already covers both via
  duck typing; no change expected.
- Extend `CreateServerOptions` with `engine?: "playwright" |
  "puppeteer"` + auto-detect logic.
- Add `optionalDependencies: { puppeteer-core: "^22.0.0" }`.
- Tests: a stub puppeteer Browser parallel to the Playwright
  stub in `pool.test.ts`; round-trip
  `resolveLocator(page, ...)` against it to assert structural
  compatibility.

**Verification:** same gate set as Phase 1. Manual smoke:
```sh
ANNOT_MCP_ENGINE=puppeteer npx @ingcreators/annot-mcp
```
(env var → server option pass-through, optional)

### Phase 3 — Docs + version bump

- [`packages/mcp/README.md`](../../packages/mcp/README.md):
  add "Choosing a browser engine" section right after the
  Installation block. Document the matrix of locator grammar
  differences. Include both `npx playwright install chromium`
  and `npx puppeteer browsers install chrome` install commands.
- [`docs/ai-agents.md`](../ai-agents.md): one-line addendum
  pointing at the engine choice section.
- Changeset: `minor` bump (0.1.x → 0.2.0) IF Phase 2 also
  moves `playwright-core` to `optionalDependencies`; `patch`
  otherwise.

**Verification:** README links resolve; CHANGELOG entry
generated.

## Verification (whole-track)

- Two end-to-end manual smoke runs: one with `engine:
  "playwright"`, one with `engine: "puppeteer"`. Both produce
  the same annotated PNG against
  [`packages/annotator/README.md`](../../packages/annotator/README.md)'s
  test fixture page.
- `npm pack --dry-run` shows the new adapter source in the
  published tarball.
- Both engines' install errors surface as the friendly
  `ChromiumUnavailableError` (text differs per engine).

## Open questions

1. **Default engine when both are installed.** Probably
   `"playwright"` for back-compat with v0.1.x. Could surface a
   warning if both are detected but the user didn't specify.
2. **Firefox support.** Puppeteer's Firefox support is mature
   enough to expose, but it requires `puppeteer.launch({
   browser: "firefox" })`. Out of scope for v0.2.0 — add as a
   v0.3.x follow-up if the demand is concrete.
3. **WebKit support via Playwright.** Same — out of scope for
   the Puppeteer plan; if someone asks, add a Playwright-side
   `browser: "webkit"` option.
4. **CDP-level access escape hatch.** Should the MCP package
   expose a "give me the raw browser handle" knob for
   power users to extend? Probably not — that's what writing
   your own MCP server is for. Keep the API narrow.

## References

- [`agent-mcp-integration.md`](./agent-mcp-integration.md) —
  parent plan; this is its v0.2.x follow-up.
- [`packages/mcp/src/browser/`](../../packages/mcp/src/browser/)
  — the structural interfaces that make this plan cheap.
- Puppeteer 22 release notes: locator API parity with
  Playwright (the unlock that makes this plan viable).
- [`docs/plans/annot-cloud-roadmap.md`](./annot-cloud-roadmap.md)
  — one of the consumers that might surface this need.
