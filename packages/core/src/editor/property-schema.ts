// Tier B — pure (jsdom-friendly) classification + shape registry the
// PropertyPanel uses to decide which control set to render. Extracted
// from `@ingcreators/annot-editor/property-panel` so the dispatch
// logic — "is this element a textbox? marker? redact? highlight?
// group? generic shape?" — can be unit-tested against synthetic
// SVG elements without the rest of the panel UI.
//
// Detection is attribute-driven. The redact branch deliberately
// inspects `data-redact-style` directly here instead of importing
// `detectRedactStyle` from `@ingcreators/annot-editor/redact-utils`:
// the rest of `redact-utils` is CanvasManager-coupled (Tier C), and
// duplicating a four-line attribute read here is preferable to a
// circular-package import.

import { computeDasharray, detectDashKey } from "../utils/dash-utils.js";
import {
  arrowPreview,
  arrowSizePreview,
  detectArrowSpec,
  refreshArrowPath,
} from "./arrow-markers.js";
import { coerceToLogicalFamily } from "./font-registry.js";
import { convertShape, detectShapeType } from "./shape-utils.js";
import {
  convertTextVariant,
  detectTextVariant,
  isTextShapeElement,
  readTextShapeSpec,
  replaceRunsInPlace,
  type TextAnchor,
  type TextVerticalAnchor,
} from "./text-utils.js";
import type {
  ArrowDim,
  ArrowHead,
  ArrowShape,
  DrawStyle,
  MarkerShape,
  RedactStyle,
  ShapeType,
  TextVariant,
} from "./tool-options.js";
import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "./toolbar-icons.js";

/**
 * Coarse property-panel category an SVG element falls into. The
 * editor's PropertyPanel uses the category to pick which control
 * set to render; the values intentionally mirror the historical
 * `if (isTextbox) ... else if (isMarker) ... else ...` chain.
 */
export type PropertyCategory =
  | "textbox"
  | "marker"
  | "redact-mosaic"
  | "redact-solid"
  | "redact-blur"
  | "highlight"
  | "group"
  | "shape";

/** Stable IDs used both as map keys in the panel and as test
 *  fixtures so a follow-up "schema-driven render" can swap the
 *  imperative `#renderXxxControls` chain for a declarative table. */
export const PROPERTY_CONTROL_IDS = {
  shapeTypePicker: "shapeTypePicker",
  arrowVariantPicker: "arrowVariantPicker",
  drawStylePicker: "drawStylePicker",
  fillColor: "fillColor",
  strokeColor: "strokeColor",
  strokeWidth: "strokeWidth",
  strokeStyle: "strokeStyle",
  textVariantPicker: "textVariantPicker",
  textColor: "textColor",
  fontFamily: "fontFamily",
  fontSize: "fontSize",
  /** Per-character bold toggle for the selected textbox. Phase 4
   *  of `docs/plans/rich-text-and-shape-text.md`. Modelled as a
   *  two-option `select` ("Off" / "On") so the existing
   *  `select`-type renderer is reused; future Phase-4-prime work
   *  can introduce a dedicated `toggle` control type if visual
   *  polish demands a different affordance. */
  textBold: "textBold",
  textItalic: "textItalic",
  textUnderline: "textUnderline",
  /** Horizontal text alignment inside the shape — start / middle /
   *  end. Writes `data-text-anchor` on the wrapper `<g>` and
   *  re-runs the layout pass. */
  textAnchor: "textAnchor",
  /** Vertical text alignment inside the shape — top / middle /
   *  bottom. Writes `data-text-vanchor` on the wrapper `<g>` and
   *  re-runs the layout pass. */
  textVerticalAnchor: "textVerticalAnchor",
  /** PowerPoint-style autofit policy — none / shrink / resize.
   *  `resize` extends the wrapper geometry's height so the
   *  rendered run block fits without clipping; `shrink` records
   *  the intent (the layout side that scales the font-size is a
   *  follow-up); `none` lets the box clip to its current
   *  dimensions. Stored as `data-text-autofit` on the wrapper. */
  textAutofit: "textAutofit",
  /** Per-side text-box margin in user-space units (mirrors
   *  PowerPoint's left / right / top / bottom margins). Stored
   *  as `data-text-margin-{l,r,t,b}` on the wrapper; the layout
   *  pass reserves the matching pixel inset around the run
   *  block. */
  textMarginLeft: "textMarginLeft",
  textMarginRight: "textMarginRight",
  textMarginTop: "textMarginTop",
  textMarginBottom: "textMarginBottom",
  redactStylePicker: "redactStylePicker",
  redactSolidColor: "redactSolidColor",
  highlightColorPicker: "highlightColorPicker",
  highlightTransparency: "highlightTransparency",
  markerShapePicker: "markerShapePicker",
  markerSize: "markerSize",
  markerBgFillColor: "markerBgFillColor",
  markerBgStrokeColor: "markerBgStrokeColor",
  markerBgStrokeWidth: "markerBgStrokeWidth",
  markerBgStrokeStyle: "markerBgStrokeStyle",
  markerLabelValue: "markerLabelValue",
  fillOpacity: "fillOpacity",
  strokeOpacity: "strokeOpacity",
  strokeLinecap: "strokeLinecap",
  arrowStartShape: "arrowStartShape",
  arrowStartSize: "arrowStartSize",
  arrowEndShape: "arrowEndShape",
  arrowEndSize: "arrowEndSize",
} as const;
export type PropertyControlId = (typeof PROPERTY_CONTROL_IDS)[keyof typeof PROPERTY_CONTROL_IDS];

/**
 * The (potentially-applicable) controls for each category. Whether
 * a given control actually shows up still depends on per-element
 * fine-grained checks (e.g. "Fill is hidden for stroke-only shapes
 * like <line>"). The shape registry is the upper bound that drives
 * eventual schema-driven rendering; the panel is free to filter
 * further at render time.
 */
export const CATEGORY_CONTROL_SHAPE: Readonly<
  Record<PropertyCategory, readonly PropertyControlId[]>
