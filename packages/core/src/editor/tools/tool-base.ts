import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";

const SVG_NS = "http://www.w3.org/2000/svg";

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

/** Legacy single-enum size kept for backward compat with presets
 *  saved before width/length were split. Always treated as both width
 *  AND length set to the same value. */
export type MarkerSize = ArrowDim;

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
  /** Style for the Draw tool: normal pen vs highlighter.
   *    "pen"         = crisp opaque stroke, round caps (default)
   *    "highlighter" = thick semi-transparent stroke, flat caps */
  drawStyle?: DrawStyle;
  /** Style for the unified Redact tool.
   *    "mosaic" = block-averaged pixelation (default)
   *    "solid"  = opaque colored rectangle (fillColor / black)
   *    "blur"   = gaussian blur of the underlying image */
  redactStyle?: RedactStyle;

  // ---- PowerPoint-equivalent line polish ----

  /** Per-end arrow head shapes. When set, override the simpler
   *  `arrowHead` (which only distinguishes none / end / both). Start
   *  defaults to "none", end to "triangle" (the classic arrow). */
  arrowHeadStart?: ArrowShape;
  arrowHeadEnd?: ArrowShape;
  /** Per-end arrow widths (perpendicular to stem) — sm / md / lg. */
  arrowWidthStart?: ArrowDim;
  arrowWidthEnd?: ArrowDim;
  /** Per-end arrow lengths (along stem) — sm / md / lg. */
  arrowLengthStart?: ArrowDim;
  arrowLengthEnd?: ArrowDim;
  /** Legacy per-end size (used only when the split width/length
   *  options above are absent). Kept for back-compat with older
   *  saved presets and ingested SVGs. */
  arrowSizeStart?: MarkerSize;
  arrowSizeEnd?: MarkerSize;

  /** Stroke opacity (0..1). Separate from fill-opacity and from the
   *  drawStyle=highlighter alpha, so users can dial any line. */
  strokeOpacity?: number;

  /** SVG stroke-linecap: butt / round / square. Changes dash / open-
   *  end appearance. */
  strokeLinecap?: LineCap;

  /** SVG stroke-linejoin for shapes with corners (rect, path). */
  strokeLinejoin?: LineJoin;

  /** Optional gradient override for stroke. When set, supersedes
   *  `strokeColor` at render time — the tool builds a <linearGradient>
   *  in defs and references it via stroke="url(#id)". */
  strokeGradient?: GradientSpec;

  /** Optional gradient override for fill. Same shape as
   *  strokeGradient, applied to the fill attribute. */
  fillGradient?: GradientSpec;

  /** Color for the Highlight shape variant. Independent from
   *  `fillColor` so the user's choice of Rect fill doesn't bleed into
   *  their chosen highlighter color (and vice versa). Defaults to
   *  `#ffe100` (the classic yellow highlighter pen). */
  highlightColor?: string;

  /** Shape variant for the Counter (Marker) tool — circle / square /
   *  rounded square. Replaces the legacy convention of encoding the
   *  shape into `fillColor` ("rect" string), which conflated color
   *  and shape concepts. Older saved presets with `fillColor="rect"`
   *  are migrated on read in MarkerTool. */
  markerShape?: MarkerShape;

  /** Counter (Marker) border — an OPTIONAL ring drawn around the
   *  bg primitive (circle/rect). The marker preset convention uses
   *  `strokeColor` as the bg FILL (historical — see marker-tool.ts),
   *  so the actual stroke attrs need dedicated fields. Unset =
   *  use the tool's defaults (white / 1.5pt / solid). */
  markerBorderColor?: string;
  markerBorderWidth?: number;
  markerBorderDasharray?: string;
}

export abstract class ToolBase {
  abstract readonly name: string;

  protected canvas: CanvasManager;
  protected history: History;
  protected options: ToolOptions;

  constructor(canvas: CanvasManager, history: History, options: ToolOptions) {
    this.canvas = canvas;
    this.history = history;
    this.options = options;
  }

  abstract onPointerDown(e: PointerEvent, pt: DOMPoint): void;
  abstract onPointerMove(e: PointerEvent, pt: DOMPoint): void;
  abstract onPointerUp(e: PointerEvent, pt: DOMPoint): void;

  onKeyDown?(e: KeyboardEvent): void;
  onActivate?(): void;
  onDeactivate?(): void;

  /** Called after a shape is completed; toolbar uses this to switch back to select mode */
  onShapeComplete?: (el?: SVGElement) => void;

  protected createSVG<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string>,
  ): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    return el;
  }

  protected addAnnotation(el: SVGElement): void {
    this.canvas.annotations.appendChild(el);
    this.history.save();
  }
}
