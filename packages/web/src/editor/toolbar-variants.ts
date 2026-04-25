/**
 * Tool-variant catalogue + element → tool mapping for the editor
 * toolbar. Pure data + a single pure function — no DOM access, no
 * `Toolbar`-instance state.
 *
 * Extracted from `toolbar.ts` as Stage 3a-1 of
 * `docs/plans/pre-release-cleanup.md` to start whittling that file
 * down from its 3.5k-line god-module shape. Subsequent steps split
 * out the property-panel renderer, the preset manager, the save menu,
 * and the context-menu builders.
 */

import {
  ARROW_ICON_SVG,
  COUNTER_ICON_SVG,
  HIGHLIGHT_COLORS,
  SHAPE_ICON_SVG,
} from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import type { ToolBase } from "@ingcreators/annot-editor";

export interface ToolDef {
  label: string;
  icon: string;
  factory: (opts: ToolOptions) => ToolBase;
}

/** Variant metadata for a tool that has a compact flyout picker. Each
 *  entry describes one "sub-shape" the user can pick from the toolbar
 *  dropdown. The icon is also used on the parent button so users see
 *  AT A GLANCE which variant a subsequent click will create — the
 *  pattern Figma / PowerPoint use for sticky-tool flyouts. */
export interface ToolVariant {
  /** ToolOptions field value ("rect" | "end" | "sticky" | …). */
  value: string;
  /** Material Symbols ligature name. Used when `svg` is not provided —
   *  the container renders this as text with the
   *  `material-symbols-outlined` class. */
  icon: string;
  label: string;
  /** Optional inline SVG markup. When present, takes precedence over
   *  `icon` — the container's innerHTML is set to this string instead
   *  of rendering the ligature glyph. Used for variants where Material
   *  Symbols don't provide enough visual distinction at small sizes —
   *  the canonical case is rect vs rounded-rect, which look nearly
   *  identical in the generic icon font. The SVG should:
   *    - use `viewBox="0 0 24 24"` (same unit system as Material
   *      Symbols, so relative scaling stays consistent)
   *    - omit explicit width/height so CSS (`.tool-flyout-chip svg`
   *      and `.tool-btn-badge svg`) can size it per-context
   *    - use `stroke="currentColor"` and `fill="none"` to match the
   *      outlined Material-Symbols visual weight. */
  svg?: string;
}

export interface ToolVariantGroup {
  /** Which ToolOptions field selects the variant. */
  field: keyof ToolOptions;
  variants: ToolVariant[];
  /** Default variant when no preset exists. */
  fallback: string;
}

/** Default highlight color — first palette entry. Used when no preset
 *  has been saved yet (first-time launch of the Highlight tool). */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0]!.value;

export const TOOL_VARIANTS: Record<string, ToolVariantGroup> = {
  shape: {
    field: "shapeType",
    fallback: "rect",
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
  },
  arrow: {
    field: "arrowHead",
    fallback: "end",
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
  },
  text: {
    field: "textVariant",
    fallback: "sticky",
    variants: [
      { value: "plain", icon: "text_fields", label: "Plain text" },
      { value: "sticky", icon: "sticky_note_2", label: "Sticky note" },
      { value: "callout", icon: "chat_bubble", label: "Callout" },
    ],
  },
  freehand: {
    field: "drawStyle",
    fallback: "pen",
    variants: [
      { value: "pen", icon: "edit", label: "Pen" },
      { value: "highlighter", icon: "ink_highlighter", label: "Highlighter" },
    ],
  },
  redact: {
    field: "redactStyle",
    fallback: "mosaic",
    variants: [
      { value: "mosaic", icon: "grid_view", label: "Mosaic (pixelate)" },
      { value: "solid", icon: "check_box", label: "Solid bar" },
      { value: "blur", icon: "blur_on", label: "Blur" },
    ],
  },
  marker: {
    field: "markerShape",
    fallback: "circle",
    variants: [
      // All three glyphs are filled-shape-with-"1" so the variant
      // chip previews match what the tool actually produces. Plain
      // Material-Symbols ligatures (outline-only square / circle)
      // would under-represent the filled + numbered character of a
      // counter marker.
      { value: "circle", icon: "circle", label: "Circle", svg: COUNTER_ICON_SVG.circle },
      { value: "rect", icon: "square", label: "Square", svg: COUNTER_ICON_SVG.rect },
      {
        value: "rounded",
        icon: "crop_square",
        label: "Rounded square",
        svg: COUNTER_ICON_SVG.rounded,
      },
    ],
  },
  // Highlight's "variant" is its color — each palette entry gets its
  // own preset so users can keep a different transparency per color
  // (e.g. yellow at 60% but red at 40%). The `value` is the fill
  // hex; the toolbar uses it for the element key and the swatch chips.
  highlight: {
    field: "highlightColor",
    fallback: HIGHLIGHT_COLORS[0]!.value,
    variants: HIGHLIGHT_COLORS.map((c) => ({
      value: c.value,
      icon: "ink_highlighter",
      label: c.label,
    })),
  },
};

/**
 * Map an annotation element back to the toolbar id that creates it.
 * Used for rubber-band style propagation — when the user edits an
 * existing shape, we want to know which tool's preset should absorb
 * that change. Returns null for elements the toolbar doesn't own.
 */
export function toolIdForElement(el: SVGElement): string | null {
  const tag = el.tagName;
  if (tag === "line") return "arrow";
  // Redact's `solid` variant is a plain <rect>, distinguished from a
  // shape rect by the data-redact-style marker.
  if (tag === "rect" && el.getAttribute("data-redact-style") === "solid") return "redact";
  // Highlight rects carry `data-highlight="1"` — checked before the
  // generic shape branch so rubber-band style propagation goes to
  // the Highlight tool's preset (not the Shape tool's).
  if (tag === "rect" && el.getAttribute("data-highlight") === "1") return "highlight";
  if (tag === "rect" || tag === "ellipse") return "shape";
  // Mosaic / blur redactions bake a PNG into an <image>.
  if (tag === "image") return "redact";
  if (tag === "path") return "freehand";
  if (tag === "text") return "text";
  if (tag === "g") {
    // Arrow groups (stem + head <path> children) share the ArrowTool preset.
    if (el.getAttribute("data-type") === "arrow") return "arrow";
    if (el.getAttribute("data-type") === "textbox") return "text";
    // Freehand groups bundle a session's strokes (each a <path> child).
    // Route back to the Draw tool's preset for rubber-band sync.
    if (el.getAttribute("data-type") === "freehand") return "freehand";
    if (el.getAttribute("data-type") === "group") return null;
    if (el.hasAttribute("data-marker")) return "marker";
  }
  return null;
}
