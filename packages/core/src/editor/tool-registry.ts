/**
 * Tier B — pure-data registry describing every tool the editor's
 * toolbar exposes. Sibling to `property-schema.ts`: same imperative-
 * chain → declarative-registry pattern that landed for PropertyPanel
 * across PRs #153–#164, applied here to consolidate the per-tool
 * metadata currently scattered across `toolbar.ts` (registration
 * array, preset (de)serializer field map, variant flyout) and
 * `toolbar-variants.ts` (variant catalog).
 *
 * What lives here:
 *   - `id` / `label` / `icon` for the toolbar button
 *   - `variants` + `variantField` + `defaultVariant` for the flyout
 *   - `presetFields` — which `ToolOptions` keys this tool's preset
 *     reads / writes (drives the future generic preset serializer
 *     in Phase 2)
 *   - `variantKeyForElement` — element → preset-storage key
 *     classifier, replacing the per-tool branches in
 *     `toolIdForElement` + `elementKeyFromElement` (Phase 4 / 5)
 *
 * What stays out (Tier C, in `@ingcreators/annot-web`):
 *   - Tool factories (need `CanvasManager` + `History`)
 *   - The flyout DOM construction (`<annot-tool-flyout>` consumer)
 *   - The preset persistence side-effects (Tauri / chrome.storage /
 *     localStorage)
 *
 * Phase 1 of `docs/plans/toolbar-schema.md`: land the type + data
 * with shape-invariant tests; no Toolbar wiring yet. Subsequent
 * phases consume the registry one site at a time.
 */

import { computeDasharray } from "../utils/dash-utils.js";
import { refreshArrowPath } from "./arrow-markers.js";
import { PROPERTY_CONTROL_IDS, type PropertyControlId } from "./property-schema.js";
import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "./toolbar-icons.js";
import type { ToolOptions } from "./tool-options.js";
import { writeUniversalStyleAttrs } from "./tool-style-writer.js";

/** Tool-side panel sections. The Tool property panel uses the same
 *  four pp-section buckets as the SELECTION-side property panel, in
 *  the same visual order (Type → Fill → Line → Label). The renderer
 *  groups consecutive entries with the same section into a single
 *  `pp-section` card; section ORDER follows first-encounter in the
 *  per-tool `panelControls` array. */
export type ToolPanelSection = "Type" | "Fill" | "Line" | "Label";

/** Tool-only control ids — affordances the Tool panel renders that
 *  the SELECTION registry doesn't model. Distinct from
 *  `PropertyControlId` so the schema-driven renderer in Phase 2 can
 *  dispatch on whichever id family it sees.
 *
 *  `tool.typeChips`
 *      Type-row chip picker driven by `TOOL_REGISTRY[toolId].variants`.
 *      ONE entry per tool with a variant flyout. Reads / writes
 *      `preset[TOOL_REGISTRY[toolId].variantField]` (the only adapter
 *      that genuinely needs `toolId` at read/write time — every other
 *      adapter ignores it).
 *
 *  `tool.transparencyPercent`
 *      0..100% inverse of `preset.strokeOpacity` (so "60% transparent"
 *      reads as 60, not 0.4). The SELECTION-side `strokeOpacity` def
 *      uses the same convention; the Tool panel always shows percent
 *      directly without the helper, so this id keeps its own adapter.
 *
 *  `tool.fillTransparencyPercent`
 *      0..100% inverse of `preset.fillOpacity`. Used by Highlight
 *      (default 0.4 ↔ 60% transparent) where the visual language is
 *      "transparency" — the larger the number, the see-throughier.
 *
 *  `tool.fillOpacityPercent`
 *      0..100% DIRECT of `preset.fillOpacity`. Used by Shape (default
 *      1.0 ↔ 100% opaque) where the imperative renderer used the
 *      "Opacity" label. Distinct from `tool.fillTransparencyPercent`
 *      so Phase 2 can preserve byte-equivalent DOM (label string +
 *      number direction) per tool. Whether to unify the two surfaces
 *      onto a single "Transparency" idiom is a UX decision, not a
 *      refactor concern — out of scope for this plan.
 *
 *  `tool.freehandDone`
 *      Click-action button that ends the active freehand drawing
 *      session. No persisted value — the adapter's read/write are
 *      a no-op pair (read returns null, write does nothing) so the
 *      shape-invariant test treats it uniformly with the rest. */
export type ToolPanelExtraControlId =
  | "tool.typeChips"
  | "tool.transparencyPercent"
  | "tool.fillTransparencyPercent"
  | "tool.fillOpacityPercent"
  | "tool.freehandDone";

/** Frozen tuple of every `ToolPanelExtraControlId`. Drives the
 *  shape-invariant test that asserts every extra id has a matching
 *  adapter. Keep in sync with the union above when adding new ids. */
export const TOOL_PANEL_EXTRA_CONTROL_IDS: ReadonlyArray<ToolPanelExtraControlId> = [
  "tool.typeChips",
  "tool.transparencyPercent",
  "tool.fillTransparencyPercent",
  "tool.fillOpacityPercent",
  "tool.freehandDone",
] as const;

