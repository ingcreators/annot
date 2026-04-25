/**
 * Inline-SVG icon catalogues + highlight-color presets shared
 * between the toolbar (in `@ingcreators/annot-web`) and core's
 * `PropertyPanel`. Extracted out of `toolbar.ts` as part of
 * Phase 5a of `docs/plans/lit-migration.md` so the Toolbar
 * class could relocate to web without dragging core's
 * PropertyPanel into the cross-package import.
 *
 * These are pure data: ASCII strings + arrays + a tiny string
 * lookup helper. No DOM access, no listeners, no globals.
 */

/** Inline SVG icons for the Shape tool's variants — rendered
 *  as outline strokes so the chip glyphs read as "what shape
 *  type" without implying any fill color.
 *
 *  Why hand-rolled: the Material Symbols `rectangle` /
 *  `square` ligatures are visually IDENTICAL at 36px button
 *  scale. `crop_square` (rounded outline) and `square` (sharp
 *  outline) both render as a square outline in 36px buttons —
 *  the difference (slight vs. no corner radius) is
 *  imperceptible. Authoring inline SVG with EXAGGERATED corner
 *  radius (rx/ry ≈ 1/3 of the side) makes the distinction
 *  clear, matching what PowerPoint / Google Slides / Keynote /
 *  Miro all do. */
export const SHAPE_ICON_SVG = {
  /** Sharp-cornered rectangle outline. Stroke weight tuned to
   *  match the optical weight of adjacent Material-Symbols
   *  outlined icons. */
  rect: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/></svg>`,
  /** Rounded rectangle with rx=5 on a 16-wide square (≈ 31% —
   *  above the 20% threshold where humans reliably perceive
   *  corner rounding at icon scale). */
  rounded: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"/></svg>`,
  /** Ellipse / circle outline. Drawn as an <ellipse> with rx=ry
   *  so it's perfectly circular; using <ellipse> rather than
   *  <circle> keeps a single element type if future variants
   *  (e.g. wide ellipse) need different rx/ry. Stroke-width
   *  matches rect / rounded so the three chips look optically
   *  equal. */
  ellipse: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="12" rx="8" ry="8"/></svg>`,
} as const;

/** Inline SVG icons for the Arrow tool's head variants.
 *  Material Symbols has no icon that accurately depicts a
 *  single line with arrowheads on both ends (`sync_alt` shows
 *  TWO parallel lines in opposite directions, which is not the
 *  same thing). Hand-rolling the three glyphs as a unified set
 *  — same line length, same stroke weight, only the arrowheads
 *  change — makes the "this is the same line with different
 *  ends" narrative visually obvious. */
export const ARROW_ICON_SVG = {
  /** Plain horizontal line, no arrowheads. */
  none: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12 H20"/></svg>`,
  /** Single arrowhead at the right end ("end" variant). */
  end: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12 H20"/><path d="M16 8 L20 12 L16 16"/></svg>`,
  /** Arrowheads at BOTH ends ("both" variant). */
  both: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12 H20"/><path d="M16 8 L20 12 L16 16"/><path d="M8 8 L4 12 L8 16"/></svg>`,
} as const;

/** Inline SVG icons for the Counter (marker) shape variants —
 *  each glyph shows the container shape filled with
 *  `currentColor` and a "1" cut out to represent the numeric
 *  label. The cutout uses fill-rule="evenodd" so the "1" reads
 *  as the panel background showing through, automatically
 *  adapting to light / dark themes without hard-coded colors. */
export const COUNTER_ICON_SVG = {
  circle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="12" rx="8" ry="8"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text></svg>`,
  rect: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text></svg>`,
  rounded: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text></svg>`,
} as const;

/** Preset highlight colors — matches common PDF / PowerPoint
 *  highlighter pen sets. The user can pick any of these from
 *  the Highlight tool's color-swatch flyout; the chosen color
 *  is persisted via the preset system so the next click on the
 *  Highlight button uses it again. */
export const HIGHLIGHT_COLORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#ffe100", label: "Yellow" },
  { value: "#7bff7b", label: "Green" },
  { value: "#ff91e0", label: "Pink" },
  { value: "#7be0ff", label: "Blue" },
  { value: "#ffb84c", label: "Orange" },
  { value: "#c991ff", label: "Purple" },
];

/** Map a highlight fill hex (case-insensitive) to its palette
 *  label. Used by the right-panel selection title ("Selected
 *  Highlight (Yellow)") and by the Type-picker swatch tooltips.
 *  Falls back to the hex string itself for colors outside the
 *  preset palette (e.g. legacy documents with custom
 *  highlightColor values). */
export function highlightColorLabel(fill: string | null | undefined): string {
  const lc = (fill || "").toLowerCase();
  return HIGHLIGHT_COLORS.find((c) => c.value === lc)?.label ?? (fill || "");
}
