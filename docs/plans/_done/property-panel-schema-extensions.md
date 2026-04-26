# PropertyPanel — Schema-driven Render Extensions

> **Status:** Done — Phases A / B / C landed in PRs #162 / #163 /
> #164 (April 2026). Continuation of
> [`property-panel-schema.md`](./property-panel-schema.md) (PRs
> #153–#161). The original migration left three categories of
> imperative rows untouched because they didn't fit the registry's
> shape at the time. This plan extended the registry to cover them
> and migrated the matching panel code.
>
> **PR map:**
> - #162 — Phase A: marker bg-primitive controls (5 new ids)
> - #163 — Phase B: shape transparency + cap type + arrow-aware
>   strokeColor / strokeWidth augmentations (3 new ids, 3
>   augmented setters)
> - #164 — Phase C: per-end arrow type + size pulldowns (4 new
>   ids; renderer gained `getOptions` / `selectColumns` /
>   `selectPopupWidth`; arrow preview helpers moved to Tier B)
>
> **Outcome:** every row in `#renderShapeControls` /
> `#renderMarkerControls` is schema-driven now. `property-panel.ts`
> shrank from 1,377 → ~991 LOC across the three phases (and from
> the original 1,817 baseline → -826 total). The `#renderXxx
> Controls` methods are now small enough to inline directly into
> `show()`'s switch if a future cleanup wants to.
>
> **Scope:** Three independently-merge-able phases that close out
> the residual imperative `#addXxx` chains in
> `packages/editor/src/property-panel.ts`. After all three land,
> the panel's per-category render methods should be small enough
> to inline back into `show()`'s switch.

## How to resume in a fresh session

```
"Read docs/plans/property-panel-schema-extensions.md and start <phase>."
```

Each phase below is self-contained and lists its own files +
acceptance criteria.

## Context

The schema-driven migration ([`_done/property-panel-schema.md`](./_done/property-panel-schema.md))
landed the registry, renderer, and live-panel migration end-to-end
across PRs #153–#161. `property-panel.ts` shrank from 1,817 →
1,377 LOC. The plan's stretch target (≤800 LOC) wasn't reached
because three sets of imperative rows remained:

1. **Marker bg-primitive controls** — Fill / Line / Label-Value
   rows in `#renderMarkerControls` write to the marker's INNER
   `<circle>` / `<rect>` bg primitive (`g.querySelector("circle, rect")`),
   not the outer `<g>`. The registry's standard `fillColor` /
   `strokeColor` / `strokeWidth` controls all operate on the
   target element via `el.setAttribute(...)` and don't model
   that traversal.
2. **Stroke / fill transparency + cap type** — `#addPPLineSection`
   carries Transparency (with a line-vs-shape opacity quirk —
   lines use `opacity` so SVG markers fade with the stroke; shapes
   use `stroke-opacity`), Cap type (`stroke-linecap`), and the
   per-end arrow rows. The registry didn't model these.
3. **Per-end arrow type & size pulldowns** — the most complex
   row pair. Each endpoint (Begin / End) gets a Type pulldown
   (6 OOXML preset shapes in a 3-col grid) and a Size pulldown
   (3×3 width × length grid). Values are compound (shape + width
   + length per end), and the Type pulldown's option list is
   filtered by the variant (Line / Arrow / Double arrow).

The schema-driven scaffold landed in #155–#161 makes each piece
addressable by adding registry ids + (where needed) effect
handlers, then swapping the imperative row in the panel.

## Phases

### Phase A — Marker bg-primitive controls

**Goal:** Add 5 control ids that traverse from the outer marker
`<g>` to its inner `<circle>` / `<rect>` bg primitive, then
migrate `#renderMarkerControls`'s Fill / Line / Label-Value rows.

**New control ids** (`PROPERTY_CONTROL_IDS`):

| id | type | reads / writes | notes |
|---|---|---|---|
| `markerBgFillColor` | color | `bg.fill` | `allowNone: true` (counter can be outline-only) |
| `markerBgStrokeColor` | color | `bg.stroke` | — |
| `markerBgStrokeWidth` | number | `bg.stroke-width` | min 0, max 20, step 0.25, unit "pt"; recompute dasharray on change |
| `markerBgStrokeStyle` | select | `bg.data-dash-key` / `bg.stroke-dasharray` | same 5 dash presets as `strokeStyle` |
| `markerLabelValue` | number | `g.data-marker` + `text.textContent` | min 1, max 999, step 1, no unit |

All five are pure Tier B (just element traversal + attribute
writes / reads). `bg = g.querySelector("circle, rect")`. Plain
`setValue` mutators — no `effect` needed.

**Files:**

- `packages/core/src/editor/property-schema.ts` — extend
  `PROPERTY_CONTROL_IDS`, `CATEGORY_CONTROL_SHAPE.marker`, and
  `PROPERTY_CONTROLS` with the 5 new defs
- `packages/core/src/editor/property-schema.test.ts` — bump the
  registry-coverage entry-count test, add per-id getValue / setValue
  spot checks
- `packages/editor/src/property-panel-renderer.test.ts` — refresh
  the marker per-category golden snapshot to include the new rows
- `packages/editor/src/property-panel.ts` — replace the imperative
  rows in `#renderMarkerControls`'s Fill / Line / Label-Value
  sections with `#renderRegistryControl` calls

