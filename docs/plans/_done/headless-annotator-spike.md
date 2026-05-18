# Headless annotator spike

> **Status:** Done — landed [`#750`](https://github.com/ingcreators/annot/pull/750) 2026-05-18
> **Compatibility:** New package `@ingcreators/annot-annotator`
>   (private during spike). Reads from `@ingcreators/annot-core` +
>   `@ingcreators/annot-render`. Does **not** touch the PWA, the
>   extension, the desktop host, or the VSCode host.
> **Risk:** Spike — single landing. The deliverable is a feasibility
>   report + a small runnable proof, not a production package. No
>   data migration. No schema changes. No `StorageProvider` changes.

## Context

Phase 0 of the Playwright / headless productization track. The
strategic goal — `@ingcreators/annot-annotator` (Node-side public
API) plus `@ingcreators/annot-playwright` (Playwright fixture) — is
the largest single source of leverage in the productization
roadmap (see [Annot Productization Readiness Roadmap](
../../../C--Users-ichim-workspaces-annot/memory/MEMORY.md) at
`~/.claude/plans/annot-refactored-eclipse.md`). Before committing
to that scope, we need to know two things that can only be
answered by running code, not by reading source:

1. **Can the existing `@ingcreators/annot-render` rasterisation
   path run in Node?** [`packages/render/src/render-image-record.ts`](../../packages/render/src/render-image-record.ts)
   uses `new Image()` + `document.createElement("canvas")` +
   `URL.createObjectURL` + `FileReader` — all browser-only. A
   Node port needs a different rasteriser. The two realistic
   candidates are
   [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) (Mozilla
   resvg via NAPI; pure SVG → PNG; no Canvas API) and
   [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)
   (Skia-backed Canvas API with `drawImage` SVG support). The
   spike picks one with eyes open.
2. **Does the headless-by-construction
   [`packages/core/src/headless.test.ts`](../../packages/core/src/headless.test.ts)
   invariant actually hold under `node --no-warnings`?** The
   test runs under Vitest's jsdom-or-happy-dom-influenced
   environment today; running an explicit Node-only smoke
   confirms `@ingcreators/annot-core` + `@ingcreators/annot-core/storage`
   + `@ingcreators/annot-core/utils` import cleanly with no
   browser polyfills. The Tier-A boundary that
   `PRODUCT_DIRECTION.md` P2 commits to has been an aspiration;
   the spike turns it into a verified fact.

Two known-hard sub-problems to surface (not solve) during the
spike:

- **Font rendering parity**. The
  [`multilingual-fonts-os-stack`](./_done/multilingual-fonts-os-stack.md)
  design relies on the OS resolving logical tokens (`Annot Sans`
  etc.) per script. In a browser this resolves through CSS
  per-codepoint font selection; under `resvg-js` we get whatever
  the system fonts directory provides — almost certainly no CJK
  on a stock CI image. The spike documents the gap. It does NOT
  ship a fix; that's a follow-up plan.
- **PNG ↔ JPEG round-trip parity**. The current renderer paints
  a white background + redraws to JPEG via Canvas
  ([`render-image-record.ts:87-104`](../../packages/render/src/render-image-record.ts)).
  `resvg-js` only outputs PNG; the Node port would need to pipe
  through `sharp` or similar for JPEG. The spike documents the
  cost.

## Design

### Spike deliverable shape

One new private workspace package, `packages/annotator/`, with
`package.json` marked `"private": true` and **not** listed in the
public npm `files` field. Two source files:

```
packages/annotator/
├── package.json                   # private, devDeps only
├── src/
│   ├── render.ts                  # the Node-side renderImageRecord
│   └── render.spike.test.ts       # one round-trip integration test
└── tsconfig.json
```

The package depends on `@ingcreators/annot-core` (Tier A) and
optionally `@ingcreators/annot-render` for the SVG-stringifying
half of `renderImageRecord` if we can refactor it out, or
duplicates that string-building inline (it's ~40 lines).

### Rasteriser choice — first-cut recommendation: `@resvg/resvg-js`

Reasoning:

- Lighter dep tree (one native addon vs Skia's heavier
  installation).
- Direct SVG → PNG path; no Canvas API surface to maintain
  parity against.
- Plays well with the Tier A boundary — `resvg-js` is a pure
  function `(svg: string) => Buffer`. No DOM polyfill, no
  globals, no `URL.createObjectURL`. Imports cleanly in any
  Node version.

Trade-off acknowledged: if a future tool ever needs to draw on a
Canvas API directly from Node (e.g. for some complex composite
that resvg can't render), we'd revisit. For the spike that
contingency is unlikely.

### Test surface

One integration test that:

1. Loads a fixture `originalDataUrl` (small base64 PNG —
   reuse one from the existing render tests if possible).
2. Builds a representative annotations SVG using the existing
   Tier B helpers (an arrow, a rect, a sticky, a counter — the
   four most common annotation kinds).
3. Calls the spike's Node-side `renderImageRecord` equivalent.
4. Asserts the returned bytes parse as a valid PNG header.
5. Snapshots a hash of the pixel data so a regression in resvg
   produces a visible diff.

Failure modes the test will surface:

- Font fallback for non-Latin tspans (will show as boxes or
  missing glyphs on a stock CI image — captured in the report).
- Gradient / marker `id` resolution under resvg (the existing
  `sanitiseRenderDefs` should keep these intact, but resvg's
  CSS support is partial — the spike confirms which features
  survive).

### Out of scope for the spike

- The public API of `@ingcreators/annot-annotator` —
  `createAnnotator()` etc. Designed in Phase 1, not here.
- The Playwright fixture surface. Phase 2.
- Performance benchmarks. Useful eventually; not gating.
- macOS / Windows / Linux font parity. Documented as a gap;
  not solved here.

## Phased plan

Single phase, single PR. The deliverable is "the report" — a
`SPIKE_REPORT.md` in `packages/annotator/` (or appended to this
plan as a "Spike findings" section). The PR description summarises
the answer to the two questions in Context.

If the spike succeeds:

- Promote this plan to Done; move to `_done/`.
- Author `docs/plans/annot-annotator-package.md` (Phase 1) and
  `docs/plans/annot-playwright-fixture.md` (Phase 2).

If the spike surfaces blockers:

- Move this plan to Done with the findings appended.
- Author `docs/plans/headless-annotator-rasteriser-decision.md`
  (or similar) documenting which path forward (Skia / wasm-only
  build / hold for upstream change) is justified.

## Verification

- `pnpm --filter @ingcreators/annot-annotator typecheck` passes
  in CI on a Node-only runner (no browser).
- The spike test passes locally on Linux / macOS / Windows.
- The pre-existing
  [`packages/core/src/headless.test.ts`](../../packages/core/src/headless.test.ts)
  invariant continues to hold (no regression from the new
  package).
- The PR description quotes resvg-js's reported bytes vs the
  reference browser output for the same fixture (visual diff is
  expected; the size order-of-magnitude should match).

## Migration notes

None — spike package is private and lives alongside the existing
packages. The eventual rename to `@ingcreators/annot-annotator`
+ publish happens in Phase 1, not here.
