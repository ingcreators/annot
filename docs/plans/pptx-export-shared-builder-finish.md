# Finish the PPTX export migration to the shared OOXML builder

> **Status:** Queued. Direct follow-up to
> [`_done/office-paste-shared-drawing-builder.md`](./_done/office-paste-shared-drawing-builder.md).
> That plan landed the shared builder under
> `@ingcreators/annot-render/drawingml` and migrated the simple
> shapes (rect / ellipse / text / marker / freehand single path /
> mosaic) onto it. Lines / arrows + the freehand session-group
> wrapper stayed on
> [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts)'s
> own SVG-element handlers because they need OOXML output that
> the shared builder didn't model yet (curved-arrow `<a:custGeom>`,
> PPTX-only `<p:grpSp>` group). This plan finishes the migration.
>
> **Risk:** Low–medium. The end state is `pptx-export.ts` containing
> only the slide envelope + theme + content-types + ZIP packaging
> — every per-shape OOXML emit goes through the shared builder.
> Both surfaces (PPTX export + Office clipboard) gain feature
> parity for free: curved arrows in clipboard paste, freehand
> grouping in clipboard paste (if we want it), and `<line>` legacy
> coverage in both.
>
> **Why this is small enough to be one plan, not several:** the
> code paths touched are narrow — pptx-export's residual handlers
> + a few extension points on the shared builder. No cross-language
> migration this time (Rust is already packaging-only).

## How to resume in a fresh session

```
"Read docs/plans/pptx-export-shared-builder-finish.md and start <phase>."
```

## Context

After
[`_done/office-paste-shared-drawing-builder` phase 4](./_done/office-paste-shared-drawing-builder.md)
landed, `pptx-export.ts` shrank from ~1070 LOC to ~877 LOC. But
the file still hosts ~10 helpers and 3 per-shape builders that
either duplicate `@ingcreators/annot-render/drawingml/helpers`
or block on shape-model gaps. Concretely:

### Pure helper duplicates (drop-in dedupe)

| pptx-export | render/drawingml/helpers | Notes |
|---|---|---|
| `colorHex` ([pptx-export.ts:30](../../packages/editor/src/pptx-export.ts)) | `chex` ([helpers.ts:33](../../packages/render/src/drawingml/helpers.ts)) | Both: `#rrggbb` / `#rgb` / `url(#…)` / fallback `000000`. ~20 LOC each, byte-identical output. |
| `PT_TO_EMU` / `PX_TO_EMU` / `ptToEMU(v)` / `px(v)` ([pptx-export.ts:18–28](../../packages/editor/src/pptx-export.ts)) | `PT_EMU` / `PX_EMU` / `pt(v)` / `px(v)` ([helpers.ts:15–26](../../packages/render/src/drawingml/helpers.ts)) | Same constants (9525 / 12700), same arithmetic. Different names — choose the shorter ones. |
| `parseSVGPath` returning `{x,y}[]` ([pptx-export.ts:673](../../packages/editor/src/pptx-export.ts)) | `parseSvgPath` returning `[number, number][]` ([helpers.ts:229](../../packages/render/src/drawingml/helpers.ts)) | Identical regex (`/[ML]\s*([\d.-]+)[,\s]+([\d.-]+)/g`). Adjust callers for tuple return. |
| `endOOXML(which, svgShape, svgWidth, svgLength)` ([pptx-export.ts:67](../../packages/editor/src/pptx-export.ts)) | `endXml(which, shape, width, length)` ([helpers.ts:60](../../packages/render/src/drawingml/helpers.ts)) | Same SVG-shape → OOXML preset map (six types), same `sm`/`med`/`lg` size dispatch. |
| `capOOXML(cap)` ([pptx-export.ts:220](../../packages/editor/src/pptx-export.ts)) | `capAttr(cap)` ([helpers.ts:82](../../packages/render/src/drawingml/helpers.ts)) | Same 3-way `butt/square/round` → `flat/sq/rnd` map. Output format differs slightly (pptx-export returns `"flat"`/`"sq"`/`"rnd"` plain; render returns `' cap="flat"'` etc with leading space). Caller-side adjustment needed. |
| `joinOOXML(join)` ([pptx-export.ts:226](../../packages/editor/src/pptx-export.ts)) | `joinXml(join)` ([helpers.ts:88](../../packages/render/src/drawingml/helpers.ts)) | Same `miter/round/bevel` → `<a:miter/>` / `<a:round/>` / `<a:bevel/>` map. |

### Structural duplicates (need shape-model widening)

