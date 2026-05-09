/**
 * Per-tool initial presets seeded into the toolbar's `#presets`
 * map at construction time. These are the "first-time use" defaults
 * users see before they've tweaked anything; they live HERE rather
 * than as `ToolOptions` globals because the global defaults can't
 * express per-tool semantics (a counter's filled badge has different
 * needs from an arrow's stroke).
 *
 * Pulled into its own module so it can be unit-tested without
 * standing up a `Toolbar`. Pure: no DOM, no `CanvasManager`, no
 * `History`. Tier C-friendly (it imports `TOOL_REGISTRY` for the
 * variant defaults but doesn't touch any browser globals).
 *
 * The seeded values are screenshot-annotation-tuned. See the
 * 2026-04-30 review against `annot_designer_annotation_template.pptx`
 * for the rationale; in short:
 *
 *   - **arrow.end** — `strokeLinecap: "round"` softens the line ends
 *     vs. SVG's default `butt`. Less CAD-like.
 *
 *   - **freehand.pen** — `strokeLinecap: "round"` for the same
 *     reason. Matches what most users expect from a "pen" tool.
 *
 *   - **freehand.highlighter** — explicit highlighter semantics
 *     (yellow, wider, semi-transparent, `linecap: "butt"`). Without
 *     this seed, switching from pen to highlighter produced an
 *     opaque red 3 px line — indistinguishable from pen.
 *
 *   - **marker.<default>** — `fillColor: "#ff0000"` + explicit
 *     white border. Fixes a real bug: the global default
 *     `fillColor: "none"` is truthy, so the
 *     `this.options.fillColor || "#ff0000"` fallback in
 *     `marker-tool.ts` does NOT fire — the counter background
 *     paints with `fill="none"` and the badge is invisible. The
 *     paired defensive guard in `marker-tool.ts` handles legacy
 *     stored presets that already have `"none"`.
 *
 *   - **text.<all variants>** — `strokeColor: "#1a1a1a"` (TextTool
 *     uses stroke as the text fill). Red text on yellow sticky-note
 *     background was a legibility hit; dark grey reads cleanly on
 *     all three variants (plain, sticky, callout).
 *
 *   - **highlight.<default>** — yellow + 0.4 opacity + no stroke.
 *     Pre-existing behaviour, preserved here so all of the toolbar's
 *     first-time seeds live in one place.
 */

import { HIGHLIGHT_COLORS, TOOL_REGISTRY } from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";

/** Build the per-tool initial preset map keyed by `${toolId}.${variant}`
 *  (or just `${toolId}` for variant-less tools). The map is consumed by
 *  `Toolbar`'s constructor — every entry it contains takes precedence
 *  over the global `#options` for that key on first use.
 *
 *  Pure function: same input → same output, no side effects. */
export function buildInitialPresets(globalDefaults: ToolOptions): Map<string, ToolOptions> {
  const presets = new Map<string, ToolOptions>();

  // ───── Highlight ─────────────────────────────────────────────
  // Highlight's variant IS its fill hex (palette entry). Yellow
  // first; 0.4 opacity matches PDF / PowerPoint highlighter
  // convention. No stroke — highlighter rects don't have outlines.
  // Without this seed the first click on Highlight would pick up
  // whatever fillColor the global default carries (= the user's
  // last Rect fill on subsequent uses) and look like a normal
  // filled rect, not a highlighter.
  const defaultHighlightColor = TOOL_REGISTRY.highlight!.defaultVariant!;
  presets.set(`highlight.${defaultHighlightColor}`, {
    ...globalDefaults,
    shapeType: "highlight",
    highlightColor: defaultHighlightColor,
    fillOpacity: 0.4,
    strokeColor: "none",
    strokeWidth: 0,
  });

  // ───── Marker (Counter badge) ────────────────────────────────
  // Step-number badge: red interior + white border + bold "1" in
  // white. Without this seed the inherited global `fillColor: "none"`
  // makes the badge invisible (the `||` fallback in marker-tool.ts
  // doesn't kick in for the truthy string "none"). White border
  // overrides the global red stroke so the badge reads cleanly
  // against any background — matching the visual the marker tool's
  // own constructor comment ("classic white 1.5 pt ring") aimed for.
  const defaultMarkerVariant = TOOL_REGISTRY.marker!.defaultVariant!;
  presets.set(`marker.${defaultMarkerVariant}`, {
    ...globalDefaults,
    fillColor: "#ff0000",
    strokeColor: "#ffffff",
    strokeWidth: 1.5,
    markerShape: defaultMarkerVariant as ToolOptions["markerShape"],
  });

  // ───── Arrow (single-arrow default) ──────────────────────────
  // Round linecap softens the line ends. Per-end arrow heads pick
  // up their defaults from `normalizeVariantSideFields` when the
  // user switches between line / arrow / double-arrow variants;
  // we only need to seed the default variant here.
  const defaultArrowVariant = TOOL_REGISTRY.arrow!.defaultVariant!;
  presets.set(`arrow.${defaultArrowVariant}`, {
    ...globalDefaults,
    strokeLinecap: "round",
    arrowHead: defaultArrowVariant as ToolOptions["arrowHead"],
  });

  // ───── Freehand (pen default) ────────────────────────────────
  // Round linecap for a pen-like feel. Same red 3 px stroke as the
  // global default — the only delta vs. globals is the linecap.
  const defaultFreehandVariant = TOOL_REGISTRY.freehand!.defaultVariant!;
  presets.set(`freehand.${defaultFreehandVariant}`, {
    ...globalDefaults,
    strokeLinecap: "round",
    drawStyle: defaultFreehandVariant as ToolOptions["drawStyle"],
  });

  // ───── Freehand (highlighter alternative) ────────────────────
  // Distinct from pen: yellow, wide stroke, semi-transparent, butt
  // linecap (real highlighter pens leave squared-off ends — round
  // would smear into adjacent letters). Without this seed, switching
  // from pen → highlighter inherits the pen's red 3 px solid stroke
  // and the result is indistinguishable from the pen variant.
  presets.set("freehand.highlighter", {
    ...globalDefaults,
    strokeColor: HIGHLIGHT_COLORS[0]!.value,
    strokeWidth: 16,
    strokeOpacity: 0.4,
    strokeLinecap: "butt",
    drawStyle: "highlighter",
  });

  // ───── Text (all three variants) ─────────────────────────────
  // TextTool treats `strokeColor` as the text fill (not the stroke
  // around glyphs). Red text on a yellow sticky note background
  // is a legibility hit; near-black is the standard for screenshot
  // annotation captions and matches the visual of most reference
  // products (Skitch, Snagit, CleanShot). 20 px is a tighter caption
  // size than the global 24 px default — small enough that two
  // lines of explanation fit on a typical screenshot region.
  presets.set("text.plain", {
    ...globalDefaults,
    strokeColor: "#1a1a1a",
    fontSize: 20,
    textVariant: "plain",
  });
  presets.set("text.sticky", {
    ...globalDefaults,
    strokeColor: "#1a1a1a",
    fontSize: 20,
    textVariant: "sticky",
  });
  presets.set("text.callout", {
    ...globalDefaults,
    strokeColor: "#1a1a1a",
    fontSize: 20,
    textVariant: "callout",
  });

  // ───── (Tools without an opinionated seed) ───────────────────
  // shape.* — global defaults already produce the right visual
  //   (red outline, no fill). No override needed.
  // redact.* — mosaic / blur don't use color fields; redact.solid
  //   has its own `REDACT_SOLID_COLOR` fallback in redact-tool.ts.
  // crop — no canvas state.

  return presets;
}