**Acceptance:**

- `pnpm -r typecheck` clean
- `pnpm test` passes (registry + renderer suites both updated)
- `pnpm lint` 0 findings
- `pnpm --filter @ingcreators/annot-editor build` clean
- `headless.test.ts` boundary still passes
- `property-panel.ts` LOC drops by ~80 (the imperative row builders
  for marker Fill / Line / Label-Value go away)

### Phase B — Shape transparency + cap type

**Goal:** Add 3 control ids covering the transparency + cap type
rows, augment the existing `strokeColor` / `strokeWidth` setters
with arrow-aware regen, then migrate `#addPPLineSection` and
`#addPPFillSection`'s simple rows.

**New control ids:**

| id | type | reads / writes | notes |
|---|---|---|---|
| `fillOpacity` | number | `fill-opacity` | min 0, max 100, step 1, unit "%" — inverse-fill-opacity / 0..100 conversion (matches the imperative `Math.round((1 - fo) * 100)` pattern) |
| `strokeOpacity` | number | `opacity` for line-like, `stroke-opacity` otherwise | min 0, max 100, step 1, unit "%". Line/composed-arrow targets need `opacity` (so SVG markers fade) AND removal of any legacy `stroke-opacity`. The setValue branches on `isLineLike(el)` |
| `strokeLinecap` | select | `stroke-linecap` | options: square / round / butt; `setAll` semantics so freehand groups propagate to children |

**Augmentations to existing defs:**

- `strokeColor.setValue` — for composed `<g data-type="arrow">`,
  also write `fill` to the head's filled subpath (`querySelector
  ('[data-role="head-filled"]')`), matching the imperative line.
- `strokeWidth.setValue` — for composed arrows, call
  `refreshArrowPath(el)` after the width write so the path's `d`
  regenerates against the new shortening offsets.

These augmentations are Tier B-friendly (just attribute reads /
writes + `refreshArrowPath` from `arrow-markers`). Both are no-op
for non-arrow targets.

**Files:** same set as Phase A, plus the renderer's golden tests
will need fixture updates for the shape + line-like cases.

**Acceptance:** mirrors Phase A. Additional check: a
`<g data-type="arrow">` selection's stroke-width edit regenerates
the head paths (manual smoke-test — the existing arrow tests
exercise `refreshArrowPath` separately).

### Phase C — Per-end arrow type & size pulldowns

**Goal:** Model the 4 compound dropdowns that today live in
`#addPPArrowRows`. Most complex of the three phases — the
controls share state (per-end shape / width / length) and the
Type dropdown's option list is variant-filtered.

**Design decision:** add 4 separate ids, one per dropdown:

| id | type | reads / writes | notes |
|---|---|---|---|
| `arrowStartShape` | select | `data-arrow-start-shape` (per `detectArrowEnds`) | Options filtered by variant: Line → only "none"; Arrow → "none" only on start; Double arrow → all non-"none" |
| `arrowStartSize` | select | `data-arrow-start-{w,l}` | 9 options (3×3 width × length grid) — encoded as `"w-l"` strings |
| `arrowEndShape` | select | `data-arrow-end-shape` | Same filter rule mirrored for end |
| `arrowEndSize` | select | `data-arrow-end-{w,l}` | — |

**Tradeoffs:**

- **Pro of 4 separate ids:** matches the existing `select` control
  type, no new control kind needed.
- **Con:** the variant-filter logic (per-end Type options change
  based on the OTHER end's shape via the variant rule) doesn't fit
  cleanly into a static `def.options` list. Either:
   - The renderer dynamically computes options per call (simplest
     — pass a `getOptions(el): PropertyControlOption[]` field that
     overrides static `options` when present)
   - OR the panel keeps the variant filter logic and only the
     dropdown rendering moves to the registry
- **Effect needs:** the setValue calls `applyArrowHead(el, spec)`
  with the modified spec. Tier C-only (lives in
  `tools/arrow-tool.ts`). So each of the 4 ids uses
  `effect: applyArrowEnds` (one shared effect id).

**New affordance for the renderer:** `getOptions?: (el) =>
PropertyControlOption[]` — overrides static `options` when
present. Lets the variant filter live in the def.

**`visibleWhen`:** the 4 ids only render for `isLineLike(el)`
selections (line / composed arrow).

**Acceptance:** mirrors Phase A/B + smoke-test of the variant-
filter behavior (mixed selections of Line + Arrow elements should
hide the start-shape pulldown; etc.).

## Out of scope

- The PowerPoint-style `pp-color-btn` styling for fillColor /
  strokeColor with the inline swatch + caret. The registry uses
  `createColorPullButton` (similar appearance, different DOM
  structure). This was a known visual delta from Phase 3b — see
  the property-panel-schema.md PR notes. Aligning the two is
  cosmetic and can land separately.
- Rebuilding `#addPPLineSection` / `#addPPFillSection` as a
  unified registry-driven section. After Phases B + C the
  remaining content is just the section wrappers + the dynamic
  arrow-rows-only-for-lines branch — small enough to inline back
  into `#renderShapeControls`.

## Status log

- 2026-04-26 — Plan drafted as the queued follow-up to the
  schema-driven render migration (PRs #153–#161). Phase A in
  progress.
