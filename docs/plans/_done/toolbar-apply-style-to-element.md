# Toolbar — `applyStyleToElement` write-back symmetry

> **Status:** Done. Landed in PRs
> [#193](https://github.com/ingcreators/annot/pull/193)–[#196](https://github.com/ingcreators/annot/pull/196)
> over four phases (2026-04-26). Direct follow-up to
> [`_done/toolbar-schema.md`](../_done/toolbar-schema.md) Phase 5
> (PR [#170](https://github.com/ingcreators/annot/pull/170)),
> which schema-drove the **read** path
> (`Toolbar.syncPresetFromElement`) via
> `TOOL_REGISTRY[toolId].extractStyleFromElement`. The **write**
> path (`applyElementVariantPreset` → `applyPresetStyleAttrs`)
> stayed hand-rolled. This plan completed the symmetry by adding
> a Tier B `applyStyleToElement` callback to the registry and
> collapsing the per-tool branches in
> [`packages/web/src/editor/toolbar-preset-helpers.ts`](../../packages/web/src/editor/toolbar-preset-helpers.ts)'s
> `applyPresetStyleAttrs` family the same way Phase 5 collapsed
> `syncPresetFromElement`.
>
> **Risk:** Medium-low. The write path is exercised every time the
> user changes a variant in the selection property panel
> (`applyElementVariantPreset`) — a regression here means the
> wrong attrs land on the element on conversion. Behaviour
> preservation is validated by happy-dom golden tests against
> synthetic SVG fixtures (one per tool that owns a per-tool
> branch today), keyed off the existing
> `toolbar-preset-helpers.test.ts` so the `applyPresetStyleAttrs`
> callsites already have an env to slot into.

## How to resume in a fresh session

```
"Read docs/plans/toolbar-apply-style-to-element.md and start <phase>."
```

Each phase is independently merge-able and CI-green on its own.

## Context

The toolbar's preset machinery has TWO directions:

| Direction | Trigger | Method | Schema-driven? |
|---|---|---|---|
| Element → Preset | User edits a shape via Selection panel; rubber-band the new style into the matching tool's "next-draw" preset | `Toolbar.syncPresetFromElement` → universal reader + `TOOL_REGISTRY[toolId].extractStyleFromElement` | **Yes** (Phase 5 of `_done/toolbar-schema.md`, PR #170) |
| Preset → Element | User switches a shape's variant via the Selection panel's Type picker; load the new variant's saved style onto the element | `Toolbar.applyElementVariantPreset` → `applyPresetStyleAttrs` (in `toolbar-preset-helpers.ts`) | **No** — still hand-rolled |

`applyPresetStyleAttrs` ([toolbar-preset-helpers.ts:201-270](../../packages/web/src/editor/toolbar-preset-helpers.ts))
branches on element TAG (not toolId — but in 1:1 correspondence
with toolId via the registry's `variantKeyForElement`):

```ts
applyPresetStyleAttrs(el, preset):
  if (el.tagName === "g" && data-marker)        → applyMarkerPresetStyle(el, preset);   return
  if (el.tagName === "g" && data-type=textbox)  → applyTextboxPresetStyle(el, preset);  return
  if (el.tagName === "rect" && data-highlight=1)→ // inline highlight branch
                                                   set fill=highlightColor;
                                                   set fill-opacity;                    return
  // generic stroke/fill path (shape / arrow / line / path / freehand outer):
  setAttribute("stroke", preset.strokeColor)
  setAttribute("stroke-width", preset.strokeWidth)
  // ... computeDasharray ...
  setAttribute("fill", preset.fillColor)
  // ... cap / join / strokeOpacity (with line-vs-other branch) ...
  if (el.tagName === "g" && data-type=arrow) refreshArrowPath(el)
```

`applyMarkerPresetStyle` ([line 277-299](../../packages/web/src/editor/toolbar-preset-helpers.ts:277))
walks the marker's `<circle>`/`<rect>` bg primitive plus the
inner `<text>`. `applyTextboxPresetStyle` ([line 307-322](../../packages/web/src/editor/toolbar-preset-helpers.ts:307))
walks the textbox's `<text>` child and `data-color` /
`data-font-family` cache attrs. Both contain inverse logic of
the per-tool extractors that already live in `TOOL_REGISTRY`.

### Why this is the obvious next refactor

1. **Asymmetry is a maintenance hazard.** The read side
   (`extractStyleFromElement`) for, say, marker reads the
   bg primitive's `fill` / `stroke`; the write side
   (`applyMarkerPresetStyle`) writes them back. The two MUST
   stay in lockstep — when one acquires a new field (e.g. the
   marker bg dash style added in PR #162), the other has to
   too. With both sides as paired registry callbacks, the lock
   becomes structural: a missing inverse won't compile (TS
   doesn't help here, but the test goldens — see Phase 2 — will).
2. **`applyPresetStyleAttrs`'s element-tag dispatch duplicates
   `variantKeyForElement`.** The registry already classifies an
   element by tool. Today's helper re-classifies via element-
   tag inspection. After this refactor, the dispatch is one
   `for (const entry of …) if (entry.variantKeyForElement?.(el))`
   loop — same pattern as `toolIdForElement`.
3. **Phase 5 of `_done/toolbar-schema.md` explicitly deferred
   this.** That plan's design notes proposed an
   `applyStyleToElement` field on the registry as the inverse
   of `extractStyleFromElement`, but called it out as larger-
   than-Phase-5-scope and queued separately. This is that
   queued separate plan.

## Goal

A new optional Tier B callback on `ToolRegistryEntry`:

```ts
interface ToolRegistryEntry {
  // ... existing fields including extractStyleFromElement ...

  /** Tool-specific style writer. Inverse of
   *  `extractStyleFromElement`. Writes the preset's style fields
   *  onto `el` (or its tool-specific child elements — marker's
   *  bg primitive, textbox's `<text>`, etc.).
   *
   *  Deliberately does NOT touch fields that define the element's
   *  type / variant (shapeType, arrowHead, textVariant) — those
   *  were already established by the variant-change path that
   *  invoked the writer.
   *
   *  Tier B — implementations live in `tool-registry.ts` itself
   *  and may only use jsdom-friendly Element APIs. The
   *  `refreshArrowPath` regen for arrow groups is the one
   *  exception: it lives in `core/editor/arrow-markers.ts`
   *  (Tier B) so the registry can call it without crossing
   *  package boundaries. */
  applyStyleToElement?: (el: SVGElement, preset: ToolOptions) => void;
}
```

After the migration, `applyPresetStyleAttrs` becomes a thin
dispatch:

```ts
export function applyPresetStyleAttrs(el: SVGElement, preset: ToolOptions): void {
  // Find the tool that owns this element via the same classifier
  // syncPresetFromElement uses, then dispatch to its writer.
  for (const entry of Object.values(TOOL_REGISTRY)) {
    if (!entry.variantKeyForElement) continue;
    if (entry.variantKeyForElement(el) === null) continue;
    entry.applyStyleToElement?.(el, preset);
    return;
  }
  // No tool claimed the element: fall through to the universal
  // generic writer. (Empty today — every concrete element is
  // claimed by some tool — but kept as a defensive sink.)
}
```

`applyMarkerPresetStyle` and `applyTextboxPresetStyle` move
into the registry as the marker / text entries'
`applyStyleToElement` bodies. The highlight branch becomes the
highlight entry's `applyStyleToElement`. The "generic" stroke /
fill / cap / join / strokeOpacity path becomes the shape /
arrow / freehand / redact entries' writers (mostly a single
shared helper they each call).

After this plan lands,
[`packages/web/src/editor/toolbar-preset-helpers.ts`](../../packages/web/src/editor/toolbar-preset-helpers.ts)
should drop from 322 → ~80 LOC (the `applyPresetStyleAttrs`
dispatch + the universal style-writer helper, plus the small
remaining `migrateLegacyPresetKey` / `mergePresetForVariantChange`
/ `seedPresetFromElement` / `validatePresetForTool` / re-exported
`normalizeVariantSideFields` already there).

## Constraints

- **Behaviour preservation is non-negotiable.** Every existing
  test passes without modification. DOM byte-equivalence: same
  attribute writes in the same order, same `refreshArrowPath`
  side effect for arrow groups, same legacy-preset migration in
  `applyMarkerPresetStyle` (the `legacy = !preset.fillColor &&
  !!preset.strokeColor` branch).
- **No new DOM dependencies in `annot-core`.** Each
  `applyStyleToElement` callback uses only jsdom-friendly Element
  APIs (`setAttribute`, `querySelector`, `getAttribute`).
  `refreshArrowPath` is already in `core/editor/arrow-markers.ts`
  so calling it from arrow's writer is a same-package call. The
  `computeDasharray` helper is already in
  `core/utils/dash-utils.ts`.
- **PR-per-phase.** Each phase is independently merge-able and
  CI-green on its own. Land Phase 1 → wait for green → Phase 2 →
  …, matching the cadence of the prior schema-driven migrations.
- **Symmetry is the contract.** Once Phase 3 ships, every
  `extractStyleFromElement` callback in the registry has a
  paired `applyStyleToElement` that round-trips the same fields.
  A new field added to one MUST be added to the other; the
  Phase 2 round-trip tests catch missing inverses.

## Phases

### Phase 1 — Land `applyStyleToElement` interface + the universal helper (Tier B)

**Goal:** Land the type extension + a small Tier B
`writeUniversalStyleAttrs(el, preset)` helper that holds the
generic stroke / fill / cap / join / strokeOpacity write logic
shared by shape / arrow / freehand / redact-solid. Don't wire
into the dispatch yet — just have the helper compile and a unit
test pinning shape invariants.

**Files:**

- `packages/core/src/editor/tool-registry.ts` —
  `ToolRegistryEntry.applyStyleToElement?` field added (with
  docstring explaining it's the inverse of
  `extractStyleFromElement`).
- `packages/core/src/editor/tool-style-writer.ts` (NEW) —
  `writeUniversalStyleAttrs(el, preset)` with the stroke / fill /
  width / dasharray / fill-opacity / cap / join /
  stroke-opacity-vs-opacity rules from the current
  `applyPresetStyleAttrs` generic path. Pure: takes Element +
  ToolOptions, mutates `el`. Helper is exported so per-tool
  writers can opt into it (shape / arrow / freehand / redact-
  solid all need it).
- `packages/core/src/editor/tool-style-writer.test.ts` (NEW) —
  happy-dom-backed:
  - Round-trip: build a synthetic element, call
    `writeUniversalStyleAttrs`, verify each attr matches the
    preset value (using the same `computeDasharray` rules).
  - Line / arrow-`<g>`: `strokeOpacity` writes to `opacity`
    attr (not `stroke-opacity`).
  - Other elements: `strokeOpacity` writes to `stroke-opacity`.

**Acceptance:**

- `pnpm --filter @ingcreators/annot-core typecheck` passes
- `pnpm vitest run packages/core/src/editor/tool-style-writer.test.ts`
  passes
- `headless.test.ts` boundary still green (writer is pure,
  no DOM globals at module load — Element-typed parameters only)
- Re-export from `packages/core/src/editor/index.ts` and
  `headless.ts` so the writer + the new interface field are
  importable from web

### Phase 2 — Per-tool `applyStyleToElement` callbacks (Tier B) + paired round-trip tests

**Goal:** Populate `applyStyleToElement` on every tool entry
that has an `extractStyleFromElement` today. Each callback is
the inverse of the matching extractor. No live wiring yet — the
callbacks coexist with the imperative `applyPresetStyleAttrs`.

**Files:**

- `packages/core/src/editor/tool-registry.ts` —
  per-tool `applyStyleToElement` implementations:
  - `arrow.applyStyleToElement` →
    `writeUniversalStyleAttrs(el, preset);`
    `if (el.tagName === "g" && data-type=arrow) refreshArrowPath(el);`
  - `shape.applyStyleToElement` →
    `writeUniversalStyleAttrs(el, preset)` (no special branch).
  - `highlight.applyStyleToElement` →
    `if (preset.highlightColor) el.setAttribute("fill",
    preset.highlightColor); if (preset.fillOpacity != null)
    el.setAttribute("fill-opacity", String(preset.fillOpacity));`
  - `text.applyStyleToElement` → port of
    `applyTextboxPresetStyle`: writes `data-color` / text fill /
    `data-font-family` / text font-family / text font-size.
  - `freehand.applyStyleToElement` →
    `writeUniversalStyleAttrs(el, preset)` (the `<g>` wrapper
    case is handled by the universal helper since freehand
    children inherit attrs).
  - `marker.applyStyleToElement` → port of
    `applyMarkerPresetStyle`, including the legacy
    `markerBorder*` migration branch.
  - `redact.applyStyleToElement` → solid branch only writes
    `fillColor`; mosaic / blur are PNG-baked and don't accept
    style writes today (no-op, matches current behaviour where
    the generic path's `setAttribute("fill", …)` would be a
    cosmetic no-op on an `<image>`).
  - `crop` — none (no on-canvas element).
- `packages/core/src/editor/tool-registry.test.ts` —
  **paired round-trip tests** per tool:
  - Build a synthetic element, snapshot its initial attrs.
  - Call `extractStyleFromElement` → harvest preset.
  - Build a fresh element of the same shape / no attrs.
  - Call `applyStyleToElement` with the harvested preset.
  - Assert the fresh element's attrs match the original
    (modulo legacy-attribute aliases like `data-arrow-start-
    size` → split into `width` + `length`).
  - Marker legacy-preset path: build a preset with
    `strokeColor` set + `fillColor` UNSET +
    `markerBorder*` set; verify the writer routes
    strokeColor → bg fill and `markerBorder*` → bg border.

**Acceptance:**

- `pnpm test` passes (existing tests untouched; new round-trip
  tests added)
- `pnpm --filter @ingcreators/annot-core typecheck` passes
- The set of fields written by each `applyStyleToElement`
  matches the set read by `extractStyleFromElement` — codified
  as a meta-test: harvest → write → harvest produces identical
  preset slices.

### Phase 3 — Migrate `applyPresetStyleAttrs` to dispatch via the registry

**Goal:** Replace `applyPresetStyleAttrs`'s element-tag cascade
with a generic loop over `TOOL_REGISTRY`. Delete
`applyMarkerPresetStyle` / `applyTextboxPresetStyle` exports
(they're now inside the registry). Keep
`applyPresetStyleAttrs` as the public entry point so
`Toolbar.#applyPresetStyleAttrs` doesn't change.

**Files:**

- `packages/web/src/editor/toolbar-preset-helpers.ts` —
  `applyPresetStyleAttrs` body becomes a 6-line loop over
  `TOOL_REGISTRY` matching against `variantKeyForElement` and
  dispatching to `applyStyleToElement`. The legacy branches +
  the two helpers are deleted.
- `packages/web/src/editor/toolbar.ts` —
  `Toolbar.#applyPresetStyleAttrs` stays as a 1-line wrapper
  (it's an instance method other parts of the toolbar may call;
  inline if no longer needed after the migration).
- Existing `applyPresetStyleAttrs` tests in
  `toolbar-preset-helpers.test.ts` (if any are added by the
  current work) stay green — same DOM output, same call
  contract.

**Acceptance:**

- `pnpm test` passes — every existing test green, no test
  change required
- `pnpm lint` clean
- `pnpm --filter @ingcreators/annot-web build` passes
- Manual smoke-test: select a shape (any tool), switch its
  variant via the Selection panel's Type picker, verify the
  rendered style matches the saved preset for the new variant
  (specifically: marker bg primitive's `fill`+`stroke` flip
  correctly; textbox text `fill` updates with `data-color`;
  highlight rect `fill` switches to the new color)

### Phase 4 — Symmetry test + cleanup + plan archival

**Goal:** Add a structural symmetry test guarding the
"every extractor has a paired writer" invariant. Settle file
naming. Delete dead code. Archive the plan.

**Files:**

- `packages/core/src/editor/tool-registry.test.ts` —
  new test:
  ```ts
  it("every tool with extractStyleFromElement has applyStyleToElement", () => {
    for (const [id, entry] of Object.entries(TOOL_REGISTRY)) {
      if (entry.extractStyleFromElement) {
        expect(entry.applyStyleToElement, `${id} missing applyStyleToElement`).toBeDefined();
      }
      if (entry.applyStyleToElement) {
        expect(entry.extractStyleFromElement, `${id} missing extractStyleFromElement`).toBeDefined();
      }
    }
  });
  ```
- `packages/web/src/editor/toolbar-preset-helpers.ts` — file
  should now be ~80 LOC (down from 322). Final pass: inline
  any helpers that became trivial wrappers; delete unused
  imports (`computeDasharray`, `refreshArrowPath` if no
  longer used in this file).
- `CLAUDE.md` — extend the "schema-driven trilogy" guardrail
  block in the toolbar section: mention that each tool's
  registry entry now carries a paired
  `extractStyleFromElement` + `applyStyleToElement`, and
  that adding a new style field requires editing both.
- Move
  [`docs/plans/toolbar-apply-style-to-element.md`](./toolbar-apply-style-to-element.md)
  → `docs/plans/_done/toolbar-apply-style-to-element.md`
  with a status header noting the landing PR range.
- Update `docs/plans/README.md`: remove the queued entry, add
  a "Recently landed plans" row.

**Acceptance:**

- `pnpm -r typecheck` passes
- `pnpm test` passes
- `pnpm lint` clean
- The symmetry test exists and passes (proves the structural
  invariant going forward)

## Out of scope

- **Moving `seedPresetFromElement` into the registry.** It also
  duplicates a portion of the universal-style read; consolidating
  it with `extractStyleFromElement` is a separate refactor
  (smaller / lower priority). Queue separately if there's
  appetite.
- **Per-tool `applyStyleToElement` for crop.** Crop has no
  on-canvas element and no `extractStyleFromElement`; the
  symmetry test in Phase 4 explicitly handles "neither defined"
  as fine.
- **Refactoring `Toolbar.#applyPresetStyleAttrs` /
  `#seedPresetFromElement` instance-method wrappers.** Those
  are 1-line indirections, candidates for inline cleanup but not
  a blocker for this plan.
- **Solving the "write side ignores `redact-mosaic` /
  `redact-blur`" gap.** Those variants bake a PNG and have no
  meaningful style attrs the user can edit per-element via
  rubber-band today. Leaving redact's `applyStyleToElement` as
  "solid only" preserves current behaviour; if the design later
  wants per-redact-variant writes, a follow-up plan can extend.

## Reference: existing code to read

Before starting, read these in this order:

1. [`packages/web/src/editor/toolbar-preset-helpers.ts`](../../packages/web/src/editor/toolbar-preset-helpers.ts) — the file under refactor. Lines 201–322 are the migration target (`applyPresetStyleAttrs` + the two tool-specific helpers).
2. [`packages/core/src/editor/tool-registry.ts`](../../packages/core/src/editor/tool-registry.ts) — read each tool's existing `extractStyleFromElement` (Phase 5 of `_done/toolbar-schema.md`) so the inverse you write reads the same fields back.
3. [`packages/core/src/editor/arrow-markers.ts`](../../packages/core/src/editor/arrow-markers.ts) — the `refreshArrowPath` export arrow's writer needs to call after a stroke change.
4. [`docs/plans/_done/toolbar-schema.md`](./_done/toolbar-schema.md) — the prior plan, especially Phase 5's design notes on `extractStyleFromElement` (the read-side mirror this plan completes).
5. PR [#170](https://github.com/ingcreatorsthat/annot/pull/170) (Phase 5 landing) — the commit body describes the read-side refactor in the same shape this plan applies to the write side.

## Status log

- 2026-04-26 — Plan drafted as the queued follow-up to
  Toolbar Phase 5. Same imperative-cascade →
  declarative-registry-callback pattern, applied to the inverse
  direction so reader + writer are paired in the registry.
