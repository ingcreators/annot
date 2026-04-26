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

import { refreshArrowPath } from "./arrow-markers.js";
import { computeDasharray, detectDashKey } from "../utils/dash-utils.js";
import { convertShape, detectShapeType } from "./shape-utils.js";
import { convertTextVariant, detectTextVariant } from "./text-utils.js";
import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "./toolbar-icons.js";
import type {
  ArrowHead,
  DrawStyle,
  MarkerShape,
  RedactStyle,
  ShapeType,
  TextVariant,
} from "./tool-options.js";

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
} as const;
export type PropertyControlId =
  (typeof PROPERTY_CONTROL_IDS)[keyof typeof PROPERTY_CONTROL_IDS];

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
  "redact-solid": [
    PROPERTY_CONTROL_IDS.redactStylePicker,
    PROPERTY_CONTROL_IDS.redactSolidColor,
  ],
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
} as const;
export type PropertyEffectId = (typeof PROPERTY_EFFECT_IDS)[keyof typeof PROPERTY_EFFECT_IDS];

/** Display affordance for a single option in a `variantPicker` /
 *  `select` control. Exactly one of `materialIcon` / `iconSvg` /
 *  `swatchColor` should be set; the renderer dispatches on whichever
 *  is present. */
export interface PropertyControlOption<T = unknown> {
  value: T;
  label: string;
  /** Material Symbols ligature name (e.g. "text_fields"). Rendered
   *  as `<span class="material-symbols-outlined">{materialIcon}</span>`. */
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
  // Read the canonical 3-state discriminator written by ArrowTool.
  // `data-arrow-head` is the simplest source of truth; per-end
  // shapes live on `data-arrow-{start,end}-shape`.
  const legacy = el.getAttribute("data-arrow-head");
  if (legacy === "none" || legacy === "end" || legacy === "both") return legacy;
  const startNone = (el.getAttribute("data-arrow-start-shape") || "none") === "none";
  const endNone = (el.getAttribute("data-arrow-end-shape") || "none") === "none";
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
    getValue: (el) =>
      el.getAttribute("data-font-family") ??
      el.querySelector("text")?.getAttribute("font-family") ??
      "sans-serif",
    setValue: (el, value) => {
      const v = String(value);
      el.setAttribute("data-font-family", v);
      el.querySelector("text")?.setAttribute("font-family", v);
    },
    options: [
      { value: "sans-serif", label: "Sans-serif" },
      { value: "serif", label: "Serif" },
      { value: "monospace", label: "Monospace" },
      { value: "system-ui, -apple-system, sans-serif", label: "System UI" },
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
    },
    min: 8,
    max: 96,
    step: 1,
    unit: "pt",
  },

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
    visibleWhen: (el) =>
      !isLineLike(el) && el.tagName !== "path" && !isFreehandGroupEl(el),
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
};

/** Returns the categorical bucket for a single SVG element. */
export function classifyPropertyElement(el: Element): PropertyCategory {
  const tag = el.tagName;
  if (tag === "g") {
    const dataType = el.getAttribute("data-type");
    if (dataType === "textbox") return "textbox";
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

/**
 * Coerce a heterogeneous selection to a single category. Returns
 * `null` when the selection mixes categories — at which point the
 * panel typically falls back to either an empty render or the
 * category of the FIRST element. The legacy `show()` always used
 * the first element; this helper preserves that behaviour while
 * exposing the "are they all the same?" check for any future
 * "edit shared properties only" mode.
 */
export function classifyPropertySelection(
  elements: readonly Element[],
): { category: PropertyCategory | null; uniform: boolean } {
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
