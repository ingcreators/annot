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

import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "./toolbar-icons.js";
import type { ToolOptions } from "./tool-options.js";

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
 *  per-end shape attributes. Mirrors `elementKeyFromElement`'s
 *  arrow branch verbatim. */
function arrowVariantFromAttrs(el: SVGElement): string {
  const headS = el.getAttribute("data-arrow-start-shape");
  const headE = el.getAttribute("data-arrow-end-shape");
  const hasStart = headS != null && headS !== "none";
  const hasEnd = headE != null && headE !== "none";
  if (hasStart && hasEnd) return "both";
  if (hasEnd || hasStart) return "end";
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
      //     variant's preset to update.
      //   - Per-end SHAPE / WIDTH / LENGTH values are preserved
      //     within the variant's constraints — the user's custom
      //     "Double arrow with start=diamond, end=oval" survives
      //     round-trips, because variant-switching clamps per-end
      //     into the valid range rather than fully resetting.
      const endShape = el.getAttribute("data-arrow-end-shape");
      const startShape = el.getAttribute("data-arrow-start-shape");
      const hEnd = endShape != null ? endShape !== "none" : !!el.getAttribute("marker-end");
      const hStart =
        startShape != null ? startShape !== "none" : !!el.getAttribute("marker-start");
      preset.arrowHead = hStart && hEnd ? "both" : hEnd ? "end" : hStart ? "end" : "none";
      // Per-end shape + width + length (PowerPoint-parity granular fields).
      const ss = el.getAttribute("data-arrow-start-shape");
      const es = el.getAttribute("data-arrow-end-shape");
      const sw =
        el.getAttribute("data-arrow-start-width") || el.getAttribute("data-arrow-start-size");
      const sl =
        el.getAttribute("data-arrow-start-length") || el.getAttribute("data-arrow-start-size");
      const ew =
        el.getAttribute("data-arrow-end-width") || el.getAttribute("data-arrow-end-size");
      const el_ =
        el.getAttribute("data-arrow-end-length") || el.getAttribute("data-arrow-end-size");
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
      if (preset.arrowHead) {
        normalizeVariantSideFields("arrow", preset.arrowHead, preset);
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
    // P3-8 refactor: marker uses standard color semantics —
    // `fillColor` = bg interior, `strokeColor` = bg border. The
    // legacy `markerBorder*` fields are kept off the array so new
    // saves don't carry them forward.
    presetFields: [
      ...UNIVERSAL_STROKE_FIELDS,
      "fillColor",
      "fontSize",
      "markerShape",
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
      // P3-8 refactor: marker uses STANDARD color semantics —
      // `fillColor` = bg interior, `strokeColor` = bg border. The
      // outer <g> has no stroke/fill attrs; we read both from the
      // bg primitive (<circle> / <rect>). Also scrub the legacy
      // `markerBorder*` fields so old presets don't linger and
      // shadow the new values on re-save.
      const bg = el.querySelector("circle, rect");
      const bgFill = bg?.getAttribute("fill");
      if (bgFill) preset.fillColor = bgFill;
      const bgStroke = bg?.getAttribute("stroke");
      if (bgStroke) preset.strokeColor = bgStroke;
      const bsw = Number.parseFloat(bg?.getAttribute("stroke-width") || "");
      if (Number.isFinite(bsw) && bsw >= 0) preset.strokeWidth = bsw;
      const bdash = bg?.getAttribute("data-dash-key") ?? bg?.getAttribute("stroke-dasharray");
      if (bdash != null) preset.strokeDasharray = bdash;
      delete (preset as Partial<ToolOptions>).markerBorderColor;
      delete (preset as Partial<ToolOptions>).markerBorderWidth;
      delete (preset as Partial<ToolOptions>).markerBorderDasharray;
      // Font size for the counter number — read from the <text>
      // child. Without this, changing font-size via the property
      // panel wouldn't stick.
      const tEl = el.tagName === "g" ? el.querySelector("text") : null;
      const fs = Number.parseFloat(tEl?.getAttribute("font-size") || "");
      if (Number.isFinite(fs) && fs > 0) preset.fontSize = fs;
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
