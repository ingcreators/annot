/**
 * Tier B — single source of truth for the toolbar's "universal
 * style attribute writer". Inverse of `tool-style-reader.ts`'s
 * `readUniversalStyleAttrs`: takes a preset's stroke / fill /
 * stroke-width / dasharray / fill-opacity / linecap / linejoin /
 * stroke-opacity fields and writes them onto an Element so a
 * subsequent rubber-band read recovers the same values.
 *
 * Pure: takes an Element + a preset, mutates the Element in place.
 * No DOM globals, no `Toolbar` access — jsdom-friendly.
 *
 * Phase 1 of `docs/plans/toolbar-apply-style-to-element.md`. The
 * helper is exported so per-tool `applyStyleToElement` callbacks
 * (Phase 2) can opt into it: shape / arrow / freehand / redact-
 * solid all funnel through this universal path before adding any
 * tool-specific extras (arrow's `refreshArrowPath` regen,
 * marker's bg-primitive walk, textbox's `<text>` child write).
 */

import { computeDasharray } from "../utils/dash-utils.js";
import type { ToolOptions } from "./tool-options.js";

/**
 * Write the universal style attributes from `preset` onto `el`.
 * Field coverage mirrors `readUniversalStyleAttrs`:
 *
 *   - `strokeColor`        → `stroke`
 *   - `strokeWidth`        → `stroke-width`
 *   - `strokeDasharray`    → `stroke-dasharray` (numeric, via
 *                            {@link computeDasharray}) AND
 *                            `data-dash-key` (canonical key) so
 *                            a subsequent read round-trips
 *   - `fillColor`          → `fill`
 *   - `fillOpacity`        → `fill-opacity`
 *   - `strokeLinecap`      → `stroke-linecap`
 *   - `strokeLinejoin`     → `stroke-linejoin`
 *   - `strokeOpacity`      → `opacity` for `<line>` / arrow `<g>`
 *                            (so SVG-marker arrowheads fade with
 *                            the stem); `stroke-opacity` for
 *                            everything else. Mirrors the read-
 *                            side rule in `readUniversalStyleAttrs`.
 *
 * Tool-specific extras (text font + variant on a child `<text>`,
 * marker's bg primitive walk, arrow's `refreshArrowPath` regen,
 * highlight's `fillColor → fill` routing) are handled by the
 * registry's `applyStyleToElement` callbacks and intentionally
 * NOT covered here — keep this helper toolId-agnostic.
 *
 * Each branch is gated on the matching field being present so a
 * partially-populated preset doesn't clobber attributes the user
 * hasn't set. Mirrors the conditionals in the legacy
 * `applyPresetStyleAttrs` generic path.
 */
export function writeUniversalStyleAttrs(el: SVGElement, preset: ToolOptions): void {
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
    if (el.tagName === "line" || (el.tagName === "g" && el.getAttribute("data-type") === "arrow")) {
      el.setAttribute("opacity", String(preset.strokeOpacity));
    } else {
      el.setAttribute("stroke-opacity", String(preset.strokeOpacity));
    }
  }
}
