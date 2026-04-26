/**
 * Tier B — single source of truth for the toolbar's "universal
 * style attribute reader". Captures the stroke / fill / dasharray /
 * opacity / linecap / linejoin attribute reads that the toolbar's
 * rubber-band path (`Toolbar.syncPresetFromElement`) and the
 * variant-switch seed path (`seedPresetFromElement` in
 * `toolbar-preset-helpers.ts`) used to duplicate.
 *
 * Pure: takes an Element + a preset, mutates the preset in place.
 * No DOM globals, no `Toolbar` access — jsdom-friendly.
 *
 * The freehand-group → last-path-child fallback is encapsulated
 * here too: the outer `<g data-type="freehand">` carries no stroke
 * attrs of its own (the style lives on the child `<path>` elements),
 * so we read off the most recent stroke instead. Mirrors what the
 * old inline reader in `syncPresetFromElement` did for the same
 * case.
 */

import type { LineCap, LineJoin, ToolOptions } from "./tool-options.js";

/** Pick the element whose attributes should be read for the
 *  universal-style fields. For most elements that's `el` itself;
 *  for freehand session groups (`<g data-type="freehand">`) it's
 *  the LAST `<path>` child — the user's most recent stroke,
 *  which is the natural rubber-band source. Returns `el` unchanged
 *  when the freehand group has no path children yet (defensive). */
export function resolveStyleReadSource(el: SVGElement): SVGElement {
  if (el.tagName.toLowerCase() !== "g") return el;
  if (el.getAttribute("data-type") !== "freehand") return el;
  const pathChildren = el.querySelectorAll<SVGPathElement>(":scope > path");
  if (pathChildren.length === 0) return el;
  return pathChildren[pathChildren.length - 1]!;
}

/**
 * Read the universal style attributes off `el` (or its
 * freehand-group inner stroke) and write them onto `preset`. Field
 * coverage:
 *
 *   - `stroke`         → `strokeColor`
 *   - `fill`           → `fillColor`
 *   - `stroke-width`   → `strokeWidth` (only when finite + > 0)
 *   - `data-dash-key` ?? `stroke-dasharray` → `strokeDasharray`
 *     (`data-dash-key` wins when present, matching the priority the
 *      legacy readers settled on)
 *   - `fill-opacity`   → `fillOpacity` (only when finite)
 *   - `opacity` ?? `stroke-opacity` → `strokeOpacity` (only when
 *     finite). Lines / arrow `<g>`s carry transparency via
 *     `opacity` so SVG-marker arrowheads fade with the stem;
 *     other shapes use `stroke-opacity`. Reading both — preferring
 *     `opacity` — captures whichever is set.
 *   - `stroke-linecap` → `strokeLinecap` (whitelist butt/round/square)
 *   - `stroke-linejoin` → `strokeLinejoin` (whitelist
 *     miter/round/bevel)
 *
 * Tool-specific extras (text font, marker bg primitive, arrow
 * per-end state, highlight's `fill → highlightColor` routing) are
 * handled by the registry's `extractStyleFromElement` callbacks
 * and intentionally NOT covered here — keep this helper toolId-
 * agnostic.
 */
export function readUniversalStyleAttrs(el: SVGElement, preset: ToolOptions): void {
  const readEl = resolveStyleReadSource(el);

  const stroke = readEl.getAttribute("stroke");
  if (stroke) preset.strokeColor = stroke;

  const fill = readEl.getAttribute("fill");
  if (fill) preset.fillColor = fill;

  const sw = Number.parseFloat(readEl.getAttribute("stroke-width") || "");
  if (Number.isFinite(sw) && sw > 0) preset.strokeWidth = sw;

  // `data-dash-key` is the canonical preset key (e.g. "dash" /
  // "dot"); `stroke-dasharray` is the rendered numeric pattern.
  // Either presence is a signal — prefer the canonical key when
  // present so a downstream `computeDasharray(strokeDasharray,
  // strokeWidth)` round-trips cleanly.
  const dashKey = readEl.getAttribute("data-dash-key") ?? readEl.getAttribute("stroke-dasharray");
  if (dashKey != null) preset.strokeDasharray = dashKey;

  const fo = Number.parseFloat(readEl.getAttribute("fill-opacity") || "");
  if (Number.isFinite(fo)) preset.fillOpacity = fo;

  const so = Number.parseFloat(
    readEl.getAttribute("opacity") || readEl.getAttribute("stroke-opacity") || "",
  );
  if (Number.isFinite(so)) preset.strokeOpacity = so;

  const lc = readEl.getAttribute("stroke-linecap");
  if (lc === "butt" || lc === "round" || lc === "square") {
    preset.strokeLinecap = lc satisfies LineCap;
  }

  const lj = readEl.getAttribute("stroke-linejoin");
  if (lj === "miter" || lj === "round" || lj === "bevel") {
    preset.strokeLinejoin = lj satisfies LineJoin;
  }
}