> = {
  textbox: [
    PROPERTY_CONTROL_IDS.textVariantPicker,
    PROPERTY_CONTROL_IDS.textColor,
    PROPERTY_CONTROL_IDS.fontFamily,
    PROPERTY_CONTROL_IDS.fontSize,
    PROPERTY_CONTROL_IDS.textBold,
    PROPERTY_CONTROL_IDS.textItalic,
    PROPERTY_CONTROL_IDS.textUnderline,
    PROPERTY_CONTROL_IDS.textAnchor,
    PROPERTY_CONTROL_IDS.textVerticalAnchor,
    PROPERTY_CONTROL_IDS.textAutofit,
    PROPERTY_CONTROL_IDS.textMarginLeft,
    PROPERTY_CONTROL_IDS.textMarginRight,
    PROPERTY_CONTROL_IDS.textMarginTop,
    PROPERTY_CONTROL_IDS.textMarginBottom,
  ],
  marker: [
    PROPERTY_CONTROL_IDS.markerShapePicker,
    PROPERTY_CONTROL_IDS.markerBgFillColor,
    PROPERTY_CONTROL_IDS.markerBgStrokeColor,
    PROPERTY_CONTROL_IDS.markerBgStrokeWidth,
    PROPERTY_CONTROL_IDS.markerBgStrokeStyle,
    PROPERTY_CONTROL_IDS.markerLabelValue,
    PROPERTY_CONTROL_IDS.markerSize,
  ],
  "redact-mosaic": [PROPERTY_CONTROL_IDS.redactStylePicker],
  "redact-solid": [PROPERTY_CONTROL_IDS.redactStylePicker, PROPERTY_CONTROL_IDS.redactSolidColor],
  "redact-blur": [PROPERTY_CONTROL_IDS.redactStylePicker],
  highlight: [
    PROPERTY_CONTROL_IDS.highlightColorPicker,
    PROPERTY_CONTROL_IDS.highlightTransparency,
  ],
  group: [], // Manually-grouped elements only expose Actions, no per-element editing.
  shape: [
    PROPERTY_CONTROL_IDS.shapeTypePicker,
    PROPERTY_CONTROL_IDS.arrowVariantPicker,
    PROPERTY_CONTROL_IDS.drawStylePicker,
    PROPERTY_CONTROL_IDS.fillColor,
    PROPERTY_CONTROL_IDS.fillOpacity,
    PROPERTY_CONTROL_IDS.strokeColor,
    PROPERTY_CONTROL_IDS.strokeOpacity,
    PROPERTY_CONTROL_IDS.strokeWidth,
    PROPERTY_CONTROL_IDS.strokeStyle,
    PROPERTY_CONTROL_IDS.strokeLinecap,
    PROPERTY_CONTROL_IDS.arrowStartShape,
    PROPERTY_CONTROL_IDS.arrowStartSize,
    PROPERTY_CONTROL_IDS.arrowEndShape,
    PROPERTY_CONTROL_IDS.arrowEndSize,
  ],
};

/** Discriminator for how the renderer should display a control. The
 *  values map onto leaf widget families that already exist in
 *  `@ingcreators/annot-editor` (color pull-buttons, pp-number inputs,
 *  custom-select dropdowns, prop-choice-chip rows). Sections are
 *  layout-only and don't appear here — they're a renderer concern,
 *  not a control. */
export type PropertyControlType = "color" | "number" | "select" | "variantPicker";

/**
 * Identifier for a Tier C-only side-effect a control's mutation requires.
 *
 * Several setters (arrow head regeneration, freehand pen↔highlighter
 * conversion, marker geometry rescale, redact mosaic/blur baking) live
 * in `@ingcreators/annot-editor` because they either need the live
 * `<canvas>` for pixel sampling or wrap helpers that grew up co-located
 * with the tool classes. Tier B can't import those without creating a
 * reverse package dependency, so the registry references them by
 * stable id and Phase 2's renderer (in Tier C) supplies the matching
 * implementations.
 */
export const PROPERTY_EFFECT_IDS = {
  /** Switch an arrow's per-end variant (none / end / both) — calls
   *  `applyArrowHead` from `tools/arrow-tool` which regenerates the
   *  composed `<path>`'s `d` attribute. */
  applyArrowVariant: "applyArrowVariant",
  /** Toggle a freehand element between pen and highlighter — calls
   *  `applyDrawStyle` from `tools/freehand-tool` which sets stroke
   *  attrs across the wrapper group's `<path>` children. */
  applyDrawStyle: "applyDrawStyle",
  /** Swap a marker's bg primitive (circle ↔ rect ↔ rounded) — calls
   *  `convertMarkerShape` from `tools/marker-tool` which mutates the
   *  outer `<g>` in place. */
  applyMarkerShape: "applyMarkerShape",
  /** Resize a marker proportionally — calls `resizeMarker` from
   *  `tools/marker-tool` which scales bg + text together. */
  resizeMarker: "resizeMarker",
  /** Convert a redact element between mosaic / solid / blur — calls
   *  `convertRedactStyle` from `redact-utils`, which is **async** and
   *  needs `CanvasManager` access to sample the underlying base image
   *  for mosaic / blur baking. */
  applyRedactStyle: "applyRedactStyle",
  /** Set a textbox's text color and (for sticky / callout variants
   *  whose bg is derived from the text color) regenerate the bg via
   *  `convertTextVariant`. Plain textboxes get the simple attribute
   *  write; sticky / callout get a bg-recreation pass that produces
   *  a fresh element so the per-target `oldEl !== newEl` swap is
   *  picked up by `onTargetReplaced`. */
  applyTextColor: "applyTextColor",
  /** Per-end arrow effect handlers (Phase C). Each updates a single
   *  field of `detectArrowEnds(el)` and re-applies the spec via
   *  `applyArrowHead`. Split into 4 ids (rather than one shared
   *  handler with a diff-object value) so each registry def's
   *  `effect` field still encodes "which end + which field" without
   *  the renderer needing to thread extra context to the handler. */
  applyArrowStartShape: "applyArrowStartShape",
  applyArrowStartSize: "applyArrowStartSize",
  applyArrowEndShape: "applyArrowEndShape",
  applyArrowEndSize: "applyArrowEndSize",
} as const;
export type PropertyEffectId = (typeof PROPERTY_EFFECT_IDS)[keyof typeof PROPERTY_EFFECT_IDS];

/** Display affordance for a single option in a `variantPicker` /
 *  `select` control. Exactly one of `materialIcon` / `iconSvg` /
 *  `swatchColor` should be set; the renderer dispatches on whichever
 *  is present. */
export interface PropertyControlOption<T = unknown> {
  value: T;
  label: string;
  /** Builtin icon id (e.g. "text_fields"). Rendered via
   *  `renderIconHtml(builtinIcon(materialIcon))` from the
   *  `@ingcreators/annot-core/editor/icons` registry. The legacy
   *  `materialIcon` field name is preserved so `PROPERTY_CONTROLS`
   *  data tables don't have to be rewritten. */
  materialIcon?: string;
  /** Inline SVG markup (already-serialized string). Used when the
   *  glyph isn't available as a Material Symbol or where the icon
   *  family needs hand-rolled geometry for clarity (shape / arrow /
   *  counter pickers). */
  iconSvg?: string;
  /** Color swatch — paints `--swatch-color` on the chip's swatch
   *  element. Used by the highlight color picker, where the variant
   *  IS the color. */
  swatchColor?: string;
}

/**
 * Declarative descriptor for a single PropertyPanel control. The
 * registry below maps every `PropertyControlId` to one of these.
 *
 * **Mutation contract:** each def supplies exactly ONE of:
 *   - `setValue(el, value)` — in-place attribute mutation, Tier B-only
 *     logic. The renderer calls this directly.
 *   - `replace(el, value)` — element-replacement (e.g. converting a
 *     rectangle to an ellipse). Returns the new element, which the
 *     renderer hands back to PropertyPanel via `onTargetReplaced`.
 *   - `effect: PropertyEffectId` — Tier C-only operation. The renderer
 *     looks the id up in its effect-handler table and dispatches.
 *     Used for arrow / draw-style / marker / redact converters that
 *     either need `CanvasManager` (redact) or wrap helpers that live
 *     in `@ingcreators/annot-editor` (the rest).
 */
