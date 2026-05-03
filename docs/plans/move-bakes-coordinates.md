# Move bakes coordinates — transform reserved for rotation / flip

> **Status:** Draft
> **Compatibility:** **Pre-release; no backward-compat shims.**
>   Existing `<g>` / `<path>` annotations saved with
>   `data-tx` / `data-ty` carrying the position will, on first
>   load after this lands, get baked into the children's
>   geometry attrs. Stored SVGs are forward-only — earlier Annot
>   builds reading the post-bake SVG will still render correctly
>   (the geometry attrs are valid SVG; `data-tx`/`data-ty` just
>   evaluate to 0). The `data-annot-version` does **not** bump:
>   the post-bake SVG is structurally identical to "the user
>   just placed the shape at this final position".
> **Risk:** Phased; each phase is independently revertable.
>   Per-shape bakers are tested in isolation before any
>   `#moveElement` switchover, and the legacy transform-based
>   move stays available for rotated / flipped elements (where
>   pivot tracking is still required).

## Context

The current move semantics are split by shape kind:

| Kind | Move impl | Stores position in |
|---|---|---|
| `rect` / `image` | rewrites `x` / `y` | geometry attrs |
| `ellipse` / `circle` | rewrites `cx` / `cy` | geometry attrs |
| `text` / `foreignObject` | rewrites `x` / `y` | geometry attrs |
| `line` / `<g data-type="arrow">` | `bakeLineTransform` + endpoint rewrite | endpoint attrs |
| `<path>` (Freehand, Redact-path, future Focus-mask) | `nudgeTranslate` writes `data-tx` / `data-ty` and rebuilds `transform="translate(...)"` | transform attribute |
| `<g data-type="shape">` (Sticky / Callout / Text-on-shape / Textbox) | same as path | transform attribute |
| `<g data-type="group">` | same as path | transform attribute |
| `<g data-type="marker">` (Counter) | same as path | transform attribute |

Two consequences flow from this split:

