# Toolbar — Schema-drive the Highlight "color flyout" special case

> **Status:** Done — landed 2026-04-26 across PRs
> [#197](https://github.com/ingcreators/annot/pull/197)–TBD.
> Cleanup follow-up to
> [`./toolbar-schema.md`](./toolbar-schema.md).
> The toolbar's Highlight tool is the last residual `if (toolId
> === "highlight")` branch site after the Phase 5 schema-driven
> migration: 3 callsites still hard-code Highlight's "variant is
> a color, not an icon glyph" presentation. This plan lifts those
> cases into a `flyoutKind: "variant" | "color"` discriminator on
> `ToolRegistryEntry` (plus a small `chipColor` accessor) so a
> future tool with a swatch-style flyout (e.g. a "Stamp" or
> "Pen color" tool) inherits the same path without copy-paste.
>
> **Risk:** Low. The 3 callsites are all toolbar UI rendering;
> the underlying `<annot-tool-flyout>` component already
> distinguishes `layout: "variant" | "color"` and renders both
> styles. This plan unifies the dispatch into the registry, not
> the leaf-component behaviour. Behaviour preservation is
> validated by happy-dom tests against the existing flyout
> component plus a manual smoke-test on each callsite.

## How to resume in a fresh session

```
"Read docs/plans/toolbar-highlight-flyout-kind.md and start <phase>."
```

Each phase is independently merge-able and CI-green on its own.

## Context

Three places in `packages/web/src/editor/` still hard-code
`if (toolId === "highlight") { … color path … } else { … variant
path … }`:

| Callsite | File | Special-case treatment |
|---|---|---|
| Badge click → flyout dispatch | [`toolbar.ts:1307-1311`](../../packages/web/src/editor/toolbar.ts:1307) | `if (toolId === "highlight") this.#showHighlightColorFlyout(wrap); else this.#showVariantFlyout(toolId, wrap);` |
| `#syncToolButtonIcon` badge rendering | [`toolbar.ts:1329-1359`](../../packages/web/src/editor/toolbar.ts:1329) | Color-swatch badge (`tool-btn-badge-color` + `--swatch-color` CSS var + `highlightColorLabel(color)` for tooltip) — distinct from the icon/SVG glyph badges every other variant tool uses |
| Toolbox menu badge + submenu chip | [`toolbar-canvas-menu.ts:330,350`](../../packages/web/src/editor/toolbar-canvas-menu.ts:330) | `if (toolId === "highlight") { badge = { swatch: currentVariant.value }; … submenu chip swatch: v.value, … }` instead of `{ icon: currentVariant.icon }` / `{ svg: currentVariant.svg }` |

Plus two methods that exist solely to serve the Highlight path:

- `Toolbar.#showHighlightColorFlyout` ([toolbar.ts:1397-1435](../../packages/web/src/editor/toolbar.ts:1397))
  — distinct from `Toolbar.#showVariantFlyout` only because it
  passes `flyout.layout = "color"` and maps chips into `{value,
  color, label}` shape (instead of `{value, icon, svg, label}`)
  AND looks up the canonical mixed-case hex from
  `HIGHLIGHT_COLORS` before persisting (the chip's `value` is
  pre-lower-cased to make the active-state match work).

The leaf component (`<annot-tool-flyout>` /
[`annot-tool-flyout.ts`](../../packages/web/src/editor/annot-tool-flyout.ts))
ALREADY parametrises `layout: "variant" | "color"` and renders
both via the same chip-row scaffold. Only the Toolbar / canvas-
menu side hard-codes "for highlight, take the OTHER path".

### Why this is the right next refactor

1. **It's the last `toolId === "..."` literal in the toolbar's
   render paths.** After Phases 1–6 of `_done/toolbar-schema.md`,
   the only remaining hard-coded tool id in toolbar.ts +
   canvas-menu rendering is `"highlight"`. Lifting it to a
   registry discriminator brings the toolbar to a structurally
   uniform state — adding a new color-flyout tool (e.g. a
   "Stamp" or "Pen color" tool) becomes one registry entry, no
   `if (toolId === "stamp" || toolId === "highlight")` chains.
