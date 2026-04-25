/**
 * Pure helpers for the editor toolbar's preset system. None of these
 * read or mutate `Toolbar`-private state; they take whatever they
 * need as parameters and return a value or mutate a passed-in
 * preset / element.
 *
 * Extracted from `toolbar.ts` as Stage 3a-5 of
 * `docs/plans/pre-release-cleanup.md`. The state-managing parts
 * (`#presets` Map, `#lastVariantByTool`, persistence I/O,
 * `#changeVariant` / `#handlePanelVariantChange` / `#getCurrentPreset`
 * / `#saveCurrentPreset`) stay in toolbar.ts for now — promoting them
 * to a `ToolbarPresetManager` class is a separate, larger refactor
 * that does not need to land in the same PR as this carve-out.
 */

import { computeDasharray, type ToolOptions } from "@ingcreators/annot-core";
import { refreshArrowPath } from "@ingcreators/annot-core/editor/arrow-markers";
import { TOOL_VARIANTS } from "./toolbar-variants.js";

/** Map a legacy tool-ID-keyed preset entry to the matching element
 *  key. `"shape"` → `"shape.rect"` (the shape tool's fallback
 *  variant), `"arrow"` → `"arrow.end"`, etc. New-format keys that
 *  already contain "." pass through unchanged. */
export function migrateLegacyPresetKey(rawKey: string): string {
  if (rawKey.includes(".")) return rawKey;
  const group = TOOL_VARIANTS[rawKey];
  if (!group) return rawKey; // tools without variants (crop, highlight)
  return `${rawKey}.${group.fallback}`;
}

/** Compute the element key for an existing SVG element. Used by
 *  `syncPresetFromElement` so that rubber-band style propagation
 *  targets the RIGHT variant's preset — e.g. editing a rounded
 *  rectangle updates "shape.rounded" only, not "shape.rect". */
export function elementKeyFromElement(el: SVGElement, toolId: string): string {
  const group = TOOL_VARIANTS[toolId];
  if (!group) return toolId;
  let variant: string | null = null;
  switch (toolId) {
    case "shape": {
      if (el.tagName === "ellipse") variant = "ellipse";
      else if (el.tagName === "rect") {
        if (el.getAttribute("data-highlight") === "1") variant = "highlight";
        else if (el.hasAttribute("data-rounded")) variant = "rounded";
        else variant = "rect";
      }
      break;
    }
    case "arrow": {
      const headS = el.getAttribute("data-arrow-start-shape");
      const headE = el.getAttribute("data-arrow-end-shape");
      const hasStart = headS && headS !== "none";
      const hasEnd = headE && headE !== "none";
      variant = hasStart && hasEnd ? "both" : hasEnd || hasStart ? "end" : "none";
      break;
    }
    case "text":
      variant = el.getAttribute("data-text-variant");
      break;
    case "freehand":
      variant = el.getAttribute("data-draw-style");
      break;
    case "marker":
      variant = el.getAttribute("data-shape");
      break;
    case "redact":
      variant = el.getAttribute("data-redact-style");
      break;
    case "highlight": {
      // Highlight's variant is the fill color itself, stored on the
      // <rect> as `fill`. Normalized to lowercase so "#FFE100" and
      // "#ffe100" collapse to the same preset bucket.
      const fill = el.getAttribute("fill");
      variant = fill ? fill.toLowerCase() : null;
      break;
    }
  }
  return variant ? `${toolId}.${variant}` : `${toolId}.${group.fallback}`;
}

/**
 * After a variant switch, fix up the side-fields on `preset` so the
 * new variant's invariants hold. Today only `arrow` needs this:
 * - `none`: both ends must be "none".
 * - `end`: begin must be "none", end must be non-"none" (default tri).
 * - `both`: both ends must be non-"none" (default tri).
 *
 * Mutates `preset` in place; safe to call for tools without a
 * relevant invariant (it's a no-op).
 */
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