| pptx-export | render/drawingml | Why still split |
|---|---|---|
| `xfrmAttrs(el: SVGElement, opts)` ([pptx-export.ts:245](../../packages/editor/src/pptx-export.ts)) | `xfrmAttrs(s: AnnotationShape, excludeFlip)` ([helpers.ts:165](../../packages/render/src/drawingml/helpers.ts)) | Same rotation / flip dispatch; different inputs. Goes away once pptx-export's `buildLine` and `buildFreehandGroup` migrate to the shared builder. |
| `paintXml(el, value, which)` ([pptx-export.ts:168](../../packages/editor/src/pptx-export.ts)) + `strokeOpacity(el)` ([pptx-export.ts:155](../../packages/editor/src/pptx-export.ts)) + `gradFillXml(gRaw)` ([pptx-export.ts:95](../../packages/editor/src/pptx-export.ts)) | `strokePaintXml(s, hex)` + `buildFillXml(fill, opacity)` + `gradFillXml(spec)` ([helpers.ts:108–157](../../packages/render/src/drawingml/helpers.ts)) | pptx-export reads gradient JSON / opacity from SVG attrs; render takes pre-parsed AnnotationShape fields. Goes away with the buildLine migration. |
| `_lnXml` ([pptx-export.ts:124](../../packages/editor/src/pptx-export.ts)) + `lineLnXml` ([pptx-export.ts:194](../../packages/editor/src/pptx-export.ts)) | (none — inline in `buildLine` / `buildRect` / `buildEllipse` / `buildFreehand` shape builders) | Used only by `buildLine`. Goes away with the migration. |
| `offsetFromTransform(el)` ([pptx-export.ts:239](../../packages/editor/src/pptx-export.ts)) | `translateOf(el)` ([svg-to-annotation-shapes.ts:29](../../packages/core/src/editor/svg-to-annotation-shapes.ts)) | pptx-export only reads `data-tx`/`data-ty`; svg-to-annotation-shapes also falls back to literal `transform="translate(…)"`. Used only by `buildFreehandGroup` after phase 3. |
| `dataUrlToUint8Array(dataUrl)` ([pptx-export.ts:659](../../packages/editor/src/pptx-export.ts)) | (similar pattern in [`drawing-envelope.ts`'s mosaic loop](../../packages/render/src/drawingml/drawing-envelope.ts)) | Trivial 10-line `atob` helper; used by `buildPptxFiles` for the screenshot embed. Could share but the saving is small. |

### Per-shape builders that need migration

| pptx-export | Shared builder gap | Resolution |
|---|---|---|
| `buildLine` ([pptx-export.ts:396](../../packages/editor/src/pptx-export.ts)) | Curved-arrow `<a:custGeom>` Bezier path | Extend `AnnotationShape` with `arrow_curve_cx?` + `arrow_curve_cy?`. Add `<a:custGeom>` branch to [`render/src/drawingml/shapes/line.ts`](../../packages/render/src/drawingml/shapes/line.ts) when curve coords are present. Plain `<line>` elements are not migrated — phase 1 drops the legacy dispatch arm. |
| `buildFreehand` ([pptx-export.ts:508](../../packages/editor/src/pptx-export.ts)) | (none — used only as `buildFreehandGroup`'s per-child emitter) | Replace internal call with `buildShapeXml(svgElementToAnnotationShape(p), { ns: "p", id })` inside `buildFreehandGroup`. `buildFreehand` then disappears. |
| `buildFreehandGroup` ([pptx-export.ts:591](../../packages/editor/src/pptx-export.ts)) | PPTX-only `<p:grpSp>` wrapper; the GVML clipboard side flattens | Stays in pptx-export — it's a PPTX-only presentation feature. But its child-emit loop routes through the shared builder so the duplicate `buildFreehand` goes away. |

### Legacy `<line>` element — drop, don't unify

`pptx-export.ts:buildShapes` dispatches `tag === "line"` to its
local `buildLine`. This branch only fires for plain `<line>`
elements that survive in saved annotations from before
ArrowTool was unified into the `<g data-type="arrow">` form;
the current ArrowTool no longer emits `<line>` directly (a
`grep -rn "createElementNS.*line\|tag === \"line\"" packages/editor/src/tools/`
returns nothing). Past-data salvage is explicitly **out of
scope** — user direction (2026-04-26) is to drop the legacy
branch as dead code rather than mirror it on the Office-paste
side. Phase 1 deletes the dispatch arm; the shared builder
stays scoped to ArrowTool's current output (`<g
data-type="arrow">`, optionally with a curve control point).

## Goal

After this plan lands:

- `pptx-export.ts` contains: the slide envelope + theme +
  content_types + relationships + ZIP packaging. No per-shape
  OOXML helpers, no per-shape OOXML emitters. Likely ≤500 LOC
  (down from the current ~877 LOC).
- Adding a new tool that needs OOXML support: one
  `transformOf` mapping (Tier B) + one per-shape builder (Tier
  C-render). PPTX export and Office paste pick it up
  automatically. The CLAUDE.md guardrail added in
  `_done/office-paste-shared-drawing-builder` phase 5 already
  documents this; this plan makes the guardrail's promise
  literally true (today there's still a per-shape line /
  freehand-group emitter pptx-export side that escapes the
  guardrail).
- Both surfaces gain feature parity for legacy `<line>`
  elements + curved arrows.

## Constraints

- **Byte-equivalent OOXML output for every existing fixture
  in `pptx-export.test.ts`** unless a phase explicitly calls
  out an intentional snapshot diff. Phase 3 (curved-arrow + line
  via shared builder) is expected to produce byte-equivalent XML
  for the non-curved cases and byte-different XML for curved
  arrows (the `<a:custGeom>` form converges with whatever the
  shared builder emits, plus the wrapper attrs converge to
  GVML form).
- **Cross-impl byte-equivalence with the Rust GVML goldens
  stays intact.** Phase 3 adds new fields to `AnnotationShape`
  but optional + None-by-default — the existing
  `drawingml.test.ts` 5 fixtures are unaffected.
- **One concept per phase.** Each phase is independently
  merge-able + revertable. Land phase 0 → wait for green →
  phase 1 → … . No big-bang rename.

## Phases

### Phase 0 — Lock the curved-arrow path in the PPTX golden

**Goal:** The current `pptx-export.test.ts` fixture covers
`<g data-type="arrow">` with a triangle head and a freehand
session group, but does NOT cover a curved arrow (the
`<a:custGeom>` quadratic-Bezier form). Without that fixture,
phase 3 lands "blind" — the `<a:custGeom>` migration could
silently drop the curve and the diff would look clean.

**Files:**

- [`packages/editor/src/pptx-export.test.ts`](../../packages/editor/src/pptx-export.test.ts)
  — add a test fixture for a curved arrow (`<g
  data-type="arrow">` with `data-cx` / `data-cy` populated).
  Snapshot via `toMatchSnapshot()`, mirroring the existing
  fixtures. The plain-line fixture in the existing
  `pins the current output for every emitter` snapshot stays
  for now; phase 1 removes the test's `svg("line", …)`
  contributor along with the production code.

**Acceptance:**

- `pnpm vitest run packages/editor/src/pptx-export.test.ts` —
  4 passed (3 existing + 1 new).
- The new snapshot pins the current `<a:custGeom>` quadratic
  Bezier output literally; phase 3 must match it.

### Phase 1 — Drop the drop-in helper duplicates + the legacy `<line>` dispatch

**Goal:** Replace pptx-export's `colorHex` / `endOOXML` /
`capOOXML` / `joinOOXML` / `parseSVGPath` / EMU constants with
imports from `@ingcreators/annot-render/drawingml/helpers`.
At the same time delete the `tag === "line"` branch in
`buildShapes` (legacy past-data salvage; ArrowTool no longer
emits plain `<line>`). No structural change for the modern
ArrowTool path; pure dedupe + dead-code removal.

**Files:**

- [`packages/render/src/drawingml/index.ts`](../../packages/render/src/drawingml/index.ts)
  — re-export the helpers (`chex`, `endXml`, `capAttr`,
  `joinXml`, `parseSvgPath`, `pt`, `px`, `PT_EMU`, `PX_EMU`)
  so callers import from the single
  `@ingcreators/annot-render` entry. (Today they're not on
  the package's public surface; pptx-export would need a deep
  import.)
- [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts):
  - Drop `PT_TO_EMU` / `PX_TO_EMU` / `ptToEMU` / `px` /
    `colorHex` / `endOOXML` / `capOOXML` / `joinOOXML` /
    `parseSVGPath` constants and functions.
  - Import `pt`, `px`, `chex`, `endXml`, `capAttr`,
    `joinXml`, `parseSvgPath` from `@ingcreators/annot-render`
    (or its `drawingml` subpath).
  - Adjust callers for the cap-attr format change (pptx-export's
    `capOOXML` returned `"flat"` / `"sq"` / `"rnd"` plain;
    render's `capAttr` returns `' cap="flat"'` with leading
    space). The two spots in pptx-export that consume the
    return value (`buildLine`'s `<a:ln cap="…"`) need a
    mechanical edit.
  - Adjust `buildFreehand`'s callsite for the tuple return
    type of `parseSvgPath`.
  - **Delete** the `if (tag === "line") { ... }` branch in
    `buildShapes`. ArrowTool emits `<g data-type="arrow">`
    exclusively (verified via `grep -rn "createElementNS.*line\|tag === \"line\""
    packages/editor/src/tools/`); the only payloads that
    fired this branch were back-compat reads from old saved
    files, which are out of scope per the user direction
    on 2026-04-26.
- [`packages/editor/src/pptx-export.test.ts`](../../packages/editor/src/pptx-export.test.ts)
  — drop the `svg("line", …)` contributor in the
  `pins the current output for every emitter` fixture (one
  shape removed). The snapshot's `<a:cxnSp>` for the bare
  line goes away; the existing arrow-group entry covers the
  modern surface.

**Acceptance:**

- `pptx-export.test.ts` — fixture snapshot regenerates with
  the bare-line `<a:cxnSp>` removed (intentional, declared
  in the PR description). Curved-arrow + freehand-group +
  arrow-group + rect / ellipse / text / marker / freehand-
  single fixtures stay byte-equivalent.
- `pnpm -r typecheck` — green.
- `pnpm test` — same pass count as before (snapshots
  regenerated, not added).

### Phase 2 — Migrate `buildFreehandGroup`'s child emit through the shared builder

**Goal:** `buildFreehandGroup` keeps its `<p:grpSp>` wrapper
(PPTX-only structure; intentionally not in shared builder),
but its per-child path emit goes through
`buildShapeXml(shape, { ns: "p", id })`. After this phase,
`buildFreehand` (the per-path emitter) disappears entirely.

**Files:**

- [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts):
  - Inside `buildFreehandGroup`, replace the loop that calls
    `buildFreehand(p, childId)` with one that:
    - calls `svgElementToAnnotationShape(p)` to get an
      AnnotationShape;
    - calls `buildShapeXml(shape, { ns: "p", id: childId })` to
      get the per-stroke `<p:sp>`.
  - Drop `buildFreehand` entirely.

**Acceptance:**

- `pptx-export.test.ts` — all 4 snapshots byte-equivalent
  (the child-stroke XML matches what the shared builder emits;
  phase 4 of `_done/office-paste-shared-drawing-builder` already
  proved byte-equivalence for single-path freehand).

### Phase 3 — Widen `AnnotationShape` for curved arrows; migrate `buildLine`

**Goal:** Move the arrow / curved-arrow OOXML emit into the
shared builder. After this phase, pptx-export has no
line-related helpers (`paintXml` / `strokeOpacity` / `_lnXml` /
`lineLnXml` / SVG-element `xfrmAttrs` / `buildLine`).

**Files:**

- [`packages/core/src/utils/tauri-bridge.ts`](../../packages/core/src/utils/tauri-bridge.ts)
  — add `arrow_curve_cx?: number` + `arrow_curve_cy?: number`
  to `AnnotationShape`. Both populated together; either being
  absent degrades to a straight line.
- [`packages/core/src/editor/svg-to-annotation-shapes.ts`](../../packages/core/src/editor/svg-to-annotation-shapes.ts)
  — extend the arrow-group branch to read `data-cx` /
  `data-cy` (or whatever `getEffectiveLineEndpoints` populates
  for the curve control point) and emit
  `arrow_curve_cx` / `arrow_curve_cy` when present. No new
  `<line>` branch — the legacy dispatch was removed in phase 1.
- [`packages/render/src/drawingml/shapes/line.ts`](../../packages/render/src/drawingml/shapes/line.ts)
  — when `arrow_curve_cx` + `arrow_curve_cy` are populated,
  swap the `<a:prstGeom prst="line">` for `<a:custGeom>` with
  a `<a:moveTo>` + `<a:quadBezTo>` path (mirroring pptx-export's
  current curved-arrow output). Bbox computation includes the
  control point (already in `getEffectiveLineEndpoints` on the
  TS side).
- [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts):
  - Drop `buildLine`, `paintXml`, `strokeOpacity`, `_lnXml`,
    `lineLnXml`, the SVG-element `xfrmAttrs`, and
    pptx-export's own `gradFillXml` (the `gRaw` / JSON-parsing
    variant).
  - The `if (tag === "g" && data-type === "arrow") { ... }`
    branch in `buildShapes` folds into the generic
    `svgElementToAnnotationShape → buildShapeXml` dispatch
    (same as rect / ellipse / etc).

**Acceptance:**

- `pptx-export.test.ts` — phase 0's curved-arrow snapshot
  matches the new shared-builder output (intentionally
  byte-equivalent or with the same minor cosmetic-shift the
  other phase-4 migrations had — declared in the PR
  description).
- `drawingml.test.ts` — existing 5 fixtures byte-equivalent
  (the new fields default to `None`, the existing `arrow()`
  fixture stays straight).
- New `drawingml.test.ts` fixture for curved arrow asserts
  the `<a:custGeom>` form.

### Phase 4 — Cleanup

**Files:**

- [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts):
  - Drop `offsetFromTransform` (no remaining caller after
    phase 2 + 3).
  - Drop `dataUrlToUint8Array` if a shared helper has been
    introduced; otherwise leave it (10-line `atob` helper,
    not duplication-worthy).
  - Refresh the file header / module-level comment to
    describe the now-narrow surface (slide envelope +
    packaging only).
- Move
  [`docs/plans/pptx-export-shared-builder-finish.md`](./pptx-export-shared-builder-finish.md)
  → `docs/plans/_done/` with the landing PR range.
- Update `docs/plans/README.md` index.

**Acceptance:**

- All test suites pass; pptx-export.ts ≤ 500 LOC (down from
  ~877).
- A `grep -r "buildLine\|buildFreehand\|colorHex\|endOOXML\|paintXml" packages/editor/src/pptx-export.ts`
  returns nothing.
- A `grep -rn "tag === \"line\"" packages/` returns nothing
  outside test fixtures (the legacy dispatch arm is gone
  from production code).

## Out of scope

- **Adding a "freehand session group" concept to the shared
  builder.** The `<p:grpSp>` wrapper is PPTX-only — the GVML
  clipboard side intentionally flattens to individual freehand
  shapes. Cross-surface unification of grouping is a separate
  product question (do clipboard pastes want grouping?), not
  a refactor.
- **Replacing the hand-rolled string builder with a `quick-xml`
  / OOXML SDK.** Same rationale as the parent plan: the
  hand-rolled approach works; templating is its own concern.
- **Migrating pptx-export's `buildSlide` / `theme()` /
  packaging helpers.** Those are PPTX-document-level
  scaffolding (slide layouts, masters, theme) that the GVML
  clipboard side replaces entirely — not duplication.

## Reference: existing code to read

Before starting, read these in this order:

1. [`packages/editor/src/pptx-export.ts`](../../packages/editor/src/pptx-export.ts) —
   what's left after phase 4 of the parent plan. Most of
   what this plan touches is in lines 1–700.
2. [`packages/render/src/drawingml/helpers.ts`](../../packages/render/src/drawingml/helpers.ts)
   + [`shapes/line.ts`](../../packages/render/src/drawingml/shapes/line.ts) —
   the canonical helpers + the line emitter that needs
   widening for curves.
3. [`packages/core/src/editor/svg-to-annotation-shapes.ts`](../../packages/core/src/editor/svg-to-annotation-shapes.ts) —
   the SVG → AnnotationShape extractor that needs `<line>`
   coverage + curved-arrow control-point reads in phase 3.
4. [`docs/plans/_done/office-paste-shared-drawing-builder.md`](./_done/office-paste-shared-drawing-builder.md) —
   the parent plan that landed the shared builder. Helpful
   for context; phase boundaries here mirror its phase 4
   migration pattern (input-side change first, then a
   per-phase byte-equivalence check, then cleanup).

## Status log

- 2026-04-26 — Plan drafted as the natural follow-up to
  `_done/office-paste-shared-drawing-builder`. Found via a
  systematic duplication audit of the post-refactor
  `pptx-export.ts` / `render/drawingml/helpers.ts` /
  `svg-to-annotation-shapes.ts` triple. The audit flagged
  both curved arrows (current ArrowTool feature, silently
  lost in Office paste) and plain-`<line>` (legacy past-data
  salvage) as parity gaps.
- 2026-04-26 — User direction: drop the legacy `<line>`
  branch as dead code rather than mirror it on the
  Office-paste side. Past-data salvage is out of scope; the
  plan unifies on ArrowTool's current output (`<g
  data-type="arrow">`, with optional curve control point).
  Phase 1 absorbs the legacy delete; phase 3 simplifies to
  curved-arrow widening only.
