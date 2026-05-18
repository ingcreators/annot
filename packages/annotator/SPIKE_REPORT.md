# Phase 0 spike — findings

> Plan: [`docs/plans/headless-annotator-spike.md`](../../docs/plans/headless-annotator-spike.md)

## Summary

**The spike succeeded.** The Node-side rasterisation path works via
`@resvg/resvg-js`; the Tier-A invariant holds when `annot-core/headless`
and `resvg-js` load in the same Node process. The two documented gaps
(font rendering parity and JPEG round-trip) are real but tractable —
neither is a Phase-1 blocker.

The recommendation is to **proceed with Phase 1** (`@ingcreators/annot-annotator`
public package) on the spike's foundation.

## Question 1 — Can the Node-side rasterisation path work?

**Answer: yes, via `@resvg/resvg-js`.**

- `Resvg(svgString).render().asPng()` returns a `Buffer` (which
  extends `Uint8Array`); no Canvas API, no `URL.createObjectURL`,
  no DOM polyfill required.
- The same SVG-string construction the browser-side
  `renderImageRecord` uses ports verbatim — it's pure string
  concatenation. The browser-only parts (`new Image()` +
  `<canvas>` + `FileReader`) collapse to a single call to
  `resvg.render()`.
- Embedded `data:image/png;base64,...` base images resolve
  natively under resvg-js without any `imagesToResolve()`
  callback. Verified by [`render.test.ts`](src/render.test.ts):
  the spike tests round-trip a hand-crafted 4×4 transparent
  PNG through the renderer.
- `<defs>` with `<linearGradient>` + `<marker>` resolve
  correctly. `fill="url(#grad-1)"` and `marker-end="url(#arrow-1)"`
  on annotation children pick up the def-side definitions.
  Verified by the "gradient + marker reference shape" test.

## Question 2 — Does the Tier-A invariant hold under plain Node?

**Answer: yes.**

- [`headless-coexistence.test.ts`](src/headless-coexistence.test.ts)
  imports `@ingcreators/annot-core/headless` and
  `@resvg/resvg-js` in the same test file. The vitest config
  pins `environment: "node"` globally — V8 only, no jsdom, no
  happy-dom. Both modules load and their public surface is
  callable. `typeof globalThis.document === "undefined"` and
  `typeof globalThis.window === "undefined"` are asserted
  inside the test.
- The pre-existing
  [`packages/core/src/headless.test.ts`](../../packages/core/src/headless.test.ts)
  continues to pass — no regression to the headless surface.

## Documented gaps (Phase 1+ follow-ups, not blockers)

### Gap A — Font rendering parity

resvg-js exposes a `font` option (`loadSystemFonts` /
`fontFiles` / `fontDirs`) that delegates glyph resolution to the
OS or to explicit font files. Today the spike does NOT register
any fonts — `loadSystemFonts` falls back to its default
(`true`), which means text renders with whatever the runner OS
has installed.

Implications:

- **CJK / Arabic / Indic / Thai glyphs are unreliable on stock
  CI images** (GitHub Actions' `ubuntu-latest` ships a thin
  Latin font set). The
  [`multilingual-fonts-os-stack`](../../docs/plans/_done/multilingual-fonts-os-stack.md)
  story — logical tokens (`Annot Sans` etc.) interleaving
  per-script families — is a browser-side CSS concept; resvg
  doesn't reproduce it. Glyphs that don't resolve render as
  tofu (□) or empty space depending on the resvg version.
- **Recommendation for Phase 1**: ship a small `fontFiles`
  option on the public API so callers can register their own
  fonts. For Annot's own CI, bundle a permissively-licensed
  CJK subset (e.g. Noto Sans + Noto Sans JP) as a devDep and
  pass `fontFiles` for the test suite. End-user fixture
  parity with the browser version is a Phase 2 concern (or
  later); for the headline Playwright use case, "developer
  passes their app's fonts" is the model.

### Gap B — JPEG output

`resvg-js` is PNG-only. The browser-side `renderImageRecord`
auto-converts back to JPEG via Canvas
([`render-image-record.ts:87-104`](../../packages/render/src/render-image-record.ts))
when the source `originalDataUrl` is a JPEG.

Implications:

- The Node port needs `sharp` (or `jpeg-js`, or `@napi-rs/canvas`)
  to pipe PNG bytes → JPEG bytes for callers who need to
  preserve the original format.
- **Recommendation for Phase 1**: design the public API to
  return either a `Buffer` (PNG, default) or `{ format:
  "jpeg", quality: 0.92 }`-style options. Pull `sharp` in as
  an optional peer dep, lazy-load it, fall through to "PNG
  only" if it isn't installed. This keeps the base install
  size small for Playwright users who only need PNG.

### Gap C — Light SVG sanitisation

The browser-side `sanitiseRenderDefs` in
[`packages/render/src/render-image-record.ts`](../../packages/render/src/render-image-record.ts)
strips the editor's `data-annot-fonts` `<style>` block before
rendering. The spike skips this because the spike's input is
hand-built (no `data-annot-fonts`). Phase 1 needs a small
XML walker (likely `@xmldom/xmldom` or `node-html-parser` —
both pure JS, both Tier-A-clean) to do the same sanitisation
on real editor output before passing to resvg.

## Rasteriser comparison — why `@resvg/resvg-js` over `@napi-rs/canvas`

The plan listed both as candidates. The spike picks resvg-js
based on:

| Criterion | `@resvg/resvg-js` | `@napi-rs/canvas` |
|---|---|---|
| API shape | Pure `(svg) => Buffer` | Canvas API; needs `loadImage` + manual `drawImage` |
| Tier-A purity | Native addon, no globals | Native addon; some implicit `document`-ish surface (e.g. `canvas.createCanvas`) |
| SVG feature coverage | High (Mozilla resvg upstream) | Medium (depends on Skia's SVG parser) |
| Install footprint | ~5 MB native addon | ~30 MB Skia native addon |
| Cross-platform prebuilts | Linux x64/arm64, macOS x64/arm64, Win x64 | Same |
| Maintenance | Single maintainer (Yisi); active | Brooooooklyn / NAPI-RS team; very active |

Resvg-js wins on Tier-A purity and install footprint. The
trade-off is no Canvas API for callers that want to do their
own drawing on top of the annotated bitmap — but that's not
a use case for the Playwright fixture. If it becomes one later,
adding `@napi-rs/canvas` as an optional second backend is
straightforward.

## Recommended Phase 1 scope

Based on the spike, Phase 1 should:

1. Promote `packages/annotator/` from `private: true` to a
   real published package: rename to
   `@ingcreators/annot-annotator`, drop `private`, set up
   `files` allowlist + `exports` map.
2. Design the public API around `ImageRecord` shape instead of
   the spike's loose `(dataUrl, innerXml, w, h)` tuple. Likely
   `createAnnotator()` returns an object with `annotate(record:
   ImageRecord): Promise<Buffer>` and `annotate(record:
   ImageRecord, { format: "jpeg" | "png" }): Promise<Buffer>`.
3. Add a small XML walker for sanitisation (Gap C). Reuse
   `sanitiseRenderDefs`-equivalent logic from
   `packages/render/src/render-image-record.ts` ported to
   the chosen parser.
4. Add `fontFiles` registration option on the public API
   (Gap A).
5. Wire optional `sharp` dep for JPEG output (Gap B).
6. Migrate the spike's tests into the package's contract
   test suite; add tests against real `ImageRecord` fixtures
   loaded from the existing render package's golden files.

Phase 2 (`@ingcreators/annot-playwright`) builds on top of
the Phase 1 surface — no new rasterisation work.