/** Build a fresh preset from the current style attributes of an
 *  existing element. Used when a target variant has no saved preset
 *  yet — the new preset inherits the element's current look so
 *  variant conversion doesn't surprise the user with unrelated
 *  defaults. `liveOptions` is the tool's currently-active
 *  ToolOptions reference (used as the seed before element-specific
 *  attrs are layered on top). */
export function seedPresetFromElement(
  el: SVGElement,
  toolId: string,
  elementKey: string,
  liveOptions: ToolOptions,
): ToolOptions {
  // Start from the tool's live options (reflecting whatever the
  // tool was last configured with), then layer element-specific
  // style attrs on top.
  const seed: ToolOptions = { ...liveOptions };
  const stroke = el.getAttribute("stroke");
  if (stroke) seed.strokeColor = stroke;
  const fill = el.getAttribute("fill");
  if (fill) seed.fillColor = fill;
  const sw = Number.parseFloat(el.getAttribute("stroke-width") || "");
  if (Number.isFinite(sw) && sw > 0) seed.strokeWidth = sw;
  const da = el.getAttribute("data-dash-key") ?? el.getAttribute("stroke-dasharray");
  if (da != null) seed.strokeDasharray = da;
  const fo = Number.parseFloat(el.getAttribute("fill-opacity") || "");
  if (Number.isFinite(fo)) seed.fillOpacity = fo;
  // Ensure the variant-defining field matches this element's variant.
  const group = TOOL_VARIANTS[toolId];
  if (group && elementKey.includes(".")) {
    const variant = elementKey.slice(elementKey.indexOf(".") + 1);
    (seed as unknown as Record<string, unknown>)[group.field as string] = variant;
    normalizeVariantSideFields(toolId, variant, seed);
  }
  return seed;
}

/** Write the "style" fields of a preset (color / width / dash /
 *  opacity / linecap / linejoin) onto an existing element.
 *  Deliberately does NOT touch fields that define the element's
 *  type/variant (shapeType, arrowHead, textVariant, etc.) because
 *  those were already established by the variant-change path that
 *  invoked this helper.
 *
 *  Some tools store their "color" on a child element rather than
 *  the outer wrapper `<g>` (marker: bg primitive's `fill`; text:
 *  `<text>`'s `fill`). For those cases we dispatch to a tool-
 *  specific helper instead of writing stroke/fill directly to `el`. */
export function applyPresetStyleAttrs(el: SVGElement, preset: ToolOptions): void {
  // Tool-specific style application for composite elements.
  if (el.tagName === "g" && el.hasAttribute("data-marker")) {
    applyMarkerPresetStyle(el, preset);
    return;
  }
  if (el.tagName === "g" && el.getAttribute("data-type") === "textbox") {
    applyTextboxPresetStyle(el, preset);
    return;
  }
  // Highlight rects: the visual color is `highlightColor`, NOT
  // `fillColor`. ShapeTool's createShape uses `highlightColor` for
  // the rect's `fill` attribute (and leaves `fillColor` untouched,
  // since `fillColor` tracks the Shape tool's filled-rect color).
  // Without this branch, loading a Highlight preset whose
  // `fillColor` was inherited from global defaults (e.g. "#ffffff")
  // would overwrite the element's highlight color with white,
  // making the rect effectively invisible. Route fill through
  // `highlightColor` to mirror ShapeTool's creation logic.
  if (el.tagName === "rect" && el.getAttribute("data-highlight") === "1") {
    if (preset.highlightColor) el.setAttribute("fill", preset.highlightColor);
    if (preset.fillOpacity != null) {
      el.setAttribute("fill-opacity", String(preset.fillOpacity));
    }
    return;
  }

  // Generic path for shape / arrow / path / line / etc.
  if (preset.strokeColor) el.setAttribute("stroke", preset.strokeColor);
  if (preset.strokeWidth != null) {
    el.setAttribute("stroke-width", String(preset.strokeWidth));
  }
  if (preset.strokeDasharray != null) {
    el.setAttribute(
      "stroke-dasharray",
      computeDasharray(preset.strokeDasharray, preset.strokeWidth),
    );
    el.setAttribute("data-dash-key", preset.strokeDasharray);
  }
  if (preset.fillColor) el.setAttribute("fill", preset.fillColor);
  if (preset.fillOpacity != null) {
    el.setAttribute("fill-opacity", String(preset.fillOpacity));
  }
  if (preset.strokeLinecap) {
    el.setAttribute("stroke-linecap", preset.strokeLinecap);
  }
  if (preset.strokeLinejoin) {
    el.setAttribute("stroke-linejoin", preset.strokeLinejoin);
  }
  if (preset.strokeOpacity != null) {
    // Lines carry transparency via `opacity` so markers fade too;
    // other shapes use `stroke-opacity`. Mirror the same rule as
    // syncPresetFromElement's reader.
    if (
      el.tagName === "line" ||
      (el.tagName === "g" && el.getAttribute("data-type") === "arrow")
    ) {
      el.setAttribute("opacity", String(preset.strokeOpacity));
    } else {
      el.setAttribute("stroke-opacity", String(preset.strokeOpacity));
    }
  }
  // Arrow groups: the head <path>'s `fill` attribute was set
  // explicitly at refreshArrowPath time from the `<g>`'s stroke
  // color. Since we just changed the stroke color, the head's
  // fill is stale — refresh to re-derive it from the new stroke.
  if (el.tagName === "g" && el.getAttribute("data-type") === "arrow") {
    refreshArrowPath(el);
  }
}