export interface PropertyControlDef<T = unknown> {
  id: PropertyControlId;
  type: PropertyControlType;
  /** Human-readable label shown next to the control (e.g. "Color",
   *  "Width"). Variant pickers omit a separate label — their chip
   *  row IS the label, anchored under the section header. */
  label: string;
  /** Pure read of the current value off an SVG element. Always
   *  implemented in Tier B. */
  getValue: (el: SVGElement) => T;
  /** In-place mutation. Tier B-only — no `CanvasManager`, no host
   *  callbacks. Mutually exclusive with `replace` and `effect`. */
  setValue?: (el: SVGElement, value: T) => void;
  /** Element replacement. Returns the new element to swap into the
   *  DOM. Tier B-only. Mutually exclusive with `setValue` and `effect`. */
  replace?: (el: SVGElement, value: T) => SVGElement;
  /** Tier C-only side effect; the renderer must supply an
   *  implementation bound to this id. Mutually exclusive with
   *  `setValue` and `replace`. */
  effect?: PropertyEffectId;
  /** Optional gating predicate. Returning `false` tells the renderer
   *  to skip this control for the current selection's first element
   *  (e.g. "Fill is hidden when the element is line-like"). */
  visibleWhen?: (el: SVGElement) => boolean;
  /** Optional metadata for variant pickers / select dropdowns. */
  options?: ReadonlyArray<PropertyControlOption<T>>;
  /** Dynamically-computed options. When present AND the def's
   *  `type === "select"` (or future "variantPicker"), the renderer
   *  calls this with the current sample target instead of reading
   *  the static `options` field. Lets per-end arrow shape pickers
   *  filter by the current variant without forcing the registry
   *  to know about cross-control state. Functions receive the same
   *  `Element` instance the renderer passes to `getValue` /
   *  `visibleWhen`. */
  getOptions?: (el: SVGElement) => ReadonlyArray<PropertyControlOption<T>>;
  /** Number of columns for the select popup grid. Defaults to 1
   *  (vertical list). Used by per-end arrow shape (3 cols for the
   *  6-shape OOXML grid) and size (3 cols for the 3×3 width × length
   *  grid) selects to match PowerPoint's layout exactly. */
  selectColumns?: number;
  /** Width hint (px) for the select popup. Used alongside
   *  `selectColumns` to size the per-end arrow grids. */
  selectPopupWidth?: number;
  // ─── Number-input metadata (meaningful when `type === "number"`) ──
  /** Inclusive lower bound for a number input. */
  min?: number;
  /** Inclusive upper bound for a number input. */
  max?: number;
  /** Spinner / arrow-key step granularity for a number input. */
  step?: number;
  /** Trailing unit label for a number input (e.g. "pt", "%"). */
  unit?: string;
  // ─── Color-input metadata (meaningful when `type === "color"`) ────
  /** Whether a "No fill" sentinel is offered alongside the palette
   *  (only applies to `type === "color"` controls — fill paints can
   *  be unset, strokes generally cannot). */
  allowNone?: boolean;
}

// ─── Helpers used by the registry below ─────────────────────────────
// All Tier B — attribute reads + string parsing only. The matching
// Tier C-side detectors (`detectArrowEnds`, `detectDrawStyle`,
// `detectMarkerShape`) wrap richer logic (legacy attribute fallbacks,
// child-tag inference) but the property panel only needs the
// canonical authoritative reads, which are simple enough to inline
// here without dragging the wrappers across the package boundary.

function arrowVariantOf(el: SVGElement): ArrowHead {
  // Derive the 3-state discriminator from the per-end shape attrs
  // ArrowTool writes (`data-arrow-{start,end}-shape`).
  const startNone = (el.getAttribute("data-arrow-start-shape") ?? "none") === "none";
  const endNone = (el.getAttribute("data-arrow-end-shape") ?? "none") === "none";
  if (startNone && endNone) return "none";
  if (!startNone && !endNone) return "both";
  return "end";
}

function drawStyleOf(el: SVGElement): DrawStyle {
  // Wrapper `<g data-type="freehand">` carries `data-draw-style`;
  // bare `<path>` either has the same attr or falls back to opacity-
  // based inference (highlighters use stroke-opacity < 0.99).
  const tagged = el.getAttribute("data-draw-style");
  if (tagged === "pen" || tagged === "highlighter") return tagged;
  if (el.tagName === "g" && el.getAttribute("data-type") === "freehand") {
    const child = el.querySelector("path");
    if (child) return drawStyleOf(child as SVGElement);
  }
  const op = Number.parseFloat(el.getAttribute("stroke-opacity") || "1");
  return op < 0.99 ? "highlighter" : "pen";
}

function markerShapeOf(g: SVGElement): MarkerShape {
  const ds = g.getAttribute("data-shape");
  if (ds === "circle" || ds === "rect" || ds === "rounded") return ds;
  // Legacy fallback: infer from the bg primitive's tag name.
  const bg = g.querySelector("circle, rect");
  return bg?.tagName === "rect" ? "rect" : "circle";
}

/** The marker's bg primitive — `<circle>` for `circle`, `<rect>`
 *  for `rect` / `rounded`. Centralised so the marker-bg control
 *  defs below all traverse the same way the imperative panel did. */
function markerBgEl(g: SVGElement): Element | null {
  return g.querySelector("circle") ?? g.querySelector("rect");
}

/** Expansion target list for stroke-attr writes. Freehand `<g>`
 *  wrappers surface their `<path>` children — the children
 *  explicitly set their own stroke attributes, so writing on the
 *  wrapper alone wouldn't take effect (the children's per-element
 *  stroke wins over the inherited value). Mirrors the imperative
 *  panel's `#strokeTargets()` / `#setAll()` expansion. */
function strokeWriteTargets(el: SVGElement): SVGElement[] {
  if (el.tagName === "g" && el.getAttribute("data-type") === "freehand") {
    const out: SVGElement[] = [];
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() === "path") out.push(child as SVGElement);
    }
    return out;
  }
  return [el];
}

/** Read an attribute that conventionally lives on the inner shape
 *  primitive of a `<g>` wrapper (arrow / freehand groups). For
 *  non-`<g>` elements, falls back to a direct attribute read.
 *  Mirrors the imperative panel's `#getAttr()` walk. */
function groupAttrRead(el: SVGElement, attr: string): string | null {
  if (el.tagName === "g") {
    const inner = el.querySelector("path, rect, line, circle");
    return inner?.getAttribute(attr) ?? el.getAttribute(attr);
  }
  return el.getAttribute(attr);
}

// `isLineLike` (single-element predicate) lives further up the file;
// `strokeOpacity`'s setValue uses it to choose between writing
// `opacity` (so SVG-marker arrowheads fade with the stem) and
// `stroke-opacity`.

/** Composed-arrow marker — true ONLY for `<g data-type="arrow">`,
 *  the wrapper produced by ArrowTool. Used by `strokeColor` /
 *  `strokeWidth` to drive arrow-specific augmentations
 *  (head-filled fill propagation; `refreshArrowPath` regen). */
function isComposedArrow(el: Element): boolean {
  return el.tagName === "g" && el.getAttribute("data-type") === "arrow";
}

/** Classify the current per-end state into the 3-state `ArrowHead`
 *  variant used by both the toolbar and the panel:
 *    - "none" (Line)        — both ends "none"
 *    - "end" (Arrow)        — one end has a marker, the other is "none"
 *    - "both" (Double arrow) — both ends have markers
 *  Used by the per-end `arrow{Start,End}Shape` defs' `getOptions`
 *  to filter the shape pulldown so users can't pick an
 *  inconsistent state (e.g. "Line" with a triangle on the start). */
