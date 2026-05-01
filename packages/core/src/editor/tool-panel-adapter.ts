/**
 * Tier B — Tool-side value adapters that bridge a `PropertyControlId`
 * (or `ToolPanelExtraControlId`) to a `(preset, value) => void`
 * mutation against `ToolOptions`. Sibling to `tool-registry.ts`'s
 * `panelControls` arrays: every id those arrays reference resolves
 * to one entry below.
 *
 * Why this file exists at all: the SELECTION-side `PROPERTY_CONTROLS`
 * registry in `property-schema.ts` describes mutations against
 * `SVGElement` attributes, not against a `ToolOptions` preset object.
 * The label / options / min / max / step / unit / allowNone metadata
 * on those defs IS sharable — but the mutation contract isn't. So the
 * Tool side runs its own thin adapter table, and Phase 4 of
 * `docs/plans/tool-property-renderer-schema.md` pulls the SELECTION
 * defs for metadata only via `selectionDef`.
 *
 * Phase 1 deliverable: data-only. No consumer reads
 * `TOOL_PANEL_ADAPTERS` yet — Phase 2's renderer in
 * `tool-property-renderer-schema.ts` (Tier C) is the first reader.
 *
 * Pure data + closures over `preset` / `toolId` only. No DOM
 * dependencies, no `CanvasManager`, no `Toolbar` access.
 */

import {
  PROPERTY_CONTROL_IDS,
  PROPERTY_CONTROLS,
  type PropertyControlDef,
  type PropertyControlId,
  type PropertyControlOption,
} from "./property-schema.js";
import {
  TOOL_PANEL_EXTRA_CONTROL_IDS,
  TOOL_REGISTRY,
  type ToolPanelExtraControlId,
} from "./tool-registry.js";
import type {
  ArrowDim,
  ArrowShape,
  LineCap,
  TextAnchor,
  TextVerticalAnchor,
  ToolOptions,
} from "./tool-options.js";

/** Every id a Tool-side `panelControls` entry can reference, plus
 *  the Tool-only extras. Drives the type of `TOOL_PANEL_ADAPTERS`'s
 *  key. */
export type ToolPanelAdapterId = PropertyControlId | ToolPanelExtraControlId;

/**
 * Read / write closure pair routing a single Tool-panel control's
 * value onto the active preset.
 *
 * Most adapters genuinely don't need `toolId` — they target a fixed
 * `ToolOptions` field regardless of which tool's panel is rendering.
 * The exception is `tool.typeChips`, whose target field varies by
 * tool (`shape.shapeType`, `arrow.arrowHead`, …) and is resolved
 * dynamically via `TOOL_REGISTRY[toolId].variantField`. To keep the
 * adapter shape uniform, every read / write takes `toolId` and the
 * implementations that don't need it simply ignore the argument.
 *
 * Values are typed `unknown` at the registry level (a generic `T`
 * runs into the contravariant-position assignability problem when
 * mixed adapters share a single `Record` literal — the same reason
 * the SELECTION-side `PropertyControlDef` keeps T at its default).
 * Each adapter narrows internally via a single `String(value)` /
 * `Number(value)` / `value as Shape` coercion at the write site;
 * Phase 2's renderer is responsible for passing the right value
 * type for the id it's dispatching.
 *
 * `selectionDef` (Phase 4 wiring): names the matching SELECTION-side
 * `PropertyControlId` whose `PROPERTY_CONTROLS[…]` entry supplies the
 * label / options / min / max / step / unit / allowNone metadata.
 * `null` for Tool-only ids whose metadata has no SELECTION-side
 * analogue. Phase 2's renderer doesn't read this yet — Phase 4 is
 * where the metadata reuse lands.
 */
