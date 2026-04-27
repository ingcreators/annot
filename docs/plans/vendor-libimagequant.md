# Vendor libimagequant — replace `@panda-ai/imagequant`

> **Status:** Draft. Authored 2026-04-27 in response to a
> security-conscious review of Annot's PNG-8 capture pipeline.
> The pipeline currently depends on
> [`@panda-ai/imagequant`](https://www.npmjs.com/package/@panda-ai/imagequant)
> (a 2-month-old npm org with one follower, 0 GitHub stars on
> the upstream repo, no CI on the WASM build, 331 weekly
> downloads) for the WASM-side palette quantization. This plan
> replaces it with an in-tree wasm-bindgen wrapper around the
> upstream [ImageOptim/libimagequant](https://github.com/ImageOptim/libimagequant)
> Rust crate (the same algorithm — Median Cut + Voronoi
> refinement — but built from a known-author source under our
> own audit and version pin).
>
> **Compatibility:** `@ingcreators/annot-core/encode` only.
> External API of `encodeCapture()` is unchanged. The `init()` /
> `quantize_image(pixels, w, h, 256) → { palette, indices }`
> ABI consumed at
> [`packages/core/src/encode/index.ts:19,127,152`](../../packages/core/src/encode/index.ts:19)
> is preserved verbatim, so the call-site change in `core/encode`
> is one import-path swap.
>
> **Risk:** Five phases, each independently revertable. The
> heaviest is Phase 1 (introduces the new Rust + wasm-bindgen
> crate); Phases 2–5 are mechanical (CI, swap, removal,
> verification). No SVG schema change. No data migration. The
> migration is gated by a byte-equivalence golden against the
> current `@panda-ai/imagequant` output so we can prove the
> swap is a pure substitution.

## Context

### Why this matters

The 2026-04-27 review flagged
[`@panda-ai/imagequant`](https://www.npmjs.com/package/@panda-ai/imagequant)
on the following supply-chain signals (verified 2026-04-27):

| Signal | Value |
|--------|-------|
| GitHub repo | https://github.com/Panda-Intelligence/imagequant-wasm — **0 stars, 0 forks, 0 watchers**, no releases, no CI |
| GitHub org `Panda-Intelligence` | created **2025-02-12** |
| First npm publish | **2025-02-20** (8 days after org creation) |
| npm publisher | single account `tearsofphoenix`, 1 follower |
| Weekly downloads | **331** |
| Reproducible-build attestation | none (precompiled `.wasm` blob you trust by default) |
| License consistency | README badge says MIT but links GPLv3 text |
| Other npm packages from same publisher | none of comparable scope |

This is the canonical profile a typosquat / takeover attack
inhabits. There is no concrete evidence of compromise today —
the package works, the WASM appears legitimate (it loads, it
returns sensible quantizations) — but the trust chain is
"npm + one anonymous publisher + a precompiled binary blob you
can't reproduce". For an Apache-2.0 OSS project that pitches
enterprise-adoption auditability ([`README.md:32-42`](../../README.md))
and lists "Dependency hygiene" in its evaluator-facing posture,
relying on this dependency long-term is a defensible
embarrassment we should not have to explain.

### Why not switch to UPNG.js

The first instinct is "swap to a more mature pure-JS library".
[`upng-js`](https://www.npmjs.com/package/upng-js) is a
well-known option (Photopea author identity, 81k weekly
downloads, pure JS — no WASM blob to trust), but its API does
not actually fit our pipeline:

- UPNG's quantizer is internal to its `UPNG.encode()` PNG
  builder. There is no `quantize(rgba, w, h, 256) →
  {palette, indices}` public surface.
- Using it would require either (a) calling `UPNG.encode()`
  then re-decoding the produced PNG to recover the palette
  (wasteful, and silly when we already have
  [`png8.ts`](../../packages/core/src/encode/png8.ts) doing the
  encoding), or (b) vendoring UPNG's internal `quantize()`
  function (now we own a fork of an 8-years-stale-on-npm
  package with k-means quality, worse than libimagequant's
  Median Cut + Voronoi).
- The `@jsquash/png` + `@jsquash/oxipng` family is **not** a
  substitute — `@jsquash/png` is a codec only, `@jsquash/oxipng`
  is a *lossless* optimizer (oxipng deliberately does not
  bundle libimagequant; the upstream Squoosh app uses pngquant
  separately for that). Both are dead ends for this task.

The right move is to **own the libimagequant build** rather
than substitute the algorithm.

### What's actually being replaced

The dependency surface is small. Today, `@panda-ai/imagequant`
is consumed in exactly one file
([`packages/core/src/encode/index.ts`](../../packages/core/src/encode/index.ts)):

```ts
import init, { quantize_image } from "@panda-ai/imagequant";
// ...
await init();                                                // line 127
const result: any = quantize_image(pixels, w, h, 256);       // line 152
const palette: Uint8Array = result?.palette;
const indices: Uint8Array = result?.indices;
```

Everything downstream of that — the PNG-8 encoder
([`png8.ts`](../../packages/core/src/encode/png8.ts), 143 LOC,
depends on `pako` only) and the heuristic / dispatch logic in
`encodeCapture()` — is in-tree and not affected.

## Goals

- `pnpm-lock.yaml` no longer contains `@panda-ai/imagequant`
  or any sub-tree from `panda-ai`.
- The libimagequant WASM blob ships from a build step we own
  end-to-end (Rust toolchain → wasm-bindgen → committed
  `.wasm`), reproducible from a documented `pnpm build:wasm`
  invocation.
- The replacement preserves byte-equivalent PNG-8 output for
  a representative golden-image set so the swap is provably
  algorithm-equivalent (same libimagequant kernel, same
  knobs).
- The runtime ABI consumed by
  [`packages/core/src/encode/index.ts`](../../packages/core/src/encode/index.ts)
  (`init()` + `quantize_image(pixels, w, h, 256) → {palette,
  indices}`) is preserved, so the call-site change is a
  one-line import swap.
- Annot's CI either (a) builds the WASM on every PR with a
  dedicated job, or (b) verifies that the committed `.wasm`
  matches a fresh local build (decision deferred to Phase 2).

## Non-goals

- **NOT** changing the quantization algorithm. We keep
  libimagequant exactly as-is — same Median Cut + Voronoi +
  alpha-aware processing, same default dithering, same 256
  palette cap. The only thing that changes is who built the
  WASM and from what source.
- **NOT** publishing the new crate to npm. It stays
  `private: true` in the workspace (`@ingcreators/annot-imagequant`,
  `workspace:*` in `packages/core`). External users don't
  consume it; it's an internal vendor.
- **NOT** rewriting [`png8.ts`](../../packages/core/src/encode/png8.ts).
  The encoder is correct, fast, and audited; it stays.
- **NOT** touching the `pako` dependency. `pako` is from a
  long-established maintainer (Vitaly Puzrin), 50M+ weekly
  downloads — a different supply-chain category from
  `@panda-ai/imagequant`.
- **NOT** introducing a Rust runtime dependency for
  contributors who only want to edit TypeScript. The
  committed-WASM model means a `pnpm install` + `pnpm dev`
  contributor never installs Rust.

## Design

### New workspace package: `packages/imagequant/`

```
packages/imagequant/
  Cargo.toml                  # Rust crate: name = "annot-imagequant"
  src/lib.rs                  # ~80 LOC wasm-bindgen wrapper around the imagequant crate
  package.json                # name = "@ingcreators/annot-imagequant", private
  pkg/                        # wasm-pack output: .wasm + JS glue + .d.ts
  README.md                   # build instructions, audit notes, version-pin rationale
```

`Cargo.toml` pins the upstream crate exactly:

```toml
[dependencies]
imagequant = "=4.x.y"      # last known-good version, pinned
wasm-bindgen = "=0.2.x"
```

`src/lib.rs` exposes one entry point with the same shape as
the existing binding:

```rust
#[wasm_bindgen]
pub fn quantize_image(
    rgba: &[u8],
    width: u32,
    height: u32,
    max_colors: u32,
) -> JsValue {
    // 1. Build a libimagequant Image from rgba/w/h
    // 2. Run liq.quantize() with default attrs
    // 3. Get the resulting palette + indices
    // 4. Return { palette: Uint8Array, indices: Uint8Array }
}
```

`package.json` exposes `init` + `quantize_image` from the
wasm-pack-generated `pkg/index.js`. The TypeScript `.d.ts` is
generated by wasm-bindgen and committed (so consumers don't
need a Rust toolchain to typecheck).

### Build model: committed WASM, reproducible from source

The `pkg/` directory (containing `.wasm`, JS glue, `.d.ts`) is
**checked into the repo**. Two reasons:

1. **Contributor experience.** Most contributors edit
   TypeScript; requiring Rust + wasm-pack to be installed
   just to run `pnpm install` is a needless tax. Today, the
   `@panda-ai/imagequant` workflow doesn't require Rust
   either — the precompiled blob ships in the npm tarball.
   Committing the WASM in-tree is the same UX, just with us
   as the publisher.
2. **Reproducibility audit, not build orchestration.** The
   security argument isn't "build the WASM fresh on every PR"
   (that's CI cost for marginal benefit and pins us to one
   build environment). It's "any reviewer can reproduce the
   committed WASM by running a documented command". A
   `pnpm --filter @ingcreators/annot-imagequant build:wasm`
   script does the build; CI verifies once per release that
   the script produces a byte-equivalent artifact.

The repo gains:

- `packages/imagequant/scripts/build-wasm.sh` — pinned
  `wasm-pack` version + `cargo --locked` + reproducible
  `RUSTFLAGS`. Documented in the package's README.
- `packages/imagequant/scripts/verify-wasm.sh` — runs the
  build into a temp dir, diffs against the committed `pkg/`
  to confirm reproducibility. Used by CI on a periodic /
  release-cut basis (decided in Phase 2).
- A new `verified WASM build` row in
  [`README.md`](../../README.md)'s "Engineering posture"
  table once the migration completes.

### Vulnerability detection after the migration

The current setup has two automated bot/CI gates that cover
the npm side of the dependency graph:

- **Dependabot** ([`.github/dependabot.yml`](../../.github/dependabot.yml))
  watches `npm` (weekly grouped) and `github-actions` (monthly).
  Security advisories from the GitHub Advisory Database bypass
  the grouping and open individual PRs immediately.
- **`pnpm audit --audit-level=high`** runs as a separate
  non-blocking CI job ([`.github/workflows/ci.yml:75-96`](../../.github/workflows/ci.yml:75)).

After this plan lands the dependency graph **adds Rust crates**
(via the new [`packages/imagequant/Cargo.toml`](../../packages/imagequant/Cargo.toml)
once Phase 1 ships) but **removes** `@panda-ai/imagequant` and
its transitive npm closure. To keep coverage symmetric:

- **Phase 1 includes adding a `cargo` section to
  [`.github/dependabot.yml`](../../.github/dependabot.yml)**
  pointing at `/packages/imagequant`. Dependabot's `cargo`
  ecosystem reads `Cargo.lock` and checks every transitive
  crate against the GitHub Advisory Database, which mirrors
  [RustSec](https://rustsec.org/) advisories. Same UX as the
  existing npm gates: weekly grouped PRs + immediate
  individual PRs for security advisories.
- **The committed `.wasm` blob is opaque to advisory
  scanners** — Dependabot doesn't inspect compiled artifacts.
  This is what the Phase 2 `verify-wasm` CI job exists for:
  if anyone (a contributor PR, a compromised maintainer
  account, a typo'd commit) modifies `packages/imagequant/pkg/`
  without re-running the build script, the diff fails the
  build. **The CI job is the WASM equivalent of an advisory
  bot — it catches the supply-chain vector that Dependabot
  structurally cannot.**
- **The `pako` JS dep stays** under the existing npm Dependabot
  watch.

Honest disclosure of what is **not** covered:

- **GHSA mirroring lag.** RustSec advisories typically appear
  in GHSA within hours but occasionally take days. For the
  rare critical-severity case where this lag matters, a
  human-driven check at https://rustsec.org/ during incident
  response is the fallback — same situation as today for
  every other Cargo-using project on GitHub.
- **The new `cargo` Dependabot watch only covers
  `packages/imagequant/`.** The existing
  [`packages/desktop/src-tauri/`](../../packages/desktop/src-tauri/)
  Cargo workspace stays uncovered after this plan — Tauri
  crates are not part of this plan's scope. Adding a second
  `cargo` watch for the Tauri crate is a worthwhile follow-up
  but lives in its own PR (one-line addition to dependabot.yml).
- **No bot detects "the upstream `imagequant` crate was
  yanked or relabeled" until an advisory is published.** Same
  for any pinned dependency. This is why the plan defaults to
  an **exact version pin** (`=4.x.y`) — yanks become loud
  during the next `cargo update` rather than silent at
  install time.

### Why an in-tree workspace package, not a separate repo

Considered and rejected: split the Rust crate into
`ingcreators/annot-imagequant` as a sibling repo and consume
via `workspace:*` over a registry.

- Cross-repo coordination friction: any Rust update needs a
  PR there, then a bump here. Annot's pace doesn't justify
  this overhead.
- The WASM blob has zero external consumers. There's no
  reason for it to live separately from its only call site.
- An in-tree package is auditable in one repo grep — easier
  for security reviewers.

If a second `@ingcreators/*` product ever needs the same
quantizer, splitting it out is a follow-up plan, not blocking
work.

## Phased plan

| Phase | Scope | PRs | Depends on |
|-------|-------|-----|------------|
| 1 | New `packages/imagequant/` workspace package: Rust crate + wasm-bindgen wrapper + committed `pkg/` artifact + README + build script. Add a `cargo` section to [`.github/dependabot.yml`](../../.github/dependabot.yml) pointing at `/packages/imagequant` so the new Rust deps land under the same advisory bot coverage as everything else. Not yet wired into the call site. | 1 | — |
| 2 | CI: add a `verify-wasm` job that runs the build script and diffs against the committed artifact. Runs on every PR (decision below). | 1 | 1 done |
| 3 | Golden-image byte-equivalence test: feed N representative captures (UI-heavy, photo-heavy, high-DPI scrollshot, alpha-channel) through both `@panda-ai/imagequant` and the new package, assert PNG-8 output bytes match. Lives in `packages/core/src/encode/equivalence.test.ts`, runs once during the migration window. | 1 | 1 done |
| 4 | Swap the import in [`packages/core/src/encode/index.ts:19`](../../packages/core/src/encode/index.ts:19) from `@panda-ai/imagequant` to `@ingcreators/annot-imagequant`. Drop `@panda-ai/imagequant` from `packages/core/package.json` deps. Re-run the golden equivalence test inline as a regression guard going forward. | 1 | 2 + 3 done |
| 5 | Cleanup: remove `@panda-ai/imagequant` from `pnpm-lock.yaml` (auto via `pnpm install`), update [`README.md`](../../README.md)'s Engineering Posture table to mention the in-house WASM build, update [`CLAUDE.md`](../../CLAUDE.md) to document `packages/imagequant/` as Tier A from a runtime perspective (the JS glue is pure, the WASM has no DOM access). | 1 | 4 done |

Each phase is one PR, mergeable in sequence on `main`. Phases
1, 2, 3 can land in any order between themselves; Phase 4
depends on the equivalence test (Phase 3) being green.

## Verification

For each phase, the standard checklist
([`CONTRIBUTING.md`](../../CONTRIBUTING.md)) plus phase-specific:

- **Phase 1:** `pnpm --filter @ingcreators/annot-imagequant build:wasm`
  produces deterministic output (run twice, diff). The wasm-bindgen
  generated `.d.ts` exposes `init` + `quantize_image` with
  signatures matching the existing import shape used at
  [`encode/index.ts:19,127,152`](../../packages/core/src/encode/index.ts:19).
- **Phase 2:** the `verify-wasm` CI job passes against the
  committed `pkg/` and would fail if someone modified the
  Rust source without re-running the build script.
- **Phase 3:** the equivalence test compares PNG-8 byte
  output across both backends for the golden image set.
  Acceptable diff: zero bytes. If the wasm-bindgen ABI returns
  the palette in a different order than `@panda-ai/imagequant`
  (libimagequant's output is deterministic for the same input,
  but wrapper code paths may differ), the test fails and we
  investigate before swapping.
- **Phase 4:** all storage / capture / extension tests still
  pass. The `pnpm-lock.yaml` diff shows `@panda-ai/imagequant`
  removed; `@ingcreators/annot-imagequant` resolved to
  `workspace:*`.
- **Phase 5:** `pnpm audit --audit-level=high` still passes.
  `grep -r "@panda-ai" packages/` returns zero hits.

## Migration notes

- **No data migration.** SVG schema unchanged.
  `data-annot-version` unchanged. PNG-8 byte-equivalence is
  the migration's correctness gate — if the equivalence test
  passes, no captured image's stored bytes change.
- **No runtime behaviour change.** `encodeCapture()`'s
  external API is unchanged; the `EncodeOptions` /
  `EncodeResult` types stay the same. Same dispatch (smart /
  png / jpeg), same fallback (`MAX_SMART_PIXELS` cap, photo-
  heavy detection threshold).
- **Contributor toolchain:** the default `pnpm install` flow
  doesn't add Rust. Only contributors editing
  `packages/imagequant/src/lib.rs` need the documented Rust
  toolchain (rustup + wasm-pack pinned versions, instructions
  in `packages/imagequant/README.md`).
- **`packages/desktop`** has its own Rust crate
  (`packages/desktop/src-tauri/`) — no overlap, no shared
  Cargo workspace. The new `packages/imagequant/Cargo.toml`
  is a leaf crate.

## Decisions

These were called out as open questions during the original
draft and resolved on first review (2026-04-27):

- **Build verification cadence: every PR.** The Phase 2
  `verify-wasm` job runs on every PR with aggressive
  Rust + wasm-pack caching. Drift is caught immediately
  rather than accumulating up to a week. Flip to weekly
  scheduling only if the cache hit rate proves poor.
- **Pin strategy: exact (`=4.x.y`).** Upstream patch
  releases require a deliberate bump PR. The whole point of
  this plan is supply-chain trust — explicit beats implicit.

## Open questions

- **Should `packages/imagequant/` ship a tiny TypeScript
  wrapper layer** (`packages/imagequant/src/index.ts`) on
  top of the wasm-pack output to massage the ABI into the
  exact shape `encode/index.ts` expects, or should
  `encode/index.ts` adapt to whatever wasm-bindgen produces?
  Plan defers this to the implementation PR; the answer
  depends on whether wasm-bindgen's default `JsValue` →
  `{ palette, indices }` conversion matches the current ABI
  literally or needs a one-line `as any` smoother.
- **Scope creep guard:** when this lands, we will be tempted
  to also vendor or audit `pako`. The plan explicitly does
  not. `pako` is in a different supply-chain trust tier
  (50M+ weekly downloads, long-established maintainer); the
  decision to leave it alone is conscious, not an oversight.

## Out of scope (explicitly)

- **Algorithm changes** (Floyd-Steinberg dithering toggle, alpha
  handling tweaks, max-colors override). The point is
  byte-equivalence. Algorithm changes are a separate plan if
  ever desired.
- **Substituting `pako`.** Different trust tier; not in scope.
- **Substituting any other dependency for supply-chain
  reasons.** This plan is scoped specifically to
  `@panda-ai/imagequant`. A periodic dependency-trust audit
  is a worthwhile follow-up, but it's its own plan.
- **Publishing the new package to npm.** Internal vendor
  only. The `private: true` flag is load-bearing.
- **Adding the existing
  [`packages/desktop/src-tauri/`](../../packages/desktop/src-tauri/)
  Cargo workspace to Dependabot.** Worth doing — it's a
  one-line addition to
  [`.github/dependabot.yml`](../../.github/dependabot.yml) — but
  it's an existing-coverage gap separate from this plan's
  vendor-swap goal. Lives in its own PR.
- **WebGPU or Web Workers parallelism for the quantizer.**
  libimagequant is fast enough; out of scope.
