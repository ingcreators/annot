# Toolbar — Schema-driven Refactor

> **Status:** Queued. Sibling to the just-landed property-panel
> schema-driven migration ([`_done/property-panel-schema.md`](./_done/property-panel-schema.md)
> + [`_done/property-panel-schema-extensions.md`](./_done/property-panel-schema-extensions.md),
> PRs #153–#164). Same imperative-chain → declarative-registry
> pattern, applied to `packages/web/src/editor/toolbar.ts`.
>
> **Scope:** Replace the imperative wiring in `Toolbar` (tool
> registration, preset (de)serialization, variant flyout, preset-
> from-element rubber-band) with a Tier B `TOOL_REGISTRY` schema
> that consolidates per-tool metadata in one place. Factories
> stay in Tier C (they need `CanvasManager` / `History`); the
> data ABOUT each tool (id, label, icon, variant catalog, preset
> field shape) lives in the registry.
>
> **Risk:** Medium. `Toolbar` is the editor's primary entry point
> for tool selection + preset persistence. The
> `syncPresetFromElement` / `applyElementVariantPreset` paths
> have per-tool special cases (highlight stores fill as
> `highlightColor`; text reads `font-size` from a child `<text>`;
> arrow has compound per-end state) that must survive the rewrite
> verbatim. Behaviour preservation is validated by happy-dom
> integration tests against synthetic SVG fixtures + preset
> round-trip golden tests.

## How to resume in a fresh session

```
"Read docs/plans/toolbar-schema.md and start <phase>."
```

The plan is self-contained; no prior conversation context is
required. Each phase below is independently merge-able and lists
its own acceptance criteria.

## Context

`packages/web/src/editor/toolbar.ts` is **2,181 LOC** and owns:

1. **Tool registration** — an inline `[id, label, icon, factory][]`
   array in `#registerTools()` (lines 275–333) populating a
   `Map<string, ToolDef>`.
2. **Preset state** — `#presets: Map<string, ToolOptions>`,
   `#lastVariantByTool: Map<string, string>`, plus a default
   `#options: ToolOptions` (the unified ToolOptions blob shared
   across tools).
3. **Preset (de)serialization** — `#loadPresetsFromFile()` /
   `#savePresetsToFile()` (lines ~1728–1820) carry a 25-field
   manual mapping between the camelCase `ToolOptions` keys and
   the snake_case wire format. A near-identical chain lives in
   `#savePresetsToLocalStorage` / `#loadPresetsFromLocalStorage`.
4. **Variant flyout** — `#showVariantFlyout()` (line 1229) reads
   from a partial Tier C registry in
   [`packages/web/src/editor/toolbar-variants.ts`](../../packages/web/src/editor/toolbar-variants.ts)
   (`TOOL_VARIANTS: Record<string, ToolVariantGroup>`). The
   registry already exists but lives in Tier C and conflates UI
   metadata with `factory` references.
5. **Preset rubber-band** — `syncPresetFromElement()` (lines
   1476–1660) reads style attrs off a selected element back into
   the appropriate variant's preset; per-tool branches handle
   `highlight` (fill → `highlightColor`), `text` (font on inner
   `<text>` child), `arrow` (compound per-end state).
   `applyElementVariantPreset()` (line 1167) is the inverse.

The schema-driven scaffold landed for PropertyPanel in PRs #153–
#164 makes each piece addressable by:

- Pulling the metadata into a Tier B registry
- Replacing the imperative chain with a generic loop / dispatch
- Keeping factories + DOM construction in Tier C, accessed via id

## Goal

A pure-data `TOOL_REGISTRY` in Tier B that fully describes every
tool the toolbar exposes, plus thin Tier C consumers that read
the registry and produce the same DOM + state behaviour today's
imperative chains do.

```ts
// Tier B — packages/core/src/editor/tool-registry.ts (NEW)
export interface ToolRegistryEntry {
  id: string;
  label: string;
  /** Material Symbols ligature for the toolbar button. */
  icon: string;
  /** Variant catalog (sub-shapes pickable from the flyout).
   *  Empty for tools without sub-variants (Crop). */
  variants?: ReadonlyArray<{
    value: string;
    icon: string;
    svg?: string;
    label: string;
  }>;
  /** Which `ToolOptions` field discriminates the variant. */
  variantField?: keyof ToolOptions;
  /** Default variant when no preset exists. */
  defaultVariant?: string;
  /** Which `ToolOptions` keys this tool's preset reads / writes
   *  (drives the generic preset (de)serializer). */
  presetFields: ReadonlyArray<keyof ToolOptions>;
  /** Element → variant key extractor. Returns the
   *  preset-storage key for an element (e.g. "shape.rounded"
   *  for a rounded `<rect>`). */
  variantKeyForElement?: (el: SVGElement) => string | null;
}

export const TOOL_REGISTRY: Readonly<Record<string, ToolRegistryEntry>>;
```

After this plan lands, `Toolbar.ts` should drop to roughly the
LOC range PropertyPanel landed at (~1,000 — about half of the
current 2,181). The 8 tool-related helper methods
(`#registerTools`, `#loadPresetsFromFile`, `#savePresetsToFile`,
`#loadPresetsFromLocalStorage`, `#savePresetsToLocalStorage`,
`#showVariantFlyout`, `syncPresetFromElement`,
`applyElementVariantPreset`) become 2–10 line dispatch loops
over `TOOL_REGISTRY`.

## Constraints

- **Behaviour preservation is non-negotiable.** Every existing
  test (~620 across the repo) must pass without modification.
  Preset round-trip (camelCase → snake_case → camelCase) needs a
  golden test that survives every phase. Variant switching needs
  to preserve the per-end arrow state mapping the imperative
  chain hand-rolls.
- **No new DOM dependencies in `annot-core`.** Tool factories
  stay in Tier C — they construct `ArrowTool` / `ShapeTool` /
  etc. which take `CanvasManager` + `History`. The Tier B
  registry holds only metadata + element-takers.
- **PR-per-phase.** Each phase below is independently merge-able
  and CI-green on its own. Land Phase 1 → wait for green →
  Phase 2 → … (matches the cadence of the property-panel
  series #153–#164).
- **`presetFields` arrays are the single source of truth.**
  Once Phase 2 ships, adding a new `ToolOptions` field that one
  tool reads is one entry in that tool's `presetFields` —
  preset (de)serialization picks it up automatically without
  touching the file/localStorage marshallers.

## Phases

### Phase 1 — Land `TOOL_REGISTRY` interface + data (Tier B)

**Goal:** Land the type and the data structure covering every
tool in `#registerTools()` + every group in `TOOL_VARIANTS`. Don't
wire it into Toolbar yet — just have the registry compile and a
unit test pinning shape invariants.

**Files:**

- `packages/core/src/editor/tool-registry.ts` (NEW) — the
  `ToolRegistryEntry` interface + `TOOL_REGISTRY` constant. Move
  the variant catalogs from `packages/web/src/editor/toolbar-
  variants.ts` (Tier C, currently has both data + factory-bound
  `ToolDef` interface) into the registry. The factory-bound
  `ToolDef` stays in Tier C; the data half migrates here.
- `packages/core/src/editor/tool-registry.test.ts` (NEW) —
  shape invariants:
  - Every entry's `id` matches its key
  - Every variant entry has both `value` + `label`
  - `defaultVariant` (if present) appears in the `variants` list
  - `presetFields` reference only valid `ToolOptions` keys
  - The 8 currently-registered tool ids all have entries

**Acceptance:**

- `pnpm --filter @ingcreators/annot-core typecheck` passes
- `pnpm vitest run packages/core/src/editor/tool-registry.test.ts`
  passes
- `headless.test.ts` boundary still passes (no DOM globals at
  module load — the registry is data only)
- `TOOL_REGISTRY` covers all 8 tools (arrow, shape, highlight,
  text, freehand, marker, redact, crop)

### Phase 2 — Generic preset (de)serializer driven by the registry

**Goal:** Replace the manual 25-field camelCase ↔ snake_case
mapping in `#loadPresetsFromFile` / `#savePresetsToFile` /
`#loadPresetsFromLocalStorage` / `#savePresetsToLocalStorage`
with a generic mapper that walks `TOOL_REGISTRY[toolId].
presetFields` and converts each field via a single-source-of-
truth case-conversion table.

**Files:**

- `packages/core/src/editor/tool-preset-serde.ts` (NEW) —
  `presetToWire(opts: ToolOptions, presetFields): Record<string,
  unknown>` and `presetFromWire(record, presetFields): Partial<
  ToolOptions>`. Pure functions, jsdom-friendly, Tier B.
- `packages/core/src/editor/tool-preset-serde.test.ts` (NEW) —
  round-trip golden tests for each tool:
  - Build a sample preset for the tool
  - `presetToWire(...)` → snake_case record
  - `presetFromWire(...)` → recovers the original camelCase
    object byte-equivalent
  - Pin the wire format with an inline snapshot per tool so any
    field-name accident shows up loudly
- `packages/web/src/editor/toolbar.ts` — replace the 4 manual-
  mapping methods with calls to the new helpers. The 4 methods
  shrink from ~80 LOC each to ~10 LOC each.

**Acceptance:**

- All existing preset-related tests pass (legacy
  `migrateLegacyPresetKey` tests in
  `toolbar-preset-helpers.test.ts` stay green)
- New round-trip tests pass for every tool
- A preset file written by the new code reads identically to one
  written by the old code (manual smoke-test: open a saved
  preset file in a hex editor diff)
- `pnpm --filter @ingcreators/annot-web build` passes

### Phase 3 — Migrate `#registerTools()` to consume the registry

**Goal:** Replace the inline `[id, label, icon, factory][]` array
with a loop over `TOOL_REGISTRY`. Keep the factory map (toolId →
factory) Tier C-local (factories take `CanvasManager` /
`History`).

**Files:**

- `packages/web/src/editor/toolbar.ts` — `#registerTools()` body
  becomes:
  ```ts
  for (const id of Object.keys(TOOL_REGISTRY)) {
    const meta = TOOL_REGISTRY[id]!;
    const factory = TOOL_FACTORIES[id];
    if (!factory) continue; // crop has no preset-bound factory yet
    this.#tools.set(id, {
      label: meta.label,
      icon: meta.icon,
      factory: (o) => factory(o, this.#canvas, this.#history, this.#selection),
    });
  }
  ```
  with `TOOL_FACTORIES: Record<string, (opts, canvas, history,
  selection) => ToolBase>` declared in a new Tier C file
  `packages/web/src/editor/tool-factories.ts`.

**Acceptance:**

- `pnpm test` passes (no test changes expected)
- Manual smoke-test: every tool button activates correctly +
  produces the same SVG output as before
- `#registerTools()` shrinks from ~60 LOC to ~10 LOC

### Phase 4 — Migrate `#showVariantFlyout()` to read from the registry

**Goal:** Replace the `TOOL_VARIANTS[toolId]` lookup with
`TOOL_REGISTRY[toolId].variants`. The lookup currently lives in
the Tier C `toolbar-variants.ts`; after this phase the file is
deleted and its `TOOL_VARIANTS` constant is gone.

**Files:**

- `packages/web/src/editor/toolbar.ts` — `#showVariantFlyout()`
  reads `TOOL_REGISTRY[toolId]` directly:
  ```ts
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.variants) return;
  const preset = this.#getCurrentPreset(toolId);
  const current = (preset[meta.variantField!] as string) ||
                   meta.defaultVariant!;
  // ... rest unchanged ...
  ```
- `packages/web/src/editor/toolbar-variants.ts` — DELETED. The
  `ToolDef` interface (factory-bound) moves into a 5-LOC declaration
  in `toolbar.ts` itself or `tool-factories.ts`.
- Update `toolIdForElement` (currently in `toolbar-variants.ts`)
  to either move into Tier B `tool-registry.ts` (it's a pure
  classifier) or stay in Tier C beside `tool-factories.ts`.

**Acceptance:**

- `pnpm test` passes
- Variant flyout smoke-test: open Shape tool's flyout, switch
  variant — same chip set, same active state, same icon
  swap on the parent button

### Phase 5 — Schema-drive `syncPresetFromElement` + `applyElementVariantPreset`

**Goal:** The two methods have per-tool branches (`if (toolId
=== "text") ...`, `if (toolId === "arrow") ...`, etc.). Move the
per-tool readers / writers into the registry as `extractStyleFromElement`
/ `applyStyleToElement` callbacks, then collapse the panel-side
methods to a generic dispatch.

**Design:**

```ts
interface ToolRegistryEntry {
  // ... existing fields ...
  /** Tool-specific style reader. Mutates `preset` in place with
   *  values harvested from `el`'s attributes / children. The
   *  generic universal-style reader (stroke / fill / etc.) runs
   *  BEFORE this hook; the hook only handles tool-specific
   *  branches the universal reader can't capture. */
  extractStyleFromElement?: (el: SVGElement, preset: ToolOptions) => void;
  /** Tool-specific style writer. Inverse of the reader. Writes
   *  preset values back onto `el`. */
  applyStyleToElement?: (el: SVGElement, preset: ToolOptions) => void;
}
```

The Toolbar's `syncPresetFromElement` shrinks to:

```ts
syncPresetFromElement(el: SVGElement): void {
  const toolId = toolIdForElement(el);
  if (!toolId) return;
  const elementKey = elementKeyFromElement(el, toolId);
  const preset = { ...(this.#presets.get(elementKey) || this.#options) };
  applyUniversalStyleReader(readEl(el), preset);  // stroke/fill/etc.
  TOOL_REGISTRY[toolId]?.extractStyleFromElement?.(el, preset);
  this.#presets.set(elementKey, preset);
  // ... rest unchanged ...
}
```

**Files:**

- `packages/core/src/editor/tool-registry.ts` — extend each
  entry with the optional callbacks. The reader/writer logic
  for `text` / `arrow` / `highlight` / `freehand` migrates here
  from `toolbar.ts`.
- `packages/core/src/editor/tool-registry.test.ts` — add per-
  tool round-trip tests:
  - Build a synthetic element fixture
  - Pass through `extractStyleFromElement`
  - Verify the harvested preset matches expectations
  - Apply via `applyStyleToElement` to a fresh element
  - Verify the resulting attributes match the input
- `packages/web/src/editor/toolbar.ts` — collapse the two methods.

**Acceptance:**

- All existing tests pass
- Manual smoke-test: select an element of each type → tweak its
  style → verify the next click on the same tool inherits the
  tweak (rubber-band path)
- The two methods drop from ~190 LOC combined to ~30 LOC

### Phase 6 — Cleanup + plan archival

**Goal:** Delete dead code, update CLAUDE.md, archive the plan.

**Files:**

- `packages/web/src/editor/toolbar.ts` — should now be ~1,100
  LOC (down from 2,181). Inline any helpers that became
  trivial wrappers; delete unused imports.
- `CLAUDE.md` — extend the existing "PropertyPanel is schema-
  driven" guardrail (#6) to mention the parallel `TOOL_REGISTRY`
  pattern.
- Move `docs/plans/toolbar-schema.md` →
  `docs/plans/_done/toolbar-schema.md` with a status header
  noting the landing PR range.

## Out of scope

- **`SelectionManager.ts` (1,859 LOC)** — same call-out as the
  property-panel plan. Its UI surface is gesture state, not
  declarative controls; this pattern doesn't apply.
- **Replacing the `<annot-tool-flyout>` Lit component** — the
  registry feeds it data; the component itself stays as-is.
- **Migrating the per-tool property panel
  (`#populateToolProperties` / `populateToolPropertyPanel`)** —
  already extracted to a separate file; could itself be schema-
  driven by reusing the PropertyPanel registry. Queue separately
  if there's appetite.

## Reference: existing code to read

Before starting, read these in this order:

1. `packages/web/src/editor/toolbar.ts` — skim each method
   listed in "Context" above to understand the imperative
   chains being replaced.
2. `packages/web/src/editor/toolbar-variants.ts` — the partial
   Tier C registry that becomes the seed for `TOOL_REGISTRY`.
3. `packages/core/src/editor/tool-options.ts` — the option-field
   shape the registry's `presetFields` references.
4. `docs/plans/_done/property-panel-schema.md` +
   `_done/property-panel-schema-extensions.md` — the prior
   schema-driven migration this plan mirrors.
5. PRs #153 (initial registry pattern) and #155 (live wiring +
   effect handler binding).

## Status log

- 2026-04-26 — Plan drafted as the queued follow-up to the
  PropertyPanel schema-driven migration. Same imperative-chain
  → declarative-registry pattern, applied to the toolbar.