/** A single Tool-side panel control. The renderer (Phase 2, Tier C)
 *  consumes `panelControls` arrays to produce the per-tool side
 *  panel. The id either reuses a `PropertyControlId` (when the
 *  SELECTION registry can supply label / options / min / max
 *  metadata) or names a Tool-only affordance via
 *  `ToolPanelExtraControlId`.
 *
 *  Plain data — no closures over canvas state, no DOM globals at
 *  module load. The optional `visibleWhen` predicate runs against
 *  the CURRENT preset (NOT an SVGElement — this is the Tool side,
 *  no element exists yet) so a control like Redact's Color row can
 *  hide unless `preset.redactStyle === "solid"`. */
export interface ToolPanelControlDef {
  /** Section header. Renderer batches consecutive entries with the
   *  same section into one `pp-section`. Order in the registry
   *  controls visual order. */
  section: ToolPanelSection;
  /** Control id. Either a SELECTION-side id (`fillColor`,
   *  `strokeWidth`, …) where the adapter routes the mutation onto
   *  the matching `ToolOptions` field, or a Tool-only id
   *  (`tool.typeChips`, `tool.transparencyPercent`, …) the renderer
   *  resolves via its Tier C-local table. */
  id: PropertyControlId | ToolPanelExtraControlId;
  /** Optional gating predicate against the CURRENT preset. Returning
   *  `false` tells the renderer to skip this control for the active
   *  tool (e.g. "Redact Color row only when redactStyle === 'solid'").
   *
   *  Pure — no DOM access, no `Toolbar` access. Tier B-safe. */
  visibleWhen?: (preset: ToolOptions) => boolean;
}

/** A single sub-shape pickable from a tool's variant flyout. Mirrors
 *  the shape of `ToolVariant` in the legacy `toolbar-variants.ts`
 *  (which becomes a thin re-export once Phase 4 deletes the file).
 *  `svg` overrides `icon` when present — used for variants where
 *  Material Symbols glyphs don't read clearly at button scale (rect
 *  vs. rounded-rect, the three arrow-head variants, etc.). */
export interface ToolRegistryVariant {
  /** Value written into `ToolOptions[variantField]` when this variant
   *  is selected. Also forms the suffix of the preset-storage key
   *  (`shape.rect`, `arrow.both`, …). */
  value: string;
  /** Material Symbols ligature name. Rendered as text with the
   *  `material-symbols-outlined` class when no `svg` is provided. */
  icon: string;
  /** Human-readable label for tooltips + a11y. */
  label: string;
  /** Optional inline SVG markup. When present, takes precedence over
   *  `icon`. Should use `viewBox="0 0 24 24"`, omit explicit
   *  width/height (so CSS sizes per-context), and use
   *  `stroke="currentColor"` + `fill="none"` to match the outlined
   *  Material-Symbols visual weight. */
  svg?: string;
}

/** Full metadata for one tool. Plain data — no closures over canvas
 *  state, no DOM globals at module load.
 *
 *  Tools without a variant flyout (Crop) omit `variants` /
 *  `variantField` / `defaultVariant`; their preset key is just the
 *  bare tool id.
 *
 *  Tools without an element-on-canvas (Crop again) omit
 *  `variantKeyForElement` — there's no rubber-band style to harvest. */
