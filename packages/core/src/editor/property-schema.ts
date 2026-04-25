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
  marker: [PROPERTY_CONTROL_IDS.markerShapePicker, PROPERTY_CONTROL_IDS.markerSize],
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
    PROPERTY_CONTROL_IDS.strokeColor,
    PROPERTY_CONTROL_IDS.strokeWidth,
    PROPERTY_CONTROL_IDS.strokeStyle,
  ],
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
