# Replace libimagequant with a pure-TS Median Cut + FS dither quantizer

> **Status:** Draft. Authored 2026-05-20 to remove Annot's only
> GPL-3.0-or-later dependency
> ([`packages/imagequant/`](../../packages/imagequant/), the
> in-tree wasm-bindgen wrapper around
> [ImageOptim/libimagequant](https://github.com/ImageOptim/libimagequant))
> by replacing it with a self-contained TypeScript implementation
> of Median Cut + Floyd–Steinberg dithering.
>
> **Why this matters for commercial use.** Annot's planned
> commercial cloud ([`oss-cloud-split.md`](./oss-cloud-split.md)
> + [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md))
> distributes the PWA bundle to end users. As long as the bundle
> embeds the GPL-3.0-or-later WASM blob, the *combined work* the
> user receives is subject to GPL-3.0-or-later — which is
> incompatible with shipping a proprietary `annot-cloud` UI on
> top of OSS `annot`. The choices to resolve this are: (a) buy a
> commercial libimagequant licence, (b) move PNG-8 encoding
> server-side, (c) replace the quantizer with permissively-
> licensed code. This plan picks (c) and additionally removes a
> whole workspace package + the Rust / wasm-pack CI pipeline,
> which is aligned with the supply-chain hygiene argument that
> drove the original
> [`_done/vendor-libimagequant.md`](./_done/vendor-libimagequant.md)
> work.
>
> **Compatibility:** two call sites need updating, both inside
> the monorepo:
>
> - [`packages/core/src/encode/index.ts`](../../packages/core/src/encode/index.ts)
>   — the PWA / extension / desktop client capture pipeline.
>   Direct (static) import; WASM eagerly loaded.
> - [`packages/annotator/src/encode/quantize.ts`](../../packages/annotator/src/encode/quantize.ts)
>   — the headless-annotator (Node) PNG-8 path, also used
>   transitively from [`@ingcreators/annot-mcp`](../../packages/mcp/).
>   **Dynamic-import boundary with graceful fallback** today:
>   the WASM ships as a regular `dependencies` entry but is
>   `import()`-ed lazily so a consumer who `npm uninstall`s the
>   package to avoid GPL contamination still gets a working
>   `toEncoded()` (the smart-encoder degrades to PNG-32 with
>   `reason: "imagequant-missing"`). The TS replacement makes
>   this dynamic-import dance obsolete — PNG-8 becomes always
>   available, no graceful-fallback path needed.
>
> External APIs (`encodeCapture()`,
> [`Annotator.toEncoded()`](../../packages/annotator/src/annotator.ts),
> the MCP tool signatures) are unchanged. The
> [`isImagequantAvailable()`](../../packages/annotator/src/encode/quantize.ts)
> public export goes away as part of Phase 2 (always-true after
> the swap; pre-release, no external consumers — see
> [`docs/plans/annot-cloud-roadmap.md`](./annot-cloud-roadmap.md)
> for the launch timeline).
>
> **Risk:** Five phases, each independently revertable. Phase 1
> lands the TS quantizer behind a feature flag so the two
> quantizers can be A/B-compared on real fixtures before any
> bytes-in-anger swap.

## Context

### What we are replacing

[`packages/imagequant/`](../../packages/imagequant/) (300-line
wasm-bindgen crate, **published as
`@ingcreators/annot-imagequant@0.1.0` on 2026-05-20** per
[PR #852](https://github.com/ingcreators/annot/pull/852))
exports exactly one function:

```ts
quantize_image(rgba, width, height, max_colors=256)
  → { palette: Uint8Array, indices: Uint8Array }
```

Two call sites today:

| Call site | Import style | Fallback |
|---|---|---|
| [`packages/core/src/encode/index.ts`](../../packages/core/src/encode/index.ts) (`quantizeToPng8`) | static `import init, { quantize_image }` | none — WASM eagerly loaded |
| [`packages/annotator/src/encode/quantize.ts`](../../packages/annotator/src/encode/quantize.ts) (`quantizeRgbaToPng8` / `isImagequantAvailable`) | dynamic `await import(...)` | PNG-32 + `reason: "imagequant-missing"` |

Both feed the output unchanged into
[`encodePng8`](../../packages/core/src/encode/png8.ts) — a 140-line
self-contained PNG-8 file-format encoder (Pako-only dependency)
that is **NOT being replaced** by this plan.

In other words: only the *colour quantization* step is on the
table. The *PNG file format encoding* step stays exactly as-is.

### Existing graceful-fallback contract (annotator / MCP only)

The annotator package already treats imagequant as an
optional, GPL-fenced dependency:

- Marketed as a regular `dependencies` entry but **dynamic-
  imported** inside `quantize.ts` so a tree-shake or
  explicit uninstall is a no-op at static-analysis time.
- `isImagequantAvailable(): Promise<boolean>` lets callers
  decide whether to request `format: "smart"`.
- When unavailable, `toEncoded()` returns a result with
  `reason: "imagequant-missing"` and PNG-32 bytes.
- Test coverage in
  [`packages/annotator/src/encode/encode.test.ts`](../../packages/annotator/src/encode/encode.test.ts)
  exercises both the "imagequant present" and "imagequant
  absent" paths.

Once Median Cut + FS dither lives inside
`@ingcreators/annot-core/encode`, this fallback path is
obsolete — PNG-8 becomes unconditionally available without
GPL exposure. The dynamic-import dance + the
`isImagequantAvailable` export + the `"imagequant-missing"`
reason value all go away in Phase 2.

### Why a pure-TS replacement is realistic for Annot

The
[`isPhotoHeavy`](../../packages/core/src/encode/index.ts) heuristic
upstream of the quantizer routes photo-heavy captures to JPEG /
PNG-24 fallback **before** invoking PNG-8 at all. The quantizer
therefore sees:

- Limited-palette UI screenshots (the dominant case)
- Code-editor screenshots
- Illustrations / icons / line art
- Anti-aliased text with constrained colour ranges

This is exactly the regime where Median Cut + Floyd–Steinberg
dither matches or beats NeuQuant-class alternatives and approaches
libimagequant's quality in subjective comparison. The advanced
features that justify libimagequant on photographic content
(Voronoi-iterated palette refinement, perceptual sRGB-aware
distance, importance maps) buy proportionally less on UI content.

### Why not a WASM-based permissive alternative

`image-rs/color_quant` (NeuQuant, MIT/Apache-2.0) is a natural
in-place replacement that preserves the existing build pipeline.
Considered and rejected because:

- **Supply-chain footprint stays large.** Cargo.lock,
  `pkg/annot_imagequant_bg.wasm`, `scripts/build-wasm.sh`,
  `scripts/verify-wasm.sh`, the `verify-wasm` CI job, the Rust
  toolchain install, the `wasm-pack` version pin — all stay in
  place. The
  [`_done/vendor-libimagequant.md`](./_done/vendor-libimagequant.md)
  work paid the cost of owning a WASM dep because there was no
  serious permissive alternative; if a TS implementation is
  achievable, owning a workspace package solely to host a
  permissive WASM is net negative.
- **Algorithmic fit is worse.** NeuQuant trains a 1D
  self-organizing map and excels on photographic colour
  distributions. UI screenshots have hard colour clusters that
  NeuQuant tends to over-smooth.
- **Bundle size is comparable.** A pure-TS Median Cut +
  FS-dither implementation comes in around 5–10 KB minified.
  The committed WASM blob plus glue is roughly 30–35 KB. The
  pure-TS bundle is smaller, not larger.

### Why not negotiate a libimagequant commercial licence

Considered as a fallback. Drawbacks:

- Recurring cost (libimagequant commercial pricing is per-
  developer / per-project, in the USD low-thousands per year
  range historically). Multiplies as the team grows.
- Couples Annot's release cadence to a third-party licence
  contract.
- Doesn't help the OSS distribution (which still ships the
  GPL-3.0 blob to anyone who downloads `annot` from GitHub).

The TS-replacement route resolves both OSS and commercial
distributions in one move.

## Goals

1. The PNG-8 capture pipeline produces output of subjectively
   equivalent quality to the current libimagequant pipeline for
   Annot's representative screenshot corpus.
2. Annot's distributed bundles (PWA, extension, desktop, VSCode
   extension webview) ship **zero GPL-3.0-or-later code** after
   Phase 3 lands.
3. The `packages/imagequant/` workspace, the Rust / wasm-pack
   toolchain, and the `verify-wasm` CI job are removed
   entirely. CLAUDE.md "Monorepo layout", `.changeset/README.md`,
   and any other docs are updated to match.
4. `@ingcreators/annot-imagequant@0.1.0` on npm is **deprecated**
   via `npm deprecate` with a pointer to the replacement plan
   and the equivalent built-in path. We don't unpublish (npm
   policy + supply-chain etiquette) — we mark it deprecated so
   `pnpm add` surfaces a warning if anyone tries to install it.
5. `encodeCapture()` and `encodePng8()` external behaviour /
   signatures are unchanged. The annotator's
   `Annotator.toEncoded()` external behaviour is unchanged in
   the success case; the `reason: "imagequant-missing"` value
   stops being emitted because PNG-8 is unconditionally
   available. The `isImagequantAvailable()` named export is
   removed (pre-release; no external consumers).
6. The new quantizer is deterministic (same input → same output)
   so PNG-8 fixtures are stable for snapshot tests.
7. Test coverage in
   [`packages/core/src/encode/`](../../packages/core/src/encode/)
   exercises the new quantizer on fixture inputs that mirror the
   existing test corpus.

## Non-goals

- **Photo-mode PNG-8 quality.** The `isPhotoHeavy` fallback
  remains the right answer for photographic content. We do not
  attempt to make the new quantizer competitive with
  libimagequant on photos.
- **Perceptual LAB / γ-correct colour space.** The simplest
  workable Median Cut implementation operates in linear RGBA
  space. We may add perceptual weighting later if Phase 1's A/B
  shows specific failure cases, but it is out of scope for the
  initial landing.
- **Pluggable / swappable quantizer architecture.** The
  pipeline currently has exactly one quantizer; the plan keeps
  that shape.
- **Server-side quantization.** Not pursued; the pipeline stays
  client-side.
- **Performance parity with WASM.** A pure-JS Median Cut on a
  1920×1080 image is expected to take 200–500 ms vs ~100 ms
  for WASM. Acceptable for a save operation; mitigation knobs
  (Web Worker offload) are available if real-world feedback
  surfaces a regression.

## Design

### Algorithm: Median Cut + Floyd–Steinberg

**Quantization step (Median Cut):**

1. Build a flat list of RGBA samples from the input
   ImageData. For images larger than a sample cap (e.g. 1M
   pixels), uniformly subsample to keep histogram construction
   bounded.
2. Place all samples into a single "box" describing the
   minimal axis-aligned bounding cuboid of their RGB
   coordinates (alpha tracked separately).
3. Maintain a priority queue of boxes ordered by population ×
   longest-edge-length. Pop the largest, split along its
   longest edge at the median of that channel's sample
   distribution, push the two halves back.
4. Repeat until the queue holds `max_colors` boxes (≤ 256).
5. Each box's palette entry is the population-weighted mean of
   its samples (RGBA).
6. **Alpha handling:** samples with alpha < threshold (e.g. 16)
   are accumulated into a dedicated transparent palette
   entry (RGB = 0, A = 0). Annot's screenshots are predominantly
   opaque so this rarely fires, but it preserves the
   tRNS-correctness contract that the current libimagequant
   pipeline upholds.

**Remap step (Floyd–Steinberg):**

1. For each pixel in scanline order, find the nearest palette
   entry by Euclidean distance in RGBA space.
2. Compute the quantization error (per-channel residual).
3. Diffuse the error to neighbouring unprocessed pixels with
   FS coefficients (7/16 right, 3/16 below-left, 5/16 below,
   1/16 below-right), clamped to [0, 255].
4. Output one byte per pixel indexing into the palette,
   matching the existing
   [`encodePng8`](../../packages/core/src/encode/png8.ts) input
   contract.

**Determinism:** the priority queue ties are broken by a
deterministic tie-breaker (insertion order) and the histogram
subsample (when used) is generated with a fixed-stride walk,
not RNG. Snapshot tests therefore stay byte-stable.

**Nearest-palette lookup acceleration:** a naïve linear search
over up to 256 palette entries × 2M pixels is ~500 MOPS. To
keep wall-clock under the 500 ms target, the remap step uses
either (a) a per-pixel cache keyed by the RGBA 32-bit value
(since UI screenshots reuse colours heavily), or (b) a small
k-d tree over the palette. Phase 1 will pick whichever
benchmarks better.

### New file: `packages/core/src/encode/quantize-median-cut.ts`

Public API mirrors the current internal contract:

```ts
export interface QuantizeResult {
  palette: Uint8Array; // flat RGBA8 bytes, length = N*4 (1 ≤ N ≤ 256)
  indices: Uint8Array; // one byte per pixel, length = w*h
}

export function quantizeMedianCut(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number,
): QuantizeResult;
```

Pure function. No side effects. No `await`. Synchronous.
Importable from Node and the browser (Tier A, per CLAUDE.md
section 2).

### Call-site shape after migration

`packages/core/src/encode/index.ts` changes from:

```ts
import init, { quantize_image } from "@ingcreators/annot-imagequant";
// ...
await ensureWasm();
const result = quantize_image(pixels, w, h, 256);
```

to:

```ts
import { quantizeMedianCut } from "./quantize-median-cut.js";
// ...
const result = quantizeMedianCut(pixels, w, h, 256);
```

No `await`, no WASM init, no lazy load. `ensureWasm()` and the
`WasmExports` type are deleted.

### Tests

- Pure-function unit tests in
  `packages/core/src/encode/quantize-median-cut.test.ts`:
    - Single-colour input → single-entry palette.
    - 16-colour synthetic checkerboard → palette ≤ 16 entries,
      no dither artefacts (since palette is exact).
    - Gradient input → palette ≤ N entries, sanity-check that
      indices vary smoothly.
    - Alpha mix (50/50 opaque + transparent) → palette
      includes a transparent entry.
- Integration test in
  `packages/core/src/encode/encode.test.ts` (or new) that
  drives `encodeCapture` end-to-end on a fixture PNG and
  asserts the output decodes back to a valid PNG-8 with the
  expected dimensions and a sensible palette size.

### Quality gate

Phase 1's A/B step is the quality gate, not a CI metric. The
PR description for Phase 2 must include side-by-side rendered
output and PNG-8 file size for at least these fixture inputs
(reusing the existing
[`packages/core/src/encode/`](../../packages/core/src/encode/)
fixture corpus where present, adding new fixtures otherwise):

| Fixture | Notes |
|---|---|
| Solid background + black text | Sharp text, near-zero colour diversity |
| Modern web UI (light theme) | Soft gradients, anti-aliased text |
| Modern web UI (dark theme) | Same content, dark theme |
| Code editor screenshot | Syntax-highlighted, monospaced |
| Comic / illustration page | Limited palette, hard edges |
| Mixed UI + embedded small photo | Stress case for `isPhotoHeavy` boundary |
| Long scroll capture (1920×5000+) | Performance + memory pressure |

Subjective quality must be "indistinguishable in normal use"
for the first six fixtures. The scroll fixture is allowed up
to ~1 s of quantization time at full size.

## Phased plan

### Phase 0 — Plan PR (this document)

Land the plan as `docs/plans/replace-libimagequant-with-median-cut.md`
with status `Draft`. User signoff moves it to `Queued`. No
implementation in this phase.

### Phase 1 — TS quantizer + feature-flagged A/B harness

- Add
  `packages/core/src/encode/quantize-median-cut.ts` with the
  algorithm and a deterministic test suite.
- Add a build-time / call-time feature flag to
  `encodeCapture` that selects between the WASM and TS
  quantizers. Default remains WASM for this phase.
- Wire a small developer-only A/B page (Storybook story or
  one-off `apps/`-side route) that runs both quantizers on the
  fixture corpus and renders the output side-by-side with PNG
  byte-size readouts.
- PR description includes the side-by-side grid for the
  fixtures above.

Acceptance: the TS quantizer is callable, tested, and visually
A/B-compared in the PR. No production behaviour has changed.

### Phase 2 — Switch the client-capture default to the TS quantizer

- Flip the feature flag default in
  `packages/core/src/encode/index.ts`.
- Remove the `ensureWasm()` path. Remove the
  `@ingcreators/annot-imagequant` static import.
- Keep `packages/imagequant/` in the workspace untouched for
  one-PR revertability.
- Build sizes (PWA, extension, desktop) recorded in the PR for
  comparison.

Acceptance: production PWA / extension / desktop bundles no
longer load the WASM blob. Smoke-test capture flow in PWA +
extension + desktop. Annotator / MCP path **still uses the
WASM dynamic-import** at this phase (Phase 3 retires it).

### Phase 3 — Switch the annotator / MCP path to the TS quantizer

- In `packages/annotator/src/encode/quantize.ts`, replace the
  dynamic-import dance with a direct call to
  `quantizeMedianCut` from `@ingcreators/annot-core/encode`.
- Remove `isImagequantAvailable()` and its export from
  `packages/annotator/src/index.ts`.
- Stop emitting `reason: "imagequant-missing"` from
  `toEncoded()`. Update the API docs in `annotator.ts` and the
  type union in `EncodeResult` accordingly.
- Update tests in
  `packages/annotator/src/encode/encode.test.ts` — the
  "imagequant absent" branch becomes unreachable; replace with
  a deterministic golden against the TS quantizer.
- Drop `@ingcreators/annot-imagequant` from the
  `dependencies` of `packages/annotator/package.json` and
  (if applicable) `packages/mcp/package.json`.
- Changeset: `minor` bump for both `annot-annotator` and
  `annot-mcp` — public API surface contracts (removed export
  + removed reason value).

Acceptance: `pnpm --filter @ingcreators/annot-annotator test`
+ `--filter @ingcreators/annot-mcp test` pass with no
imagequant in `node_modules` of either workspace. End-to-end
PNG-8 path exercised by `encode.test.ts`.

### Phase 4 — Delete `packages/imagequant/` + deprecate on npm

- Remove the workspace package, the Cargo.lock entries, the
  wasm-pack scripts (`scripts/build-wasm.sh`,
  `scripts/verify-wasm.sh`), the `verify-wasm` CI job, and any
  remaining toolchain installation steps from the root
  workflows.
- Drop `@ingcreators/annot-imagequant` from
  `.changeset/README.md`'s publishable-packages list (back
  down to four: core / annotator / playwright / mcp). Drop
  the matching changeset config entry.
