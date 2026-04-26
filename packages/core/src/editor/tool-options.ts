/**
 * Pure type / interface definitions for the editor's tool layer.
 * Moved out of `tools/tool-base.ts` (now in
 * `@ingcreators/annot-editor`) as part of Phase 2 of
 * `docs/plans/three-package-split.md` — these types are shared
 * between the editor (which contains the runtime `ToolBase`
 * class + concrete tool classes) and the rest of `core/editor`
 * (PropertyPanel was a temporary dependent; the helpers in
 * `gradient-utils`, `redact-utils`, `shape-utils`, `text-utils`,
 * `property-controls`, `property-panel-helpers` continue to read
 * variant strings out of these types).
 *
 * Lives in core/editor (Tier B subpath) because consumers run
 * under jsdom for tests and the types are used at the SVG
 * element manipulation layer.
 */

export type ShapeType = "rect" | "rounded" | "ellipse" | "highlight";

/** Shape preset for the Counter (Marker) tool. Shared vocabulary
 *  with ShapeType so users see the same "rect / rounded / circle"
 *  mental model across tools. */
export type MarkerShape = "circle" | "rect" | "rounded";
export type ArrowHead = "none" | "end" | "both";
export type TextVariant = "plain" | "sticky" | "callout";
export type DrawStyle = "pen" | "highlighter";
export type RedactStyle = "mosaic" | "solid" | "blur";

/** Arrow head shapes (per endpoint). Matches PowerPoint's line panel
 *  exactly — the six OOXML preset types defined in the ECMA-376
 *  standard:
 *    none     — no marker
 *    arrow    — open / outline triangle
 *    triangle — filled triangle
 *    stealth  — narrow filled angular arrow
 *    diamond  — filled diamond
 *    oval     — filled circle / oval
 *  Markers live in <defs> with id `anno-{shape}-w{width}-l{length}`.
 *  Legacy values ("triangle-open", "tbar", "reverse") are accepted on
 *  read and remapped to the closest OOXML preset. */
export type ArrowShape = "none" | "arrow" | "triangle" | "stealth" | "diamond" | "oval";

/** Per-dimension size preset — matches OOXML's `w` / `len` attribute
 *  granularity (sm / med / lg). Width is perpendicular to the stem,
 *  length is along the stem. */
export type ArrowDim = "sm" | "md" | "lg";

export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

/** A single gradient stop — color + 0..1 position along the gradient,
 *  optional transparency. The 2-stop case covers the common PowerPoint
 *  "fade from A to B" workflow; 3+ stops render fine too. */
export interface GradientStop {
  color: string;
  offset: number; // 0.0 .. 1.0
  opacity?: number; // 0.0 .. 1.0, default 1
}

/** Linear-gradient stroke descriptor. When set on an element, the
 *  serializer emits a <linearGradient> into the SVG defs and references
 *  it via `stroke="url(#...)"`. */
export interface GradientSpec {
  type: "linear";
  stops: GradientStop[];
  /** Direction in degrees (0 = left→right, 90 = top→bottom, etc). */
  angle: number;
}

export interface ToolOptions {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  strokeDasharray: string; // "" = solid, "dash", "dot", "dashDot", "lgDash"
  fillOpacity: number; // 0.0 - 1.0
  /** Subtype for the unified Shape tool ("rect" / "rounded" / "ellipse").
   *  Ignored by tools that don't have a shape-family choice. */
  shapeType?: ShapeType;
  /** Head configuration for the unified Line/Arrow tool.
   *    "none" = plain line, "end" = arrow at endpoint (default),
   *    "both" = bi-directional arrow. Ignored by non-line tools. */
  arrowHead?: ArrowHead;
  /** Variant for the unified Text tool.
   *    "plain"   = text only (no background)
   *    "sticky"  = text with colored background (default, classic sticky note)
   *    "callout" = text with pointer tail (speech-bubble-like) */
  textVariant?: TextVariant;
  /** Font family CSS value for the Text tool. Defaults to "sans-serif"
   *  when not specified. Stored on the textbox as `data-font-family`
   *  so it survives save / reopen / Office paste. */
  fontFamily?: string;
  /** Style for the Draw tool: normal pen vs highlighter. */
  drawStyle?: DrawStyle;
  /** Style for the unified Redact tool. */
  redactStyle?: RedactStyle;

  // ---- PowerPoint-equivalent line polish ----

  /** Per-end arrow head shapes. When set, override the simpler
   *  `arrowHead` (which only distinguishes none / end / both). */
  arrowHeadStart?: ArrowShape;
  arrowHeadEnd?: ArrowShape;
  /** Per-end arrow widths (perpendicular to stem) — sm / md / lg. */
  arrowWidthStart?: ArrowDim;
  arrowWidthEnd?: ArrowDim;
  /** Per-end arrow lengths (along stem) — sm / md / lg. */
  arrowLengthStart?: ArrowDim;
  arrowLengthEnd?: ArrowDim;
  /** **Deprecated, read-only back-compat.** Single-enum per-end size
   *  saved by versions that pre-date the width/length split. Newly-
   *  saved presets do NOT populate these fields. `ArrowTool` reads
   *  them as a fallback when both `arrowWidthStart` /
   *  `arrowLengthStart` (resp. `*End`) are absent. The preset
   *  serializer keeps an entry in `FIELD_TO_SNAKE` (`arrow_size_*`)
   *  so disk files written by old versions still load cleanly. */
  arrowSizeStart?: ArrowDim;
  arrowSizeEnd?: ArrowDim;

  /** Stroke opacity (0..1). Separate from fill-opacity. */
  strokeOpacity?: number;

  /** SVG stroke-linecap: butt / round / square. */
  strokeLinecap?: LineCap;

  /** SVG stroke-linejoin for shapes with corners (rect, path). */
  strokeLinejoin?: LineJoin;

  /** Optional gradient override for stroke. */
  strokeGradient?: GradientSpec;

  /** Optional gradient override for fill. */
  fillGradient?: GradientSpec;

  /** Color for the Highlight shape variant. */
  highlightColor?: string;

  /** Shape variant for the Counter (Marker) tool. */
  markerShape?: MarkerShape;
}