2. **It surfaces a real product concept that's currently
   invisible.** The discriminator answers: "is this tool's
   variant a color, or an icon glyph?". The answer drives
   THREE rendering decisions today (flyout layout, badge style,
   toolbox-menu chip style) plus ONE persistence decision
   (lowercased lookup). Naming it makes the cross-callsite
   coordination explicit.
3. **Symmetric with the read/write registry callbacks.**
   `extractStyleFromElement` (Phase 5 of `_done/toolbar-schema.md`)
   and `applyStyleToElement` (queued in
   [`toolbar-apply-style-to-element.md`](./toolbar-apply-style-to-element.md))
   are per-tool callbacks. `flyoutKind` is the matching per-tool
   metadata for the rendering path. After this lands, the
   registry covers metadata (id / label / icon / variants /
   variantField / defaultVariant / presetFields / **flyoutKind**)
   AND behaviour (variantKeyForElement / extractStyleFromElement
   / applyStyleToElement) for every tool, with no Highlight-
   shaped escape hatches.

## Goal

A new optional Tier B field on `ToolRegistryEntry`:

```ts
interface ToolRegistryEntry {
  // ... existing fields ...

  /** How the tool's variant flyout / variant badge / toolbox-menu
   *  submenu present each variant chip:
   *    - "variant" (default): icon glyph (Material Symbols
   *      ligature) or inline SVG, matching the chip's
   *      `icon` / `svg` fields.
   *    - "color": filled color swatch driven by the chip's
   *      `chipColor` accessor (or, for the legacy Highlight
   *      catalog, the variant's `value` itself when it's a hex
   *      string).
   *  Default is "variant" for tools without sub-variants
   *  (Crop) and for tools whose variants are SHAPE-discriminated
   *  (shape / arrow / text / freehand / marker / redact).
   *  Highlight is the lone "color" today. */
  flyoutKind?: "variant" | "color";

  /** Chip color resolver — only meaningful when
   *  `flyoutKind === "color"`. Returns the swatch fill color for
   *  a given variant value. Defaults to identity (`(v) => v`),
   *  which works for Highlight today (variant value IS the hex
   *  string). Future tools whose variant value is an opaque id
   *  (e.g. `"red"` instead of `"#ff0000"`) override to map
   *  through their palette. */
  chipColorForVariant?: (variantValue: string) => string;

  /** Tooltip-label resolver — overrides the default
   *  `${label} (${variantLabel})` formatter for tools whose
   *  variant LABEL doesn't render usefully (e.g. Highlight uses
   *  the palette LABEL like "Yellow" rather than the variant
   *  value, which is a hex). When undefined, the default format
   *  applies. */
  tooltipLabelForVariant?: (variantValue: string, variantLabel: string) => string;
}
```

Plus a small Tier C resolver that turns a chip's "active"
comparison into a normalised key — Highlight today does
`current.toLowerCase()` because palette hexes round-trip via
both cases. When `flyoutKind === "color"`, the comparator is
case-insensitive; otherwise it's strict equality.

After the migration, the three callsites become:

```ts
// 1. Badge click → flyout dispatch (toolbar.ts)
if (TOOL_REGISTRY[toolId]?.flyoutKind === "color") {
  this.#showColorFlyout(toolId, wrap);
} else {
  this.#showVariantFlyout(toolId, wrap);
}

// 2. Badge rendering (#syncToolButtonIcon)
const meta = TOOL_REGISTRY[toolId];
if (!meta?.variants || !meta.variantField || !meta.defaultVariant) return;
const preset = this.#getCurrentPreset(toolId);
const current = (preset[meta.variantField] as string) || meta.defaultVariant;
const variant = meta.variants.find((v) => v.value === current);
if (!variant) return;
const badge = this.#ensureBadge(btn, toolId);
if (meta.flyoutKind === "color") {
  badge.className = "tool-btn-badge tool-btn-badge-color";
  badge.style.setProperty("--swatch-color", meta.chipColorForVariant?.(current) ?? current);
  badge.textContent = "";
} else if (variant.svg) {
  badge.className = "tool-btn-badge tool-btn-badge-svg";
  badge.innerHTML = variant.svg;
} else {
  badge.className = "tool-btn-badge material-symbols-outlined";
  badge.textContent = variant.icon;
}
const composedTooltip =
  meta.tooltipLabelForVariant?.(current, variant.label) ?? `${variant.label}`;
const toolDef = this.#tools.get(toolId);
if (toolDef) {
  const composed = composedTooltip
    ? `${toolDef.label} (${composedTooltip})`
    : toolDef.label;
  setTooltip(btn, composed);
  btn.setAttribute("aria-label", composed);
}

// 3. Toolbox-menu badge / submenu (toolbar-canvas-menu.ts)
const isColor = meta.flyoutKind === "color";
const badge = isColor
  ? { swatch: meta.chipColorForVariant?.(currentValue) ?? currentValue }
  : currentVariant.svg
    ? { svg: currentVariant.svg }
    : { icon: currentVariant.icon };
// ... and submenu chips:
isColor
  ? { swatch: meta.chipColorForVariant?.(v.value) ?? v.value, label: v.label, action: ... }
  : { svg: v.svg, icon: v.icon, label: v.label, action: ... }
```

`#showHighlightColorFlyout` becomes a private wrapper or merges
into a generic `#showColorFlyout(toolId, anchor)` that reads
chip data from the registry. Highlight's hex-canonicalisation
on chip-select moves into the registry as a small `commitVariant`
hook (or stays in the flyout via a known
"`HIGHLIGHT_COLORS.find(... toLowerCase())`" lookup — see
Phase 2 design notes).

## Constraints

- **Behaviour preservation is non-negotiable.** Every existing
  test passes without modification. The toolbar / canvas-menu /
  Highlight-color-flyout DOM output stays byte-equivalent for
  Highlight today. Manual smoke-tests cover the three
  affordances: toolbar badge swatch, toolbar variant badge for
  every other tool, toolbox right-click menu (Highlight + every
  other variant tool).
- **No new DOM dependencies in `annot-core`.** `flyoutKind` is
  pure data (a string literal union); `chipColorForVariant` /
  `tooltipLabelForVariant` are pure `(string, string) => string`
  closures with no DOM access.
- **`tool-property-renderer.ts:isHighlight` stays as-is.** The
  per-tool side panel renderer's Highlight branch (lines 88,
  453-499 of [`tool-property-renderer.ts`](../../packages/web/src/editor/tool-property-renderer.ts))
  is in scope of the separate
  [`tool-property-renderer-schema.md`](./tool-property-renderer-schema.md)
  plan. This plan stays focused on the toolbar / canvas-menu
  surfaces.
- **PR-per-phase.** Each phase is independently merge-able. Land
  Phase 1 → wait for green → Phase 2 → … matching the cadence of
  the prior schema-driven migrations.

## Phases

### Phase 1 — Land `flyoutKind` + `chipColorForVariant` + `tooltipLabelForVariant` (Tier B)

**Goal:** Land the type extension + populate the new fields on
the highlight registry entry. Don't wire callsites yet — just
have the data structure compile and a unit test pinning shape
invariants.

**Files:**

- `packages/core/src/editor/tool-registry.ts` —
  - Add `flyoutKind?: "variant" | "color"` /
    `chipColorForVariant?` / `tooltipLabelForVariant?` interface
    fields with docstrings.
  - Highlight entry: set `flyoutKind: "color"` + populate
    `tooltipLabelForVariant: (value) => highlightColorLabel(value) ?? ""`
    (returns the palette label like "Yellow" for known colors,
    empty string for ad-hoc hexes — empty triggers the
    "no parens" tooltip path).
  - Move `highlightColorLabel` into the registry file as a Tier
    B helper if a circular import becomes a problem; otherwise
    keep using the existing export from `toolbar-icons.ts`.
  - `chipColorForVariant` for highlight: identity (variant value
    IS the hex). Other tools omit the field entirely.