- Update CLAUDE.md "Monorepo layout" to delete the
  `imagequant/` row.
- Update CLAUDE.md "Three-tier package boundary" if the
  imagequant Tier A row is referenced (it is — section 2's
  table).
- Append a one-line "superseded by
  `replace-libimagequant-with-median-cut.md`" addendum to the
  top of [`_done/vendor-libimagequant.md`](./_done/vendor-libimagequant.md).
- **Operator action (manual):** run
  `npm deprecate @ingcreators/annot-imagequant@"*"
  "Replaced by built-in TS quantizer in
  @ingcreators/annot-core@>=NEXT_VERSION. See
  https://github.com/ingcreators/annot/blob/main/docs/plans/_done/replace-libimagequant-with-median-cut.md"`
  from a maintainer account. Document this in the PR
  description so it gets done at merge time, not silently
  forgotten.

Acceptance: `pnpm -r build` passes with no Rust toolchain
installed. `git grep -i imagequant -- ':!docs/plans/_done/'`
returns only addenda. `npm view @ingcreators/annot-imagequant
deprecated` returns the deprecation string.

## Verification (each phase)

- `pnpm -r typecheck` passes
- `pnpm test` passes (note pass count in the commit's
  `Verified:` paragraph)
- `pnpm lint` reports 0 findings
- `pnpm --filter @ingcreators/annot-core build` passes
- For Phase 1 + 2: `pnpm --filter @ingcreators/annot-web
  build` and `pnpm --filter @ingcreators/annot-extension
  build` succeed; bundle-size diff is captured in the PR.
