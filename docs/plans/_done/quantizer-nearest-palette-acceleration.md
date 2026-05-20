# Quantizer nearest-palette acceleration

> **Status:** Done (2026-05-20). All three phases landed via PRs
> [#871](https://github.com/ingcreators/annot/pull/871) (plan
> draft), [#872](https://github.com/ingcreators/annot/pull/872)
> (Phase 1 — per-pixel `Map<rgb24, paletteIdx>` cache inside
> `remapWithFloydSteinberg` + bench script), and
> [#873](https://github.com/ingcreators/annot/pull/873) (Phase 2 —
> retire the SW-thread `encodeBatch` single-item carve-out and
> redirect the hotkey + auto direct `encodeCapture` call sites
> through `host.encodeBatch`). Phase 1 bench numbers:
> `code`-shape fixture at 8 MP, 1655 ms → 331 ms (5×). The
> ~8-second editor-open freeze users reported after
> [`_done/replace-libimagequant-with-median-cut.md`](./replace-libimagequant-with-median-cut.md)
> Phase 2 (#859) is gone.
>
> **Original draft preserved below for history.**

---

> **Status:** Queued. Authored 2026-05-20 to fix the ~8-second
> editor-open freeze that browser-extension captures developed after
> [`_done/replace-libimagequant-with-median-cut.md`](./replace-libimagequant-with-median-cut.md)
> Phase 2 flipped the client-capture quantizer default from
> libimagequant (WASM) to the pure-TS Median Cut + Floyd–Steinberg
> implementation. The TS quantizer's nearest-palette inner loop is a
> naïve linear scan over up to 256 palette entries × every pixel.
> On a Retina-class viewport (DPR ≥ 2, ~8 megapixels) that's around
> 2 billion JS comparisons per encode — easily multiple seconds of
> synchronous CPU time. The same time was effectively free under
> WASM, so nothing else in the pipeline budgeted for it; the
> service-worker thread spends those seconds blocked on the encode
> before the editor tab can open.
>
> The upstream plan **explicitly called this out** —
> [`replace-libimagequant-with-median-cut.md`](./replace-libimagequant-with-median-cut.md)
> §"Nearest-palette lookup acceleration" said the Phase 1 remap
> step would use either (a) a per-pixel cache keyed by the input
> RGB value or (b) a small k-d tree over the palette, "whichever
> benchmarks better." The landed implementation in
> [`packages/core/src/encode/quantize-median-cut.ts`](../../../packages/core/src/encode/quantize-median-cut.ts)
> ships **neither**. This plan fills that gap.
>
> **Scope is narrow.** Two phases, each independently revertable:
> Phase 1 adds the missing accelerator inside the existing
> quantizer file (no public-API change, no byte-output change in
> the cached path). Phase 2 removes the SW-thread carve-out so
> even a worst-case encode no longer blocks the extension's
> service-worker.
>
> **No `data-annot-version` bump, no `StorageProvider` change, no
> `PageMetadata` change.** The output PNG-8 bytes stay
> byte-identical to the current implementation when the
> accelerator preserves the exact "nearest palette by squared
> Euclidean distance" contract (Phase 1's chosen approach does).

## Context

### Symptom

Reported 2026-05-20: opening the editor after a browser-extension
capture (visible / area / scroll / click / hotkey single-shot
modes) stalls for ~8 seconds before the editor mounts. The stall
started after PR
[#859](https://github.com/ingcreators/annot/pull/859) (Phase 2 of
`replace-libimagequant-with-median-cut.md`) landed; pre-#859
captures were sub-second.

### Root cause

[`quantize-median-cut.ts:421-430`](../../../packages/core/src/encode/quantize-median-cut.ts:421)
inside `remapWithFloydSteinberg`:

```ts
for (let i = 0; i < opaqueCount; i++) {
  const dr = rIn - palR[i]!;
  const dg = gIn - palG[i]!;
  const db = bIn - palB[i]!;
  const d = dr * dr + dg * dg + db * db;
  if (d < bestDist) {
    bestDist = d;
    bestIdx = i;
  }
}
```

This is a linear scan over up to 256 palette entries. It runs
once per pixel × once per encode. For an 8-megapixel capture
(2880 × 1800 Retina viewport rounded up), that's about
**2 billion compare-and-update operations** on the JS heap.
Even with V8's optimized integer loop, this lands in the 5–10
second range — and matches the 8-second symptom reported.

The pre-Phase-2 WASM path did the same algorithmic work, but in
compiled Rust with SIMD-friendly inner loops; the wall-clock cost
was ~30× lower so it was invisible.

### Secondary factor: SW thread is the critical path

[`packages/extension/src/background/host.ts:513-522`](../../../packages/extension/src/background/host.ts:513)
short-circuits single-item batches back into the service-worker
thread:

```ts
async encodeBatch(items: BatchItem[]): Promise<CaptureEncodeResult[]> {
  // Single-item: encode directly in the SW context. Avoids the
  // offscreen round-trip overhead and matches the legacy
  // encodeCapture(pngDataUrl, settings) path that visible /
  // area / scroll / click / hotkey used.
  if (items.length === 1) {
    const item = items[0]!;
    const result = await encodeOne(item.pngDataUrl, item.options);
    return [result];
  }
  // ... N-item path goes through offscreen pool ...
}
```

When WASM did the heavy lifting in microseconds, the
offscreen-document round-trip (postMessage to offscreen + worker
postMessage hop) was net-negative — the carve-out was the right
call. With pure-TS quantization on the SW thread, the carve-out
keeps a multi-second synchronous loop on the same thread that
must service every subsequent `chrome.runtime.onMessage` /
`chrome.tabs.*` callback in the capture-completion handshake
with the PWA tab. Even after Phase 1 makes the encode fast, the
worker-pool route is preferable for the same "don't block the
SW" reason that
[`_done/desktop-browser-mode.md`](./desktop-browser-mode.md)
gave for the N-item path.

### Why a per-pixel cache works for Annot's payloads

The `isPhotoHeavy` heuristic upstream of the quantizer routes
photo-heavy captures to JPEG / PNG-24 fallback **before** PNG-8
is invoked at all. The pixels the quantizer actually sees are
UI screenshots — limited palette, large monochrome regions,
heavy colour reuse. Concretely: a typical FHD UI capture has on
the order of 10⁴ unique (R,G,B) triples post-dither, against 10⁶
pixels. A cache keyed by the per-pixel post-error RGB
(integer-clamped) hits ~90+% of the time. Even at the conservative
end, miss-path cost is one linear scan + one cache insert; cached-
path cost is a single map lookup.

### Out of scope

- **Algorithmic improvements to Median Cut itself.** Boxes, splits,
  priority queue, FS coefficients — all stay byte-identical to the
  current implementation.
- **Perceptual / LAB colour-space distance.** Same Euclidean RGB
  distance as today; the accelerator just makes finding the
  nearest entry faster, it doesn't change the metric.
- **Different fallback policies** (more JPEG, more PNG-32,
  different `isPhotoHeavy` threshold). Those are orthogonal knobs
  if we want them later.
- **Annotator-side (Node) PNG-8 path.**
  `@ingcreators/annot-annotator` uses the same
  `quantize-median-cut.ts`, so it picks up the speedup
  automatically, but its perf regime is different (CI / headless,
  no SW thread to block) and not the motivating use case.

## Goals

1. **Editor opens within ~500ms** of an extension capture on an
   8-megapixel Retina viewport, measured as wall-clock from
   `captureVisibleTab` resolve to the editor's first paint.
2. **Quantizer output is byte-identical** to the pre-Phase-1
   implementation. Existing
   [`quantize-median-cut.test.ts`](../../../packages/core/src/encode/quantize-median-cut.test.ts)
   property tests pass unchanged; a new "with vs. without
   accelerator on identical input" test asserts byte equality.
3. **No public-API change.**
   [`quantizeMedianCut`](../../../packages/core/src/encode/quantize-median-cut.ts)
   signature is the same; the accelerator lives inside the
   function. Downstream `encodePng8` is untouched.
4. **No SVG / storage / metadata schema change.**
5. **Service-worker thread is no longer the encode critical path.**
   Single-item `encodeBatch` calls route through the offscreen
   worker pool (Phase 2). When even the accelerated encode
   stretches past a few hundred ms (e.g. a 4K capture on a slow
   laptop), the SW continues servicing messages.
6. **A small, reproducible micro-benchmark** lands alongside the
   accelerator so future regressions are obvious. It runs under
   `vitest` (not part of the regular suite — `bench` script) so
   we don't pay its cost on every CI run.

## Non-goals

- **A heroic optimization spree.** The accelerator chosen in
  Phase 1 is the smallest change that closes the 30× gap. We're
  not pursuing the last 2× via SIMD WASM modules or Web Workers
  partitioning the image — that's diminishing returns against
  the 8s → ~250ms jump Phase 1 buys.
- **Removing the `@ingcreators/annot-capture/encode` worker
  pool.** Phase 2 sends single-item work *into* the pool, it
  doesn't replace the pool.
- **Adoption by the PWA `<annot-capture-workspace>` encode
  path.**
  [`_done/web-capture-redesign.md`](./web-capture-redesign.md)
  documented that the new `/capture` route deferred the smart
  PNG-8 pipeline; that's still deferred. PWA captures continue
  to take whatever path that plan landed.

## Plan

### Phase 1 — Per-pixel cache inside `remapWithFloydSteinberg`

**File:**
[`packages/core/src/encode/quantize-median-cut.ts`](../../../packages/core/src/encode/quantize-median-cut.ts)

**Change shape** (sketch):

```ts
function remapWithFloydSteinberg(/* ...same signature... */): Uint8Array {
  // ... existing per-row error-buffer setup unchanged ...

  // NEW: per-encode nearest-palette cache. Key = 24-bit RGB packed
  // into a Number; value = palette index (small int). Map preserves
  // insertion order so determinism is unaffected. UI captures
  // populate a few thousand entries; cache size is bounded by the
  // number of distinct post-error RGB integers we encounter.
  const nearestCache = new Map<number, number>();

  for (let y = 0; y < height; y++) {
    // ...
    for (let x = 0; x < width; x++) {
      // ... rIn / gIn / bIn computed as today ...

      // Clamp + round the post-error RGB to integers in [0, 255]
      // — this is the lookup key. The clamp is required because
      // FS dither can push channels outside the source range.
      const ri = rIn < 0 ? 0 : rIn > 255 ? 255 : (rIn + 0.5) | 0;
      const gi = gIn < 0 ? 0 : gIn > 255 ? 255 : (gIn + 0.5) | 0;
      const bi = bIn < 0 ? 0 : bIn > 255 ? 255 : (bIn + 0.5) | 0;
      const key = (ri << 16) | (gi << 8) | bi;

      let bestIdx = nearestCache.get(key);
      if (bestIdx === undefined) {
        // Cache miss — fall back to the existing linear scan.
        // Result is byte-identical to the un-accelerated path
        // because the scan operates on the same clamped integer
        // RGB the cache key was derived from.
        let bestDist = Number.POSITIVE_INFINITY;
        bestIdx = 0;
        for (let i = 0; i < opaqueCount; i++) {
          const dr = ri - palR[i]!;
          const dg = gi - palG[i]!;
          const db = bi - palB[i]!;
          const d = dr * dr + dg * dg + db * db;
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        nearestCache.set(key, bestIdx);
      }

      indices[pixelIdx] = opaqueIndexBase + bestIdx;

      // Residual error is computed against the clamped integers
      // (same as cache key), not the unclamped floats. This is the
      // ONLY behaviour change vs. the current implementation: today
      // the residual subtracts `rIn` (unclamped float) from the
      // palette entry; the new code subtracts the clamped integer.
      // Bytes-out are unchanged for any pixel where rIn is already
      // in [0, 255] (which is every pixel in the first column of
      // every scanline — error starts at 0 — and the vast majority
      // of all interior pixels). For pixels where the dither pushed
      // the channel outside [0, 255], the new code's residual is
      // bounded and well-behaved; the old code's residual was the
      // out-of-range delta. The Phase 1 PR's micro-bench fixtures
      // include both "always-in-range" and "saturates-occasionally"
      // images; if any saturation-edge fixture changes bytes, the
      // PR description will call it out.
      const errR = ri - palR[bestIdx]!;
      const errG = gi - palG[bestIdx]!;
      const errB = bi - palB[bestIdx]!;

      // ... FS diffusion identical to today ...
    }
    // ... row swap identical to today ...
  }

  return indices;
}
```

**Why this shape:**

- **Cache key is the integer-clamped post-error RGB**, not the raw
  unclamped float. This is what makes the cache key space finite
  (at most 2²⁴ entries vs. unbounded floats) and what makes the
  cache hit-rate high on UI screenshots (most pixels round to one
  of a few thousand unique triples after error accumulation).
- **`Map<number, number>`** is the simplest correct data structure.
  V8 inlines monomorphic-shape number-keyed map operations to
  about 30–50ns each on warm code. For ~10⁴ distinct keys × 10⁶
  pixels with a 95+% hit rate, total cache work is ~3M lookups +
  10⁴ inserts + 10⁴ scans — dominated by lookups, totals ~100ms.
- **No precomputed LUT.** A 2²⁴-entry LUT (16 MB
  `Uint8Array`) would amortize even better, but allocating it
  per-encode is wasteful and reusing it across encodes is hard
  (palette changes per image). A lazy `Map` is the right
  trade-off.
- **The cache lives inside `remapWithFloydSteinberg`'s call
  frame.** Garbage-collected per encode. No module-level state,
  no need for `clear()`, no risk of palette-stale entries
  leaking between calls.

**Behaviour note (intentional, documented in the PR).** The
residual error is now computed from the **clamped integer** rather
than the raw unclamped float. For any pixel where the FS
accumulator stayed in [0, 255], this is bit-identical. For the
small fraction of pixels where the accumulator saturated, the
residual is slightly different — but the cumulative behaviour is
strictly better (it can't propagate out-of-range errors further
into the image). The Phase 1 PR description will include a
before/after PNG byte comparison for both "always-in-range" and
"often-saturates" fixtures; if any of the latter changes a small
number of bytes, the PR calls it out explicitly. Snapshot tests
in
[`quantize-median-cut.test.ts`](../../../packages/core/src/encode/quantize-median-cut.test.ts)
are property-tests (palette size, index validity, determinism),
not byte-snapshot tests, so the existing tests pass either way.

**New micro-benchmark.** A new script
`packages/core/scripts/bench-quantize.ts` (committed but not part
of the test run; invoked via `pnpm --filter @ingcreators/annot-core
bench:quantize`) renders three synthetic ImageData inputs at three
sizes (1 MP / 4 MP / 8 MP × "UI" / "code editor" / "illustration"
templates), runs `quantizeMedianCut` 5 times warmed + 10 times
measured, and prints median wall-clock ms. The Phase 1 PR
description quotes the before/after numbers.

**Why not a k-d tree:** considered. Roughly 5–10× speedup vs. the
current linear scan, but the constant factor for tree-node access
in JS (object property loads, polymorphic comparators) plus the
build cost (256 inserts) plus the bookkeeping bring the realised
speedup to ~3–5×. A `Map` cache on the actual hit-pattern of UI
screenshots is closer to 30× because the hit rate is so high. We
can always layer a k-d tree on the cache-miss path in a follow-up
if Phase 1 telemetry shows a regression on a payload class with
unusually low cache hit rate.

**Why not a 64³ LUT:** considered. A 64-cell-per-channel LUT
(262144 entries × 1 byte = 256 KB Uint8Array, built in ~4M ops)
gives O(1) lookup but introduces a quantization granularity error
(cell-center vs. pixel actual). On UI screenshots the error is
imperceptible, but it would break byte-identity. The byte-identity
goal pushes us to the exact-cache path.

**Tests landing in Phase 1:**

- An "accelerated vs un-accelerated returns identical
  `indices`" test fixture loop (3 synthetic ImageData × 3 sizes)
  — guards against future cache-key bugs.
- An "accelerated path determinism" test — runs the function
  3× against the same input, asserts byte-identical output.

Both go in
[`quantize-median-cut.test.ts`](../../../packages/core/src/encode/quantize-median-cut.test.ts).
No new test file.

**Acceptance for Phase 1 PR:**

- `pnpm --filter @ingcreators/annot-core typecheck` passes.
- `pnpm --filter @ingcreators/annot-core test` passes.
- `pnpm --filter @ingcreators/annot-core build` passes.
- `pnpm lint` reports 0 findings.
- The PR description quotes bench numbers: before/after wall-clock
  median for the three fixture sizes.
- Manual smoke: build the extension (`pnpm --filter
  @ingcreators/annot-extension build`), load unpacked in Chrome,
  trigger a visible-mode capture, confirm the editor opens within
  ~500ms on a Retina display.

### Phase 2 — Route every extension encode through the offscreen worker pool

**Files:**

1. [`packages/extension/src/background/host.ts`](../../../packages/extension/src/background/host.ts)
   — drop the single-item carve-out at
   [host.ts:518-522](../../../packages/extension/src/background/host.ts:518).
2. [`packages/extension/src/background/service-worker.ts`](../../../packages/extension/src/background/service-worker.ts)
   — replace the two direct `encodeCapture(captured.pngDataUrl,
   settings)` call sites at
   [service-worker.ts:624](../../../packages/extension/src/background/service-worker.ts:624)
   (hotkey single-shot flow) and
   [service-worker.ts:958](../../../packages/extension/src/background/service-worker.ts:958)
   (auto-capture flow) with `host.encodeBatch([{ pngDataUrl, cropSrcY:
   0, cropHeight: 0, fullHeight: 0, options: <derived from settings> }])`
   so they share the same offscreen-pool route as the orchestrator
   modes (`runVisibleCapture` / `runAreaCapture` / `runScrollCapture` /
   `runPerPageCapture` already do this — see
   [`packages/capture/src/orchestrate/run-visible.ts:39`](../../../packages/capture/src/orchestrate/run-visible.ts:39)).
3. Remove the `import { encodeCapture } from "../shared/encode.js"`
   declaration in
   [service-worker.ts:26](../../../packages/extension/src/background/service-worker.ts:26)
   once both call sites are migrated.

**Why both files matter:** the carve-out in `host.ts` is one path
to the SW-thread encode, but hotkey + auto modes bypass `host`
entirely today and call the shared encoder directly. Without
fixing both, the user-visible capture types most likely to be hit
repeatedly (hotkey for "capture this moment", auto for "wait for
change → capture") would still freeze the SW thread for the full
encode duration.

**Why now, not in Phase 1:** the rationale ("don't block the SW
thread") was always there, but the carve-out's behaviour was
acceptable when the encode took microseconds. Phase 1 makes the
encode take ~200ms in the common case and ~1s in the
4K-on-slow-laptop case. At 1s, the SW being unresponsive matters;
at the new common-case 200ms, the worker round-trip cost (≈10ms)
is a rounding error. So Phase 2 is the right moment to retire the
optimization on both surfaces.

**No code change inside the pool, the worker, or the orchestrators.**
The carve-out is the single line that decided "SW vs. pool" in
`host.ts`; the two direct call sites in `service-worker.ts` get
the same `host.encodeBatch([...])` wrapper that
`runVisibleCapture` and friends use. The pool already accepts
single-item submissions via `encodeOne` (see
[`packages/capture/src/encode/worker-pool.ts`](../../../packages/capture/src/encode/worker-pool.ts)).

**Settings → EncodeOptions mapping** at both
`service-worker.ts` call sites:

```ts
const options: EncodeOptions = {
  format: settings.quality.format,
  smartFallback: settings.quality.smartFallback,
  smartColorThreshold: settings.quality.smartColorThreshold,
  jpegPercent: settings.quality.jpegPercent,
  saveSizePreset: settings.quality.saveSizePreset,
};
```

This is the same mapping `packages/capture/src/shared/encode.ts`
performs today, kept inline at the call site to avoid
re-introducing a wrapper now that the call goes through `host`.

**Risk:** if the offscreen document fails to start (Chrome quirk
on a freshly installed extension), the SW-side fallback path
inside `host.encodeBatch` (the `catch (e) { console.warn(...) }`
block at
[host.ts:535-551](../../../packages/extension/src/background/host.ts:535))
already handles it: serial encode on the SW thread as the
recovery path. So routing hotkey + auto through `host.encodeBatch`
doesn't expose a new failure mode — it just makes the SW-thread
path strictly a fallback instead of the default for those flows.

**Tests landing in Phase 2:**

- No new automated test (the offscreen ↔ SW handshake isn't
  unit-testable from outside `chrome.*`).
- Manual smoke: rebuild the extension, trigger all six modes
  (visible / area / full-page / per-page / click / hotkey) plus
  auto-capture, confirm each completes successfully and the SW
  thread stays responsive to console-side
  `chrome.runtime.sendMessage` pings during the encode.

**Acceptance for Phase 2 PR:**

- `pnpm --filter @ingcreators/annot-extension typecheck` passes.
- `pnpm --filter @ingcreators/annot-extension build` passes.
- The PR description includes a "before / after" wall-clock for
  one capture in each of the six modes (and auto) on the same
  fixture page + viewport.

### Phase 3 — Plan archival

Move this file to `docs/plans/_done/` once Phases 1 & 2 are
merged. Add a one-line pointer in
[`docs/plans/README.md`](./README.md)'s "Recently landed" table,
linking back to
[`_done/replace-libimagequant-with-median-cut.md`](./replace-libimagequant-with-median-cut.md)
as the upstream plan that motivated the work.

No code touched.

## Risks

- **Cache-key collisions:** the cache keys only the integer-clamped
  RGB, so two pixels with different unclamped floats but identical
  clamped integers will pick the same palette entry. This is the
  desired behaviour (the un-accelerated path's "find nearest by
  Euclidean distance" comparator only looks at the float values,
  but for any two pixels with identical clamped-integer RGB the
  nearest palette entry IS the same). The unit tests assert this
  invariant.
- **`Map` deopt under heavy mutation:** V8 keeps `Map` shape
  monomorphic as long as keys + values are small integers. The
  cache here uses `number → number`, so the shape is stable. Not
  a real risk in practice, but called out so a future optimizer
  doesn't accidentally widen the value type.
- **Offscreen-document startup latency (Phase 2):** the first
  capture after the SW wakes from idle pays ~50–100ms to create
  the offscreen document. The pool is then warm for subsequent
  captures. Net wall-clock cost for the first-of-session capture
  is bounded; even with Phase 2's pool-route, total time is
  still well under the pre-Phase-1 8s freeze.

## Open questions

None at draft time. If Phase 1 bench numbers come in worse than
expected, the fallback is to layer a k-d tree on the cache-miss
path; the
[`quantize-median-cut.ts`](../../../packages/core/src/encode/quantize-median-cut.ts)
diff stays localised either way.

## References

- Upstream plan that introduced the regression:
  [`_done/replace-libimagequant-with-median-cut.md`](./replace-libimagequant-with-median-cut.md)
  (specifically the "Nearest-palette lookup acceleration" section
  which specified the work this plan now executes).
- Worker-pool design:
  [`packages/capture/src/encode/worker-pool.ts`](../../../packages/capture/src/encode/worker-pool.ts).
- SW thread call sites:
  [`packages/extension/src/background/host.ts`](../../../packages/extension/src/background/host.ts)
  (`encodeBatch`),
  [`packages/extension/src/background/service-worker.ts`](../../../packages/extension/src/background/service-worker.ts)
  (`hotkey` + `auto` capture flows, both reach the encode via
  `host.encodeBatch` per the desktop-browser-mode refactor).
- Companion offscreen entry:
  [`packages/extension/src/offscreen/offscreen.ts`](../../../packages/extension/src/offscreen/offscreen.ts).
