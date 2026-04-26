# PropertyPanel — Schema-driven Render

> **Status:** Done — landed in PRs #153–#161 (April 2026). Closes
> the long-running testability series (proposals 1–8 +
> StorageProvider contract review, PRs #138–#151).
>
> **PR map:**
> - #153 — Phase 1: `PropertyControlDef` interface + `PROPERTY_CONTROLS` registry (Tier B)
> - #154 — Phase 2: free-function renderer + golden DOM tests
> - #155 — Phase 3a: live wiring for the empty `group` category
> - #156 — Phase 3b: `shape` Type-section migration
> - #157 — Phase 3c: `redact` (validates async effect path)
> - #158 — Phase 3d: `highlight` (variant-IS-the-value pattern)
> - #159 — Phase 3e: `marker` Type + Size (composite-`<g>` setter)
> - #160 — Phase 3f: `textbox` (text-on-child setter, sticky/callout
>   bg recreation via `applyTextColor` effect)
> - #161 — Phase 4: dead-code cleanup + plan archival + CLAUDE.md
>   guardrail
>
> **Outcome:** every category in `CATEGORY_CONTROL_SHAPE` now routes
> through `PropertyPanel#renderViaRegistry` → `renderControl`.
> `property-panel.ts` shrank from 1,817 LOC to ~1,580 (target was
> ≤800 — the residual is imperative rows the registry doesn't yet
> model: stroke / fill transparency, cap type, per-end arrow
> type+size grids, marker bg-primitive controls). Those are
> independent follow-up work; the schema-driven scaffold is in
> place for them to land incrementally.
>
> **Scope:** Replace the imperative `#renderXxxControls` methods in
> `packages/editor/src/property-panel.ts` with a schema-driven
> renderer that reads from a `PropertyControlDef` registry. The
> registry lives in Tier B (`@ingcreators/annot-core/editor`) so the
> "which controls does each element category expose?" question
> becomes pure-function-testable without the live PropertyPanel UI.
>
> **Risk:** Medium-to-high. PropertyPanel is the editor's primary
> "edit selected SVG" UI; it has dozens of subtle conditional rules
> (e.g. "Fill section is hidden for line-like elements", "highlight
> swatch chips fire `onVariantChanged` instead of `onStyleChanged`")
> that must survive the rewrite verbatim. Behavior preservation is
> validated by happy-dom integration tests that drive a fresh
> PropertyPanel against synthetic SVG fixtures and assert the
> rendered DOM matches a golden snapshot per category.

## How to resume in a fresh session

```
"Read docs/plans/property-panel-schema.md and start Phase 1."
```

The plan is self-contained; no prior conversation context is
required. Each phase below is independently merge-able and lists
its own acceptance criteria.

## Context

`PropertyPanel` (`packages/editor/src/property-panel.ts`, 1,817 LOC)
is the right-side editor UI shown when one or more SVG annotations
are selected. Its `show(elements)` method:

1. Classifies the first selected element (textbox / marker /
   redact / highlight / group / shape) via
   `classifyPropertyElement` — that classifier already lives in
   Tier B (`@ingcreators/annot-core/editor/property-schema.ts`,
   added in #138).
2. Switches to one of 5 imperative `#renderXxxControls` methods,
   each ~20–80 LOC, that call `#addColorPicker`, `#addWidthPicker`,
   `#addArrowVariantPicker`, `#inSection`, etc. in a hand-rolled
   sequence to build the DOM.

Each `#addX` helper takes the current value, builds a control, and
wires a change listener that calls back into `#commit` (which fires
`onStyleChanged` → host saves the change).

The control wiring and the conditional logic ("hide Fill for
line-like", "Type section comes before Fill", "highlight uses
swatch chips routed through `onVariantChanged`") is buried in the
imperative bodies. **There is no place where you can read the
spec for "what does the textbox category render?" without reading
the procedural code.**

#138 added a `CATEGORY_CONTROL_SHAPE` registry in Tier B that lists
control IDs per category — but the IDs aren't tied to any
implementation, and PropertyPanel doesn't consume that registry
yet. This plan finishes the loop.

## Goal

A pure-data registry in Tier B that fully describes every control
PropertyPanel renders, and a thin renderer in Tier C that reads
the registry and produces the same DOM the imperative code does
today.

```ts
// Tier B — packages/core/src/editor/property-schema.ts
export interface PropertyControlDef<T = unknown> {
  id: PropertyControlId;
  type: "color" | "number" | "select" | "variantPicker" | "section";
  label: string;
  /** Read the current value off an SVG element. Pure. */
  getValue(el: SVGElement): T;
  /** Write a new value back. Mutates `el` in place. Pure
   *  (no PropertyPanel state, no host callbacks). */
  setValue(el: SVGElement, value: T): void;
  /** Optional gate — render this control only when the predicate
   *  returns true for the current selection's first element. Used
   *  for rules like "Fill is hidden when the element is line-like". */
  visibleWhen?(el: SVGElement): boolean;
  /** Optional metadata for variant pickers / select dropdowns. */
  options?: Array<{ value: T; label: string; icon?: string }>;
}

export const PROPERTY_CONTROLS: Record<PropertyControlId, PropertyControlDef>;
```

After this plan lands, the PropertyPanel's `show()` body shrinks to:

```ts
show(elements: SVGElement[]): void {
  // ... existing setup ...
  const category = classifyPropertyElement(elements[0]);
  for (const id of CATEGORY_CONTROL_SHAPE[category]) {
    const def = PROPERTY_CONTROLS[id];
    if (def.visibleWhen && !def.visibleWhen(elements[0])) continue;
    this.#renderControl(def, elements);
  }
}
```

Where `#renderControl(def, elements)` is a single imperative
method dispatching on `def.type`. The 5 `#renderXxxControls`
methods + most `#addXxx` helpers go away.

## Constraints

- **Behavior preservation is non-negotiable.** Every existing test
  (300+ across the repo) must pass without modification. The
  StorybookLits screenshots used for pre/post-Lit migration
  validation in `docs/plans/_done/lit-migration.md` are the
  reference for visual equivalence.
- **No new DOM dependencies in `annot-core`.** Property control
  defs are jsdom-friendly Element-takers, same Tier B contract as
  `transform-utils` / `shape-utils`. Renderers stay in
  `annot-editor` (Tier C).
- **PR-per-phase.** Each phase below is independently merge-able
  and CI-green on its own. Land Phase 1 → wait for green → Phase 2
  → … (matches the recent storage refactor cadence in #142–#151).

## Phases

### Phase 1 — Define `PropertyControlDef` interface + property-controls module

**Goal:** Land the type and a registry table covering EVERY control
PropertyPanel currently renders. Don't wire it into the panel
yet — just have the data structure compile, with unit tests
validating the registry's shape (every id present, every def has
a getValue/setValue, every category in `CATEGORY_CONTROL_SHAPE`
points to ids that exist in the registry).

**Files:**

- `packages/core/src/editor/property-schema.ts` — add
  `PropertyControlDef` interface + `PROPERTY_CONTROLS: Record<PropertyControlId, PropertyControlDef>`
- `packages/core/src/editor/property-schema.test.ts` — extend with
  registry shape tests:
  - Every `PropertyControlId` value has an entry in
    `PROPERTY_CONTROLS`
  - Every id listed in `CATEGORY_CONTROL_SHAPE[*]` exists in the
    registry
  - Each def's `getValue` / `setValue` is a function

**Implementation sketch:**

The hardest part is faithfully capturing every getter/setter pair
from the existing code. Reference table (from `property-panel.ts`):

| Control id | getValue (from where) | setValue (writes to) |
|---|---|---|
| `fillColor` | `el.getAttribute("fill")` | `el.setAttribute("fill", v)` |
| `strokeColor` | `el.getAttribute("stroke")` | `el.setAttribute("stroke", v)` |
| `strokeWidth` | `el.getAttribute("stroke-width")` | `el.setAttribute("stroke-width", v)` + dasharray recompute |
| `strokeStyle` | `detectDashKey(el)` | `el.setAttribute("stroke-dasharray", computeDasharray(v, sw))` + `data-dash-key` |
| `shapeTypePicker` | `detectShapeType(el)` | `convertShape(el, v)` (returns new element — call site replaces) |
| `arrowVariantPicker` | computed from `detectArrowEnds(el)` | `applyArrowHead(el, v)` |
| `drawStylePicker` | `detectDrawStyle(el)` | `applyDrawStyle(el, v, sw)` |
| `textVariantPicker` | `detectTextVariant(el)` | `convertTextVariant(el, v)` (returns new element) |
| `textColor` | `el.querySelector("text")?.getAttribute("fill")` | text fill + `data-color` + recreate sticky/callout |
| `fontFamily` | `data-font-family` ?? text font-family | `data-font-family` + text font-family |
| `fontSize` | text font-size | text font-size |
| `redactStylePicker` | `detectRedactStyle(el)` | `convertRedactStyle(el, v, canvas)` (async — needs canvas access) |
| `redactSolidColor` | `el.getAttribute("fill")` | `el.setAttribute("fill", v)` (only when `redactStyle === "solid"`) |
| `highlightColorPicker` | `el.getAttribute("fill")` | `el.setAttribute("fill", v)` (chip-style picker, fires `onVariantChanged`) |
| `highlightTransparency` | `el.getAttribute("fill-opacity")` | `el.setAttribute("fill-opacity", v)` |
| `markerShapePicker` | `detectMarkerShape(el)` | `convertMarkerShape(el, v)` (replaces bg primitive) |
| `markerSize` | reads `bg.r` / `bg.width` | `resizeMarker(el, v)` |

**Async setters** (`redactStylePicker`, anything that needs the
current canvas's bitmap to bake mosaic/blur) need a way to
indicate they're async — extend `setValue` to return
`void | Promise<void>`. Phase 2's renderer awaits before firing
`onStyleChanged`.

**Replacement setters** (`convertShape`, `convertTextVariant`,
`convertMarkerShape`) replace the element entirely. `setValue`
needs to either:
  - Mutate in place AND return the new element (caller passes that
    back to PropertyPanel's `onTargetReplaced` callback), or
  - Have a separate `replaceValue(el, v): SVGElement` method on
    the def.

**Recommendation:** add a `replace?: (el, value) => SVGElement`
optional field; renderer checks for it and routes through the
replacement path. Most defs use `setValue`; only the variant
pickers (`shapeTypePicker`, `textVariantPicker`, `markerShapePicker`,
`redactStylePicker`) use `replace`.

**Acceptance:**

- `pnpm --filter @ingcreators/annot-core typecheck` passes
- `pnpm vitest run packages/core/src/editor/property-schema.test.ts`
  passes — every registry-shape invariant pinned
- `headless.test.ts` boundary test still passes (no DOM globals
  leak from the new module)
- The new `PROPERTY_CONTROLS` table has at least 17 entries
  (every id in `PROPERTY_CONTROL_IDS` covered)

### Phase 2 — Build a thin schema renderer + happy-dom golden tests

**Goal:** A `renderControl(def, elements, deps): HTMLElement` function
in `annot-editor` that produces the same DOM the existing imperative
helpers do. Does NOT touch the live PropertyPanel yet; this phase is
about building + validating the renderer in isolation.

**Files:**

- `packages/editor/src/property-panel-renderer.ts` (new) — exports
  `renderControl(def, elements, deps)` that dispatches on `def.type`
  and produces the DOM:
  - `"color"` → `createColorPullButton(...)` (existing helper)
  - `"number"` → `ppNumberInput(...)`
  - `"select"` → `createCustomSelect(...)`
  - `"variantPicker"` → chip row with `prop-choice-chip` per option
  - `"section"` → `pp-section` wrapper hosting nested controls

- `packages/editor/src/property-panel-renderer.test.ts` (new,
  happy-dom env) — for each category in `CATEGORY_CONTROL_SHAPE`,
  build a synthetic element fixture and assert the rendered DOM
  shape matches a golden snapshot string. ~6 tests, one per
  category.

**deps shape:**

```ts
interface RenderControlDeps {
  /** Fired after a setValue / replace. PropertyPanel uses this
   *  to push to History + fire onStyleChanged. */
  onCommit(replacements: ElementReplacement[]): void;
  /** Canvas access for setters that need bitmap sampling
   *  (redact mosaic/blur). */
  canvas: CanvasManager;
  /** Used for opening color popovers etc. */
  hostRoot: HTMLElement;
}
```

**Acceptance:**

- 6 golden tests pass — rendered DOM matches reference
- The renderer file has zero direct dependencies on
  `PropertyPanel` (it should be a free function)
- `pnpm vitest run packages/editor` stays green

### Phase 3 — Migrate `PropertyPanel` to use the renderer (one category at a time)

**Goal:** Replace the imperative `#renderXxxControls` methods one
category at a time, keeping the rest unchanged. Each PR migrates
ONE category. Behavior validated against the contract test +
manual editor verification.

**Phase order (lowest-risk first):**

1. **Phase 3a — `group` category** — already a no-op render; just
   delete the early return and let the renderer handle the empty
   shape. Trivial, validates the wiring.
2. **Phase 3b — `shape` category** — biggest payoff (covers
   rect/ellipse/line/path/freehand). Migrate `#renderShapeControls`.
3. **Phase 3c — `redact` (3 variants)** — async setter validation.
4. **Phase 3d — `highlight`** — variant chip routing through
   `onVariantChanged`.
5. **Phase 3e — `marker`** — composite `<g>` setter complexity.
6. **Phase 3f — `textbox`** — text-element-on-child setter
   complexity.

For each phase 3x:

- Replace the `#renderXxxControls` body with a loop over
  `CATEGORY_CONTROL_SHAPE[xxx]` calling the renderer
- Delete the now-unused `#addXxx` helpers (per category)
- Run `pnpm test` + `pnpm --filter @ingcreators/annot-web build`
- Smoke-test in the dev server: select an element of each variant
  in this category and confirm the property panel matches the
  pre-migration screenshot

**Acceptance per phase 3x:**

- All existing tests pass
- The migrated category's controls work in `pnpm --filter
  @ingcreators/annot-web dev` — visual verification with at least
  3 element fixtures per variant
- Property-panel DOM byte-diff against a pre-migration snapshot is
  empty (helps reviewers spot regressions)

### Phase 4 — Cleanup + plan archival

**Goal:** Delete dead code, update CLAUDE.md, archive the plan.

**Files:**

- `packages/editor/src/property-panel.ts` — should now be
  meaningfully shorter (target: ≤ 800 LOC, down from 1,817)
- `CLAUDE.md` — update the architectural-guardrails section to
  mention the schema-driven property-panel pattern
- Move this file to `docs/plans/_done/property-panel-schema.md`
  with a status header noting the landing PR range

## Out of scope

- **`Toolbar.ts` 2,197 LOC** — same imperative pattern, similar
  schema-driven refactor possible. Not in this plan; queue
  separately if there's an appetite after PropertyPanel lands.
- **`SelectionManager.ts` 1,859 LOC** — its UI surface is gesture
  state, not declarative controls; this pattern doesn't apply.
- **Replacing the existing color / size / dash pickers themselves**
  — the renderer wraps them, doesn't rewrite them.

## Reference: existing code to read

Before starting, read these files in this order:

1. `packages/core/src/editor/property-schema.ts` — current Tier B
   classifier + control-id registry (incomplete; this plan
   completes it).
2. `packages/editor/src/property-panel.ts` — the imperative
   renderer being replaced. Skim each `#renderXxxControls` method
   to understand category-specific rules.
3. `packages/editor/src/property-panel-helpers.ts` — existing
   leaf-control builders the renderer will reuse.
4. `packages/editor/src/property-controls.ts` — color picker
   helpers.
5. PRs #138 (initial property-schema), #149–#151 (the
   StorageProvider contract review pattern this plan mirrors —
   "land the data layer first, then migrate consumers in
   independently merge-able phases").

## Status log

- 2026-04-26 — Plan drafted as the queued large piece of
  proposal 8 from the testability review series. The smaller
  parts (classifier + control-id registry) landed in #138.
