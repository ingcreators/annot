# Tool Property Renderer — Schema-driven Refactor

> **Status:** Done — landed across PRs #188–#192 (April 2026).
> Final piece of the schema-driven trilogy:
> [`property-panel-schema.md`](./property-panel-schema.md)
> + [`property-panel-schema-extensions.md`](./property-panel-schema-extensions.md)
> (PRs #153–#164) declarativised the SELECTION-side property panel;
> [`toolbar-schema.md`](./toolbar-schema.md) (PRs #166–#171)
> declarativised the toolbar's tool registry + preset persistence
> + variant flyout + rubber-band reader.
>
> This plan declarativised the third surface that still relied on
> the same `if (toolId === "shape") … if (toolId === "arrow") …`
> imperative cascade: the **TOOL-side property panel renderer**
> (`packages/web/src/editor/tool-property-renderer.ts`,
> 649 LOC, 14 per-tool branches at the start of the work).
>
> **Outcome:** the imperative cascade is gone; per-tool panels are
> driven by `TOOL_REGISTRY[toolId].panelControls` (Tier B data) +
> `TOOL_PANEL_ADAPTERS` (Tier B writers) + `selectionDefMetadata`
> (Tier B metadata bridge). Adding a new control to a tool is one
> entry in the registry + one matching adapter; no edits to the
> renderer or its callers. CLAUDE.md guardrail #6 carries the
> ongoing convention.
>
> **Risk (at landing):** Medium. The renderer is the per-tool side
> panel users see whenever they activate a drawing tool from the
> toolbar — a regression here would mean visible UI breakage for
> every tool. The behaviour preservation contract was "DOM byte-
> equivalence" against the existing imperative output, validated by
> happy-dom golden snapshots; Phase 5 adopted the registry's
> tooltip labels as a deliberate (and pre-announced) UX cleanup.

## How to resume in a fresh session

```
"Read docs/plans/tool-property-renderer-schema.md and start <phase>."
```

Each phase below is independently merge-able. Phase boundaries are
ordered so a CI-green Phase N PR doesn't depend on Phase N+1
landing.

## Context

`packages/web/src/editor/tool-property-renderer.ts` is **649 LOC**
and renders the per-tool side panel for every tool the toolbar
activates. The current shape, after the toolbar registry refactor,
is:

```
populateToolPropertyPanel(toolId, menu, ctx):
  preset = ctx.getCurrentPreset(toolId)
  isText / isMarker / isShape / isArrow / isFreehand / isRedact / isHighlight = …

  // Local DOM helpers
  addTypeRow(options, current)            // pp-section "Type" + chip row
  getFillBody() / getLineBody()           // lazy pp-section "Fill" / "Line"
  syncPreset()                            // saveCurrentPreset + Object.assign(ctx.options)
  addColorRow / addNumberRow / addSelectRow
  dashPreview / capPreview

  // === 1. Type picker per tool ===
  if (isRedact)   addTypeRow([mosaic / solid / blur], …)
  if (isFreehand) addTypeRow([pen / highlighter], …)
  if (isArrow)    addTypeRow([none / end / both], … with ARROW_ICON_SVG)
  if (isShape)    addTypeRow([rect / rounded / ellipse], … with SHAPE_ICON_SVG)
  if (isMarker)   addTypeRow([circle / rect / rounded], … with COUNTER_ICON_SVG)
  if (isText)     addTypeRow([plain / sticky / callout], …)

  // === 2. Appearance per tool ===
  if (isRedact) {
    if (preset.redactStyle === "solid") addColorRow(Fill, "Color", …)
    return
  }
  if (isMarker) {
    addColorRow(Fill, "Color", … allowNone, with legacy migration of strokeColor → fillColor)
    addColorRow(Line, "Color", …)
    addNumberRow(Line, "Width", …)
    addSelectRow(Line, "Dash type", …)
    addNumberRow(Label, "Size", …)
    return
  }
  if (isText) {
    addColorRow(Line, "Color", …)
    addSelectRow(Line, "Font", …)
    addNumberRow(Line, "Size", …)
    return
  }
  if (isHighlight) {
    // Custom Type row — color swatches with --swatch-color
    addNumberRow(Fill, "Transparency", … 1 - fillOpacity)
    return
  }

  // Shape / Arrow / Freehand shared path:
  addColorRow(Line, "Color", …)
  addNumberRow(Line, "Transparency", … 1 - strokeOpacity)
  addNumberRow(Line, "Width", …)
  addSelectRow(Line, "Dash type", …)
  if (isShape || isArrow || isFreehand) addSelectRow(Line, "Cap type", …)
  if (isArrow)  createArrowEndsRows(Line, …)        // Begin / End shape + size grids
  if (isShape)  addColorRow(Fill, "Fill", …) + addNumberRow(Fill, "Opacity", …)
  if (isFreehand) appendFreehandDoneButton(menu)
```

### Why this is the obvious next refactor

1. **Same pattern as the two completed migrations.** Every entry
   in the cascade is "for tool X, render section Y with control
   Z" — exactly what a Tier B registry models. `PROPERTY_CONTROLS`
   in
   [`packages/core/src/editor/property-schema.ts`](../../packages/core/src/editor/property-schema.ts)
   already encodes the SELECTION-side equivalent. The Tool side
   re-implements ~70 % of the same defs (Color / Width / Dash /
   Cap / Fill / Opacity / Font / Size) as imperative rows.
2. **The two surfaces drift apart silently today.** PropertyPanel
   gained `arrowStartShape` / `arrowStartSize` / `arrowEndShape` /
   `arrowEndSize` per-end pulldowns in PRs #162–#164. The Tool
   panel's Arrow rendering uses the older `createArrowEndsRows`
   helper and stayed parallel only by accident. A registry-shared
   set of defs would make "add a new Selection property" and
   "add a new Tool default" a single edit in one file.
3. **The renderer is the LARGEST imperative cascade left in
   the editor.** 14 `if (isXxx)` branches in 649 LOC. Removing
   it brings the codebase into a "no toolId-keyed cascades"
   steady state — adding a new tool becomes one `TOOL_REGISTRY`
   entry + one factory + (eventually) one `toolPanelControls`
   array per tool, with no edits to renderers, dispatchers, or
   marshallers.

### What is — and isn't — shared with PropertyPanel today

The two surfaces SHOULD render identical-looking controls for the
same property: PowerPoint's "edit properties of selected shape"
panel and "set defaults for the next shape you draw" panel ARE
visually identical at parity. But the implementations diverged:

| Concern                       | Selection panel                                        | Tool panel                                                 |
|-------------------------------|--------------------------------------------------------|------------------------------------------------------------|
| Color row                     | `createColorPullButton` + `pp-row`                     | `addColorRow` → `createColorPullButton` + `pp-row`         |
| Number row                    | `ppNumberInput` (in `property-panel-helpers.ts`)       | `addNumberRow` → `createNumberInput` (different module)    |
| Select row                    | `createCustomSelect` + `pp-row`                        | `addSelectRow` → `createCustomSelect` + `pp-row`           |
| Type chip row                 | `renderVariantPicker` (registry + renderer)            | `addTypeRow` (local helper, distinct DOM)                  |
| Per-end arrow                 | `arrowStart{Shape,Size}` + `arrowEnd{Shape,Size}` defs (`createCustomSelect` grid) | `createArrowEndsRows` (a separate widget producing 2 ROWs of `Type` + `Size` selects) |
| Section grouping              | `#inSection("Fill" / "Line" / "Label")`                | `getFillBody` / `getLineBody` lazies + `menu.appendChild`  |
| Mutation persistence          | `onStyleChanged` rubber-band → toolbar                 | `syncPreset` (saveCurrentPreset + Object.assign options)   |

The differences are skin-deep — both surfaces ultimately produce
DOM with the same `pp-row` / `pp-section` / `prop-choice-chip`
classes — but the duplication means two test suites, two diff
audits when a control's UX changes, and a slow drift in defaults.

## Goal

A pure-data extension to `TOOL_REGISTRY` that fully describes the
controls each tool's side panel renders, plus a thin Tier C
renderer that consumes the registry and produces the same DOM the
imperative cascade does today.

```ts
// Tier B — addition to packages/core/src/editor/tool-registry.ts
export interface ToolPanelControlDef {
  /** Section header. Renderer batches consecutive entries with the
   *  same section into one `pp-section`. Order in the registry
   *  controls visual order. */
  section: "Type" | "Fill" | "Line" | "Label";
  /** Control id. For controls that map cleanly onto the SELECTION
   *  registry (`fillColor`, `strokeWidth`, `strokeStyle`, …),
   *  reuses the existing `PropertyControlId`. New ids cover Tool-
   *  specific affordances:
   *    - `tool.typeChips` — Type-row chip picker driven by
   *      `TOOL_REGISTRY[toolId].variants`. ONE entry per tool.
   *    - `tool.transparencyPercent` — 0–100% inverse of an opacity
   *      field (so "60% transparent" reads as 60, not 0.4). The
   *      Selection registry uses raw 0–1 opacity; the Tool panel
   *      always shows percent. Keeps the underlying ToolOptions
   *      field unchanged.
   *    - `tool.freehandDone` — Phase-1 placeholder for the
   *      Freehand "Done drawing" button. Could later move into a
   *      generic "actions" section.
   */
  id: PropertyControlId | ToolPanelExtraControlId;
  /** Optional visibility predicate against the CURRENT preset
   *  (NOT an SVGElement — this is the Tool side, no element exists
   *  yet). Used for "Color row only when redactStyle === 'solid'". */
  visibleWhen?: (preset: ToolOptions) => boolean;
}

export type ToolPanelExtraControlId =
  | "tool.typeChips"
  | "tool.transparencyPercent"
  | "tool.fillTransparencyPercent"
  | "tool.freehandDone";

interface ToolRegistryEntry {
  // … existing fields …
  /** Tool-side panel control list. Order is render order. */
  panelControls?: ReadonlyArray<ToolPanelControlDef>;
}
```

The renderer becomes a 30-LOC dispatch loop:

```ts
export function populateToolPropertyPanel(toolId, menu, ctx) {
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.panelControls) return;
  const preset = ctx.getCurrentPreset(toolId);
  const sections = groupBySection(meta.panelControls.filter((c) =>
    !c.visibleWhen || c.visibleWhen(preset)));
  for (const [name, controls] of sections) {
    const { section, body } = createPropertySection(name);
    for (const def of controls) {
      const el = renderToolControl(def, toolId, preset, ctx);
      if (el) body.appendChild(el);
    }
    menu.appendChild(section);
  }
  ctx.saveCurrentPreset(toolId, preset);
  Object.assign(ctx.options, preset);
}
```

Adding a new control to a tool becomes one entry in that tool's
`panelControls` array. Adding a new control type that doesn't yet
exist becomes one entry in `ToolPanelExtraControlId` plus one
case in `renderToolControl`.

After this plan lands,
[`tool-property-renderer.ts`](../../packages/web/src/editor/tool-property-renderer.ts)
should drop from 649 LOC → ~150 LOC (renderer dispatch + the
extra-control implementations the SELECTION-side registry doesn't
already cover).

## Constraints

- **Behaviour preservation is non-negotiable.** Every existing test
  passes without modification. DOM byte-equivalence is the
  migration contract — same class names, same nesting, same data-*
  attrs — except where the migration is a deliberate visual change
  (called out in the PR description).
- **No new DOM dependencies in `annot-core`.** The registry stays
  pure data + `(preset) => boolean` predicates. The renderer +
  per-control DOM construction stays in
  `@ingcreators/annot-web` (Tier C, where `createColorPullButton`
  / `ppNumberInput` / `createCustomSelect` already live).
- **Reuse the SELECTION registry where it cleanly maps.** A `Color`
  row writing to `preset.strokeColor` shares zero implementation
  with the SELECTION-side `strokeColor` def today (Selection writes
  attrs onto an Element; Tool writes onto a `ToolOptions` object),
  but the LABEL / VALIDATION / OPTIONS metadata IS sharable. The
  renderer wraps `PROPERTY_CONTROLS[id]` to read its `label` /
  `options` / `min` / `max` / `step` / `unit` / `allowNone` while
  routing the mutation through a `(preset, value) => void` Tool-
  side adapter.
- **PR-per-phase.** Each phase is independently merge-able and
  CI-green on its own. Land Phase 1 → wait for green → Phase 2 →
  …, matching the cadence of the prior two registry migrations.
- **`panelControls` arrays are the single source of truth.**
  Once Phase 4 ships, adding a new control to the Tool side is
  one entry in that tool's `panelControls` — no edits to
  `tool-property-renderer.ts`, no parallel test maintenance.

## Phases

### Phase 1 — Land `panelControls` interface + Tool-side adapters (Tier B)

**Goal:** Land the type extension + a registry of Tool-side
"value adapters" that bridge a `PropertyControlId` to a `(preset,
newValue) => void` mutation. Don't wire it into the renderer yet
— just have the definitions compile and a unit test pinning shape
invariants.

**Files:**

- `packages/core/src/editor/tool-registry.ts` —
  `ToolPanelControlDef` interface, `ToolPanelExtraControlId`
  union, optional `panelControls` field on `ToolRegistryEntry`.
- `packages/core/src/editor/tool-panel-adapter.ts` (NEW) —
  `TOOL_PANEL_ADAPTERS: Record<PropertyControlId, ToolPanelAdapter>`
  with read/write closures per id:
  ```ts
  export interface ToolPanelAdapter<T = unknown> {
    /** Read the current value off the preset. */
    read: (preset: ToolOptions) => T;
    /** Mutate the preset in place. */
    write: (preset: ToolOptions, value: T) => void;
    /** Reuse the matching SELECTION-side def for label / options /
     *  min / max / step / unit / allowNone metadata when present.
     *  When null, the renderer falls back to a per-id table in Tier
     *  C (used by `tool.transparencyPercent`, `tool.freehandDone`,
     *  etc. that have no SELECTION-side analogue). */
    selectionDef?: PropertyControlId | null;
  }
  ```
- `packages/core/src/editor/tool-panel-adapter.test.ts` (NEW) —
  shape invariants:
  - Every `ToolPanelExtraControlId` has an adapter
  - Every adapter referenced by a tool's `panelControls` exists
    in `TOOL_PANEL_ADAPTERS`
  - Round-trip per adapter: `write(preset, read(preset))` is a
    no-op
- `packages/core/src/editor/tool-registry.ts` — populate
  `panelControls` for ALL 7 panel-rendering tools (everything
  except crop), matching the imperative cascade verbatim:
  ```ts
  arrow.panelControls = [
    { section: "Type", id: "tool.typeChips" },
    { section: "Line", id: PROPERTY_CONTROL_IDS.strokeColor },
    { section: "Line", id: "tool.transparencyPercent" },
    { section: "Line", id: PROPERTY_CONTROL_IDS.strokeWidth },
    { section: "Line", id: PROPERTY_CONTROL_IDS.strokeStyle },
    { section: "Line", id: PROPERTY_CONTROL_IDS.strokeLinecap },
    { section: "Line", id: PROPERTY_CONTROL_IDS.arrowStartShape },
    { section: "Line", id: PROPERTY_CONTROL_IDS.arrowStartSize },
    { section: "Line", id: PROPERTY_CONTROL_IDS.arrowEndShape },
    { section: "Line", id: PROPERTY_CONTROL_IDS.arrowEndSize },
  ];
  ```
  Same exhaustive enumeration for shape / highlight / text /
  freehand / marker / redact.

**Acceptance:**

- `pnpm --filter @ingcreators/annot-core typecheck` passes
- `pnpm vitest run packages/core/src/editor/tool-panel-adapter.test.ts`
  passes
- `headless.test.ts` still green (no new DOM globals)
- `panelControls` populated for all 7 tools; every id used in
  those arrays resolves to an adapter

### Phase 2 — Renderer dispatch + the four "section types" (Tier C)

**Goal:** Land the schema-driven renderer alongside the
imperative one (no callsite migration yet). Tests assert the new
renderer produces DOM byte-equivalent to the imperative output.

**Files:**

- `packages/web/src/editor/tool-property-renderer-schema.ts`
  (NEW) — generic dispatch:
  ```ts
  export function populateToolPropertyPanelFromRegistry(
    toolId: string,
    menu: HTMLElement,
    ctx: ToolPropertyRendererContext,
  ): void;
  ```
  Internally:
  - Group `panelControls` by `section`
  - For each section, build a `pp-section` via
    `createPropertySection`
  - Per-control: dispatch on adapter `selectionDef` → SELECTION
    registry def → renderer-internal control factory
  - For Tool-only ids (`tool.typeChips`, etc.) call the matching
    Tier C-local renderer
  - Persist + sync `ctx.options` after each control commit
- `packages/web/src/editor/tool-property-renderer-schema.test.ts`
  (NEW) — happy-dom golden snapshots, one test per tool:
  - Build a fixture preset
  - Run the new renderer
  - Run the imperative renderer
  - Assert `menu.outerHTML` is byte-equal
  Any divergence shows up as a snapshot diff in PR.
- The "tool-only" extra renderers (`tool.typeChips`,
  `tool.transparencyPercent`, `tool.fillTransparencyPercent`,
  `tool.freehandDone`) live in
  `tool-property-renderer-schema.ts` itself — small enough to
  not justify a separate file.

**Acceptance:**

- `pnpm test` passes (no test changes expected; new tests added)
- New goldens cover all 7 panel-rendering tools
- `pnpm --filter @ingcreators/annot-web build` passes
- The imperative `populateToolPropertyPanel` is still the live
  callsite — no behaviour change for users yet

### Phase 3 — Migrate the live callsite + remove the imperative renderer

**Goal:** Swap `Toolbar.#populateToolProperties` over to
`populateToolPropertyPanelFromRegistry`. Delete the imperative
`populateToolPropertyPanel`. Keep its goldens as regression
fixtures for the new renderer.

**Files:**

- `packages/web/src/editor/toolbar.ts` —
  `#populateToolProperties` becomes a 3-line wrapper around
  `populateToolPropertyPanelFromRegistry`. (The wrapper exists
  only because `Toolbar` exposes the method on the instance for
  the right-panel host; consider inlining as part of Phase 4
  cleanup.)
- `packages/web/src/editor/tool-property-renderer.ts` —
  imperative cascade DELETED. The Tier C-local helpers
  (`addColorRow` / `addNumberRow` / `addSelectRow` / `addTypeRow`
  / `dashPreview` / `capPreview`) move into
  `tool-property-renderer-schema.ts` if used, are deleted
  otherwise.
- `packages/web/src/editor/tool-property-renderer-schema.test.ts`
  — drop the "matches imperative" cross-check (the imperative
  renderer is gone); keep the per-tool golden snapshots as the
  regression net.

**Acceptance:**

- `pnpm test` passes (snapshot suite intact; deleted "matches
  imperative" tests don't count against pass count)
- Manual smoke-test: activate every tool from the toolbar; verify
  the side panel renders identically (Type / Fill / Line / Label
  sections in the right order, same controls per tool)
- `tool-property-renderer.ts` either:
  - drops to ~50 LOC (just the renderer), or
  - is renamed to `tool-property-renderer-schema.ts` and the
    schema variant becomes the only one. Pick the simpler outcome
    — the file name shouldn't carry refactor history.
- `pnpm --filter @ingcreators/annot-web build` passes

### Phase 4 — Reuse SELECTION-registry adapters where they cleanly map

**Goal:** Replace per-control mutation closures in the Tool-side
adapters with delegation to the SELECTION-side
`PROPERTY_CONTROLS` registry where the read/write semantics are
the same. The Tool side mutates a preset (object) instead of an
Element (attributes), but the option lists, validation ranges,
labels, and dash/cap/font preview SVGs are identical and should
have ONE source of truth.

**Why this is its own phase:** Phase 3 lands a working schema-
driven renderer that still owns its own option / metadata tables
(label strings, dash style options, cap type options, font family
options, number-input min/max). This phase pulls those tables
into `PROPERTY_CONTROLS` reads, so a UX-tweak to (say) "add 'Dot-
Dash-Dot' to the dash menu" is one edit in
`property-schema.ts` and both surfaces pick it up.

**Files:**

- `packages/core/src/editor/tool-panel-adapter.ts` — add a
  `selectionDefMetadata` accessor that pulls `label` / `options` /
  `min` / `max` / `step` / `unit` / `allowNone` off
  `PROPERTY_CONTROLS[selectionDef]`. Adapters that previously
  hard-coded the option list now reference this.
- `packages/web/src/editor/tool-property-renderer-schema.ts` —
  the section renderer reads metadata via the adapter accessor
  instead of a per-id `switch`.
- New tests under
  `packages/web/src/editor/tool-property-renderer-schema.test.ts`
  to verify a UX edit in `PROPERTY_CONTROLS` flows through to the
  Tool-side rendered DOM (regression net for the "single source
  of truth" claim).

**Acceptance:**

- `pnpm test` passes (existing goldens unchanged — same DOM)
- A deliberate test edit to `PROPERTY_CONTROLS[strokeStyle].
  options` shows up in the Tool-side golden; reverting restores
  it. (Tested as a one-off in CI; no committed test.)
- The list of hard-coded option arrays in Tier C tool code is
  empty — every dash / cap / font / number-range value comes
  from the registry.

### Phase 5 — Cleanup + plan archival

**Goal:** Delete dead code, finalise file naming, update
CLAUDE.md, archive the plan.

**Files:**

- `packages/web/src/editor/tool-property-renderer*.ts` — settle
  on a single file name (`tool-property-renderer.ts` is the
  natural choice — it's what `Toolbar.#populateToolProperties`
  imports). Inline any helpers that became trivial wrappers.
- `CLAUDE.md` — extend the schema-driven guardrail (#6) with a
  third bullet for `panelControls`, parallel to the existing
  PropertyPanel + Toolbar mentions.
- Move
  [`docs/plans/tool-property-renderer-schema.md`](./tool-property-renderer-schema.md)
  → `docs/plans/_done/tool-property-renderer-schema.md` with a
  status header noting the landing PR range.
- Update `docs/plans/README.md`: remove the queued entry, add a
  "Recently landed plans" row.

## Out of scope

- **Replacing `createArrowEndsRows`** — the current Phase 1 plan
  uses it as-is for arrow per-end rendering on the Tool side.
  The SELECTION side has a different per-end layout (4 separate
  pulldowns: `arrowStartShape` / `arrowStartSize` /
  `arrowEndShape` / `arrowEndSize`). Unifying the two
  presentations is a UX call, not a refactoring concern; queue
  separately if the design team wants the surfaces to match
  exactly.
- **Lifting `Toolbar.#populateToolProperties`'s `tools.get(id)`
  shape lookup into the registry** — the renderer wrapper still
  needs the per-tool `ToolDef` for activation hooks. Out of
  scope; a separate plan can fold it into the registry if there's
  appetite.
- **Touching `populateToolPropertyPanel`'s persistence behaviour**
  (saveCurrentPreset → savePresetsToFile → syncToolButtonIcon
  chain). Phase 1's renderer wraps the same calls.

## Reference: existing code to read

Before starting, read these in this order:

1. `packages/web/src/editor/tool-property-renderer.ts` — the file
   under refactor. Skim each `if (isXxx)` branch to map them onto
   `panelControls` arrays.
2. `packages/core/src/editor/property-schema.ts` — the SELECTION
   registry the Tool side will delegate metadata reads into.
3. `packages/editor/src/property-panel-renderer.ts` — the
   SELECTION-side renderer. Tool-side schema renderer follows the
   same `renderControl(def, …)` shape but with a `(preset, value)
   => void` mutation contract instead of element replacement.
4. `docs/plans/_done/property-panel-schema.md` +
   `_done/property-panel-schema-extensions.md` +
   `_done/toolbar-schema.md` — the prior schema-driven migrations
   this plan mirrors. Phase boundaries, golden-snapshot strategy,
   and CLAUDE.md guardrail extension all follow the same playbook.
5. PRs #153 (initial PropertyPanel registry pattern), #170 (final
   Toolbar `extractStyleFromElement` migration) — read commit
   bodies for the "what shrank, what stayed, why" framing the
   per-phase commits should adopt.

## Status log

- 2026-04-26 — Plan drafted as the queued follow-up to the
  Toolbar schema-driven migration. Same imperative-chain →
  declarative-registry pattern, applied to the third (and
  largest remaining) toolId-keyed cascade in the editor.