- `packages/core/src/editor/tool-registry.test.ts` —
  shape invariants:
  - Highlight has `flyoutKind === "color"`.
  - Every other tool has `flyoutKind === undefined` (treated
    as "variant" by callers).
  - `tooltipLabelForVariant` for highlight returns "Yellow"
    for `"#ffe100"`, empty / undefined for an unknown hex like
    `"#123456"`.
- `packages/core/src/headless.ts` + `packages/core/src/editor/index.ts`
  — no changes (the new fields ride on the existing
  `ToolRegistryEntry` re-export).

**Acceptance:**

- `pnpm --filter @ingcreators/annot-core typecheck` passes
- `pnpm vitest run packages/core/src/editor/tool-registry.test.ts`
  passes
- `headless.test.ts` boundary still green

### Phase 2 — Add `Toolbar.#showColorFlyout` generic + migrate the 1st callsite (badge click dispatch)

**Goal:** Land a generic `#showColorFlyout(toolId, anchor)` in
`toolbar.ts` that reads chip data + canonicalisation rules from
the registry. Use the registry's `flyoutKind` to dispatch from
the badge click handler. The other two callsites (badge
rendering, canvas menu) stay imperative for this phase — split
to keep the diff small + reviewable.

**Files:**

- `packages/web/src/editor/toolbar.ts` —
  - New `#showColorFlyout(toolId, anchor)` mirroring the
    `#showHighlightColorFlyout` body but reading `meta.variants`
    + `meta.variantField` from the registry instead of the
    hard-coded `HIGHLIGHT_COLORS` import.
  - Hex canonicalisation on chip select: when the registry's
    `flyoutKind === "color"`, look up the canonical (mixed-case)
    chip value from `meta.variants.find((v) => v.value.toLowerCase()
    === detail.value)?.value ?? detail.value` (no longer hard-
    codes `HIGHLIGHT_COLORS.find`).
  - Badge click handler dispatches via `meta.flyoutKind` instead
    of `toolId === "highlight"`.
  - `#showHighlightColorFlyout` deleted (its body fully covered
    by `#showColorFlyout`).
- `packages/web/src/editor/toolbar.test.ts` (or
  `toolbar-flyout.test.ts` if a new file is preferable for
  scope) — happy-dom-backed click test:
  - Build a Toolbar with the registry, click the highlight
    badge, assert a flyout opens with `layout="color"` and
    `chips` matching `HIGHLIGHT_COLORS`.

**Acceptance:**

- `pnpm test` passes (existing tests untouched)
- Manual smoke-test: clicking the highlight tool's badge opens
  the same color-swatch flyout as today; clicking any other
  variant tool's badge opens the same icon-chip flyout as today.
- `pnpm --filter @ingcreators/annot-web build` passes

### Phase 3 — Migrate `#syncToolButtonIcon` highlight branch

**Goal:** Replace the `if (toolId === "highlight")` block in
`Toolbar.#syncToolButtonIcon` with `meta.flyoutKind === "color"`
dispatch + the registry's `chipColorForVariant` /
`tooltipLabelForVariant` accessors.

**Files:**

- `packages/web/src/editor/toolbar.ts` —
  - `#syncToolButtonIcon` becomes a single code path: read
    `meta` once, branch on `flyoutKind`, fall through to the
    common label-update block. The early-return for highlight
    + the duplicated `setTooltip` / `aria-label` writes go away.
- `packages/web/src/editor/toolbar.ts` — remove the `import { highlightColorLabel }`
  if it's no longer used directly (it's now inside the registry
  via `tooltipLabelForVariant`).

**Acceptance:**

