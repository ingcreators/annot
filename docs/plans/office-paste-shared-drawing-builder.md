# Office-paste & PPTX export — share the DrawingML builder

> **Status:** Queued. Direct follow-up to
> [`_done/office-paste-abi-modernisation.md`](./_done/office-paste-abi-modernisation.md).
> That plan made the TS `AnnotationShape` interface and the Rust
> `AnnotationShape` struct lockstep (every TS field reads from a
> matching Rust field). This plan exploits that lockstep to delete
> the per-shape OOXML duplication between the PPTX export path
> ([`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts))
> and the Office-clipboard path
> ([`packages/desktop/src-tauri/src/commands/clipboard.rs`](../../packages/desktop/src-tauri/src/commands/clipboard.rs)).
>
> **Risk:** Medium. Both surfaces are user-visible:
>
> - PPTX export goes through `exportPptx(canvas)` (Web/PWA + Tauri),
>   triggered from the editor's "Export → PPTX" action.
> - Office paste goes through Tauri-only `copyAsOffice`, triggered
>   by `Ctrl+C` on Windows desktop.
>
> Both ride on the same DrawingML primitives but currently emit
> them via two parallel implementations. The migration contract
> is **byte-equivalent OOXML output** for every supported shape,
> verified by golden snapshots on both sides.
>
> **Not in scope:** the slide / clipboard packaging layer
> (`<p:sp>` vs `<a:sp>`, ZIP filenames, content types). Those
> stay where they are.

## How to resume in a fresh session

```
"Read docs/plans/office-paste-shared-drawing-builder.md and start <phase>."
```

## Context

After
[`_done/office-paste-abi-modernisation.md`](./_done/office-paste-abi-modernisation.md)
landed (PRs [#202](https://github.com/ingcreators/annot/pull/202)–
[#210](https://github.com/ingcreators/annot/pull/210)), the
TS↔Rust ABI is clean: `AnnotationShape` declares one canonical
field per piece of data, and the Rust struct is in lockstep.
**But the OOXML output side is still duplicated.**

Concretely, here is the same per-shape DrawingML being built
twice — once in `pptx-export.ts` (off `SVGElement`s) and once
in `clipboard.rs` (off `AnnotationShape`s):

| Concept | TS site (`pptx-export.ts`) | Rust site (`clipboard.rs`) |
|---|---|---|
| EMU constants (`9525` / `12700`) | `PX_TO_EMU` / `PT_TO_EMU` (lines 16–22) | `PX_EMU` / `PT_EMU` (lines 251–252) |
| `px(v)` / `ptToEMU(v)` | yes | yes |
| Color hex normalize | `colorHex` (line 28) | `chex` (line 256) |
| XML escape | `escXml` (line 875) | `exml` (line 257) |
| `<a:headEnd>/<a:tailEnd>` | `endOOXML` (line 65) | `end_xml` (line 70) |
| dasharray → `<a:prstDash>` | inline in `paintXml` | `dash_to_drawingml` (line 437) |
| `cap=…` / `<a:miter/>/<a:round/>/<a:bevel/>` | `capOOXML` / `joinOOXML` (lines 218 / 224) | `cap_attr` / `join_xml` (lines 94 / 104) |
| `<a:gradFill>` | `gradFillXml` (line 93) | `grad_fill_xml` (line 168) |
| `<a:xfrm rot=… flipH=…>` attrs | `xfrmAttrs` (line 243) | `xfrm_attrs` (line 186) |
| `prstGeom prst="rect"` | `buildRect` (line 492) | `gvml_rect` (line 476) |
| `prstGeom prst="ellipse"` | `buildEllipse` (line 522) | `gvml_ellipse` (line 499) |
| `prstGeom prst="line"` connector | `buildLine` (line 380) | `gvml_line` (line 516) |
| `prstGeom prst="roundRect"` (rounded rect) | `buildRect` (`avLst` adj branch) | `gvml_rect` (corner_radius branch) |
| `prstGeom prst="roundRect"` (marker rect/rounded) | `buildMarker` (line 759) | `gvml_marker` (line 604) |
| `prstGeom prst="ellipse"` (marker circle) | `buildMarker` | `gvml_marker` |
| `prstGeom prst="wedgeRoundRectCallout"` | (NOT YET — pptx export still emits `roundRect` for callouts; gap parity-wise) | `gvml_text` (callout branch added in phase 4) |
| `<a:pic>` for embedded image | `buildSlide` background + future mosaic | `<a:pic>` for screenshot + `gvml_mosaic_pic` (line 621) |
| `custGeom` freehand path | `buildFreehand` (line 610) | `gvml_freehand` (line 631) |
| Text run `<a:p>/<a:r>/<a:rPr>` | `buildText` (line 553) | `gvml_text` (line 549) |
| SVG path `d` parser | `parseSVGPath` (line 864) | `parse_svg_path` (line 666) |

Both sides also share the same packaging layer skeleton (theme
XML, content types, slide vs lockedCanvas wrapper) but those parts
**legitimately differ** (PPTX vs GVML clipboard) and stay split.

### Why this isn't simply "delete duplication"

- **Different inputs.** `pptx-export` reads `SVGElement`s from
  `CanvasManager`; `clipboard.rs` reads `AnnotationShape`s
  parsed from JSON. Phase 1 of this plan is to stop the
  divergence by making `pptx-export` go through `transformOf`
  → `AnnotationShape[]` → DrawingML, the same way the Office
  paste path does.
- **Different languages.** TS in `annot-editor`, Rust in the
  Tauri crate. The DrawingML builder is "format the right
  string" code — nothing language-specific. Phase 2 picks
  TS as the single home and reduces the Rust side to
  "serialise the shapes as JSON, pass to the TS builder via
  Tauri IPC, receive the drawing XML string, ZIP it up, push
  to clipboard." Rust loses ~600 LOC of OOXML construction.
- **Different parity gaps.** `pptx-export` currently doesn't
  emit `wedgeRoundRectCallout` for callouts (it falls back
  to `roundRect`); `clipboard.rs` got that in phase 4 of the
  ABI plan. After unification, both surfaces gain the same
  feature parity for free.

### Why the previous plan was a prerequisite

The TS↔Rust `AnnotationShape` lockstep makes phase 1 below a
straight refactor instead of a cross-language ABI migration:
the same shape struct is both the input to `transformOf` and
the input to whichever DrawingML builder we end up with. The
only thing left is to rewrite `pptx-export`'s per-shape
builders to take an `AnnotationShape` instead of an
`SVGElement`.

## Goal

A single set of per-shape DrawingML builders that both PPTX
export and Office paste consume:

- `packages/render/src/drawingml/` — new home for the shared
  builders. `annot-render` is Tier C-render (data-driven,
  takes `AnnotationShape` / `ImageRecord`-shape inputs, NOT
  `SVGElement`). The package boundary is already documented
  in [`CLAUDE.md`](../../CLAUDE.md) as the right home for
  data-driven rendering.
- `pptx-export.ts` becomes a thin wrapper: walk the canvas
  via `transformOf` → `AnnotationShape[]` → call the shared
  builder → wrap the per-shape XML in `<p:sp>` (PPTX uses
  the `p:` namespace prefix where GVML uses `a:`) and the
  PPTX packaging files.
- `clipboard.rs` becomes even thinner: receive the drawing
  XML string from the TS side via a new Tauri command, wrap
  in the GVML `lockedCanvas` envelope, ZIP, push to
  clipboard. The Rust struct + per-shape `gvml_*` emitters
  go away.

After this lands, **adding a new tool means: one TS-side
SVG → `AnnotationShape` mapping in `transformOf` + one
TS-side per-shape DrawingML builder.** PPTX export and Office
paste both pick it up automatically.

## Constraints

- **Byte-equivalent OOXML output for every existing shape on
  both surfaces.** Verified by:
  - The existing `clipboard_test.rs` golden snapshots
    (phase 0–8 era, currently 5 active tests).
  - **New** golden snapshots for `pptx-export` —
    `packages/editor/src/pptx-export.test.ts` doesn't exist
    yet; phase 0 of this plan adds it as the regression net.
- **One namespace prefix swap is the ONLY allowed diff.**
  GVML uses `<a:sp>` / `<a:cxnSp>` / `<a:pic>` because the
  shapes live inside an `<a:graphic>` envelope. PPTX uses
  `<p:sp>` / `<p:cxnSp>` / `<p:pic>` because they live
  inside `<p:spTree>`. The wrapper layer chooses the prefix;
  the shared builder is parameterised on it.
- **No new automated paste-into-Office testing.** Like the
  previous plan, the clipboard side has no CI verification —
  manual smoke-test on Tauri desktop is the gate.
- **Rust crate surface stays the same.** `copy_as_office`
  is still the public Tauri command; only its body changes
  (it now accepts a pre-built drawing XML string).

## Phases

### Phase 0 — Land the PPTX export golden snapshot

**Goal:** Mirror what phase 0 of the ABI plan did for the
clipboard side: pin the current `pptx-export` XML output as
a regression net before any refactor.

**Files:**

- `packages/editor/src/pptx-export.ts` — extract the slide-
  XML construction (after `buildSlide(w, h, shapes, hasImage)`
  is built but before ZIP packaging) into a callable function
  that returns `{ slideXml, slideRels, contentTypes,
  imageBytes }`. The wrapper that produces the PPTX `Blob`
  keeps the existing entry point.
- `packages/editor/src/pptx-export.test.ts` (NEW) — synthetic
  `CanvasManager` (or a stub: this plan can also choose to
  test by going from `AnnotationShape[]` once phase 1 lands;
  for phase 0 we still need a `CanvasManager`-based goldens
  since the input is still `SVGElement`s). Cover every
  emitter: rect / rounded-rect / ellipse / line / arrow /
  marker (circle / rect / rounded) / text (plain / sticky)
  / freehand / freehand-group.
- Snapshots via `vitest`'s `toMatchInlineSnapshot()` or
  `toMatchSnapshot()` — match the existing convention in
  the editor package.

**Acceptance:**

- `pnpm --filter @ingcreators/annot-editor test pptx-export`
  passes; first run pins the snapshots.
- The snapshot pins the current OOXML byte-for-byte; later
  phases that refactor the implementation must preserve the
  output exactly.

### Phase 1 — Drive PPTX export through `AnnotationShape`

**Goal:** Make `pptx-export.ts` consume the same input
shape the Office-paste path consumes, so we can collapse
the per-shape OOXML builders next.

**Files:**

- `packages/web/src/editor/toolbar.ts` — extract the body
  of `transformOf` (today: anonymous closure inside
  `#copyAll`) into a free function
  `svgAnnotationsToShapes(annotations: SVGElement,
  imageWidth, imageHeight): AnnotationShape[]`. Export from
  `packages/web/src/editor/svg-to-annotation-shapes.ts`
  (NEW) so both `#copyAll` and `pptx-export` can call it.
  Live `SVGElement` access is fine because the extractor is
  a pure function over the DOM tree (Tier C in the
  three-package model — sits in `packages/web`).
- `packages/editor/src/pptx-export.ts` — rewrite
  `buildShapes(canvas)` to call
  `svgAnnotationsToShapes(canvas.annotations, …)` and then
  iterate over the returned `AnnotationShape[]`. The
  per-shape `buildRect` / `buildEllipse` / `buildLine` /
  etc. helpers temporarily continue to take `SVGElement` —
  we'll switch them to `AnnotationShape` in phase 2.
  This phase is "input-side change only".

  Subtle bit: a few PPTX-specific behaviours (freehand
  group's `<p:grpSp>` wrapper, the curved-arrow control
  point in `buildLine`'s bbox computation) read SVG state
  the current `AnnotationShape` doesn't carry. Either:
  - **(a)** keep the SVG fallback in those branches for
    one cycle (phase 2 then widens `AnnotationShape` to
    cover them, removes the fallback in phase 8); or
  - **(b)** widen `AnnotationShape` first (e.g. add
    `freehand_group_id?: string`, `arrow_curve_cx?: number`
    / `arrow_curve_cy?: number`) then drop the SVG read.
  Phase 1 prefers (b) for the curved-arrow case (the field
  is small and both surfaces benefit) and (a) for the
  freehand-group case (it's PPTX-only — Office paste
  doesn't group freehand strokes — so the SVG read can stay
  inside `pptx-export` indefinitely).

**Acceptance:**

- Phase 0 PPTX snapshot still passes byte-equivalent.
- Existing `clipboard_test.rs` snapshots still pass.
- A new `svgAnnotationsToShapes.test.ts` covers the
  extractor for each emitter.

### Phase 2 — Shared per-shape DrawingML builder in `annot-render`

**Goal:** One TS implementation per emitter, consumed by both
surfaces.

**Files:**

- `packages/render/src/drawingml/` (NEW) — house the shared
  builders:
  - `index.ts` — public surface:
    `buildShapeXml(shape: AnnotationShape, opts:
    { id: number; ns: "a" | "p" }): string`,
    `buildBackgroundPicXml(opts: { rid: string; w: number;
    h: number; ns: "a" | "p"; nameAttr?: string }): string`.
  - `helpers.ts` — port of the helper bodies (`endOOXML`,
    `gradFillXml`, `xfrmAttrs`, `capOOXML`, `joinOOXML`,
    `colorHex`, `escXml`, `dashToDrawingMl`, EMU constants).
    Same names, no functional changes; tests pin the
    output.
  - `shapes/` — one file per emitter (`rect.ts`,
    `ellipse.ts`, `line.ts`, `marker.ts`, `text.ts`,
    `freehand.ts`, `mosaic-image.ts`). Each takes an
    `AnnotationShape`, returns a string in either the
    `a:` or `p:` namespace.
  - `drawingml.test.ts` — direct test of `buildShapeXml`
    against the same 8-shape canvas the
    `clipboard_test.rs` golden uses. Asserts the `a:`-prefix
    form is byte-equivalent to the Rust phase-0 snapshot
    (so we can prove TS reproduces Rust's existing output).
- `packages/editor/src/pptx-export.ts` — every per-shape
  `buildXxx(el: SVGElement, id)` is replaced by
  `buildShapeXml(shape, { id, ns: "p" })`. The freehand
  group wrapper, slide envelope, content types, theme
  remain in `pptx-export`. Wherever `pptx-export` carried
  PPTX-specific decisions (e.g. `<p:nvSpPr>` element vs
  GVML's `<a:nvSpPr>`), the namespace switch happens via
  the `ns` parameter; the per-shape internals don't
  duplicate.
- `packages/render/package.json` — already has TS / Vitest
  config from the three-package split; just add the new
  `drawingml/index.ts` export.

**Acceptance:**

- All `clipboard_test.rs` snapshots still pass (Rust still
  builds its own XML — phase 3 is what swaps that).
- Phase 0 PPTX snapshot still passes byte-equivalent.
- `drawingml.test.ts` snapshot matches the Rust phase-0
  snapshot for the `a:` namespace (proves cross-impl
  equivalence).

### Phase 3 — Tauri command takes pre-built drawing XML

**Goal:** Stop re-implementing the per-shape OOXML in Rust;
let the TS side build the XML and pass it through.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs`:
  - Change the `copy_as_office` signature to take
    `drawing_xml: String` instead of
    `shapes: Vec<AnnotationShape>` (and `canvas_width` /
    `canvas_height` stay because they're still needed for
    the GVML envelope's `<a:ext cx=… cy=…>`). Add a
    sibling field `mosaic_media: Vec<MosaicMedia>` for
    the per-mosaic image bytes the TS side has already
    parsed.
  - The Rust file shrinks to: ZIP packaging + Win32
    clipboard (`set_clipboard_all`) + DIB conversion
    (`png_to_dib`). The 600+ LOC of `gvml_rect`,
    `gvml_ellipse`, … vanish.
  - `clipboard_test.rs` is replaced (or pared down) to
    test the **packaging** — given a synthetic drawing XML
    string + canvas dims + mosaic media list, the produced
    ZIP has the right entries (`clipboard/drawings/
    drawing1.xml`, `clipboard/media/…`, theme,
    `[Content_Types].xml`, etc.). The per-shape OOXML
    snapshots move to `drawingml.test.ts`.
- `packages/core/src/utils/tauri-bridge.ts` —
  `copyAsOffice(drawingXml, mosaicMedia, canvasW, canvasH,
  screenshotData?, pngDataUrl?)` updates its TS
  signature to match.
- `packages/web/src/editor/toolbar.ts:#copyAll` — instead
  of building `AnnotationShape[]` and handing them to
  `copyAsOffice`, build the shapes, run them through
  `buildShapeXml` (with `ns: "a"` and the GVML envelope
  wrapper), pre-parse mosaic data URLs into byte buffers,
  and pass `(drawingXml, mosaicMedia, …)` over IPC.

**Acceptance:**

- A copy-paste smoke test on Tauri Windows still produces
  the same Office-clipboard XML as before (verified by
  `cargo test --lib commands::clipboard_test` against the
  preserved-as-fixture phase-0 snapshot, fed through the
  new packaging path).
- All other `clipboard_test.rs` snapshots gone — replaced
  by the equivalent `drawingml.test.ts` snapshots in
  `annot-render`.

### Phase 4 — Wire the parity gaps both surfaces gained

**Goal:** Now that there's one builder, a few existing
parity gaps close for free. Land them as a single small PR.

**Files:**

- `packages/render/src/drawingml/shapes/text.ts` — gains
  the `wedgeRoundRectCallout` branch (originally added in
  phase 4 of the ABI plan, on the Rust side only). After
  this phase, `pptx-export`'d callouts also get a tail.
- `packages/render/src/drawingml/shapes/rect.ts` — gains
  the `redact_style: "solid"` no-outline branch
  (originally Rust-only). PPTX export's solid-bar redactions
  now match PowerPoint's "rectangle (no outline)" preset.
- New PPTX snapshot fixtures for callout-with-tail and
  redact-solid (mirrors the phase-4 / phase-5 fixtures
  added on the clipboard side).

**Acceptance:**

- Phase 0 PPTX snapshot is **NOT** byte-equivalent for the
  callout / redact-solid fixtures (intended visual change,
  documented in the PR).
- Manual: open a PPTX containing a callout in PowerPoint;
  verify the tail tip lands where the user drew it.

### Phase 5 — Cleanup + plan archival

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` —
  remove the `AnnotationShape` struct entirely (it's no
  longer the Rust-side wire format; the TS side owns the
  shape model). The struct's only remaining caller is the
  test helper, which moved out in phase 3.
- `packages/core/src/utils/tauri-bridge.ts` — refresh the
  doc comment on `AnnotationShape` so the "sent to the
  desktop side for Office clipboard export" header instead
  describes the input to the shared `buildShapeXml`
  builder (PPTX + clipboard).
- Move
  [`docs/plans/office-paste-shared-drawing-builder.md`](./office-paste-shared-drawing-builder.md)
  → `docs/plans/_done/office-paste-shared-drawing-builder.md`
  with the landing PR range.
- Update `docs/plans/README.md` index.
- Update [`CLAUDE.md`](../../CLAUDE.md)'s
  "Architectural guardrails" — section 5 (public API) gains
  a sentence: "DrawingML output for both PPTX export and
  Office clipboard goes through `@ingcreators/annot-render`'s
  `buildShapeXml`. New tools that need to be paste-able into
  Office add a per-shape builder under
  `packages/render/src/drawingml/shapes/` and a
  `transformOf` mapping in `packages/web/src/editor/
  svg-to-annotation-shapes.ts` — both surfaces pick up the
  new shape automatically."

## Out of scope

- **Replacing the hand-rolled string builder with a
  `quick-xml`-based templating layer** (Rust) or an OOXML
  SDK (`pptxgenjs`, `office-document-properties`) on the
  TS side. The hand-rolled approach is fine; refactoring
  the templating mechanism is its own concern.
- **Adding paste-into-Word support** for shapes that
  currently paste only into PowerPoint correctly.
  Tracked separately.
- **Cross-platform Office clipboard support.** Currently
  Windows-only via `set_clipboard_all`. macOS / Linux is
  a separate plan.
- **`pptx-export` going through Tauri / Rust on desktop.**
  PPTX export today builds the file in JS and downloads it
  as a `Blob`; that's fine on both Web and Tauri (Tauri
  intercepts the download dialog and writes to disk
  natively if needed). No change.

## Reference: existing code to read

Before starting, read these in this order:

1. [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts) —
   the TS-side OOXML builder that reads `SVGElement`s
   directly. Compare each `buildXxx` against its `gvml_xxx`
   counterpart in `clipboard.rs`.
2. [`packages/desktop/src-tauri/src/commands/clipboard.rs`](../../packages/desktop/src-tauri/src/commands/clipboard.rs) —
   the Rust-side OOXML builder that reads `AnnotationShape`s
   over the Tauri IPC.
3. [`packages/web/src/editor/toolbar.ts`](../../packages/web/src/editor/toolbar.ts) —
   `transformOf` (inside `#copyAll`) builds the
   `AnnotationShape[]` payload for the clipboard side.
   Phase 1 lifts this into a free function in
   `svg-to-annotation-shapes.ts`.
4. [`docs/plans/_done/office-paste-abi-modernisation.md`](./_done/office-paste-abi-modernisation.md) —
   the prior plan that set up the ABI lockstep this work
   depends on.
5. [`docs/plans/_done/three-package-split.md`](./_done/three-package-split.md) —
   defines `annot-render` as the home for data-driven
   `ImageRecord` / `AnnotationShape`-shape rendering. Same
   reasoning applies to DrawingML.

## Status log

- 2026-04-26 — Plan drafted as the natural follow-on to the
  office-paste ABI modernisation series. Builds on the
  TS↔Rust lockstep that series established; the goal is to
  collapse the parallel OOXML builders into one shared
  TS implementation under `annot-render`.