export interface ToolRegistryEntry {
  /** Stable id, matches the registry's record key. Used as the
   *  `data-tool` attribute on the toolbar button + as the prefix of
   *  every preset-storage key for this tool. */
  id: string;
  /** Tooltip label on the toolbar button. */
  label: string;
  /** Material Symbols ligature for the toolbar button's default icon
   *  (overridden at runtime by the active variant's icon for tools
   *  with a flyout — see `Toolbar.#syncToolButtonIcon`). */
  icon: string;
  /** Variant catalog. Empty / absent for tools without sub-variants. */
  variants?: ReadonlyArray<ToolRegistryVariant>;
  /** Which `ToolOptions` field discriminates the variant. Used by
   *  the flyout to show the active chip and by the preset machinery
   *  to migrate legacy tool-id-keyed entries to the new
   *  `tool.variant` form. */
  variantField?: keyof ToolOptions;
  /** Default variant when no preset exists yet. MUST appear in
   *  `variants`. */
  defaultVariant?: string;
  /** Which `ToolOptions` keys this tool's preset reads / writes.
   *  Phase 2 makes this the single source of truth for the
   *  camelCase ↔ snake_case (de)serializer; Phase 5 makes it the
   *  source of truth for the rubber-band reader / writer. Today
   *  it's data only — no consumer reads it yet. */
  presetFields: ReadonlyArray<keyof ToolOptions>;
  /** Element → preset-storage key extractor. Returns `null` for
   *  elements this tool doesn't own (so a generic dispatch loop
   *  can iterate `Object.entries(TOOL_REGISTRY)` and find the
   *  first non-null match — replacing both `toolIdForElement` and
   *  `elementKeyFromElement` in a single sweep, Phase 4 / 5).
   *
   *  Returns the FULL key (`"shape.rounded"`, `"arrow.both"`, …),
   *  not just the variant suffix — so the caller doesn't need to
   *  juggle the toolId prefix separately.
   *
   *  Implementations may assume jsdom-friendly Element APIs
   *  (`tagName`, `getAttribute`, `hasAttribute`, `querySelector`).
   *  No `document` / `window` access. */
  variantKeyForElement?: (el: SVGElement) => string | null;
  /** Tool-side panel control list. Drives the schema-driven renderer
   *  in `tool-property-renderer-schema.ts` (Phase 2 of
   *  `docs/plans/tool-property-renderer-schema.md`). Order is render
   *  order; the renderer groups consecutive entries with the same
   *  `section` into one `pp-section`.
   *
   *  Crop omits this field — its activation is a transient overlay,
   *  not a per-tool side panel.
   *
   *  Today (Phase 1) it's data only — no consumer reads it yet.
   *  Phase 2 adds the schema-driven renderer alongside the imperative
   *  one; Phase 3 swaps the live callsite. */
  panelControls?: ReadonlyArray<ToolPanelControlDef>;
  /** Tool-specific style reader. Mutates `preset` in place with
   *  values harvested from `el`'s attributes / children. The
   *  generic universal-style reader (stroke / fill / stroke-width /
   *  dasharray / opacity / linecap / linejoin) runs BEFORE this
   *  hook; the hook only handles tool-specific branches the
   *  universal reader can't capture (text font + variant on a
   *  child `<text>`, arrow per-end state, marker bg primitive
   *  reads, etc.).
   *
   *  Phase 5 of `docs/plans/toolbar-schema.md`: the imperative
   *  `if (toolId === "text") { … } if (toolId === "arrow") { … }`
   *  cascades in `Toolbar.syncPresetFromElement` collapse to a
   *  single `TOOL_REGISTRY[toolId]?.extractStyleFromElement?.(el,
   *  preset)` dispatch.
   *
   *  Tier B — implementations live in `tool-registry.ts` itself
   *  and may only use jsdom-friendly Element APIs. */
  extractStyleFromElement?: (el: SVGElement, preset: ToolOptions) => void;
  /** Tool-specific style writer. Inverse of
   *  `extractStyleFromElement`: writes the preset's style fields
   *  onto `el` (or its tool-specific child elements — marker's
   *  bg primitive, textbox's `<text>`, etc.).
   *
   *  Deliberately does NOT touch fields that define the element's
   *  type / variant (shapeType, arrowHead, textVariant) — those
   *  were already established by the variant-change path that
   *  invoked the writer.
   *
   *  Phase 3 of `docs/plans/toolbar-apply-style-to-element.md`:
   *  the imperative element-tag cascade in
   *  `applyPresetStyleAttrs` (in
   *  `packages/web/src/editor/toolbar-preset-helpers.ts`)
   *  collapses to a single
   *  `TOOL_REGISTRY[toolId]?.applyStyleToElement?.(el, preset)`
   *  dispatch — symmetric with how Phase 5 of
   *  `_done/toolbar-schema.md` collapsed the read side.
   *
   *  Tier B — implementations live in `tool-registry.ts` itself
   *  and may only use jsdom-friendly Element APIs. The
   *  `refreshArrowPath` regen for arrow groups is the one
   *  exception: it lives in `core/editor/arrow-markers.ts`
   *  (Tier B) so the registry can call it without crossing
   *  package boundaries. */
  applyStyleToElement?: (el: SVGElement, preset: ToolOptions) => void;
}

/** Universal style fields most tools persist. Pulled out so each
 *  tool's `presetFields` array stays readable without repeating the
 *  same five entries. Tools that DON'T persist these (highlight,
 *  redact, crop) override by listing only what they need. */
const UNIVERSAL_STROKE_FIELDS: ReadonlyArray<keyof ToolOptions> = [
  "strokeColor",
  "strokeWidth",
  "strokeDasharray",
  "strokeOpacity",
  "strokeLinecap",
];

/** Helper: classify a `<rect>` for the Shape tool. Returns the
 *  shape's variant value, or `null` if the rect is owned by another
 *  tool (highlight / redact-solid). Encapsulates the priority order
 *  the legacy `toolIdForElement` enforces by check ordering. */
function shapeRectVariant(el: SVGElement): string | null {
  if (el.getAttribute("data-highlight") === "1") return null;
  if (el.getAttribute("data-redact-style") === "solid") return null;
  return el.hasAttribute("data-rounded") ? "rounded" : "rect";
}

/** Helper: classify an arrow-bearing element's variant from its
 *  per-end shape attributes. Single source of truth shared by
 *  `variantKeyForElement` (preset-bucket routing) and
 *  `extractStyleFromElement` (rubber-band reader) so the two stay
 *  in lockstep. */
function arrowVariantFromAttrs(el: SVGElement): "none" | "end" | "both" {
  const hasStart = (el.getAttribute("data-arrow-start-shape") ?? "none") !== "none";
  const hasEnd = (el.getAttribute("data-arrow-end-shape") ?? "none") !== "none";
  if (hasStart && hasEnd) return "both";
  if (hasStart || hasEnd) return "end";
  return "none";
}

/** After a variant switch, fix up the side-fields on `preset` so the
 *  new variant's invariants hold. Today only `arrow` needs this:
 *    - `none`: both ends must be "none".
 *    - `end`:  begin must be "none", end must be non-"none" (default tri).
 *    - `both`: both ends must be non-"none" (default tri).
 *
 *  Mutates `preset` in place; safe to call for tools without a
 *  relevant invariant (it's a no-op).
 *
 *  Tier B — pure (no DOM, no `Toolbar` access). Relocated from
 *  `packages/web/src/editor/toolbar-preset-helpers.ts` in Phase 5
 *  of `docs/plans/toolbar-schema.md` so the registry's
 *  `extractStyleFromElement` callbacks can call it without crossing
 *  the Tier B → Tier C boundary. */