- `pnpm test` passes
- Manual smoke-test: highlight badge still shows the
  color-swatch dot with the canonical color ("Yellow") tooltip
  when a palette color is active; other tools' badges still
  show their icon glyphs / SVGs.

### Phase 4 — Migrate `toolbar-canvas-menu.ts` highlight branches

**Goal:** Replace the two `toolId === "highlight"` branches in
`toolMenuEntry` with `meta.flyoutKind` dispatch + the
`chipColorForVariant` accessor.

**Files:**

- `packages/web/src/editor/toolbar-canvas-menu.ts` —
  `toolMenuEntry`'s badge + submenu chip mapping reads the
  registry's `flyoutKind` once, dispatches:
  ```ts
  const isColor = meta.flyoutKind === "color";
  const chipBadge = (value: string, variant: ToolRegistryVariant) =>
    isColor
      ? { swatch: meta.chipColorForVariant?.(value) ?? value }
      : variant.svg
        ? { svg: variant.svg }
        : { icon: variant.icon };
  ```
- Optional: if the canvas menu's submenu chip mapping becomes
  symmetric enough, extract a small helper into a shared module
  (e.g. `toolbar-flyout-chip.ts`) so the toolbar + canvas-menu
  paths use ONE chip-rendering helper. Deferred to Phase 5
  cleanup if the diff stays small.

**Acceptance:**

- `pnpm test` passes
- Manual smoke-test: right-click on empty canvas → toolbox
  menu. Verify the Highlight row shows a swatch badge + a
  submenu of swatch chips; every other tool shows icon/SVG
  badges + icon submenu chips.
- `pnpm --filter @ingcreators/annot-web build` passes

### Phase 5 — Cleanup + structural test + plan archival

**Goal:** Delete dead code, finalise file layout, add a
structural test guarding the "no `toolId === "..."` literal in
toolbar render paths" invariant.

**Files:**

- `packages/web/src/editor/toolbar.ts` /
  `packages/web/src/editor/toolbar-canvas-menu.ts` —
  final pass: remove any leftover Highlight-specific imports
  (`HIGHLIGHT_COLORS` if no longer used directly,
  `highlightColorLabel` if delegated entirely to the registry).
- New test in `packages/web/src/editor/toolbar.test.ts` (or
  the existing test file) that grep-asserts `toolbar.ts` /
  `toolbar-canvas-menu.ts` source contains no
  `toolId === "highlight"` / `toolId === "any-other-id"`
  string. Caveat: the `tool-property-renderer.ts` `isHighlight`
  branch is out of scope (separate plan); the regex either
  excludes that file or scopes itself to the two migration
  targets.
- `CLAUDE.md` — extend the schema-driven trilogy guardrail
  block with one sentence noting `flyoutKind` as the per-tool
  presentation discriminator for variant flyouts / badges /
  toolbox-menu chips.
- Move
  [`docs/plans/toolbar-highlight-flyout-kind.md`](./toolbar-highlight-flyout-kind.md)
  → `docs/plans/_done/toolbar-highlight-flyout-kind.md` with
  status header noting the landing PR range.
- Update `docs/plans/README.md`: remove the queued entry, add
  a "Recently landed plans" row.

**Acceptance:**

- `pnpm -r typecheck` passes
- `pnpm test` passes
- `pnpm lint` clean
- The structural grep-test exists and passes (proves the
  `toolId === "..."` literal is gone from the toolbar render
  paths going forward)

## Out of scope

- **`tool-property-renderer.ts` Highlight branch.** Already
  covered by
  [`tool-property-renderer-schema.md`](./tool-property-renderer-schema.md)
  Phase 2 (the Tool-side property panel's `tool.typeChips`
  control will be discriminated by `flyoutKind` reading the
  same registry field this plan introduces — so Phase 1 here
  unblocks Phase 2 there).
- **Lifting the entire `<annot-tool-flyout>` Lit component
  switch on `layout`.** The component already parametrises
  layout cleanly; only the dispatcher (toolbar / canvas-menu)
  needs the cleanup.