/** Marker/counter preset application. Standard semantics (P3-8
 *  refactor): `fillColor` = bg interior, `strokeColor` = bg border.
 *  Back-compat: if the preset predates the refactor (has
 *  `strokeColor` but no `fillColor`), treat strokeColor as the bg
 *  fill AND use legacy `markerBorder*` fields for border attrs. */
export function applyMarkerPresetStyle(g: SVGElement, preset: ToolOptions): void {
  const bg = g.querySelector("circle, rect");
  if (!bg) return;
  const legacy = !preset.fillColor && !!preset.strokeColor;
  // --- bg fill ---
  const fill = legacy ? preset.strokeColor : preset.fillColor;
  if (fill) bg.setAttribute("fill", fill);
  // --- bg border ---
  const borderColor = legacy ? preset.markerBorderColor : preset.strokeColor;
  if (borderColor) bg.setAttribute("stroke", borderColor);
  const borderWidth = legacy ? preset.markerBorderWidth : preset.strokeWidth;
  if (borderWidth != null) bg.setAttribute("stroke-width", String(borderWidth));
  const borderDashKey = legacy ? preset.markerBorderDasharray : preset.strokeDasharray;
  if (borderDashKey != null) {
    const w = borderWidth ?? Number.parseFloat(bg.getAttribute("stroke-width") || "1.5");
    bg.setAttribute("stroke-dasharray", computeDasharray(borderDashKey, w));
    bg.setAttribute("data-dash-key", borderDashKey);
  }
  if (preset.fontSize != null) {
    const text = g.querySelector("text");
    if (text) text.setAttribute("font-size", String(preset.fontSize));
  }
}

/** Textbox preset application: text color is the `<text>` child's
 *  `fill` (TextTool's convention); font family / size also live on
 *  the `<text>`. The bg `<rect>` (for sticky / callout variants)
 *  derives its color from the text color via `stickyBgFor` at
 *  rebuild time — here we just update the data-color attr + text
 *  fill; a full rebuild happens elsewhere if needed. */
export function applyTextboxPresetStyle(g: SVGElement, preset: ToolOptions): void {
  if (preset.strokeColor) {
    g.setAttribute("data-color", preset.strokeColor);
    const text = g.querySelector("text");
    if (text) text.setAttribute("fill", preset.strokeColor);
  }
  if (preset.fontFamily) {
    g.setAttribute("data-font-family", preset.fontFamily);
    const text = g.querySelector("text");
    if (text) text.setAttribute("font-family", preset.fontFamily);
  }
  if (preset.fontSize != null) {
    const text = g.querySelector("text");
    if (text) text.setAttribute("font-size", String(preset.fontSize));
  }
}