1. `el.getBBox()` returns the LOCAL bbox — the children's bounds
   in the element's own coord system, ignoring its `transform`.
   For geometry-positioned elements local == world. For
   transform-positioned elements (the bottom four rows above),
   local == pre-move position. Every code path that wants the
   visual bounds needs the `#worldBBox` (CTM-applying) helper
   instead of plain `getBBox`. Forgetting to use the helper
   looks fine for most shape kinds, then quietly breaks on
   moved Sticky / Callout / Group — exactly the marquee bug
   fixed in [#378](https://github.com/ingcreators/annot/pull/378).
2. SVG output for moved transform-positioned shapes is
   inspectable only after composing the transform mentally:
   `<rect x="50" y="50" .../>` inside a `<g transform="translate(300,
   200)">` paints at (350, 250). The on-disk position
   doesn't match what the user sees, which is annoying when
   debugging saved files / OOXML / extension transfers.

We want the simpler, more uniform model: **every move bakes
position into the children's geometry attrs; `transform`
carries only rotation / flip**. After this lands:

- `getBBox()` returns the visual position for every shape kind.
- The `#worldBBox` helper still exists (rotated shapes need it),
  but the surface that actually depends on it shrinks to
  rotation/flip-aware code paths only.
- SVG output reads "what you see is the geometry": no mental
  transform composition required for the move-only case.
- The pivot-tracking `applyTransformState`-after-`nudgeTranslate(0,0)`
  pattern (currently called for geometry-positioned elements
  to refresh the rotation pivot) generalises uniformly: when a
  shape is moved by baking, the bbox center for the next
  rotate is automatically the new visual center.

## Design

### Move dispatch

`#moveElement` (`packages/editor/src/selection.ts`) decomposes
to two cases:

- **Identity transform** (no rotation, no flip) → translate by
  baking child geometry. The element's `data-tx` / `data-ty`
  / `data-rot` / `data-flip-*` stay absent / zero; `transform`
  is removed entirely (matches `applyTransformState`'s "is
  identity → removeAttribute('transform')" branch).
- **Non-identity transform** (rotation / flip present) →
  legacy `nudgeTranslate` path: persist `tx` / `ty` deltas
  into `data-tx` / `data-ty` and re-emit a `matrix(...)`
  that combines the new translation with the existing
  rotation / flip. Pivot at the LOCAL bbox center, same as
  today.

The decision is made per-element by reading
`readTransformState(el).rotation === 0 && !flipH && !flipV`. A
single `<g data-type="group">` move can mix children: the
group itself may have no rotation, but the children might.
Each level of the recursion makes its own decision.

### Per-shape `bakeTranslate(el, dx, dy)` helpers

Each transform-positioned shape kind needs a baker that walks
its known children and shifts the geometry attrs that carry
position. Bakers live alongside the shape's primary helpers
so the shape's structural knowledge stays in one place.

| Shape kind | Baker location | Children to shift |
|---|---|---|
| `<g data-shape-kind="sticky">` / `"callout"` / text-on-shape (`"rect"` / `"rounded"` / `"ellipse"`) | `text-utils.ts` (sibling of `createTextShape` / `replaceRunsInPlace`) | bg primitive (`<rect>` x,y or `<ellipse>` cx,cy) + clipPath `<rect>` x,y + tail `<path>` d (callout only) + `data-tail-x` / `data-tail-y` (callout only) + inner `<text>` x + every `<tspan>` x,y |
| `<g data-shape-kind="textbox">` (Plain text) | `text-utils.ts` | inner `<text>` x + every `<tspan>` x,y (no bg, no clipPath) |
| `<g data-type="marker">` (Counter) | `marker-utils.ts` | bg primitive (`<rect>` x,y or `<circle>` cx,cy or `<ellipse>` cx,cy) + numeral `<text>` x + numeral `<tspan>` x,y |
| `<g data-type="group">` | `transform-utils.ts` (the only generic group-aware baker) | recurses into each child via `bakeTranslate` (or rewrites geometry attrs directly for geometry-positioned children) |
| `<path>` (Freehand, Redact-path, future Focus-mask) | `transform-utils.ts` | `d` attribute — rewrite by adding dx,dy to every absolute coord; relative coords (lowercase commands) carry through unchanged |

`bakeTranslate(el, dx, dy)` in `transform-utils.ts` is the
public entry point — it dispatches by `tagName` +
`data-type` / `data-shape-kind` to the right per-shape baker.
Geometry-positioned elements (rect / ellipse / etc.) and
line-likes route to the existing geometry-rewrite paths
(`bakeLineTransform` for line/arrow). Unknown shapes fall
back to `nudgeTranslate` (the safe default).

### Path `d` shifting

The `<path>` baker shifts the `d` attribute. SVG path data
mixes absolute (uppercase) and relative (lowercase) commands;
only absolute coordinates need dx,dy added. Relative deltas
between successive points are unaffected by a global
translation.

A small parser walks the command stream, recognises
`M / L / H / V / C / S / Q / T / A` (absolute) and their
lowercase relative pairs, and rewrites only the absolute
coordinate slots. `Z` / `z` is a no-op.

A regex-based shifter would work for Annot's freehand /
redact-path / focus-mask outputs (which only emit a known
subset of commands), but the parser version is robust against
future shape kinds and against edge cases like exponent
notation in path coords. The parser ships in
`@ingcreators/annot-core/editor/path-utils.ts` (new file) and
is unit-tested in isolation against fixture paths.

### Group recursion

`bakeGroupTranslate(g, dx, dy)` walks `g.children`; for each
child:

- If the child is geometry-positioned, the helper rewrites
  its geometry attrs directly (no recursion needed).
- If the child is transform-positioned, the helper recurses
  via `bakeTranslate`.

A nested group with its own translation accumulates: the
parent's translate adds to the child's local position, but
the child's own transform stays as-is. Since we're already
at the "no rotation/flip" branch, the parent has no transform
to compose with — straight addition works.

If the child has its OWN rotation/flip, we have two options:

- **Option A — bake then re-apply:** bake the parent's
  translate into the child's coordinates (which doesn't touch
  the child's rotate-around-pivot transform; only its position
  in the parent frame), then `applyTransformState(child)` to
  re-emit the child's transform with the new pivot. The
  visual stays identical because the child's effective
  transform is `parent_translate * child_rotate(cx, cy)`,
  which equals `child_rotate(cx + dx, cy + dy)` after baking.
- **Option B — keep the parent on transform-based move** when
  any descendant is rotated. Simpler but means a group with
  one rotated child never benefits from the bake.

Option A is preferred — uniform behaviour, and the
`applyTransformState` re-emit is exactly what
`nudgeTranslate(child, 0, 0)` already does for geometry-
positioned children when the parent moved them.

### Other call sites

Code that currently calls `nudgeTranslate(el, dx, dy)` with
non-zero deltas needs review. As of `main` at the time of
writing, the only such site is `#moveElement` —
`nudgeTranslate(el, 0, 0)` calls (used by group ungroup,
resize, etc.) only refresh the rotation pivot and stay
unchanged.

After this plan lands, `#worldBBox` callers split into two
groups:

- **Still need `#worldBBox`:** code that operates on rotated /
  flipped shapes (multi-select drag of a mixed selection,
  smart-guide projection of a rotated bbox onto axis-aligned
  guides, group fitting to a rotated child).
- **Could simplify to `getBBox`:** code that only ever sees the
  visual position and doesn't care about the underlying
  transform model (marquee hit-test — already migrated; snap
  candidate collection; per-element bbox for the property
  panel's "Position" readout).

The simplification is opportunistic — phase 4 sweeps the
known sites; future code defaulting to `#worldBBox` stays
correct, just slightly slower than necessary.

### What does NOT change

- Resize: still mutates geometry attrs (bg `<rect>` x,y,w,h or
  ellipse cx,cy,rx,ry); the existing `#resizeElement` path
  doesn't touch transforms beyond recomputing the rotation
  pivot via `applyTransformState`. After this plan, that
  matches the move semantics exactly.
- Rotation / flip: still go through
  `writeTransformState({ rotation, flipH, flipV })` and the
  `applyTransformState` matrix emission. The pivot stays at
  the LOCAL bbox center, which after baking is also the
  visual center — no behavioural change.
- Line / arrow: `bakeLineTransform` + endpoint rewrite is
  already the bake-on-move behaviour. No change here either.
- The `data-tx` / `data-ty` schema fields stay reserved for
  the rotation/flip case (where they carry the screen-space
  translation that the matrix needs to emit). Readers /
  writers don't change.

## Phases

Each phase is one PR. Phase boundaries chosen so a phase-N
revert never forces a phase-(N+1) revert.

### Phase 1 — Core path baker + tests

Land `path-utils.ts:translatePathD(d, dx, dy)` in
`@ingcreators/annot-core/editor` (Tier B). Pure function;
input is a `d` string, output is a `d` string with all
absolute coordinates shifted. Lowercase / relative commands
pass through. Unit tests cover each command type, mixed
sequences, exponent notation, signed coords.

Independent of the rest of the plan — the helper is generally
useful even before the move refactor consumes it.

### Phase 2 — Per-shape `bakeTranslate` helpers + tests

Land the four per-shape bakers in their canonical locations:

- `text-utils.ts:bakeTextShapeTranslate(g, dx, dy)` — covers
  sticky / callout / text-on-shape / textbox.
- `marker-utils.ts:bakeMarkerTranslate(g, dx, dy)` — covers
  counter.
- `transform-utils.ts:bakePathTranslate(p, dx, dy)` — wraps
  `translatePathD` from phase 1.
- `transform-utils.ts:bakeGroupTranslate(g, dx, dy)` — recursive,
  dispatches per child via the public `bakeTranslate` entry
  added in phase 3.

Each helper is unit-tested in isolation: build a shape, call
the baker, assert children's geometry attrs shifted by exactly
dx,dy AND that the post-bake `getBBox()` matches what the
pre-bake `#worldBBox` would have returned with that translate
applied.

No call sites change yet. The bakers are dead code until
phase 3 wires them into the dispatcher.

### Phase 3 — `bakeTranslate` dispatcher + `#moveElement` switchover

Land `transform-utils.ts:bakeTranslate(el, dx, dy)` — the
public entry point that dispatches by `tagName` +
`data-type` / `data-shape-kind` to the right per-shape baker
or to a geometry-attr rewrite for geometry-positioned
elements.

Update `selection.ts:#moveElement`:

- Drop the `} else if (tag === "path" || tag === "g") {`
  arm that calls `nudgeTranslate(el, dx, dy)`.
- Add a top-level decision: if
  `readTransformState(el).rotation === 0 && !flipH && !flipV`,
  call `bakeTranslate(el, dx, dy)` then
  `applyTransformState(el)` (no-op for an identity state but
  defends against future state changes). Otherwise call
  `nudgeTranslate(el, dx, dy)` as today.
- The geometry-positioned and line-like arms stay; they're
  already coord-baking.

Verified by:

- Existing 1068 unit tests stay green.
- Manual: place a sticky / callout / counter / freehand /
  group, drag it, marquee at OLD position → no selection;
  marquee at NEW visual position → selection picks the
  correct shape.
- Inspect saved SVG in DevTools: the moved shape's children
  have the new coords directly; no `transform="translate(...)"`
  on the wrapper.

### Phase 4 — Opportunistic `#worldBBox` → `getBBox` simplification

Sweep the known `#worldBBox` callers in `selection.ts` (8
sites at last count) and replace with `getBBox` where the
caller only ever needs the visual bbox of a single element
(no rotation handling). Sites that handle multi-select with
mixed rotation, group fitting, or smart-guide projection
keep `#worldBBox`.

Independent of the move refactor proper — purely a cleanup.
Skip if it surfaces unexpected coupling.

### Phase 5 — Cleanup + plan archival

- Delete dead branches in `nudgeTranslate` if any (e.g. the
  `usesGeometryPosition` short-circuit that calls
  `applyTransformState` for the post-resize pivot refresh
  may simplify after move semantics align).
- Update CLAUDE.md's section on transform handling: the new
  invariant is "translate baked on move, transform carries
  only rotation/flip"; add a one-liner pointing
  contributors at the bakers in `text-utils.ts` /
  `marker-utils.ts` / `transform-utils.ts`.
- Move this plan to `docs/plans/_done/` with a one-line
  summary in the README index.

## Test plan

- Unit tests:
  - `path-utils.translatePathD` — per command, mixed, signed,
    exponent.
  - Each per-shape baker — round-trip getBBox vs `#worldBBox`-
    with-translate.
  - `bakeGroupTranslate` recursion — nested groups, mixed
    rotated / unrotated children.
- Integration / manual:
  - Place sticky → drag → marquee at old position → confirm
    no selection (this is the regression that triggered the
    plan).
  - Same for callout (with tail), text-on-shape (rect /
    rounded / ellipse), textbox, counter, freehand path,
    redact-path, group of mixed shapes.
  - Rotate a sticky 30°, drag → confirm rotation pivot still
    tracks visual center on second drag.
  - Group two rotated children, move group → confirm both
    children translate together; rotate the group → confirm
    each child's local rotation composes correctly.
- SVG output inspection:
  - Save → reload → confirm the moved shape's children carry
    the new coords directly; no `data-tx` / `data-ty` on the
    wrapper.
  - Round-trip via PPTX export → confirm no regression in
    OOXML output.
- `pnpm -r typecheck`, `pnpm test`, `pnpm lint`, `pnpm
  --filter @ingcreators/annot-web build` after each phase.

## Out of scope

- Schema bump (no `data-annot-version` change — the post-bake
  SVG is structurally identical to a freshly-placed shape).
- Backward compat for documents saved with `data-tx` /
  `data-ty` (per the user's directive at plan-creation time:
  pre-release, no compat shims). Reading such a document
  will display correctly because the transform attr still
  exists; the next move will then bake the position and the
  `data-tx` / `data-ty` will be cleared. No explicit
  migration step.
- Resize / rotation / flip semantics (unchanged).
- Line / arrow `bakeLineTransform` (already the desired
  behaviour).
- Other simplifications that the unified bake unlocks (e.g.
  `#worldBBox` could potentially be deleted in a future
  pass) — those are separate plans, not piled into this one.