- **Right-panel Highlight handling.** `right-panel.ts:659` uses
  `highlightColorLabel(el.getAttribute("fill"))` for the
  selected-element title. That's the SELECTION side, which is
  schema-driven via PropertyPanel registry already; this plan
  doesn't touch it.

## Reference: existing code to read

Before starting, read these in this order:

1. [`packages/web/src/editor/toolbar.ts`](../../packages/web/src/editor/toolbar.ts) lines 1290–1435 — the three sites this plan migrates plus `#showHighlightColorFlyout`.
2. [`packages/web/src/editor/toolbar-canvas-menu.ts`](../../packages/web/src/editor/toolbar-canvas-menu.ts) lines 300–365 — the toolbox-menu callsite.
3. [`packages/web/src/editor/annot-tool-flyout.ts`](../../packages/web/src/editor/annot-tool-flyout.ts) — the leaf component, especially the `layout` property + the `tool-flyout-color-row` CSS class. Confirms the leaf already supports both modes.
4. [`packages/core/src/editor/tool-registry.ts`](../../packages/core/src/editor/tool-registry.ts) — the registry the new fields land on. Highlight's existing `variantField: "highlightColor"` + `defaultVariant: HIGHLIGHT_COLORS[0]!.value` + `variants` are already in shape; this plan adds the *presentation* discriminator on top.
5. [`packages/core/src/editor/toolbar-icons.ts`](../../packages/core/src/editor/toolbar-icons.ts) — the source of `HIGHLIGHT_COLORS` + `highlightColorLabel`. Phase 1's `tooltipLabelForVariant` closure references the latter.
6. [`docs/plans/_done/toolbar-schema.md`](./_done/toolbar-schema.md) — the prior plan that completed Phases 1–6 of the toolbar registry migration. This is the residual cleanup it explicitly didn't tackle.

## Status log

- 2026-04-26 — Plan drafted as the queued cleanup follow-up to
  the toolbar schema-driven migration. Lifts the last
  Highlight-shaped escape hatch out of toolbar.ts +
  toolbar-canvas-menu.ts into a `flyoutKind` discriminator on
  `ToolRegistryEntry`.
- 2026-04-26 — All five phases landed:
  - Phase 1 ([#197](https://github.com/ingcreators/annot/pull/197))
    — `flyoutKind` / `chipColorForVariant` / `tooltipLabelForVariant`
    fields on `ToolRegistryEntry` + populated for highlight, with
    shape-invariant tests.
  - Phase 2 ([#198](https://github.com/ingcreators/annot/pull/198))
    — generic `Toolbar.#showColorFlyout(toolId, anchor)` +
    badge-click dispatch via `flyoutKind`. `#showHighlightColorFlyout`
    deleted; `HIGHLIGHT_COLORS` import dropped from `toolbar.ts`.
  - Phase 3 ([#199](https://github.com/ingcreators/annot/pull/199))
    — `#syncToolButtonIcon` highlight branch collapsed onto the
    `flyoutKind` discriminator + `tooltipLabelForVariant` accessor.
  - Phase 4 ([#200](https://github.com/ingcreators/annot/pull/200))
    — `toolbar-canvas-menu.ts` `toolMenuEntry` highlight branches
    (badge + submenu chip mapping) collapsed onto `flyoutKind`.
  - Phase 5 (this PR) — added `ensurePresetForVariantChange`
    callback on `ToolRegistryEntry` to lift the last
    `if (toolId === "highlight") preset.shapeType = "highlight";`
    line out of `#showColorFlyout`. Added structural test in
    `packages/web/src/editor/toolbar.test.ts` that grep-asserts
    `toolbar.ts` + `toolbar-canvas-menu.ts` source is free of
    `toolId === "<id>"` literals (excluding comments). Updated
    CLAUDE.md's schema-driven trilogy guardrail block; archived
    plan to `_done/`.