export function normalizeVariantSideFields(
  toolId: string,
  newVariant: string,
  preset: ToolOptions,
): void {
  if (toolId !== "arrow") return;
  const p = preset as unknown as Record<string, unknown>;
  const tri = "triangle" as const;
  const none = "none" as const;
  const curStart = preset.arrowHeadStart;
  const curEnd = preset.arrowHeadEnd;
  switch (newVariant) {
    case "none":
      // Line: both ends must be "none" — force.
      p.arrowHeadStart = none;
      p.arrowHeadEnd = none;
      break;
    case "end":
      // Arrow: begin must be "none", end must be non-"none".
      p.arrowHeadStart = none;
      p.arrowHeadEnd = curEnd && curEnd !== "none" ? curEnd : tri;
      break;
    case "both":
      // Double arrow: both ends must be non-"none". Preserve if
      // already valid, else seed triangle.
      p.arrowHeadStart = curStart && curStart !== "none" ? curStart : tri;
      p.arrowHeadEnd = curEnd && curEnd !== "none" ? curEnd : tri;
      break;
  }
}

export const TOOL_REGISTRY: Readonly<Record<string, ToolRegistryEntry>> = {
  // Unified line tool — defaults to arrow-end (Arrow behavior). The
  // right panel exposes "none / end / both" so the same tool covers
  // plain lines + bi-directional arrows too.
  arrow: {
    id: "arrow",
    label: "Line",
    icon: "north_east",
    variantField: "arrowHead",
    defaultVariant: "end",
    variants: [
      {
        value: "none",
        icon: "horizontal_rule",
        label: "Line (no arrow)",
        svg: ARROW_ICON_SVG.none,
      },
      { value: "end", icon: "north_east", label: "Arrow", svg: ARROW_ICON_SVG.end },
      { value: "both", icon: "sync_alt", label: "Double arrow", svg: ARROW_ICON_SVG.both },
    ],
    presetFields: [
      ...UNIVERSAL_STROKE_FIELDS,
      "arrowHead",
      "arrowHeadStart",
      "arrowHeadEnd",
      "arrowWidthStart",
      "arrowWidthEnd",
      "arrowLengthStart",
      "arrowLengthEnd",
    ],
    // Type → Line. Per-end arrow shape / size pulldowns delegate to
    // the SELECTION-side `arrow{Start,End}{Shape,Size}` ids — Phase 2
    // can either render them as four pulldowns (matching SELECTION)
    // or aggregate via the legacy `createArrowEndsRows` widget;
    // either is byte-equivalent to the imperative output as long as
    // the eventual DOM matches the snapshots in
    // `tool-property-renderer-schema.test.ts`.
    panelControls: [
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
    ],
    variantKeyForElement(el) {
      if (el.tagName === "line") return `arrow.${arrowVariantFromAttrs(el)}`;
      if (el.tagName === "g" && el.getAttribute("data-type") === "arrow") {
        return `arrow.${arrowVariantFromAttrs(el)}`;
      }
      return null;
    },
    extractStyleFromElement(el, preset) {
      // Rubber-band the full per-end state into the variant's preset:
      //   - Legacy `arrowHead` (none/end/both) classifies which
      //     variant's preset to update — uses the SAME classifier as
      //     `variantKeyForElement` so the preset bucket and the
      //     written `arrowHead` field always agree.
      //   - Per-end SHAPE / WIDTH / LENGTH values are preserved
      //     within the variant's constraints — the user's custom
      //     "Double arrow with start=diamond, end=oval" survives
      //     round-trips, because variant-switching clamps per-end
      //     into the valid range rather than fully resetting.
      preset.arrowHead = arrowVariantFromAttrs(el);
      // Per-end shape + width + length (PowerPoint-parity granular fields).
      const ss = el.getAttribute("data-arrow-start-shape");
      const es = el.getAttribute("data-arrow-end-shape");
      const sw = el.getAttribute("data-arrow-start-width");
      const sl = el.getAttribute("data-arrow-start-length");
      const ew = el.getAttribute("data-arrow-end-width");
      const el_ = el.getAttribute("data-arrow-end-length");
      if (ss) preset.arrowHeadStart = ss as typeof preset.arrowHeadStart;
      if (es) preset.arrowHeadEnd = es as typeof preset.arrowHeadEnd;
      if (sw) preset.arrowWidthStart = sw as typeof preset.arrowWidthStart;
      if (sl) preset.arrowLengthStart = sl as typeof preset.arrowLengthStart;
      if (ew) preset.arrowWidthEnd = ew as typeof preset.arrowWidthEnd;
      if (el_) preset.arrowLengthEnd = el_ as typeof preset.arrowLengthEnd;
      // Clamp per-end shapes into the classified variant's valid range
      // so the preset is always internally consistent with its variant
      // label — protects against reverse-arrow data loaded from old
      // saved files.
      normalizeVariantSideFields("arrow", preset.arrowHead, preset);
    },
    applyStyleToElement(el, preset) {
      writeUniversalStyleAttrs(el, preset);
      // Arrow groups: the head <path>'s `fill` was set explicitly at
      // refreshArrowPath time from the <g>'s stroke color. Since we
      // just changed the stroke color, the head's fill is stale —
      // refresh to re-derive it from the new stroke. Plain <line>
      // arrow-variants ("arrow.none") have no head subpath and skip
      // this regen.
      if (el.tagName === "g" && el.getAttribute("data-type") === "arrow") {
        refreshArrowPath(el);
      }
    },
  },

  // Single unified shape tool — pick rect / rounded / ellipse via
  // the shapeType property in the right panel. Replaces what used to
  // be three separate toolbar buttons.
  shape: {
    id: "shape",
    label: "Shape",
    icon: "shapes",
    variantField: "shapeType",
    defaultVariant: "rect",
    variants: [
      { value: "rect", icon: "rectangle", label: "Rectangle", svg: SHAPE_ICON_SVG.rect },
      {
        value: "rounded",
        icon: "crop_square",
        label: "Rounded rectangle",
        svg: SHAPE_ICON_SVG.rounded,
      },
      { value: "ellipse", icon: "circle", label: "Ellipse", svg: SHAPE_ICON_SVG.ellipse },
    ],
    presetFields: [
      ...UNIVERSAL_STROKE_FIELDS,
      "fillColor",
      "fillOpacity",
      "shapeType",
      "strokeLinejoin",
    ],
    // Type → Fill → Line. The imperative renderer creates Line first
    // then INSERTS Fill before it (`getFillBody`'s lazy section
    // ordering); listing Fill before Line in the array gives the
    // same final DOM. `tool.fillOpacityPercent` carries the imperative
    // "Opacity" label + DIRECT mapping (default 1.0 ↔ 100%) — distinct
    // from highlight's `tool.fillTransparencyPercent` (inverse).
    panelControls: [
      { section: "Type", id: "tool.typeChips" },
      { section: "Fill", id: PROPERTY_CONTROL_IDS.fillColor },
      { section: "Fill", id: "tool.fillOpacityPercent" },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeColor },
      { section: "Line", id: "tool.transparencyPercent" },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeWidth },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeStyle },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeLinecap },
    ],
    variantKeyForElement(el) {
      if (el.tagName === "ellipse") return "shape.ellipse";
      if (el.tagName === "rect") {
        const v = shapeRectVariant(el);
        return v ? `shape.${v}` : null;
      }
      return null;
    },
    extractStyleFromElement(el, preset) {
      if (el.tagName === "ellipse") preset.shapeType = "ellipse";
      else if (el.tagName === "rect") {
        preset.shapeType = el.hasAttribute("data-rounded") ? "rounded" : "rect";
      }
    },
    applyStyleToElement(el, preset) {
      // Shape elements (rect / rounded rect / ellipse) carry their
      // style attrs directly — no composite child writes needed.
      // The variant-defining `data-rounded` attr is left to the
      // variant-change path that invoked this writer.
      writeUniversalStyleAttrs(el, preset);
    },
  },

  // Highlight — dedicated tool for semi-transparent highlight rects.
  // Internally a ShapeTool with `shapeType="highlight"` forced on; the
  // separate button lets us attach a 6-swatch color flyout (distinct
  // from the Shape tool's icon-chip flyout) and keep the preset's
  // `highlightColor` independent from the Shape tool's fillColor.
  highlight: {
    id: "highlight",
    label: "Highlight",
    icon: "ink_highlighter",
    variantField: "highlightColor",
    // First palette entry. Used when no preset has been saved yet
    // (first-time launch of the Highlight tool).
    defaultVariant: HIGHLIGHT_COLORS[0]!.value,
    variants: HIGHLIGHT_COLORS.map((c) => ({
      value: c.value,
      icon: "ink_highlighter",
      label: c.label,
    })),
    // Highlight only persists its color + transparency — stroke
    // attrs aren't drawn on highlight rects.
    presetFields: ["highlightColor", "fillOpacity"],
    // Type → Fill. The imperative Type row uses color-swatch chips
    // (a `pp-color-chip` variant) instead of icon chips, so Phase 2's
    // renderer for `tool.typeChips` will need to branch on toolId or
    // on the variant entries' shape — same registry id, different
    // chip rendering. The Fill section is just Transparency
    // (inverse-percent). Default fillOpacity 0.4 ↔ displayed 60%.
    panelControls: [
      { section: "Type", id: "tool.typeChips" },
      { section: "Fill", id: "tool.fillTransparencyPercent" },
    ],
    variantKeyForElement(el) {
      if (el.tagName !== "rect" || el.getAttribute("data-highlight") !== "1") return null;
      // Highlight's variant is its fill color itself, normalized to
      // lowercase so "#FFE100" and "#ffe100" collapse to the same
      // preset bucket (matches `elementKeyFromElement`'s contract).
      const fill = el.getAttribute("fill");
      const variant = fill ? fill.toLowerCase() : HIGHLIGHT_COLORS[0]!.value;
      return `highlight.${variant}`;
    },
    extractStyleFromElement(el, preset) {
      // Highlight's "fill" IS its highlight color — route the
      // universal-reader's fillColor capture into the right field.
      const fill = el.getAttribute("fill");
      if (fill) preset.highlightColor = fill;
    },
    applyStyleToElement(el, preset) {
      // Inverse of `extractStyleFromElement`: the visual color is
      // `highlightColor` (NOT `fillColor`). ShapeTool's createShape
      // uses `highlightColor` for the rect's `fill` and leaves
      // `fillColor` untouched, so writing `fillColor` here would
      // overwrite the highlight with the Shape tool's color.
      // `fillOpacity` controls the rect's transparency directly.
      if (preset.highlightColor) el.setAttribute("fill", preset.highlightColor);
      if (preset.fillOpacity != null) {
        el.setAttribute("fill-opacity", String(preset.fillOpacity));
      }
    },
  },

  // Unified Text tool — property panel chooses variant
  // (plain / sticky / callout) + font family + size + color.
  text: {
    id: "text",
    label: "Text",
    icon: "title",
    variantField: "textVariant",
    defaultVariant: "sticky",
    variants: [
      { value: "plain", icon: "text_fields", label: "Plain text" },
      { value: "sticky", icon: "sticky_note_2", label: "Sticky note" },
      { value: "callout", icon: "chat_bubble", label: "Callout" },
    ],
    // Text stores its color on `<text>`'s `fill` (via `strokeColor`,
    // following TextTool's "text color = stroke" convention) plus
    // sticky/callout bg in `fillColor`.
    presetFields: ["strokeColor", "fillColor", "fontSize", "fontFamily", "textVariant"],
    // Type → Line (Color, Font, Size). No Fill or Label sections —
    // sticky/callout bg color is computed from text color rather
    // than picked separately on the Tool side.
    panelControls: [
      { section: "Type", id: "tool.typeChips" },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeColor },
      { section: "Line", id: PROPERTY_CONTROL_IDS.fontFamily },
      { section: "Line", id: PROPERTY_CONTROL_IDS.fontSize },
    ],
    variantKeyForElement(el) {
      if (el.tagName === "text") {
        // Plain `<text>` outside a `<g>` wrapper falls through to the
        // group fallback in `elementKeyFromElement` — preserve that
        // behaviour exactly.
        const variant = el.getAttribute("data-text-variant");
        return `text.${variant ?? "sticky"}`;
      }
      if (el.tagName === "g" && el.getAttribute("data-type") === "textbox") {
        const variant = el.getAttribute("data-text-variant");
        return `text.${variant ?? "sticky"}`;
      }
      return null;
    },
    extractStyleFromElement(el, preset) {
      // Textbox composite: <g data-type=textbox> with a <text> child.
      // Plain text: bare <text>. In both cases font + color live on
      // the <text>; the variant + data-color cache live on the wrapper.
      const tEl = el.tagName === "g" ? el.querySelector("text") : el;
      const fs = Number.parseFloat(tEl?.getAttribute("font-size") || "");
      if (Number.isFinite(fs) && fs > 0) preset.fontSize = fs;
      const ff = tEl?.getAttribute("font-family") || el.getAttribute("data-font-family");
      if (ff) preset.fontFamily = ff;
      const variant = el.getAttribute("data-text-variant");
      if (variant === "plain" || variant === "sticky" || variant === "callout") {
        preset.textVariant = variant;
      }
      // Tool treats "text color" as stroke (TextTool convention) — re-read
      // from the <text> child (or `data-color` cache on the <g>) so the
      // textbox <rect>'s bg-color doesn't leak into the preset.
      const textFill = tEl?.getAttribute("fill") || el.getAttribute("data-color");
      if (textFill) preset.strokeColor = textFill;
    },
    applyStyleToElement(el, preset) {
      // Textbox composite: write color/font onto BOTH the <g>'s
      // data-color / data-font-family cache attrs AND the inner
      // <text>. The wrapper's cache attrs persist across save / paste
      // / Office round-trips when the <text> child gets re-rendered;
      // the <text>'s own attrs are what the SVG renderer actually
      // uses. Mirrors the legacy `applyTextboxPresetStyle` exactly.
      if (el.tagName === "g" && el.getAttribute("data-type") === "textbox") {
        if (preset.strokeColor) {
          el.setAttribute("data-color", preset.strokeColor);
          const text = el.querySelector("text");
          if (text) text.setAttribute("fill", preset.strokeColor);
        }
        if (preset.fontFamily) {
          el.setAttribute("data-font-family", preset.fontFamily);
          const text = el.querySelector("text");
          if (text) text.setAttribute("font-family", preset.fontFamily);
        }
        if (preset.fontSize != null) {
          const text = el.querySelector("text");
          if (text) text.setAttribute("font-size", String(preset.fontSize));
        }
        return;
      }
      // Plain `<text>` (variantKeyForElement matches it but the
      // legacy `applyPresetStyleAttrs` fell through to the generic
      // path for this case). Preserve byte-equivalence for Phase 3's
      // dispatch by routing through the universal writer here too.
      writeUniversalStyleAttrs(el, preset);
    },
  },

  // Unified Draw tool — pen vs highlighter picked via the right
  // panel's drawStyle property.
  freehand: {
    id: "freehand",
    label: "Draw",
    icon: "draw",
    variantField: "drawStyle",
    defaultVariant: "pen",
    variants: [
      { value: "pen", icon: "edit", label: "Pen" },
      { value: "highlighter", icon: "ink_highlighter", label: "Highlighter" },
    ],
    presetFields: [...UNIVERSAL_STROKE_FIELDS, "drawStyle"],
    // Type → Line + a "Done drawing" action. `tool.freehandDone` is
    // declared in section "Line" for ordering purposes (it follows
    // the line controls in the imperative renderer); the Phase 2
    // renderer special-cases this id to render OUTSIDE any
    // pp-section, matching the imperative `pp-done-row` button at
    // the menu tail.
    panelControls: [
      { section: "Type", id: "tool.typeChips" },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeColor },
      { section: "Line", id: "tool.transparencyPercent" },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeWidth },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeStyle },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeLinecap },
      { section: "Line", id: "tool.freehandDone" },
    ],
    variantKeyForElement(el) {
      if (el.tagName === "path") {
        const ds = el.getAttribute("data-draw-style");
        return `freehand.${ds ?? "pen"}`;
      }
      if (el.tagName === "g" && el.getAttribute("data-type") === "freehand") {
        const ds = el.getAttribute("data-draw-style");
        return `freehand.${ds ?? "pen"}`;
      }
      return null;
    },
    extractStyleFromElement(el, preset) {
      const ds = el.getAttribute("data-draw-style");
      if (ds === "pen" || ds === "highlighter") preset.drawStyle = ds;
    },
    applyStyleToElement(el, preset) {
      // Freehand sessions wrap their strokes in a <g data-type=freehand>
      // wrapper; each child <path> inherits unset attrs from the
      // wrapper. Writing to the wrapper here lets a subsequent stroke
      // pick up the new style without having to walk every child.
      // For a bare <path> (a single freehand stroke that escaped the
      // wrapper), the same call writes attrs directly. Either way the
      // universal helper covers it.
      writeUniversalStyleAttrs(el, preset);
    },
  },

  marker: {
    id: "marker",
    label: "Counter",
    icon: "counter_1",
    variantField: "markerShape",
    defaultVariant: "circle",
    // All three glyphs are filled-shape-with-"1" so the variant
    // chip previews match what the tool actually produces. Plain
    // Material-Symbols ligatures (outline-only square / circle)
    // would under-represent the filled + numbered character of a
    // counter marker.
    variants: [
      { value: "circle", icon: "circle", label: "Circle", svg: COUNTER_ICON_SVG.circle },
      { value: "rect", icon: "square", label: "Square", svg: COUNTER_ICON_SVG.rect },
      {
        value: "rounded",
        icon: "crop_square",
        label: "Rounded square",
        svg: COUNTER_ICON_SVG.rounded,
      },
    ],
    // Marker uses standard color semantics: `fillColor` = bg
    // interior, `strokeColor` = bg border.
    presetFields: [
      ...UNIVERSAL_STROKE_FIELDS,
      "fillColor",
      "fontSize",
      "markerShape",
    ],
    // Type → Fill → Line → Label. The Counter is the only tool that
    // needs all four sections — its label (the counter number's
    // font-size, NOT a value picker on the Tool side) lives in its
    // own pp-section.
    panelControls: [
      { section: "Type", id: "tool.typeChips" },
      { section: "Fill", id: PROPERTY_CONTROL_IDS.fillColor },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeColor },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeWidth },
      { section: "Line", id: PROPERTY_CONTROL_IDS.strokeStyle },
      { section: "Label", id: PROPERTY_CONTROL_IDS.fontSize },
    ],
    variantKeyForElement(el) {
      if (el.tagName !== "g" || !el.hasAttribute("data-marker")) return null;
      const ms = el.getAttribute("data-shape");
      return `marker.${ms ?? "circle"}`;
    },
    extractStyleFromElement(el, preset) {
      // MarkerTool writes the selected shape into `data-shape` on the
      // outer <g>. Propagate it back into the preset's markerShape
      // field so a subsequent click on the Counter button creates
      // the same shape variant.
      const ms = el.getAttribute("data-shape");
      if (ms === "circle" || ms === "rect" || ms === "rounded") {
        preset.markerShape = ms;
      }
      // Marker uses STANDARD color semantics: `fillColor` = bg
      // interior, `strokeColor` = bg border. The outer <g> has no
      // stroke/fill attrs; we read both from the bg primitive
      // (<circle> / <rect>).
      const bg = el.querySelector("circle, rect");
      const bgFill = bg?.getAttribute("fill");
      if (bgFill) preset.fillColor = bgFill;
      const bgStroke = bg?.getAttribute("stroke");
      if (bgStroke) preset.strokeColor = bgStroke;
      const bsw = Number.parseFloat(bg?.getAttribute("stroke-width") || "");
      if (Number.isFinite(bsw) && bsw >= 0) preset.strokeWidth = bsw;
      const bdash = bg?.getAttribute("data-dash-key") ?? bg?.getAttribute("stroke-dasharray");
      if (bdash != null) preset.strokeDasharray = bdash;
      // Font size for the counter number — read from the <text>
      // child. Without this, changing font-size via the property
      // panel wouldn't stick.
      const tEl = el.tagName === "g" ? el.querySelector("text") : null;
      const fs = Number.parseFloat(tEl?.getAttribute("font-size") || "");
      if (Number.isFinite(fs) && fs > 0) preset.fontSize = fs;
    },
    applyStyleToElement(g, preset) {
      // Marker/counter composite: bg primitive (<circle> or <rect>)
      // carries fill / stroke / stroke-width / dasharray; the inner
      // <text> carries the counter number's font-size. The outer <g>
      // has no style attrs of its own — writing to it would not
      // affect rendering. Mirrors the legacy `applyMarkerPresetStyle`.
      const bg = g.querySelector("circle, rect");
      if (!bg) return;
      if (preset.fillColor) bg.setAttribute("fill", preset.fillColor);
      if (preset.strokeColor) bg.setAttribute("stroke", preset.strokeColor);
      if (preset.strokeWidth != null) {
        bg.setAttribute("stroke-width", String(preset.strokeWidth));
      }
      if (preset.strokeDasharray != null) {
        // Fall back to the bg's existing stroke-width when the preset
        // doesn't carry one — keeps dashes proportional even on a
        // partially-populated preset (matches the legacy helper).
        const w =
          preset.strokeWidth ?? Number.parseFloat(bg.getAttribute("stroke-width") || "1.5");
        bg.setAttribute("stroke-dasharray", computeDasharray(preset.strokeDasharray, w));
        bg.setAttribute("data-dash-key", preset.strokeDasharray);
      }
      if (preset.fontSize != null) {
        const text = g.querySelector("text");
        if (text) text.setAttribute("font-size", String(preset.fontSize));
      }
    },
  },

  // Unified Redact tool — pick mosaic / solid / blur via the right
  // panel's redactStyle property.
  // Icon = `visibility_off` (eye-with-slash) rather than `blur_on`,
  // because the tool covers mosaic / solid / blur — `blur_on`
  // suggests only the blur variant and hurts discoverability of
  // the other two. `visibility_off` is the universal "hide this"
  // metaphor (used by Google Drive, YouTube, OS settings, etc.).
  redact: {
    id: "redact",
    label: "Redact",
    icon: "visibility_off",
    variantField: "redactStyle",
    defaultVariant: "mosaic",
    variants: [
      { value: "mosaic", icon: "grid_view", label: "Mosaic (pixelate)" },
      { value: "solid", icon: "check_box", label: "Solid bar" },
      { value: "blur", icon: "blur_on", label: "Blur" },
    ],
    // Solid redact reuses fillColor as the bar color; mosaic / blur
    // bake a PNG so they don't need style fields at all — the union
    // is what actually gets persisted.
    presetFields: ["fillColor", "redactStyle"],
    // Type only by default; Fill > Color appears solely for the
    // "solid bar" variant. The `visibleWhen` predicate against the
    // CURRENT preset (NOT an element) keeps the panel reactive to
    // variant switches without re-rendering from scratch.
    panelControls: [
      { section: "Type", id: "tool.typeChips" },
      {
        section: "Fill",
        id: PROPERTY_CONTROL_IDS.fillColor,
        visibleWhen: (preset) => preset.redactStyle === "solid",
      },
    ],
    variantKeyForElement(el) {
      if (el.tagName === "rect" && el.getAttribute("data-redact-style") === "solid") {
        return "redact.solid";
      }
      if (el.tagName === "image") {
        // Mosaic / blur redactions bake a PNG into an `<image>`. We
        // claim ANY `<image>` here (matches the legacy
        // `toolIdForElement`'s "any image is redact" branch) so a
        // redact-style attribute that hasn't been written yet falls
        // back to the default variant rather than going un-claimed.
        const rs = el.getAttribute("data-redact-style");
        if (rs === "mosaic" || rs === "blur") return `redact.${rs}`;
        return "redact.mosaic";
      }
      return null;
    },
    extractStyleFromElement(el, preset) {
      const rs = el.getAttribute("data-redact-style");
      if (rs === "solid" || rs === "mosaic" || rs === "blur") preset.redactStyle = rs;
    },
    applyStyleToElement(el, preset) {
      // Solid redact rects accept the universal style writes (mainly
      // `fillColor` → bar color). Mosaic / blur variants bake a PNG
      // into an `<image>` and have no stylable attrs; skipping the
      // writer for those is a cosmetic no-op vs. the legacy generic
      // path (which would `setAttribute("fill", …)` on the <image>,
      // ignored by SVG rendering). Documented in
      // `docs/plans/toolbar-apply-style-to-element.md` Out-of-scope.
      if (el.tagName === "rect" && el.getAttribute("data-redact-style") === "solid") {
        writeUniversalStyleAttrs(el, preset);
      }
    },
  },

  // Crop has no variants and no on-canvas element to rubber-band
  // from — the crop overlay is transient. Listed here for
  // completeness so the registry covers all 8 toolbar entries.
  crop: {
    id: "crop",
    label: "Crop",
    icon: "crop",
    presetFields: [],
  },
} as const;

/** All tool ids the toolbar exposes. Frozen tuple form for tests
 *  that assert the registry covers exactly this set. */
export const TOOL_REGISTRY_IDS = [
  "arrow",
  "shape",
  "highlight",
  "text",
  "freehand",
  "marker",
  "redact",
  "crop",
] as const;

export type ToolRegistryId = (typeof TOOL_REGISTRY_IDS)[number];