- For Phase 3: `pnpm --filter @ingcreators/annot-annotator
  build` + `pnpm --filter @ingcreators/annot-mcp build`
  succeed with `imagequant` removed from `node_modules`.
- For Phase 4: a `pnpm install` on a fresh clone with no Rust
  toolchain succeeds; `gh workflow view ci` shows no
  `verify-wasm` job.

## Migration notes

- `encodePng8` is unchanged — no PNG-8 file-format work in
  scope.
- The `quantize_image` wasm-bindgen export signature lives in
  exactly one place; after Phase 3 the type is gone and
  nothing references it.
- Output PNG-8 bytes are *not* guaranteed bit-identical with
  the libimagequant output. They are guaranteed to be valid
  PNG-8 with subjectively equivalent rendering on UI content.
- Storage payloads in `ImageRecord` and the extension transfer
  pipeline are unaffected — they store the final PNG bytes,
  not the intermediate palette + indices buffers.

## Decisions

- **TS, not WASM.** Already justified above.
- **Median Cut, not Wu's algorithm.** Wu has slightly better
  theoretical PSNR but a denser implementation
  (3D histogram with running moments). Median Cut hits the
  target quality on Annot's content profile with less code and
  is easier to audit. Wu remains a future-iteration option if
  a fixture shows specific Median Cut weaknesses.