function lineVariantOf(el: SVGElement): "none" | "end" | "both" {
  const startNone = detectArrowSpec(el, "start").shape === "none";
  const endNone = detectArrowSpec(el, "end").shape === "none";
  if (startNone && endNone) return "none";
  if (!startNone && !endNone) return "both";
  return "end";
}

/** Six OOXML preset shapes for the per-end Type pulldown, filtered
 *  by the current line variant so the user can't pick an
 *  inconsistent state. The preview SVG faces the right direction
 *  for each end (left for Begin, right for End) so the option list
 *  reads naturally. */
function arrowShapeOptionsFor(
  end: "start" | "end",
  variant: "none" | "end" | "both",
): ReadonlyArray<PropertyControlOption<ArrowShape>> {
  const dir: "left" | "right" = end === "start" ? "left" : "right";
  const all: ReadonlyArray<{ value: ArrowShape; label: string }> = [
    { value: "none", label: "None" },
    { value: "triangle", label: "Triangle" },
    { value: "arrow", label: "Arrow" },
    { value: "stealth", label: "Stealth" },
    { value: "diamond", label: "Diamond" },
    { value: "oval", label: "Oval" },
  ];
  return all
    .filter((s) => {
      const isNone = s.value === "none";
      if (variant === "none") return isNone;
      if (variant === "both") return !isNone;
      // variant === "end" (Arrow): start is "none" only, end is non-"none" only
      return end === "start" ? isNone : !isNone;
    })
    .map((s) => ({
      value: s.value,
      label: s.label,
      iconSvg: arrowPreview(s.value, dir),
    }));
}

/** 3×3 width × length grid for the per-end Size pulldown. Values
 *  are encoded as `"w-l"` strings (e.g. `"md-lg"`); the panel-side
 *  effect handler splits them back into per-axis dims. The preview
 *  SVG faces the right direction for each end. */
function arrowSizeOptionsFor(end: "start" | "end"): ReadonlyArray<PropertyControlOption<string>> {
  const dir: "left" | "right" = end === "start" ? "left" : "right";
  const DIMS: ArrowDim[] = ["sm", "md", "lg"];
  const out: PropertyControlOption<string>[] = [];
  for (const w of DIMS) {
    for (const l of DIMS) {
      out.push({
        value: `${w}-${l}`,
        label: `W:${w.toUpperCase()}  L:${l.toUpperCase()}`,
        iconSvg: arrowSizePreview(w, l, dir),
      });
    }
  }
  return out;
}

function markerSizeOf(g: SVGElement): number {
  const text = g.querySelector("text");
  return Number.parseFloat(text?.getAttribute("font-size") || "13");
}

function redactStyleOf(el: SVGElement): RedactStyle {
  const v = el.getAttribute("data-redact-style");
  if (v === "mosaic" || v === "solid" || v === "blur") return v;
  return "mosaic";
}

function isLineLike(el: Element): boolean {
  if (el.tagName === "line") return true;
  return el.tagName === "g" && el.getAttribute("data-type") === "arrow";
}

function isFreehandGroupEl(el: Element): boolean {
  return el.tagName === "g" && el.getAttribute("data-type") === "freehand";
}

// ─── The registry ────────────────────────────────────────────────────
//
// Every `PropertyControlId` listed in `PROPERTY_CONTROL_IDS` has an
// entry below. The renderer in Phase 2 (Tier C) reads
// `CATEGORY_CONTROL_SHAPE[category]` for the selected element's
// category, looks each id up here, and dispatches on `def.type` to
// produce the matching DOM. Visibility predicates filter further at
// render time (e.g. "Fill is hidden for stroke-only elements").

/**
 * The complete set of declarative control definitions PropertyPanel
 * renders. Phase 1 of `docs/plans/property-panel-schema.md`: the
 * data structure, with no consumer yet — the panel still uses the
 * imperative `#renderXxxControls` chain. Phase 2 builds the renderer;
 * Phase 3 migrates the panel to use it.
 */