export interface ToolPanelAdapter {
  /** Read the current value off the preset. */
  read: (preset: ToolOptions, toolId: string) => unknown;
  /** Mutate the preset in place. Returning the value or anything
   *  else is ignored — the caller is responsible for persistence
   *  (re-saving the preset, re-syncing `ctx.options`, etc.). */
  write: (preset: ToolOptions, value: unknown, toolId: string) => void;
  /** SELECTION-side def whose metadata (label / options / ranges)
   *  this adapter borrows. `null` for Tool-only ids. */
  selectionDef?: PropertyControlId | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Byte-for-byte percent ↔ opacity converters used by the three
 *  transparency / opacity adapters. The percent ↔ opacity mapping
 *  matches the imperative renderer's `Math.round((1 - x) * 100)` and
 *  `1 - v / 100` (or the direct counterpart) so the Phase 2 schema
 *  renderer produces the same values the imperative cascade did. */
const transparencyPercentFromOpacity = (op: number, fallback: number): number => {
  const safe = Number.isFinite(op) ? op : fallback;
  return Math.round((1 - safe) * 100);
};
const opacityFromTransparencyPercent = (pct: number): number => 1 - pct / 100;
const opacityPercentFromOpacity = (op: number, fallback: number): number => {
  const safe = Number.isFinite(op) ? op : fallback;
  return Math.round(safe * 100);
};
const opacityFromOpacityPercent = (pct: number): number => pct / 100;

/** Per-end arrow Size composite adapter helpers. The SELECTION-side
 *  `arrow{Start,End}Size` defs encode size as a `"w-l"` string (e.g.
 *  `"md-lg"`) — the Tool side stores width / length as separate
 *  `arrowWidth*` / `arrowLength*` fields. These two helpers keep the
 *  composite encoding identical so Phase 4 can pull options metadata
 *  from the SELECTION registry without reformatting. */
function isArrowDim(v: string): v is ArrowDim {
  return v === "sm" || v === "md" || v === "lg";
}
function arrowDim(v: ArrowDim | undefined, fallback: ArrowDim): ArrowDim {
  return v ?? fallback;
}
function readArrowSize(width: ArrowDim | undefined, length: ArrowDim | undefined): string {
  return `${arrowDim(width, "md")}-${arrowDim(length, "md")}`;
}
function parseArrowSize(value: string): { width: ArrowDim; length: ArrowDim } {
  const [w, l] = value.split("-");
  return {
    width: w && isArrowDim(w) ? w : "md",
    length: l && isArrowDim(l) ? l : "md",
  };
}

// ─── The adapter registry ────────────────────────────────────────────

/**
 * Maps every `panelControls` id to its read / write contract.
 *
 * Adapter coverage rules (validated by `tool-panel-adapter.test.ts`):
 * 1. Every `ToolPanelExtraControlId` has an entry.
 * 2. Every id used by any tool's `panelControls` array has an entry.
 * 3. Round-trip per adapter is a no-op: with a fully-populated preset,
 *    `write(preset, read(preset, toolId), toolId)` leaves the preset
 *    semantically unchanged (every field the adapter touches reads
 *    back the same value).
 *
 * SELECTION-side ids that aren't (yet) used on the Tool side don't
 * need an adapter; only the ones the registry actually references.
 */
export const TOOL_PANEL_ADAPTERS: Readonly<
  Partial<Record<ToolPanelAdapterId, ToolPanelAdapter>>
> = {
  // ─── SELECTION-side ids ─────────────────────────────────────────
  [PROPERTY_CONTROL_IDS.strokeColor]: {
    read: (preset) => preset.strokeColor,
    write: (preset, value) => {
      preset.strokeColor = String(value);
    },
    selectionDef: PROPERTY_CONTROL_IDS.strokeColor,
  },

  [PROPERTY_CONTROL_IDS.strokeWidth]: {
    read: (preset) => preset.strokeWidth,
    write: (preset, value) => {
      preset.strokeWidth = Number(value);
    },
    selectionDef: PROPERTY_CONTROL_IDS.strokeWidth,
  },

  [PROPERTY_CONTROL_IDS.strokeStyle]: {
    // Matches `Toolbar`'s preset convention: `""` = solid, anything
    // else (`"dash"` / `"dot"` / `"dashDot"` / `"lgDash"`) names a
    // dasharray key resolved via `computeDasharray`.
    read: (preset) => preset.strokeDasharray ?? "",
    write: (preset, value) => {
      preset.strokeDasharray = String(value);
    },
    selectionDef: PROPERTY_CONTROL_IDS.strokeStyle,
  },

  [PROPERTY_CONTROL_IDS.strokeLinecap]: {
    // Default "butt" matches the SELECTION def's getValue fallback +
    // the imperative Tool-side `preset.strokeLinecap ?? "butt"`.
    read: (preset) => preset.strokeLinecap ?? "butt",
    write: (preset, value) => {
      preset.strokeLinecap = value as LineCap;
    },
    selectionDef: PROPERTY_CONTROL_IDS.strokeLinecap,
  },

  [PROPERTY_CONTROL_IDS.fillColor]: {
    // Tool side persists the literal preset.fillColor (including the
    // `"none"` sentinel); per-tool fallback for the colour picker
    // ("#ff0000" / "#ffffff" / "#111111") is a Phase 2 renderer
    // concern, not an adapter one. Adapters preserve values; they
    // don't paper over absent ones.
    read: (preset) => preset.fillColor,
    write: (preset, value) => {
      preset.fillColor = String(value);
    },
    selectionDef: PROPERTY_CONTROL_IDS.fillColor,
  },

  [PROPERTY_CONTROL_IDS.fontSize]: {
    read: (preset) => preset.fontSize,
    write: (preset, value) => {
      preset.fontSize = Number(value);
    },
    selectionDef: PROPERTY_CONTROL_IDS.fontSize,
  },

  [PROPERTY_CONTROL_IDS.fontFamily]: {
    // The text tool seeds `fontFamily` lazily ("sans-serif" when
    // missing); the adapter returns the same fallback so the read /
    // write round-trip is well-defined regardless of preset state.
    read: (preset) => preset.fontFamily ?? "sans-serif",
    write: (preset, value) => {
      preset.fontFamily = String(value);
    },
    selectionDef: PROPERTY_CONTROL_IDS.fontFamily,
  },

  [PROPERTY_CONTROL_IDS.textAnchor]: {
    // Horizontal text alignment for the next-drawn Text shape. The
    // SELECTION-side def writes `data-text-anchor` + re-flows the
    // tspans; the Tool-side adapter just persists the value into
    // `ToolOptions` so `createTextShape` picks it up at draw time.
    read: (preset) => preset.textAnchor ?? "start",
    write: (preset, value) => {
      preset.textAnchor = value as TextAnchor;
    },
    selectionDef: PROPERTY_CONTROL_IDS.textAnchor,
  },

  [PROPERTY_CONTROL_IDS.textVerticalAnchor]: {
    read: (preset) => preset.textVerticalAnchor ?? "top",
    write: (preset, value) => {
      preset.textVerticalAnchor = value as TextVerticalAnchor;
    },
    selectionDef: PROPERTY_CONTROL_IDS.textVerticalAnchor,
  },

  [PROPERTY_CONTROL_IDS.arrowStartShape]: {
    read: (preset) => preset.arrowHeadStart ?? "none",
    write: (preset, value) => {
      preset.arrowHeadStart = value as ArrowShape;
    },
    selectionDef: PROPERTY_CONTROL_IDS.arrowStartShape,
  },

  [PROPERTY_CONTROL_IDS.arrowEndShape]: {
    // Tool default for the End shape is "triangle" — matches the
    // imperative `preset.arrowHeadEnd ?? "triangle"` + ArrowTool's
    // creation-time seed. (Begin defaults to "none"; End defaults to
    // a visible head so the variant chip preview matches the drawn
    // arrow.)
    read: (preset) => preset.arrowHeadEnd ?? "triangle",
    write: (preset, value) => {
      preset.arrowHeadEnd = value as ArrowShape;
    },
    selectionDef: PROPERTY_CONTROL_IDS.arrowEndShape,
  },

  [PROPERTY_CONTROL_IDS.arrowStartSize]: {
    // Composite "w-l" string matches the SELECTION-side encoding so
    // Phase 4 can pull the 3×3 grid options from the SELECTION
    // registry without reformatting.
    read: (preset) => readArrowSize(preset.arrowWidthStart, preset.arrowLengthStart),
    write: (preset, value) => {
      const { width, length } = parseArrowSize(String(value));
      preset.arrowWidthStart = width;
      preset.arrowLengthStart = length;
    },
    selectionDef: PROPERTY_CONTROL_IDS.arrowStartSize,
  },

  [PROPERTY_CONTROL_IDS.arrowEndSize]: {
    read: (preset) => readArrowSize(preset.arrowWidthEnd, preset.arrowLengthEnd),
    write: (preset, value) => {
      const { width, length } = parseArrowSize(String(value));
      preset.arrowWidthEnd = width;
      preset.arrowLengthEnd = length;
    },
    selectionDef: PROPERTY_CONTROL_IDS.arrowEndSize,
  },

  // ─── Tool-only extras ────────────────────────────────────────────
  "tool.typeChips": {
    // The only adapter that genuinely needs `toolId` — the variant
    // field varies per tool (`shape.shapeType`, `arrow.arrowHead`,
    // `text.textVariant`, `freehand.drawStyle`, `marker.markerShape`,
    // `redact.redactStyle`, `highlight.highlightColor`). Resolves
    // via `TOOL_REGISTRY[toolId].variantField`; tools without a
    // variantField (Crop) shouldn't list `tool.typeChips` in their
    // panelControls so the lookup never fails in practice — but the
    // adapter falls back to a no-op pair if it does, to keep the
    // round-trip invariant safe under malformed registry edits.
    read: (preset, toolId) => {
      const field = TOOL_REGISTRY[toolId]?.variantField;
      if (!field) return undefined;
      return preset[field];
    },
    write: (preset, value, toolId) => {
      const field = TOOL_REGISTRY[toolId]?.variantField;
      if (!field) return;
      // The variantField is a `keyof ToolOptions` covering many
      // distinct narrow types (ShapeType / ArrowHead / TextVariant /
      // …). The dynamic dispatch is type-safe at the registry layer —
      // each tool's `panelControls` is paired with its variants — but
      // the generic adapter has to fall through `unknown` here. Cast
      // through `unknown` first to bypass the structural mismatch
      // between `ToolOptions` (named fields) and a string-indexed
      // record.
      (preset as unknown as Record<string, unknown>)[field as string] = value;
    },
    selectionDef: null,
  },

  "tool.transparencyPercent": {
    // Inverse of strokeOpacity. Default 1.0 ↔ 0% transparent —
    // matches the imperative `Math.round((1 - (preset.strokeOpacity
    // ?? 1)) * 100)` + `preset.strokeOpacity = 1 - v / 100` pair.
    read: (preset) => transparencyPercentFromOpacity(preset.strokeOpacity ?? 1, 1),
    write: (preset, value) => {
      preset.strokeOpacity = opacityFromTransparencyPercent(Number(value));
    },
    selectionDef: PROPERTY_CONTROL_IDS.strokeOpacity,
  },

  "tool.fillTransparencyPercent": {
    // Inverse of fillOpacity, used by Highlight. Default 0.4 ↔ 60%
    // transparent — matches the imperative `Math.round((1 -
    // (preset.fillOpacity ?? 0.4)) * 100)` + `preset.fillOpacity = 1
    // - v / 100` pair.
    read: (preset) => transparencyPercentFromOpacity(preset.fillOpacity ?? 0.4, 0.4),
    write: (preset, value) => {
      preset.fillOpacity = opacityFromTransparencyPercent(Number(value));
    },
    selectionDef: PROPERTY_CONTROL_IDS.fillOpacity,
  },

  "tool.fillOpacityPercent": {
    // Direct percentage of fillOpacity, used by Shape's Fill section.
    // Default 1.0 ↔ 100% opaque — matches the imperative
    // `Math.round((preset.fillOpacity ?? 1) * 100)` + `preset.fillOpacity
    // = v / 100` pair. Distinct from `tool.fillTransparencyPercent`
    // (inverse) so the Phase 2 renderer can preserve byte-equivalent
    // DOM (label "Opacity" vs "Transparency", direct vs inverse).
    read: (preset) => opacityPercentFromOpacity(preset.fillOpacity ?? 1, 1),
    write: (preset, value) => {
      preset.fillOpacity = opacityFromOpacityPercent(Number(value));
    },
    selectionDef: null,
  },

  "tool.freehandDone": {
    // Click action — no value. Read returns `null`, write is a no-op
    // so the round-trip invariant `read → write → read` is trivially
    // an identity. Phase 2's renderer wires the click to
    // `FreehandTool.endSession` directly; the adapter exists to
    // satisfy the "every id has an adapter" shape invariant.
    read: () => null,
    write: () => {
      // Intentional no-op — see the type doc above.
    },
    selectionDef: null,
  },
};

/** Static metadata an adapter borrows from its SELECTION-side def.
 *  Phase 4 makes this the single source of truth for option arrays
 *  (dash / cap / font), labels, number-input ranges, and the
 *  `allowNone` color-picker flag — so a UX edit to (say)
 *  `PROPERTY_CONTROLS.strokeStyle.options` flows through to BOTH
 *  the SELECTION-side panel AND the Tool-side panel without a
 *  parallel edit.
 *
 *  Per-tool divergences (marker's narrower strokeWidth + fontSize
 *  ranges, redact's `allowNone: false`, shape's "Fill" label
 *  override) stay in the renderer as documented exceptions on top
 *  of this metadata — there's no SELECTION-side equivalent to
 *  override against. */
export interface ToolPanelAdapterMetadata {
  /** SELECTION-side label (e.g. "Color", "Width", "Dash type"). */
  label: string;
  /** Option list for `select` / `variantPicker` controls. Tool-side
   *  consumers decorate each option with a per-id preview SVG
   *  (dash sample, cap sample, etc.) at render time. */
  options?: ReadonlyArray<PropertyControlOption>;
  /** Inclusive lower bound for a number input. */
  min?: number;
  /** Inclusive upper bound for a number input. */
  max?: number;
  /** Spinner / arrow-key step granularity. */
  step?: number;
  /** Trailing unit label (e.g. "pt", "%"). */
  unit?: string;
  /** Whether a "No fill" sentinel is offered for color pickers. */
  allowNone?: boolean;
}

/** Look up the SELECTION-side metadata an adapter borrows. Returns
 *  `null` when the adapter has no `selectionDef` (Tool-only ids
 *  like `tool.typeChips` / `tool.freehandDone`) or when the named
 *  def doesn't exist (which would be a registry typo — guarded
 *  defensively rather than throwing).
 *
 *  Tier B — pure: no DOM access, no Element-taking; the returned
 *  metadata is just the static fields off `PROPERTY_CONTROLS`. */
export function selectionDefMetadata(id: ToolPanelAdapterId): ToolPanelAdapterMetadata | null {
  const adapter = TOOL_PANEL_ADAPTERS[id];
  if (!adapter?.selectionDef) return null;
  const def: PropertyControlDef | undefined = PROPERTY_CONTROLS[adapter.selectionDef];
  if (!def) return null;
  return {
    label: def.label,
    options: def.options,
    min: def.min,
    max: def.max,
    step: def.step,
    unit: def.unit,
    allowNone: def.allowNone,
  };
}

/** Convenience: list of every adapter id present in the registry.
 *  Used by the test file to enumerate the adapters without depending
 *  on `Object.keys` order. */
export const TOOL_PANEL_ADAPTER_IDS: ReadonlyArray<ToolPanelAdapterId> = [
  PROPERTY_CONTROL_IDS.strokeColor,
  PROPERTY_CONTROL_IDS.strokeWidth,
  PROPERTY_CONTROL_IDS.strokeStyle,
  PROPERTY_CONTROL_IDS.strokeLinecap,
  PROPERTY_CONTROL_IDS.fillColor,
  PROPERTY_CONTROL_IDS.fontSize,
  PROPERTY_CONTROL_IDS.fontFamily,
  PROPERTY_CONTROL_IDS.textAnchor,
  PROPERTY_CONTROL_IDS.textVerticalAnchor,
  PROPERTY_CONTROL_IDS.arrowStartShape,
  PROPERTY_CONTROL_IDS.arrowEndShape,
  PROPERTY_CONTROL_IDS.arrowStartSize,
  PROPERTY_CONTROL_IDS.arrowEndSize,
  ...TOOL_PANEL_EXTRA_CONTROL_IDS,
];