- **Floyd–Steinberg, not ordered dither.** FS is the strict
  superset of quality for the cost; ordered (Bayer) dither
  would visibly tile on UI gradients. Both are roughly the
  same code size.
- **Linear RGB distance for nearest-palette.** sRGB-aware /
  LAB distance is a future optimisation. Linear is the baseline
  every reference Median Cut implementation uses; it's good
  enough for the A/B gate.
- **Sample cap for histogram construction at 1 M pixels.**
  Above that we uniformly subsample. The Median Cut palette is
  determined by the histogram shape, not its absolute count,
  so subsampling above 1 M is essentially free.

## Open questions

- **Should we vendor a reference public-domain Wu
  implementation as the fallback if Median Cut fails the A/B
  gate?** Decision deferred to Phase 1's A/B outcome. If
  Median Cut is good enough on the fixture corpus, no need.
- **Worker offload?** A 1920×5200 scroll capture is expected
  to take ~1 s of pure-JS quantization. If that proves to
  block the save-flow noticeably, a follow-up PR can move the
  quantization into the existing
  [extension offscreen encoder worker](../../packages/extension/)
  path, or into a new dedicated worker for the PWA. Not in
  scope for the initial three-phase landing.
- **Should `_done/vendor-libimagequant.md` be archived
  differently?** The current convention leaves landed plans
  in `_done/`. The libimagequant vendoring was the right call
  *at the time*; this plan supersedes it because the
  trade-off has shifted (commercial-cloud distribution is now
  imminent), not because the prior work was wrong. A one-line
  status note at the top of the old plan referencing this one
  is enough.

## Out of scope (explicitly)

- Replacing
  [`packages/core/src/encode/png8.ts`](../../packages/core/src/encode/png8.ts)
  (the Pako-based PNG-8 file writer). It is MIT (Pako) + own
  code, unaffected by this plan.
- Touching the
  [`isPhotoHeavy`](../../packages/core/src/encode/index.ts)
  heuristic or the JPEG / PNG-24 fallback paths.
- The headless-annotator track
  ([`_done/annot-annotator-package.md`](./_done/annot-annotator-package.md))
  — it uses `@resvg/resvg-js` for rasterisation and does not
  go through this pipeline.
- The `[annot-mcp]` redact tools — they use `@napi-rs/canvas`
  for destructive burn and never invoke the quantizer.