export const PROPERTY_CONTROLS: Readonly<{
  [K in PropertyControlId]: PropertyControlDef;
}> = {
  // ─── Shape controls ───────────────────────────────────────────────
  shapeTypePicker: {
    id: PROPERTY_CONTROL_IDS.shapeTypePicker,
    type: "variantPicker",
    label: "Shape type",
    getValue: (el) => detectShapeType(el),
    replace: (el, value) => convertShape(el, value as ShapeType),
    visibleWhen: (el) => detectShapeType(el) !== null,
    options: [
      { value: "rect", label: "Rectangle", iconSvg: SHAPE_ICON_SVG.rect },
      { value: "rounded", label: "Rounded", iconSvg: SHAPE_ICON_SVG.rounded },
      { value: "ellipse", label: "Ellipse", iconSvg: SHAPE_ICON_SVG.ellipse },
    ],
  },
  arrowVariantPicker: {
    id: PROPERTY_CONTROL_IDS.arrowVariantPicker,
    type: "variantPicker",
    label: "Arrow type",
    getValue: (el) => arrowVariantOf(el),
    effect: PROPERTY_EFFECT_IDS.applyArrowVariant,
    visibleWhen: (el) => isLineLike(el),
    options: [
      { value: "none", label: "Line", iconSvg: ARROW_ICON_SVG.none },
      { value: "end", label: "Arrow", iconSvg: ARROW_ICON_SVG.end },
      { value: "both", label: "Double arrow", iconSvg: ARROW_ICON_SVG.both },
    ],
  },
  drawStylePicker: {
    id: PROPERTY_CONTROL_IDS.drawStylePicker,
    type: "variantPicker",
    label: "Draw style",
    getValue: (el) => drawStyleOf(el),
    effect: PROPERTY_EFFECT_IDS.applyDrawStyle,
    visibleWhen: (el) => el.tagName === "path" || isFreehandGroupEl(el),
    options: [
      { value: "pen", label: "Pen", materialIcon: "edit" },
      { value: "highlighter", label: "Highlighter", materialIcon: "ink_highlighter" },
    ],
  },
  fillColor: {
    id: PROPERTY_CONTROL_IDS.fillColor,
    type: "color",
    label: "Color",
    getValue: (el) => el.getAttribute("fill") ?? "none",
    setValue: (el, value) => {
      el.setAttribute("fill", String(value));
    },
    // Stroke-only families (line, freehand path, freehand group)
    // don't render a fill control — there's no painted region to
    // fill on a stroke. Mirrors the imperative panel's branch.
    visibleWhen: (el) => !isLineLike(el) && el.tagName !== "path" && !isFreehandGroupEl(el),
    allowNone: true,
  },
  strokeColor: {
    id: PROPERTY_CONTROL_IDS.strokeColor,
    type: "color",
    label: "Color",
    getValue: (el) => groupAttrRead(el, "stroke") ?? "#000000",
    setValue: (el, value) => {
      const v = String(value);
      // Freehand <g> wrappers expand to their <path> children so the
      // children's per-element stroke writes take effect.
      for (const t of strokeWriteTargets(el)) t.setAttribute("stroke", v);
      // Composed arrow groups: the head <path> carries its own
      // colored `fill` (the filled triangle / diamond / oval). Keep
      // it locked to the stroke color so heads track the stem.
      // Open heads keep `fill="none"` and aren't matched by the
      // selector — only the data-role="head-filled" subpath is
      // touched.
      if (isComposedArrow(el)) {
        const headFilled = el.querySelector(':scope > [data-role="head-filled"]');
        if (headFilled) headFilled.setAttribute("fill", v);
      }
    },
  },
  strokeWidth: {
    id: PROPERTY_CONTROL_IDS.strokeWidth,
    type: "number",
    label: "Width",
    getValue: (el) => Number.parseFloat(groupAttrRead(el, "stroke-width") || "0"),
    setValue: (el, value) => {
      const w = Number(value);
      for (const t of strokeWriteTargets(el)) {
        t.setAttribute("stroke-width", String(w));
        // Re-express dasharray against the new width so dots /
        // dashes stay proportional. Mirrors the imperative
        // `#addPPLineSection` branch.
        const key = t.getAttribute("data-dash-key");
        if (key) t.setAttribute("stroke-dasharray", computeDasharray(key, w));
      }
      // Composed arrow groups compute their stem-shortening offsets
      // from the stroke width (the trig constants multiply `sw`).
      // Regenerate stem + head `d` so the alignment stays flush
      // after a width change. Mirrors the imperative chain.
      if (isComposedArrow(el)) refreshArrowPath(el);
    },
    min: 0.25,
    max: 200,
    step: 0.25,
    unit: "pt",
  },
  strokeStyle: {
    id: PROPERTY_CONTROL_IDS.strokeStyle,
    type: "select",
    label: "Dash type",
    getValue: (el) => {
      const stored = groupAttrRead(el, "data-dash-key");
      if (stored != null) return stored;
      const sw = Number.parseFloat(groupAttrRead(el, "stroke-width") || "1");
      const raw = groupAttrRead(el, "stroke-dasharray") || "";
      return detectDashKey(raw, sw) ?? "";
    },
    setValue: (el, value) => {
      const key = String(value);
      for (const t of strokeWriteTargets(el)) {
        const sw = Number.parseFloat(t.getAttribute("stroke-width") || "1");
        if (key) {
          t.setAttribute("data-dash-key", key);
          t.setAttribute("stroke-dasharray", computeDasharray(key, sw));
        } else {
          t.removeAttribute("data-dash-key");
          t.removeAttribute("stroke-dasharray");
        }
      }
    },
    options: [
      { value: "", label: "Solid" },
      { value: "dash", label: "Dashed" },
      { value: "dot", label: "Dotted" },
      { value: "dashDot", label: "Dash-Dot" },
      { value: "lgDash", label: "Long Dash" },
    ],
  },

  // ─── Textbox controls ─────────────────────────────────────────────
  textVariantPicker: {
    id: PROPERTY_CONTROL_IDS.textVariantPicker,
    type: "variantPicker",
    label: "Text type",
    getValue: (el) => detectTextVariant(el),
    replace: (el, value) => convertTextVariant(el, value as TextVariant),
    options: [
      { value: "plain", label: "Plain text", materialIcon: "text_fields" },
      { value: "sticky", label: "Sticky note", materialIcon: "sticky_note_2" },
      { value: "callout", label: "Callout", materialIcon: "chat_bubble" },
    ],
  },
  textColor: {
    id: PROPERTY_CONTROL_IDS.textColor,
    type: "color",
    label: "Color",
    getValue: (el) => el.querySelector("text")?.getAttribute("fill") ?? "#ff0000",
    // Goes through `applyTextColor` (Tier C) instead of a plain
    // `setValue` because sticky / callout textboxes derive their bg
    // tint from `data-color`; after the color attr writes the bg
    // primitive needs regeneration via `convertTextVariant`. The
    // effect handler bound in PropertyPanel does both — sets the
    // text fill + data-color, then for non-plain variants returns
    // the post-recreation element so the renderer threads the swap
    // through `onTargetReplaced`. Plain textboxes return identity.
    effect: PROPERTY_EFFECT_IDS.applyTextColor,
  },
  fontFamily: {
    id: PROPERTY_CONTROL_IDS.fontFamily,
    type: "select",
    label: "Font",
    // Logical-family token only (`Annot Sans` / `Annot Serif` /
    // `Annot Mono`). The `coerceToLogicalFamily` reader below
    // normalises any legacy raw CSS family strings (e.g.
    // `"sans-serif"`, `"system-ui, -apple-system, sans-serif"`)
    // to the matching token so existing saves render predictably
    // until the next edit overwrites the attribute. See
    // `docs/plans/_done/multilingual-fonts-os-stack.md` (or its
    // active draft) for the per-token CSS stack and the OOXML
    // `<a:latin>` + `<a:ea>` + `<a:cs>` triple emit on PPTX
    // export.
    getValue: (el) =>
      coerceToLogicalFamily(
        el.getAttribute("data-font-family") ??
          el.querySelector("text")?.getAttribute("font-family"),
      ),
    setValue: (el, value) => {
      const v = coerceToLogicalFamily(String(value));
      el.setAttribute("data-font-family", v);
      el.querySelector("text")?.setAttribute("font-family", v);
    },
    options: [
      { value: "Annot Sans", label: "Sans (Multilingual)" },
      { value: "Annot Serif", label: "Serif" },
      { value: "Annot Mono", label: "Mono" },
    ],
  },
  fontSize: {
    id: PROPERTY_CONTROL_IDS.fontSize,
    type: "number",
    label: "Size",
    getValue: (el) =>
      Number.parseFloat(el.querySelector("text")?.getAttribute("font-size") || "16"),
    setValue: (el, value) => {
      const v = Number(value);
      el.querySelector("text")?.setAttribute("font-size", String(v));
      el.setAttribute("data-font-size", String(v));
      // Re-flow tspans for text-bearing shapes so the per-line layout
      // (and the autofit grow-to-fit pass for `data-text-autofit="resize"`)
      // pick up the new size. Without this, enlarging the font on a
      // selected text-shape (sticky / callout / text-on-shape) bumps
      // the visible glyphs but leaves the bg rect pinned to its old
      // height — autofit never fires, so "Resize shape to fit text"
      // silently does nothing when the trigger is a font-size change
      // rather than a text-content change. Non-text shapes (markers
      // etc.) skip the re-flow because they don't carry a text-shape
      // skeleton.
      if (isTextShapeElement(el)) {
        const runs = readTextShapeSpec(el).runs;
        replaceRunsInPlace(el, runs);
      }
    },
    min: 8,
    max: 96,
    step: 1,
    unit: "pt",
  },
  textAnchor: {
    id: PROPERTY_CONTROL_IDS.textAnchor,
    type: "select",
    label: "Align",
    getValue: (el) => (el.getAttribute("data-text-anchor") as TextAnchor | null) ?? "start",
    setValue: (el, value) => {
      const next = String(value) as TextAnchor;
      el.setAttribute("data-text-anchor", next);
      // Re-layout the existing runs against the new anchor so the
      // visual updates immediately. `replaceRunsInPlace` reads the
      // attribute back via `getAttribute`, so writing first +
      // re-laying out matches the behaviour of every other Tier B
      // attribute writer.
      const runs = readTextShapeSpec(el).runs;
      replaceRunsInPlace(el, runs);
    },
    options: [
      { value: "start", label: "Left", materialIcon: "format_align_left" },
      { value: "middle", label: "Center", materialIcon: "format_align_center" },
      { value: "end", label: "Right", materialIcon: "format_align_right" },
    ],
  },
  textVerticalAnchor: {
    id: PROPERTY_CONTROL_IDS.textVerticalAnchor,
    type: "select",
    label: "V-Align",
    getValue: (el) => (el.getAttribute("data-text-vanchor") as TextVerticalAnchor | null) ?? "top",
    setValue: (el, value) => {
      const next = String(value) as TextVerticalAnchor;
      el.setAttribute("data-text-vanchor", next);
      const runs = readTextShapeSpec(el).runs;
      replaceRunsInPlace(el, runs);
    },
    options: [
      { value: "top", label: "Top", materialIcon: "vertical_align_top" },
      { value: "middle", label: "Middle", materialIcon: "vertical_align_center" },
      { value: "bottom", label: "Bottom", materialIcon: "vertical_align_bottom" },
    ],
  },
  textAutofit: {
    id: PROPERTY_CONTROL_IDS.textAutofit,
    type: "select",
    label: "Autofit",
    getValue: (el) => el.getAttribute("data-text-autofit") || "none",
    setValue: (el, value) => {
      const next = String(value);
      if (next === "none") {
        el.removeAttribute("data-text-autofit");
      } else {
        el.setAttribute("data-text-autofit", next);
      }
      const runs = readTextShapeSpec(el).runs;
      replaceRunsInPlace(el, runs);
    },
    options: [
      { value: "none", label: "Do not autofit" },
      { value: "shrink", label: "Shrink text on overflow" },
      { value: "resize", label: "Resize shape to fit text" },
    ],
  },
  textMarginLeft: makeMarginControl(
    PROPERTY_CONTROL_IDS.textMarginLeft,
    "Margin L",
    "data-text-margin-l",
  ),
  textMarginRight: makeMarginControl(
    PROPERTY_CONTROL_IDS.textMarginRight,
    "Margin R",
    "data-text-margin-r",
  ),
  textMarginTop: makeMarginControl(
    PROPERTY_CONTROL_IDS.textMarginTop,
    "Margin T",
    "data-text-margin-t",
  ),
  textMarginBottom: makeMarginControl(
    PROPERTY_CONTROL_IDS.textMarginBottom,
    "Margin B",
    "data-text-margin-b",
  ),
  textBold: makeTspanFlagControl(
    PROPERTY_CONTROL_IDS.textBold,
    "Bold",
    "font-weight",
    "bold",
    (v) => v === "bold" || v === "700",
  ),
  textItalic: makeTspanFlagControl(
    PROPERTY_CONTROL_IDS.textItalic,
    "Italic",
    "font-style",
    "italic",
    (v) => v === "italic",
  ),
  textUnderline: makeTspanFlagControl(
    PROPERTY_CONTROL_IDS.textUnderline,
    "Underline",
    "text-decoration",
    "underline",
    (v) => v.includes("underline"),
  ),

  // ─── Redact controls ──────────────────────────────────────────────
  redactStylePicker: {
    id: PROPERTY_CONTROL_IDS.redactStylePicker,
    type: "variantPicker",
    label: "Redact style",
    getValue: (el) => redactStyleOf(el),
    // `convertRedactStyle` is async + needs CanvasManager — the
    // renderer in Tier C supplies the implementation bound to this id.
    effect: PROPERTY_EFFECT_IDS.applyRedactStyle,
    options: [
      { value: "mosaic", label: "Mosaic (pixelate)", materialIcon: "grid_view" },
      { value: "solid", label: "Solid bar", materialIcon: "check_box" },
      { value: "blur", label: "Blur", materialIcon: "blur_on" },
    ],
  },
  redactSolidColor: {
    id: PROPERTY_CONTROL_IDS.redactSolidColor,
    type: "color",
    label: "Color",
    getValue: (el) => el.getAttribute("fill") ?? "#111111",
    setValue: (el, value) => {
      el.setAttribute("fill", String(value));
    },
    visibleWhen: (el) => redactStyleOf(el) === "solid",
  },

  // ─── Highlight controls ───────────────────────────────────────────
  highlightColorPicker: {
    id: PROPERTY_CONTROL_IDS.highlightColorPicker,
    type: "variantPicker",
    label: "Highlight color",
    getValue: (el) =>
      (el.getAttribute("fill") ?? HIGHLIGHT_COLORS[0]?.value ?? "#ffff00").toLowerCase(),
    // Highlight color isn't a free-form value — it's a chip-style
    // variant pick. Setting the fill is straightforward, but the
    // existing imperative panel routes the click through
    // `onVariantChanged` (not `onStyleChanged`) so the new color's
    // saved Transparency preset gets applied. Treating this as a
    // variant change is the renderer's job; the def just sets the
    // attribute.
    setValue: (el, value) => {
      el.setAttribute("fill", String(value));
    },
    options: HIGHLIGHT_COLORS.map((c) => ({
      value: c.value,
      label: c.label,
      swatchColor: c.value,
    })),
  },
  highlightTransparency: {
    id: PROPERTY_CONTROL_IDS.highlightTransparency,
    type: "number",
    label: "Transparency",
    // Transparency is the inverse of fill-opacity, expressed as a
    // 0..100 percentage. 60% transparency ↔ 0.4 opacity.
    getValue: (el) => {
      const fo = Number.parseFloat(el.getAttribute("fill-opacity") || "0.4");
      const safe = Number.isFinite(fo) ? fo : 0.4;
      return Math.round((1 - safe) * 100);
    },
    setValue: (el, value) => {
      const pct = Number(value);
      const opacity = 1 - pct / 100;
      el.setAttribute("fill-opacity", String(opacity));
    },
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },

  // ─── Marker (counter) controls ────────────────────────────────────
  markerShapePicker: {
    id: PROPERTY_CONTROL_IDS.markerShapePicker,
    type: "variantPicker",
    label: "Counter shape",
    getValue: (el) => markerShapeOf(el),
    // `convertMarkerShape` mutates the inner bg primitive — Tier C
    // helper. The outer `<g>` keeps identity, so no `replace` path.
    effect: PROPERTY_EFFECT_IDS.applyMarkerShape,
    options: [
      { value: "circle", label: "Circle", iconSvg: COUNTER_ICON_SVG.circle },
      { value: "rect", label: "Square", iconSvg: COUNTER_ICON_SVG.rect },
      { value: "rounded", label: "Rounded square", iconSvg: COUNTER_ICON_SVG.rounded },
    ],
  },
  markerSize: {
    id: PROPERTY_CONTROL_IDS.markerSize,
    type: "number",
    label: "Size",
    getValue: (el) => markerSizeOf(el),
    // `resizeMarker` rescales bg + text geometry together — Tier C
    // helper (the math lives there alongside MarkerTool's creation
    // logic so both stay in step).
    effect: PROPERTY_EFFECT_IDS.resizeMarker,
    min: 8,
    max: 96,
    step: 1,
    unit: "pt",
  },

  // ─── Marker bg-primitive controls ────────────────────────────────
  // The Counter (marker) tool's Fill / Line rows write to the inner
  // `<circle>` / `<rect>` bg primitive (where MarkerTool puts its
  // styling), not the outer `<g>`. The five defs below traverse via
  // `markerBgEl(g)` so the registry can model the same per-target
  // attribute reads / writes the imperative `#renderMarkerControls`
  // chain did.
  markerBgFillColor: {
    id: PROPERTY_CONTROL_IDS.markerBgFillColor,
    type: "color",
    label: "Color",
    getValue: (el) => markerBgEl(el)?.getAttribute("fill") ?? "#ff0000",
    setValue: (el, value) => {
      markerBgEl(el)?.setAttribute("fill", String(value));
    },
    allowNone: true,
  },
  markerBgStrokeColor: {
    id: PROPERTY_CONTROL_IDS.markerBgStrokeColor,
    type: "color",
    label: "Color",
    getValue: (el) => markerBgEl(el)?.getAttribute("stroke") ?? "#ffffff",
    setValue: (el, value) => {
      markerBgEl(el)?.setAttribute("stroke", String(value));
    },
  },
  markerBgStrokeWidth: {
    id: PROPERTY_CONTROL_IDS.markerBgStrokeWidth,
    type: "number",
    label: "Width",
    getValue: (el) => Number.parseFloat(markerBgEl(el)?.getAttribute("stroke-width") || "1.5"),
    setValue: (el, value) => {
      const bg = markerBgEl(el);
      if (!bg) return;
      const w = Number(value);
      bg.setAttribute("stroke-width", String(w));
      // Re-express the dasharray (if any) against the new width so
      // dots / dashes stay proportional, matching the Line section's
      // strokeWidth setter.
      const key = bg.getAttribute("data-dash-key");
      if (key) bg.setAttribute("stroke-dasharray", computeDasharray(key, w));
    },
    min: 0,
    max: 20,
    step: 0.25,
    unit: "pt",
  },
  markerBgStrokeStyle: {
    id: PROPERTY_CONTROL_IDS.markerBgStrokeStyle,
    type: "select",
    label: "Dash type",
    getValue: (el) => {
      const bg = markerBgEl(el);
      if (!bg) return "";
      const stored = bg.getAttribute("data-dash-key");
      if (stored != null) return stored;
      const sw = Number.parseFloat(bg.getAttribute("stroke-width") || "1.5");
      const raw = bg.getAttribute("stroke-dasharray") || "";
      return detectDashKey(raw, sw) ?? "";
    },
    setValue: (el, value) => {
      const bg = markerBgEl(el);
      if (!bg) return;
      const key = String(value);
      const sw = Number.parseFloat(bg.getAttribute("stroke-width") || "1.5");
      if (key) {
        bg.setAttribute("data-dash-key", key);
        bg.setAttribute("stroke-dasharray", computeDasharray(key, sw));
      } else {
        bg.removeAttribute("data-dash-key");
        bg.removeAttribute("stroke-dasharray");
      }
    },
    options: [
      { value: "", label: "Solid" },
      { value: "dash", label: "Dashed" },
      { value: "dot", label: "Dotted" },
      { value: "dashDot", label: "Dash-Dot" },
      { value: "lgDash", label: "Long Dash" },
    ],
  },
  markerLabelValue: {
    id: PROPERTY_CONTROL_IDS.markerLabelValue,
    type: "number",
    label: "Value",
    // Counter number lives BOTH on the outer <g>'s `data-marker`
    // attribute (durable / round-trips through SVG IO) AND on the
    // inner <text>'s textContent (what users see). The setValue
    // keeps the two in sync the same way the imperative
    // `#renderMarkerControls` Label > Value row did.
    getValue: (el) => {
      const v = Number.parseInt(el.getAttribute("data-marker") || "1", 10);
      return Number.isFinite(v) ? v : 1;
    },
    setValue: (el, value) => {
      const v = Math.round(Number(value));
      el.setAttribute("data-marker", String(v));
      const t = el.querySelector("text");
      if (t) t.textContent = String(v);
    },
    min: 1,
    max: 999,
    step: 1,
  },

  // ─── Shape transparency + cap type ───────────────────────────────
  // Phase B of `property-panel-schema-extensions.md`. The three rows
  // below cover the imperative `#addPPLineSection` /
  // `#addPPFillSection` content the original migration left
  // behind. All three use the inverse-percentage convention
  // (transparency 0..100% = inverse of opacity 0..1) so a freshly
  // drawn shape with `fill-opacity="1"` reads as 0% transparent.
  fillOpacity: {
    id: PROPERTY_CONTROL_IDS.fillOpacity,
    type: "number",
    label: "Transparency",
    getValue: (el) => {
      const fo = Number.parseFloat(groupAttrRead(el, "fill-opacity") || "1");
      const safe = Number.isFinite(fo) ? fo : 1;
      return Math.round((1 - safe) * 100);
    },
    setValue: (el, value) => {
      const op = 1 - Number(value) / 100;
      el.setAttribute("fill-opacity", String(op));
    },
    // Stroke-only families don't have a fillable region, so the
    // opacity row hides alongside `fillColor`.
    visibleWhen: (el) => !isLineLike(el) && el.tagName !== "path" && !isFreehandGroupEl(el),
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  strokeOpacity: {
    id: PROPERTY_CONTROL_IDS.strokeOpacity,
    type: "number",
    label: "Transparency",
    // Read prefers the element's own `opacity` (line-like uses this
    // so SVG-marker arrowheads fade with the stem) and falls back
    // to `stroke-opacity` everywhere else. Mirrors the imperative
    // `readOp()` walk in `#addPPLineSection`.
    getValue: (el) => {
      const direct = el.getAttribute("opacity");
      const raw = direct != null ? direct : groupAttrRead(el, "stroke-opacity") || "1";
      const v = Number.parseFloat(raw);
      const safe = Number.isFinite(v) ? v : 1;
      return Math.round((1 - safe) * 100);
    },
    setValue: (el, value) => {
      const op = 1 - Number(value) / 100;
      // For line-like targets, write `opacity` and drop any legacy
      // `stroke-opacity` so the two paint channels don't compound
      // into an unexpectedly faint line. For other shapes,
      // `stroke-opacity` is the right channel (leaves fill alone).
      // Freehand groups expand to their <path> children so the
      // children's per-element stroke writes take effect.
      for (const t of strokeWriteTargets(el)) {
        if (isLineLike(t)) {
          t.setAttribute("opacity", String(op));
          t.removeAttribute("stroke-opacity");
        } else {
          t.setAttribute("stroke-opacity", String(op));
        }
      }
    },
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  strokeLinecap: {
    id: PROPERTY_CONTROL_IDS.strokeLinecap,
    type: "select",
    label: "Cap type",
    // Default to "butt" — SVG's actual rendering when no
    // stroke-linecap attribute is present. Order mirrors
    // PowerPoint's Square → Round → Flat (Flat = SVG "butt").
    getValue: (el) => groupAttrRead(el, "stroke-linecap") ?? "butt",
    setValue: (el, value) => {
      const v = String(value);
      for (const t of strokeWriteTargets(el)) t.setAttribute("stroke-linecap", v);
    },
    options: [
      { value: "square", label: "Square" },
      { value: "round", label: "Round" },
      { value: "butt", label: "Flat" },
    ],
  },

  // ─── Per-end arrow type & size pulldowns ─────────────────────────
  // Phase C of `property-panel-schema-extensions.md`. The four defs
  // model the PowerPoint per-end arrow grids: each end (Begin /
  // End) gets a Type pulldown (6 OOXML preset shapes, variant-
  // filtered) and a Size pulldown (3×3 width × length grid). Type
  // options are dynamic via `getOptions` because the option list
  // depends on the OTHER end's current shape (e.g. selecting the
  // start shape for an "Arrow" variant must hide all non-"none"
  // options). All four use `effect` because the setter calls
  // `applyArrowHead` (Tier C — lives in `tools/arrow-tool.ts`)
  // with the modified spec; the panel binds the four handlers in
  // its constructor. `visibleWhen: isLineLike` hides the rows for
  // anything that isn't a `<line>` or composed `<g data-type=
  // "arrow">`.
  arrowStartShape: {
    id: PROPERTY_CONTROL_IDS.arrowStartShape,
    type: "select",
    label: "Begin arrow type",
    getValue: (el) => detectArrowSpec(el, "start").shape,
    effect: PROPERTY_EFFECT_IDS.applyArrowStartShape,
    visibleWhen: isLineLike,
    getOptions: (el) => arrowShapeOptionsFor("start", lineVariantOf(el)),
    selectColumns: 3,
    selectPopupWidth: 170,
  },
  arrowStartSize: {
    id: PROPERTY_CONTROL_IDS.arrowStartSize,
    type: "select",
    label: "Begin arrow size",
    getValue: (el) => {
      const spec = detectArrowSpec(el, "start");
      return `${spec.width}-${spec.length}`;
    },
    effect: PROPERTY_EFFECT_IDS.applyArrowStartSize,
    visibleWhen: isLineLike,
    options: arrowSizeOptionsFor("start"),
    selectColumns: 3,
    selectPopupWidth: 180,
  },
  arrowEndShape: {
    id: PROPERTY_CONTROL_IDS.arrowEndShape,
    type: "select",
    label: "End arrow type",
    getValue: (el) => detectArrowSpec(el, "end").shape,
    effect: PROPERTY_EFFECT_IDS.applyArrowEndShape,
    visibleWhen: isLineLike,
    getOptions: (el) => arrowShapeOptionsFor("end", lineVariantOf(el)),
    selectColumns: 3,
    selectPopupWidth: 170,
  },
  arrowEndSize: {
    id: PROPERTY_CONTROL_IDS.arrowEndSize,
    type: "select",
    label: "End arrow size",
    getValue: (el) => {
      const spec = detectArrowSpec(el, "end");
      return `${spec.width}-${spec.length}`;
    },
    effect: PROPERTY_EFFECT_IDS.applyArrowEndSize,
    visibleWhen: isLineLike,
    options: arrowSizeOptionsFor("end"),
    selectColumns: 3,
    selectPopupWidth: 180,
  },
};

/** Returns the categorical bucket for a single SVG element. */
export function classifyPropertyElement(el: Element): PropertyCategory {
  const tag = el.tagName;
  if (tag === "g") {
    const dataType = el.getAttribute("data-type");
    // Unified text-bearing shape — `data-shape-kind` carries the
    // discriminator (auto-bg variants plain / sticky / callout +
    // text-on-shape rect / rounded / ellipse — see `isTextOnShape`).
    if (dataType === "shape") return "textbox";
    if (dataType === "group") return "group";
    if (el.hasAttribute("data-marker")) return "marker";
    if (dataType === "arrow") return "shape"; // composed arrow
  }
  if (tag === "rect" && el.getAttribute("data-highlight") === "1") {
    return "highlight";
  }
  // Redact elements carry `data-redact-style` regardless of underlying
  // tag (<rect> for solid, <image> for mosaic / blur).
  const redact = el.getAttribute("data-redact-style");
  if (redact === "mosaic") return "redact-mosaic";
  if (redact === "solid") return "redact-solid";
  if (redact === "blur") return "redact-blur";
  return "shape";
}

/** Build a `number` control descriptor for a per-side text-box
 *  margin attribute (`data-text-margin-{l,r,t,b}`). Setting the
 *  margin re-runs `replaceRunsInPlace` so the run block re-flows
 *  immediately. Stored value is in user-space units (px).
 *  Mirrors PowerPoint's "Text Box → Margins" surface. */
function makeMarginControl(
  id: PropertyControlId,
  label: string,
  attr: string,
): PropertyControlDef<unknown> {
  return {
    id,
    type: "number",
    label,
    getValue: (el) => {
      const variant = el.getAttribute("data-shape-kind");
      const isLR = attr === "data-text-margin-l" || attr === "data-text-margin-r";
      const fallback = variant === "plain" ? (isLR ? 2 : 0) : isLR ? 10 : 8;
      const raw = el.getAttribute(attr);
      if (raw == null) return fallback;
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    },
    setValue: (el, value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return;
      el.setAttribute(attr, String(n));
      const runs = readTextShapeSpec(el).runs;
      replaceRunsInPlace(el, runs);
    },
    min: 0,
    max: 200,
    step: 1,
    unit: "px",
  };
}

/** Build a `select`-typed control descriptor for a per-tspan
 *  formatting flag (bold / italic / underline) on a text-bearing
 *  shape. The control reads "On" when EVERY `<tspan>` in the
 *  element carries the flag, "Off" otherwise; setting "On" /
 *  "Off" applies / removes the flag uniformly across every
 *  tspan.
 *
 *  Modelled as a two-option `select` so the existing renderer's
 *  select arm renders the chip without needing a fresh
 *  PropertyControlType. PowerPoint-style "mixed" tri-state can
 *  follow once the renderer grows a dedicated toggle widget. */
function makeTspanFlagControl(
  id: PropertyControlId,
  label: string,
  attr: string,
  onValue: string,
  isOn: (value: string) => boolean,
): PropertyControlDef<unknown> {
  return {
    id,
    type: "select",
    label,
    getValue: (el) => {
      const tspans = Array.from(el.querySelectorAll("tspan"));
      if (tspans.length === 0) return "off";
      return tspans.every((t) => {
        const v = t.getAttribute(attr);
        return v != null && isOn(v);
      })
        ? "on"
        : "off";
    },
    setValue: (el, value) => {
      const turnOn = String(value) === "on";
      const tspans = Array.from(el.querySelectorAll("tspan"));
      for (const t of tspans) {
        if (turnOn) {
          t.setAttribute(attr, onValue);
        } else {
          t.removeAttribute(attr);
        }
      }
    },
    options: [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
  };
}

/**
 * Coerce a heterogeneous selection to a single category. Returns
 * `null` when the selection mixes categories — at which point the
 * panel typically falls back to either an empty render or the
 * category of the FIRST element. The legacy `show()` always used
 * the first element; this helper preserves that behaviour while
 * exposing the "are they all the same?" check for any future
 * "edit shared properties only" mode.
 */
export function classifyPropertySelection(elements: readonly Element[]): {
  category: PropertyCategory | null;
  uniform: boolean;
} {
  if (elements.length === 0) return { category: null, uniform: true };
  // `elements.length >= 1`, so `elements[0]` is defined.
  const first = classifyPropertyElement(elements[0]!);
  for (let i = 1; i < elements.length; i++) {
    if (classifyPropertyElement(elements[i]!) !== first) {
      return { category: first, uniform: false };
    }
  }
  return { category: first, uniform: true };
}
