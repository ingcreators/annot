/**
 * Text-bearing shape utilities — render, detect, and convert
 * between the three text shape kinds (plain / sticky / callout).
 *
 * All three share the same DOM skeleton so SelectionManager#moveElement
 * and #resizeElement can handle them uniformly:
 *
 *   <g data-type="shape" data-shape-kind="KIND" …metadata>
 *     <rect>          ← background (invisible for "plain")
 *     [<path>]        ← callout tail (only for "callout")
 *     <clipPath>      ← clips text to the box
 *     <text>          ← user text
 *       <tspan>...</tspan> ...
 *     </text>
 *   </g>
 *
 * Metadata stored on the <g> (all preserved across kind changes):
 *   data-shape-kind    "plain" | "sticky" | "callout" (and, in
 *                      Phase 3, "rect" / "rounded" / "ellipse"
 *                      for text-on-shape)
 *   data-font-size     numeric, px (default for unstyled <tspan>s)
 *   data-font-family   CSS family string
 *   data-color         text color default (also drives sticky bg)
 *   data-tail-x        callout only — tail tip x (canvas coords)
 *   data-tail-y        callout only — tail tip y (canvas coords)
 *
 * Per-run formatting overrides ride on each `<tspan>` via the
 * standard SVG attributes — `font-weight`, `font-style`,
 * `text-decoration`, `font-size`, `font-family`, `fill`. A
 * uniformly-styled textbox emits no per-tspan overrides; the
 * shape-level defaults are inherited.
 */

import type { TextRun } from "../utils/desktop-bridge.js";
import type { TextVariant } from "./tool-options.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Sticky background color lookup — maps the text color to a pale
 *  variant for the rectangle fill. */
const STICKY_BG: Record<string, string> = {
  "#ff0000": "rgba(255,255,200,0.92)",
  "#00ff00": "rgba(200,255,200,0.92)",
  "#0000ff": "rgba(200,220,255,0.92)",
  "#ff8800": "rgba(255,230,200,0.92)",
  "#ff00ff": "rgba(255,210,255,0.92)",
};

export function stickyBgFor(color: string): string {
  return STICKY_BG[color.toLowerCase()] || "rgba(255,255,200,0.92)";
}

/** In-place text-shape color update.
 *
 *  Writes the color to:
 *    - `data-color` on the wrapper (the cache attr that survives
 *      save / paste / Office round-trips when the inner `<text>`
 *      gets re-rendered).
 *    - `fill` on the inner `<text>` child (what the SVG renderer
 *      paints).
 *    - For sticky / callout variants: `fill` on the bg `<rect>`
 *      and the tail `<path>` derived from `stickyBgFor(color)`,
 *      so the body tint follows the text color the way it would
 *      if the wrapper were freshly built.
 *
 *  Text-on-shape wrappers (see `isTextOnShape`) carry the user's
 *  drawn fill on the geometry primitive; the bg fill stays
 *  untouched here so a deliberate user-set color isn't
 *  overwritten by the text-color change.
 *
 *  Tier B — pure jsdom-friendly element manipulation, no live-
 *  canvas dependency. Used by both PropertyPanel's textColor
 *  effect and TextTool's commit path so a sticky's body tint
 *  stays in lockstep with its text color across both surfaces. */
export function applyTextShapeColor(g: SVGElement, color: string): void {
  g.setAttribute("data-color", color);
  const text = g.querySelector("text");
  if (text) text.setAttribute("fill", color);

  const variant = g.getAttribute("data-shape-kind");
  if (variant === "sticky" || variant === "callout") {
    const bg = stickyBgFor(color);
    // First direct child rect — the bg geometry primitive. The
    // clipPath's nested rect lives under `<clipPath>` and isn't a
    // direct child, so iterating skips past it without false
    // matches.
    for (const child of Array.from(g.children)) {
      if (child.tagName === "rect") {
        (child as SVGRectElement).setAttribute("fill", bg);
        break;
      }
    }
    // Callout tail — direct-child `<path>`. Only one tail per
    // callout, so the first match is the right one.
    if (variant === "callout") {
      for (const child of Array.from(g.children)) {
        if (child.tagName === "path") {
          (child as SVGPathElement).setAttribute("fill", bg);
          break;
        }
      }
    }
  }
}

/** Plain-text view of a run array — joins runs in order with `\n`
 *  inserted at every `line_break_after`. Useful when an editor
 *  wants the unstyled body (e.g. for the contentEditable seed). */
export function runsToPlainText(runs: readonly TextRun[]): string {
  let out = "";
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    out += r.text;
    if (r.line_break_after) out += "\n";
  }
  return out;
}

/** Build a uniformly-styled run array from a plain-text string,
 *  one run per line. Convenience for callers that don't yet emit
 *  styled runs (Phase 1's TextTool, the contentEditable commit
 *  before Phase 2's rich-text mapper, …). */
export function plainTextToRuns(text: string): TextRun[] {
  const lines = text.split("\n");
  const runs: TextRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    runs.push({ text: lines[i]!, line_break_after: !isLast });
  }
  return runs;
}

/** Horizontal text alignment inside the shape box. Maps onto
 *  SVG's `text-anchor` (`start` / `middle` / `end`). */
export type TextAnchor = "start" | "middle" | "end";

/** Vertical text alignment inside the shape box. SVG has no
 *  built-in vertical-anchor attribute on `<text>`, so the
 *  layout pass computes the y-origin from total run height +
 *  the vanchor value (`top` / `middle` / `bottom`). */
export type TextVerticalAnchor = "top" | "middle" | "bottom";

/** Auto-fit policy for a text-bearing shape (matches PowerPoint's
 *  three radio options under Format Shape → Text Box):
 *
 *    "none"   — text is clipped to the box; the user resizes
 *               the box to make room. Default.
 *    "shrink" — text shrinks (scales font-size down) when it
 *               overflows so it always fits. Currently records
 *               intent only — the layout pass that does the
 *               actual scaling is a follow-up.
 *    "resize" — the box grows (height) so the text always fits
 *               without clipping. Width stays fixed.
 *
 *  Stored on the wrapper as `data-text-autofit`. */
export type TextAutofit = "none" | "shrink" | "resize";

/** Per-side text-box padding in user-space units. PowerPoint's
 *  "Text Box → Margins" surface; defaults map to the legacy
 *  hard-coded inset (10 px on plain & callout, 2 px on plain).
 *  Stored on the wrapper as `data-text-margin-{l,r,t,b}` so the
 *  per-side margins survive variant changes / re-edits. */
export interface TextMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function readMargin(g: Element, attr: string, fallback: number): number {
  const raw = g.getAttribute(attr);
  if (raw == null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Pull the per-side margins off a wrapper, falling back to the
 *  variant-specific defaults that previously lived as constants
 *  in `createTextShape` / `replaceRunsInPlace`. */
function readTextMargins(g: Element): TextMargins {
  const variant = g.getAttribute("data-shape-kind");
  const padDefault = variant === "plain" ? 2 : 10;
  const padTopDefault = variant === "plain" ? 0 : 8;
  return {
    left: readMargin(g, "data-text-margin-l", padDefault),
    right: readMargin(g, "data-text-margin-r", padDefault),
    top: readMargin(g, "data-text-margin-t", padTopDefault),
    bottom: readMargin(g, "data-text-margin-b", padTopDefault),
  };
}

export interface TextShapeSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  variant: TextVariant;
  /** Per-run text content + per-character formatting. Use
   *  `plainTextToRuns(s)` to bridge from plain text. */
  runs: TextRun[];
  /** Default font size (px) for runs without a per-run override. */
  fontSize: number;
  /** Default font family for runs without a per-run override. */
  fontFamily: string;
  /** Default text color for runs without a per-run override. */
  color: string;
  /** Horizontal alignment inside the shape box. Defaults to
   *  `start` for the auto-bg variants (plain / sticky / callout,
   *  matching the pre-Phase-3 layout) and to `middle` for
   *  text-on-shape kinds (PowerPoint default). */
  textAnchor?: TextAnchor;
  /** Vertical alignment inside the shape box. Defaults to
   *  `top` for the auto-bg variants, `middle` for text-on-shape. */
  textVerticalAnchor?: TextVerticalAnchor;
  /** Callout tail tip in canvas coordinates. If undefined and the
   *  variant is "callout", a default position (below-left of the box)
   *  is picked. */
  tailX?: number;
  tailY?: number;
}

/** Pick a sensible default horizontal anchor when the spec
 *  doesn't supply one. Auto-bg variants keep their pre-anchor
 *  layout (start); text-on-shape kinds default to PowerPoint's
 *  middle. */
function defaultTextAnchor(variant: string | null | undefined): TextAnchor {
  if (variant === "rect" || variant === "rounded" || variant === "ellipse") return "middle";
  return "start";
}

function defaultTextVerticalAnchor(variant: string | null | undefined): TextVerticalAnchor {
  if (variant === "rect" || variant === "rounded" || variant === "ellipse") return "middle";
  return "top";
}

// ─── Word-wrap (PowerPoint `bodyPr wrap="square"` equivalent) ────
//
// Lay runs out into "visual lines" at the wrapper's inner width.
// Each visual line is what the renderer paints as a single tspan
// row — explicit `line_break_after` always starts a new line; in
// addition, runs that exceed the inner-width get split at locale-
// aware word boundaries (`Intl.Segmenter`) so long sentences flow
// onto subsequent lines without the user having to insert manual
// breaks. The contentEditable overlay already wraps via CSS while
// the user is typing; this matches the committed-state rendering.
//
// The runs themselves are NOT modified — wrapping is a layout-time
// concern. Resizing the box re-runs `replaceRunsInPlace` which
// re-wraps with the new width.

/** A single tspan-equivalent fragment within a wrapped visual line:
 *  carries its origin run's formatting along with the segment text
 *  the wrapper computed for this line. */
interface WrappedSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font_size?: number;
  font_family?: string;
  color?: string;
}

/** A visual line — a list of segments that share a baseline. */
interface WrappedLine {
  segments: WrappedSegment[];
  /** Per-line max font size (largest segment's effective font_size,
   *  falling back to the wrapper's `data-font-size`). Drives the
   *  line height in `buildTspanLayout`. */
  maxFontSize: number;
}

/** Lazily-cached canvas 2D context for `measureText`. Returns null
 *  in environments without a real canvas (jsdom, SSR) — callers
 *  fall back to "no wrap" so the existing `<text>` layout still
 *  renders, just without auto-wrap semantics. */
let cachedMeasureCtx: CanvasRenderingContext2D | null | undefined = undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (cachedMeasureCtx !== undefined) return cachedMeasureCtx;
  if (typeof document === "undefined") return (cachedMeasureCtx = null);
  try {
    const c = document.createElement("canvas");
    cachedMeasureCtx = c.getContext("2d");
  } catch {
    cachedMeasureCtx = null;
  }
  return cachedMeasureCtx;
}

function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
  bold: boolean,
  italic: boolean,
): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  const style = `${italic ? "italic " : ""}${bold ? "bold " : ""}`;
  ctx.font = `${style}${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

/** Locale-aware word segmenter. Reuses one instance — `Intl.Segmenter`
 *  construction is non-trivial. Falls back to undefined when the
 *  runtime doesn't expose `Intl.Segmenter` (older browsers / Node
 *  without ICU); the wrap loop then degrades to "no segmentation"
 *  and only respects explicit line breaks, which is fine. */
let cachedSegmenter: Intl.Segmenter | null | undefined = undefined;
function getWordSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") {
    return (cachedSegmenter = null);
  }
  try {
    const locale = typeof navigator !== "undefined" ? navigator.language : undefined;
    cachedSegmenter = new Intl.Segmenter(locale, { granularity: "word" });
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

const WHITESPACE_RE = /^[\s　]+$/;

/** Split `runs` into visual lines bounded by `innerW`. Soft-breaks
 *  use `Intl.Segmenter` for locale-aware word boundaries; hard-breaks
 *  (`run.line_break_after`) always start a new line.
 *
 *  Leading whitespace at the start of a wrapped line is dropped (so
 *  long sentences don't paint with an awkward leading space after
 *  flowing onto a new visual line). Trailing whitespace stays — it
 *  reflects the user's typing intent. */
function wrapRunsToLines(
  runs: readonly TextRun[],
  innerW: number,
  baseFontSize: number,
  baseFontFamily: string,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let line: WrappedLine = { segments: [], maxFontSize: 0 };
  let lineW = 0;
  const segmenter = getWordSegmenter();
  const pushLine = (): void => {
    lines.push(line);
    line = { segments: [], maxFontSize: 0 };
    lineW = 0;
  };

  for (const run of runs) {
    const fontSize = run.font_size ?? baseFontSize;
    const fontFamily = run.font_family ?? baseFontFamily;
    const bold = !!run.bold;
    const italic = !!run.italic;

    // Empty-text run on a paragraph break — still register it so the
    // visual line carries the run's font-size (drives the empty
    // line's height for the user-typed "blank line between paragraphs"
    // pattern).
    const segments: string[] = [];
    if (run.text) {
      if (segmenter) {
        for (const seg of segmenter.segment(run.text)) segments.push(seg.segment);
      } else {
        // Coarse fallback — split on runs of whitespace, keep the
        // whitespace as its own segment so trailing whitespace
        // survives the round-trip. Matches what `Intl.Segmenter`'s
        // `granularity: "word"` produces for ASCII.
        let i = 0;
        while (i < run.text.length) {
          const ws = WHITESPACE_RE.test(run.text[i]!);
          let j = i + 1;
          while (j < run.text.length && WHITESPACE_RE.test(run.text[j]!) === ws) j++;
          segments.push(run.text.slice(i, j));
          i = j;
        }
      }
    }

    let buf = "";
    let bufW = 0;
    const pushBuf = (): void => {
      if (!buf) return;
      line.segments.push({
        text: buf,
        bold: run.bold,
        italic: run.italic,
        underline: run.underline,
        font_size: run.font_size,
        font_family: run.font_family,
        color: run.color,
      });
      if (fontSize > line.maxFontSize) line.maxFontSize = fontSize;
      buf = "";
      bufW = 0;
    };

    for (const seg of segments) {
      const isStartOfLine = line.segments.length === 0 && buf === "";
      // Drop leading whitespace at the start of a freshly-wrapped
      // line — a soft-broken sentence shouldn't paint with a stray
      // leading space.
      if (isStartOfLine && WHITESPACE_RE.test(seg)) continue;
      const w = measureTextWidth(seg, fontSize, fontFamily, bold, italic);
      // Soft-wrap: if adding this segment would push the line past
      // the inner width AND the line already has content, flush the
      // buffer to the line and start a new one. The check uses
      // `>` (not `>=`) so segments that exactly fit don't trigger a
      // gratuitous wrap on the next character.
      if (lineW + w > innerW && (lineW > 0 || buf !== "")) {
        pushBuf();
        pushLine();
        if (WHITESPACE_RE.test(seg)) continue;
      }
      buf += seg;
      bufW += w;
      lineW += w;
    }

    pushBuf();

    // For an empty-text run with `line_break_after`, ensure the
    // empty line still records the run's font size so the rendered
    // gap matches the user's typing.
    if (run.text === "" && line.segments.length === 0 && fontSize > line.maxFontSize) {
      line.maxFontSize = fontSize;
    }

    if (run.line_break_after) pushLine();
  }

  // Flush the in-progress final line. Empty `runs` (no text at all)
  // → keep one empty line so the layout still emits a baseline.
  if (line.segments.length > 0 || lines.length === 0) {
    if (line.maxFontSize === 0) line.maxFontSize = baseFontSize;
    lines.push(line);
  }

  // Empty-line max-size fallback to keep the gap consistent with
  // the wrapper's baseline font.
  for (const l of lines) {
    if (l.maxFontSize === 0) l.maxFontSize = baseFontSize;
  }

  return lines;
}

/** Compute the (x, y) of a `<tspan>` that starts a new line +
 *  the SVG `text-anchor` value to put on the parent `<text>`,
 *  given the box bounds, padding, line height, anchor settings,
 *  and the line index (0-based) within the run array. */
interface TspanLayout {
  /** SVG `text-anchor` to set on the parent `<text>` element. */
  textAnchorAttr: TextAnchor;
  /** x coordinate for the line's first tspan. */
  xForLine: number;
  /** y coordinate for line N (0-based). */
  yForLine: (lineIndex: number) => number;
}

function buildTspanLayout(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per-line max font size — one entry per line. Length determines
   *  the line count (replacing the previous separate `lineCount` +
   *  single `fontSize` pair). */
  lineFontSizes: number[];
  margins: TextMargins;
  textAnchor: TextAnchor;
  textVerticalAnchor: TextVerticalAnchor;
}): TspanLayout {
  const { x, y, w, h, lineFontSizes, margins, textAnchor, textVerticalAnchor } = opts;
  // Per-line height = font size × 1.4 (matches the contentEditable's
  // CSS line-height during edit). Cumulative offsets: line 0 starts
  // at the inner top, line i starts where line i-1's box ended.
  const sizes = lineFontSizes.length > 0 ? lineFontSizes : [16];
  const lineHeights = sizes.map((s) => s * 1.4);
  // baseline[i] = top_of_line[i] + lineFontSize[i] (font size ≈ ascent).
  const lineTops: number[] = new Array(sizes.length);
  lineTops[0] = 0;
  for (let i = 1; i < sizes.length; i++) lineTops[i] = lineTops[i - 1]! + lineHeights[i - 1]!;
  const totalH = lineTops[sizes.length - 1]! + lineHeights[sizes.length - 1]!;

  // Horizontal — text-anchor handles the alignment, so all we
  // need is the x of the alignment reference point.
  let xForLine: number;
  if (textAnchor === "start") {
    xForLine = x + margins.left;
  } else if (textAnchor === "end") {
    xForLine = x + w - margins.right;
  } else {
    xForLine = x + (margins.left + (w - margins.right)) / 2;
  }

  // Vertical — SVG has no native vertical anchor; pre-compute
  // the y-origin so the run block sits in the right band of
  // the box. Margins reserve space at the top / bottom edges
  // so the run block never paints inside them.
  let blockTop: number;
  if (textVerticalAnchor === "top") {
    blockTop = y + margins.top;
  } else if (textVerticalAnchor === "bottom") {
    blockTop = y + h - margins.bottom - totalH;
  } else {
    const innerTop = y + margins.top;
    const innerH = Math.max(0, h - margins.top - margins.bottom);
    blockTop = innerTop + (innerH - totalH) / 2;
  }

  return {
    textAnchorAttr: textAnchor,
    xForLine,
    yForLine: (lineIndex: number) => {
      const idx = Math.max(0, Math.min(sizes.length - 1, lineIndex));
      return blockTop + lineTops[idx]! + sizes[idx]!;
    },
  };
}

/** Returns true when the wrapper is a text-on-shape variant —
 *  i.e. the wrapper was promoted from a Shape-tool primitive
 *  (`rect` / `rounded` / `ellipse`) via `wrapBareRectForText`,
 *  so the geometry primitive carries the user's drawn fill /
 *  stroke. The other text-bearing variants (`plain` / `sticky` /
 *  `callout`) carry an auto-generated bg whose tint follows the
 *  text color via `stickyBgFor`.
 *
 *  Used by:
 *    - `applyTextShapeColor` (above) to skip the bg-fill refresh
 *      for user-drawn geometry.
 *    - `TextTool` to decide whether to hide the wrapper or just
 *      its `<text>` child during edit, and whether the editor
 *      overlay should paint its own yellow background or stay
 *      transparent.
 *
 *  Returns false for non-text-shape elements (no `data-type`,
 *  raw `<rect>`, etc.) so callers can use it as a discriminator
 *  without an outer `isTextShapeElement` guard. */
export function isTextOnShape(el: Element): boolean {
  if (el.tagName !== "g" || el.getAttribute("data-type") !== "shape") return false;
  const kind = el.getAttribute("data-shape-kind");
  return kind === "rect" || kind === "rounded" || kind === "ellipse";
}

/** Returns true when the element is a unified text-bearing shape
 *  (`<g data-type="shape" data-shape-kind="...">`). */
export function isTextShapeElement(el: Element): boolean {
  return (
    el.tagName === "g" &&
    el.getAttribute("data-type") === "shape" &&
    el.getAttribute("data-shape-kind") != null
  );
}

export function detectTextVariant(g: SVGElement): TextVariant {
  const v = g.getAttribute("data-shape-kind") as TextVariant | null;
  if (v === "plain" || v === "sticky" || v === "callout") return v;
  // Defensive default. Keeps the text-on-shape kinds (rect /
  // rounded / ellipse) from crashing the variant picker;
  // callers that need to discriminate the broader union should
  // branch on the raw attr.
  return "sticky";
}

/** True when a `<tspan>` carries its own `x` or `y` attribute,
 *  which the writer uses to mark the start of a new line.
 *  Continuation tspans within the same paragraph inherit position
 *  from the parent `<text>` via SVG's text-flow rules. */
function tspanStartsLine(t: Element): boolean {
  return t.hasAttribute("x") || t.hasAttribute("y");
}

/** Read the runs out of an existing text-bearing shape. Each
 *  `<tspan>` becomes one `TextRun`; `line_break_after` is set on
 *  any run whose successor starts a new line (detected via
 *  the successor's own `x` / `y` attribute), so
 *  `runsToPlainText(...)` round-trips the original line breaks.
 *
 *  Phase 1 emits one `<tspan>` per line so each successor starts
 *  a new line and `line_break_after` lands on every run except
 *  the last. Phase 2 will pack styled runs from the same
 *  paragraph as continuation tspans (no x / y), at which point
 *  this same heuristic distinguishes "same paragraph" runs from
 *  "new paragraph" runs without further changes. */
function readRuns(g: SVGElement): TextRun[] {
  const textEl = g.querySelector("text");
  if (!textEl) return [];
  const tspans = Array.from(textEl.querySelectorAll("tspan"));
  if (tspans.length === 0) {
    // Bare `<text>` with no `<tspan>` children — treat the
    // textContent as a single paragraph.
    const body = textEl.textContent ?? "";
    if (!body) return [];
    return [{ text: body, line_break_after: false }];
  }
  const runs: TextRun[] = [];
  for (let i = 0; i < tspans.length; i++) {
    const tspan = tspans[i]!;
    const run: TextRun = { text: tspan.textContent ?? "" };
    const fw = tspan.getAttribute("font-weight");
    if (fw === "bold" || fw === "700") run.bold = true;
    const fs = tspan.getAttribute("font-style");
    if (fs === "italic") run.italic = true;
    const td = tspan.getAttribute("text-decoration");
    if (td?.includes("underline")) run.underline = true;
    const sz = tspan.getAttribute("font-size");
    if (sz) {
      const n = Number.parseFloat(sz);
      if (Number.isFinite(n)) run.font_size = n;
    }
    const ff = tspan.getAttribute("font-family");
    if (ff) run.font_family = ff;
    const fill = tspan.getAttribute("fill");
    if (fill) run.color = fill;
    const next = tspans[i + 1];
    run.line_break_after = next != null && tspanStartsLine(next);
    runs.push(run);
  }
  return runs;
}

/** Read the spec off an existing text-bearing shape. Used when
 *  converting variant or re-rendering after an edit. */
export function readTextShapeSpec(g: SVGElement): TextShapeSpec {
  const bg = g.querySelector("rect");
  const x = Number.parseFloat(bg?.getAttribute("x") || "0");
  const y = Number.parseFloat(bg?.getAttribute("y") || "0");
  const w = Number.parseFloat(bg?.getAttribute("width") || "200");
  const h = Number.parseFloat(bg?.getAttribute("height") || "80");
  const fontSize = Number.parseFloat(g.getAttribute("data-font-size") || "16");
  const fontFamily = g.getAttribute("data-font-family") || "Annot Sans";
  const color = g.getAttribute("data-color") || "#ff0000";
  const variant = detectTextVariant(g);
  const shapeKindRaw = g.getAttribute("data-shape-kind");
  const tailXRaw = g.getAttribute("data-tail-x");
  const tailYRaw = g.getAttribute("data-tail-y");
  const textAnchorAttr = g.getAttribute("data-text-anchor") as TextAnchor | null;
  const textVAnchorAttr = g.getAttribute("data-text-vanchor") as TextVerticalAnchor | null;
  return {
    x,
    y,
    w,
    h,
    variant,
    runs: readRuns(g),
    fontSize,
    fontFamily,
    color,
    textAnchor: textAnchorAttr ?? defaultTextAnchor(shapeKindRaw),
    textVerticalAnchor: textVAnchorAttr ?? defaultTextVerticalAnchor(shapeKindRaw),
    tailX: tailXRaw != null ? Number.parseFloat(tailXRaw) : undefined,
    tailY: tailYRaw != null ? Number.parseFloat(tailYRaw) : undefined,
  };
}

/**
 * Construct a fresh text-bearing shape group element that matches
 * the spec. Does NOT insert it into the DOM; caller is responsible.
 */
export function createTextShape(spec: TextShapeSpec): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-type", "shape");
  g.setAttribute("data-shape-kind", spec.variant);
  g.setAttribute("data-font-size", String(spec.fontSize));
  g.setAttribute("data-font-family", spec.fontFamily);
  g.setAttribute("data-color", spec.color);
  const textAnchor = spec.textAnchor ?? defaultTextAnchor(spec.variant);
  const textVerticalAnchor = spec.textVerticalAnchor ?? defaultTextVerticalAnchor(spec.variant);
  g.setAttribute("data-text-anchor", textAnchor);
  g.setAttribute("data-text-vanchor", textVerticalAnchor);

  // Background <rect> — always present so SelectionManager's resize
  // logic has a consistent target. Appearance depends on variant.
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(spec.x));
  bg.setAttribute("y", String(spec.y));
  bg.setAttribute("width", String(spec.w));
  bg.setAttribute("height", String(spec.h));
  if (spec.variant === "plain") {
    bg.setAttribute("fill", "none");
    bg.setAttribute("stroke", "none");
    // Still catchable by pointer events so the user can click anywhere
    // inside the bounds to select.
    bg.setAttribute("pointer-events", "all");
  } else if (spec.variant === "sticky") {
    bg.setAttribute("rx", "4");
    bg.setAttribute("fill", stickyBgFor(spec.color));
    bg.setAttribute("stroke", "rgba(0,0,0,0.15)");
    bg.setAttribute("stroke-width", "1");
  } else {
    // callout — bg rect carries the FILL only; the visible outer
    // outline (rect + tail combined into a single seamless
    // perimeter, with no divider line where the tail meets the
    // rect edge) is drawn by the sibling `<path>` built in
    // `rebuildCalloutTail`. PowerPoint's `wedgeRoundRectCallout`
    // preset paints the same way.
    bg.setAttribute("rx", "8");
    bg.setAttribute("fill", stickyBgFor(spec.color));
    bg.setAttribute("stroke", "none");
  }
  g.appendChild(bg);

  // Callout tail — triangle from one edge of the box to the tail tip.
  if (spec.variant === "callout") {
    const tailX = spec.tailX ?? spec.x - 30;
    const tailY = spec.tailY ?? spec.y + spec.h + 40;
    g.setAttribute("data-tail-x", String(tailX));
    g.setAttribute("data-tail-y", String(tailY));

    // Build an empty path placeholder, then defer geometry to
    // rebuildCalloutTail so the same edge-pick algorithm runs for
    // initial render AND for later updates (resize / tail drag).
    const tail = document.createElementNS(SVG_NS, "path");
    tail.setAttribute("d", "");
    tail.setAttribute("fill", stickyBgFor(spec.color));
    tail.setAttribute("stroke", "rgba(0,0,0,0.25)");
    tail.setAttribute("stroke-width", "1");
    g.appendChild(tail);
    rebuildCalloutTail(g);
  }

  // Clip text to the box region so overflow doesn't bleed past the
  // background.
  const clipId = `clip-textshape-${Math.random().toString(36).slice(2, 9)}`;
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.id = clipId;
  const clipRect = document.createElementNS(SVG_NS, "rect");
  clipRect.setAttribute("x", String(spec.x));
  clipRect.setAttribute("y", String(spec.y));
  clipRect.setAttribute("width", String(spec.w));
  clipRect.setAttribute("height", String(spec.h));
  clipPath.appendChild(clipRect);
  g.appendChild(clipPath);

  // Text content — one `<tspan>` per run. Run order maps directly
  // onto `<tspan>` order; `line_break_after` advances the y-offset
  // by one line height. Layout consults the resolved horizontal +
  // vertical anchors so the run block sits in the right band of
  // the box (e.g. `middle` / `middle` for PowerPoint-style
  // text-on-rect). Margins come from `data-text-margin-{l,r,t,b}`
  // when present, falling back to the legacy variant-specific
  // padding constants for plain (2 / 0) and the others (10 / 8).
  const margins = readTextMargins(g);
  const innerW = Math.max(0, spec.w - margins.left - margins.right);
  const wrappedLines = wrapRunsToLines(spec.runs, innerW, spec.fontSize, spec.fontFamily);
  const layout = buildTspanLayout({
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    lineFontSizes: wrappedLines.map((l) => l.maxFontSize),
    margins,
    textAnchor,
    textVerticalAnchor,
  });

  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("font-size", String(spec.fontSize));
  textEl.setAttribute("fill", spec.color);
  textEl.setAttribute("font-family", spec.fontFamily);
  textEl.setAttribute("clip-path", `url(#${clipId})`);
  textEl.setAttribute("text-anchor", layout.textAnchorAttr);
  textEl.style.pointerEvents = "none";
  emitWrappedLineTspans(textEl, wrappedLines, layout);
  g.appendChild(textEl);

  return g;
}

/** Emit one or more `<tspan>` elements per wrapped visual line into
 *  the parent `<text>`. The first segment of each line carries the
 *  explicit `x` / `y` attrs; later segments on the same line inherit
 *  position via SVG's text-flow rules. Used by both `createTextShape`
 *  and `replaceRunsInPlace` so the wrap layout is identical across
 *  the create / re-flow paths. */
function emitWrappedLineTspans(
  textEl: SVGTextElement,
  lines: readonly WrappedLine[],
  layout: TspanLayout,
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const x = layout.xForLine;
    const y = layout.yForLine(i);
    if (line.segments.length === 0) {
      // Empty line — emit a placeholder tspan so the line still
      // takes up its slot in the run block. Without it,
      // `<text>` collapses adjacent baselines and the user-typed
      // empty line vanishes from the rendered output.
      const tspan = document.createElementNS(SVG_NS, "tspan");
      tspan.setAttribute("x", String(x));
      tspan.setAttribute("y", String(y));
      tspan.textContent = "";
      textEl.appendChild(tspan);
      continue;
    }
    let isFirst = true;
    for (const seg of line.segments) {
      const tspan = document.createElementNS(SVG_NS, "tspan");
      if (isFirst) {
        tspan.setAttribute("x", String(x));
        tspan.setAttribute("y", String(y));
        isFirst = false;
      }
      if (seg.bold) tspan.setAttribute("font-weight", "bold");
      if (seg.italic) tspan.setAttribute("font-style", "italic");
      if (seg.underline) tspan.setAttribute("text-decoration", "underline");
      if (seg.font_size != null) tspan.setAttribute("font-size", String(seg.font_size));
      if (seg.font_family != null) tspan.setAttribute("font-family", seg.font_family);
      if (seg.color != null) tspan.setAttribute("fill", seg.color);
      tspan.textContent = seg.text;
      textEl.appendChild(tspan);
    }
  }
}

/**
 * Translate a text-bearing shape's children (bg `<rect>`, optional
 * callout tail `<path>` + `data-tail-*` attrs, optional clipPath
 * `<rect>`, every positioned `<tspan>` inside the inner `<text>`)
 * by (dx, dy) in world space.
 *
 * Phase 2 of `docs/plans/move-bakes-coordinates.md`. The text-shape
 * skeleton stores positions in child geometry attrs only; the outer
 * `<g>` carries no x/y of its own. Shifting all those attrs in place
 * leaves the visual unchanged when the OLD wrapper transform is
 * removed and the children are re-read at their new world coords —
 * which is exactly what the move-baker wants for the move-only
 * case (no rotation / no flip).
 *
 * No-op for non-text-shape inputs. The caller is expected to have
 * confirmed `g.getAttribute("data-type") === "shape"` before
 * dispatching here.
 *
 * Tier B — pure Element manipulation, jsdom-friendly. The path
 * shifter routes via `translatePathD` (Tier A), which keeps this
 * helper independent of any browser-only path APIs.
 */
export function bakeTextShapeTranslate(g: SVGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  if (g.getAttribute("data-type") !== "shape") return;
  // bg <rect> (sticky / callout / text-on-shape rect / rounded) OR
  // bg <ellipse> (text-on-shape ellipse) — both via the dedicated
  // bg accessor (firstElementChild for the wrapper). Plain text
  // also has a (transparent) bg <rect>; treat it identically.
  const bg = g.querySelector("rect");
  if (bg) {
    bg.setAttribute("x", String(Number.parseFloat(bg.getAttribute("x") || "0") + dx));
    bg.setAttribute("y", String(Number.parseFloat(bg.getAttribute("y") || "0") + dy));
  }
  const bgEllipse = g.querySelector(":scope > ellipse");
  if (bgEllipse) {
    bgEllipse.setAttribute(
      "cx",
      String(Number.parseFloat(bgEllipse.getAttribute("cx") || "0") + dx),
    );
    bgEllipse.setAttribute(
      "cy",
      String(Number.parseFloat(bgEllipse.getAttribute("cy") || "0") + dy),
    );
  }
  // clipPath > rect — keeps the clip aligned with the bg.
  const clipRect = g.querySelector("clipPath > rect");
  if (clipRect) {
    clipRect.setAttribute(
      "x",
      String(Number.parseFloat(clipRect.getAttribute("x") || "0") + dx),
    );
    clipRect.setAttribute(
      "y",
      String(Number.parseFloat(clipRect.getAttribute("y") || "0") + dy),
    );
  }
  // Callout tail — path's `d` is rebuilt by `rebuildCalloutTail`
  // off the bg rect + data-tail-* attrs, so shifting those two
  // anchors and re-running the rebuild keeps the tail tip and base
  // in their correct visual positions. Avoids parsing the existing
  // path geometry — `rebuildCalloutTail` is the canonical builder.
  if (g.getAttribute("data-shape-kind") === "callout") {
    const tx = g.getAttribute("data-tail-x");
    const ty = g.getAttribute("data-tail-y");
    if (tx != null) g.setAttribute("data-tail-x", String(Number.parseFloat(tx) + dx));
    if (ty != null) g.setAttribute("data-tail-y", String(Number.parseFloat(ty) + dy));
    rebuildCalloutTail(g);
  }
  // Inner <text> — the element itself never carries x/y in our
  // skeleton (createTextShape doesn't set them); only the
  // descendant <tspan>s with explicit x/y attrs need shifting.
  const text = g.querySelector("text");
  if (text) {
    const textX = text.getAttribute("x");
    const textY = text.getAttribute("y");
    if (textX != null) text.setAttribute("x", String(Number.parseFloat(textX) + dx));
    if (textY != null) text.setAttribute("y", String(Number.parseFloat(textY) + dy));
    for (const tspan of Array.from(text.querySelectorAll("tspan"))) {
      const sx = tspan.getAttribute("x");
      const sy = tspan.getAttribute("y");
      if (sx != null) tspan.setAttribute("x", String(Number.parseFloat(sx) + dx));
      if (sy != null) tspan.setAttribute("y", String(Number.parseFloat(sy) + dy));
    }
  }
}

/**
 * Rebuild the callout tail <path> off the current bg <rect> bounds and
 * the stored data-tail-x / data-tail-y. Call after any change that
 * affects either input — resize (bg rect changed) or tail-tip drag
 * (data-tail-* changed) — to keep the visual consistent.
 *
 * No-op for non-callout shapes (or callouts missing the tail path).
 */
export function rebuildCalloutTail(g: SVGElement): void {
  if (g.getAttribute("data-shape-kind") !== "callout") return;
  const bg = g.querySelector("rect");
  const tail = g.querySelector("path");
  if (!bg || !tail) return;
  const x = Number.parseFloat(bg.getAttribute("x") || "0");
  const y = Number.parseFloat(bg.getAttribute("y") || "0");
  const w = Number.parseFloat(bg.getAttribute("width") || "0");
  const h = Number.parseFloat(bg.getAttribute("height") || "0");
  const rx = Number.parseFloat(bg.getAttribute("rx") || "0");
  const tailX = Number.parseFloat(g.getAttribute("data-tail-x") || String(x - 30));
  const tailY = Number.parseFloat(g.getAttribute("data-tail-y") || String(y + h + 40));

  // Pick the edge by the tip's OVERHANG — how far the tip sits
  // outside the rect on each axis. PowerPoint's
  // `wedgeRoundRectCallout` exits whichever side faces the tip:
  //
  //   - Tip outside the X range only → exits left / right edge
  //   - Tip outside the Y range only → exits top / bottom edge
  //   - Tip outside in BOTH directions (corner zone) → exits
  //     whichever side has the larger overhang. So a tip below
  //     and slightly right of the box exits the BOTTOM edge,
  //     not the right edge — matching PowerPoint and the user's
  //     reference screenshots.
  //
  // Earlier revisions used `|dx| vs |dy|` from the box CENTER,
  // which incorrectly picks left/right for any tip more than
  // half-w to the side, even when the tip is way below or
  // above the box.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const horizOverhang = tailX < x ? x - tailX : tailX > x + w ? tailX - (x + w) : 0;
  const vertOverhang = tailY < y ? y - tailY : tailY > y + h ? tailY - (y + h) : 0;
  let edge: "top" | "right" | "bottom" | "left";
  if (horizOverhang === 0 && vertOverhang === 0) {
    // Tip inside the rect — degenerate. Fall back to a center-
    // relative pick so a freshly-promoted callout with the
    // default tail at the corner still draws something.
    const dx = tailX - cx;
    const dy = tailY - cy;
    edge = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
  } else if (horizOverhang > vertOverhang) {
    edge = tailX < x ? "left" : "right";
  } else {
    edge = tailY < y ? "top" : "bottom";
  }

  // PowerPoint `wedgeRoundRectCallout` — base width is 16.67% of
  // the chosen edge length (the preset's default `adj3 = 16667`),
  // and the base ATTACHES at the corner closer to the tip's
  // perpendicular projection: one base point sits right at the
  // corner-arc end, the other extends `BASE_WIDTH` along the
  // edge. Anchoring the base at the corner (rather than centering
  // it on the tip's projection) is what makes a slight tip move
  // within a quadrant leave the exit point fixed.
  const BASE_RATIO = 0.1667;
  const xL = x;
  const xR = x + w;
  const yT = y;
  const yB = y + h;
  // Base length per edge — 16.67% of the chosen edge's length.
  // Capped to the straight portion (between the two corner arcs)
  // so it never spills past the rounded corners on a tiny rect.
  const baseLenH = Math.max(0, Math.min(w * BASE_RATIO, w - 2 * rx));
  const baseLenV = Math.max(0, Math.min(h * BASE_RATIO, h - 2 * rx));

  // For each edge, the base CENTER sits halfway between the
  // edge's midpoint and the corner closer to the tip's
  // perpendicular projection — NOT at the corner itself. So
  // small tip movements within a quadrant keep the same exit
  // region (the base doesn't slide), but the base sits
  // visually between the edge midpoint and the corner endpoint
  // (matching the user's PowerPoint reference).
  const halfLenH = baseLenH / 2;
  const halfLenV = baseLenV / 2;
  // Quadrant midpoint = halfway between edge midpoint (cx / cy)
  // and the chosen corner endpoint (xL + rx, xR - rx, yT + rx,
  // yB - rx). Reading out which corner the tip is closer to:
  //   tailX < cx → left corner  (top / bottom edges)
  //   tailY < cy → top corner   (left / right edges)
  const baseMidH =
    tailX < cx ? (cx + (xL + rx)) / 2 : (cx + (xR - rx)) / 2;
  const baseMidV =
    tailY < cy ? (cy + (yT + rx)) / 2 : (cy + (yB - rx)) / 2;
  // Resolve to the two base points on each axis. Order picked
  // along the edge (smaller coord first, larger second) so the
  // path-emit branches below can pick first / second by
  // direction of travel without rederiving.
  const baseHLow = baseMidH - halfLenH;
  const baseHHigh = baseMidH + halfLenH;
  const baseVLow = baseMidV - halfLenV;
  const baseVHigh = baseMidV + halfLenV;

  const segs: string[] = [];
  // Start just after the TL corner and trace clockwise.
  segs.push(`M ${xL + rx} ${yT}`);

  // Top edge (left → right). Direction of travel is
  // increasing-X, so the first hit base point is the lower-X one.
  if (edge === "top") {
    segs.push(`L ${baseHLow} ${yT}`);
    segs.push(`L ${tailX} ${tailY}`);
    segs.push(`L ${baseHHigh} ${yT}`);
  }
  segs.push(`L ${xR - rx} ${yT}`);
  if (rx > 0) segs.push(`A ${rx} ${rx} 0 0 1 ${xR} ${yT + rx}`);

  // Right edge (top → bottom). Direction is increasing-Y.
  if (edge === "right") {
    segs.push(`L ${xR} ${baseVLow}`);
    segs.push(`L ${tailX} ${tailY}`);
    segs.push(`L ${xR} ${baseVHigh}`);
  }
  segs.push(`L ${xR} ${yB - rx}`);
  if (rx > 0) segs.push(`A ${rx} ${rx} 0 0 1 ${xR - rx} ${yB}`);

  // Bottom edge (right → left). Direction reverses → larger-X
  // base point first.
  if (edge === "bottom") {
    segs.push(`L ${baseHHigh} ${yB}`);
    segs.push(`L ${tailX} ${tailY}`);
    segs.push(`L ${baseHLow} ${yB}`);
  }
  segs.push(`L ${xL + rx} ${yB}`);
  if (rx > 0) segs.push(`A ${rx} ${rx} 0 0 1 ${xL} ${yB - rx}`);

  // Left edge (bottom → top). Direction reverses → larger-Y
  // base point first.
  if (edge === "left") {
    segs.push(`L ${xL} ${baseVHigh}`);
    segs.push(`L ${tailX} ${tailY}`);
    segs.push(`L ${xL} ${baseVLow}`);
  }
  segs.push(`L ${xL} ${yT + rx}`);
  if (rx > 0) segs.push(`A ${rx} ${rx} 0 0 1 ${xL + rx} ${yT}`);

  segs.push("Z");
  tail.setAttribute("d", segs.join(" "));
}

/**
 * Update a callout's tail-tip position. Writes the new coords to the
 * data-tail-* attributes and rebuilds the tail <path>. Coords are in
 * the textbox's LOCAL space — the caller is responsible for subtracting
 * any group transform (e.g. translate from a previous drag).
 */
export function setCalloutTail(g: SVGElement, localTailX: number, localTailY: number): void {
  g.setAttribute("data-tail-x", String(localTailX));
  g.setAttribute("data-tail-y", String(localTailY));
  rebuildCalloutTail(g);
}

/** Wrap a bare `<rect>` (drawn by ShapeTool — sharp, rounded, or
 *  highlight) into the unified `<g data-type="shape">` skeleton so
 *  the user can add text to it. The original geometry element
 *  becomes the first child of the wrapper unchanged; we layer a
 *  `<clipPath>` + an initially empty `<text>` on top so the
 *  TextTool's edit flow reads / writes through the same skeleton
 *  it uses for plain / sticky / callout textboxes.
 *
 *  Text-on-shape entry path — landed in Phase 3 of
 *  `docs/plans/_done/rich-text-and-shape-text.md`. The wrapper
 *  REPLACES the original element in its parent; the caller
 *  should reassign any selection / undo state to the returned
 *  `<g>`. See `isTextOnShape` for the runtime predicate that
 *  matches the resulting wrapper kinds.
 *
 *  The matching {@link unwrapBareTextShape} reverses this
 *  transformation when the user cancels a freshly-opened text
 *  edit without typing. */
export function wrapBareRectForText(rect: SVGRectElement): SVGGElement {
  const parent = rect.parentNode;
  if (!parent) throw new Error("wrapBareRectForText: element is detached");
  const x = Number.parseFloat(rect.getAttribute("x") || "0");
  const y = Number.parseFloat(rect.getAttribute("y") || "0");
  const w = Number.parseFloat(rect.getAttribute("width") || "0");
  const h = Number.parseFloat(rect.getAttribute("height") || "0");

  // Discriminate sharp / rounded so the wrapper carries an honest
  // `data-shape-kind`. Highlight rects keep their `data-highlight="1"`
  // flag on the inner geometry; the outer kind stays `rect`
  // (highlight is a *geometry-style* marker, not a separate shape
  // kind).
  const isRounded =
    rect.hasAttribute("data-rounded") || Number.parseFloat(rect.getAttribute("rx") || "0") > 0;
  const shapeKind = isRounded ? "rounded" : "rect";

  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-type", "shape");
  g.setAttribute("data-shape-kind", shapeKind);

  // Default text formatting for the freshly-promoted shape. The
  // TextTool's `#startEditing` / `#finishEditing` will overwrite
  // these from `ToolOptions` on commit, but having sane defaults
  // here means `readTextShapeSpec` doesn't throw before the user
  // enters any text.
  //
  // Text color is independent of the rect's stroke / fill —
  // PowerPoint's text-on-shape uses an automatic ink color
  // (typically black on light backgrounds, white on dark). We
  // pick black as a single deterministic default; the user can
  // change it via the mini-toolbar / PropertyPanel. The rect
  // itself keeps its original stroke / fill / opacity / etc.
  // attributes intact so the Shape-tool styling survives the
  // promotion.
  g.setAttribute("data-font-size", "16");
  g.setAttribute("data-font-family", "Annot Sans");
  g.setAttribute("data-color", "#000000");
  // Text-on-shape defaults to PowerPoint-style centered text
  // inside the shape geometry. The user can change either anchor
  // via the PropertyPanel after the shape is promoted.
  g.setAttribute("data-text-anchor", defaultTextAnchor(shapeKind));
  g.setAttribute("data-text-vanchor", defaultTextVerticalAnchor(shapeKind));

  // Move the original geometry under the wrapper.
  parent.replaceChild(g, rect);
  g.appendChild(rect);

  // Clip-path matching the rect bounds — the text element uses it
  // so overflow doesn't bleed past the geometry.
  const clipId = `clip-textshape-${Math.random().toString(36).slice(2, 9)}`;
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.id = clipId;
  const clipRect = document.createElementNS(SVG_NS, "rect");
  clipRect.setAttribute("x", String(x));
  clipRect.setAttribute("y", String(y));
  clipRect.setAttribute("width", String(w));
  clipRect.setAttribute("height", String(h));
  clipPath.appendChild(clipRect);
  g.appendChild(clipPath);

  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("font-size", "16");
  textEl.setAttribute("font-family", "Annot Sans");
  textEl.setAttribute("fill", g.getAttribute("data-color") || "#000000");
  textEl.setAttribute("clip-path", `url(#${clipId})`);
  textEl.style.pointerEvents = "none";
  g.appendChild(textEl);

  return g;
}

/** Replace the `<text>` content of an existing text-bearing shape
 *  in-place. Used by every TextTool re-edit commit and by the
 *  PropertyPanel's text effects (color / variant / autofit /
 *  margins). The wrapper's other children (geometry, clipPath,
 *  callout tail) are left untouched.
 *
 *  Tspan layout follows the same anchor / line-height rules as
 *  `createTextShape`. Layout reads its origin from the FIRST
 *  `<rect>` direct child (the geometry primitive — the user's
 *  drawn rect for text-on-shape, or the auto-generated bg for
 *  the plain / sticky / callout variants). */
export function replaceRunsInPlace(g: SVGElement, runs: readonly TextRun[]): void {
  const firstRect = (() => {
    for (const child of Array.from(g.children)) {
      if (child.tagName === "rect") return child as SVGRectElement;
    }
    return null;
  })();
  const baseX = firstRect ? Number.parseFloat(firstRect.getAttribute("x") || "0") : 0;
  const baseY = firstRect ? Number.parseFloat(firstRect.getAttribute("y") || "0") : 0;
  const boxW = firstRect ? Number.parseFloat(firstRect.getAttribute("width") || "0") : 0;
  const boxH = firstRect ? Number.parseFloat(firstRect.getAttribute("height") || "0") : 0;
  const fontSize = Number.parseFloat(g.getAttribute("data-font-size") || "16");
  const fontFamily = g.getAttribute("data-font-family") || "Annot Sans";
  const color = g.getAttribute("data-color") || "#000000";

  // Margins follow the per-side `data-text-margin-{l,r,t,b}`
  // attributes, falling back to the per-variant padding
  // constants (plain = 2/0, others = 10/8). Text-on-shape's
  // 10/8 default echoes the user-visible breathing room around
  // a deliberately drawn shape; plain text hugs its bounds to
  // mirror the pre-anchor-aware layout from Phase 1.
  const variant = g.getAttribute("data-shape-kind");
  const margins = readTextMargins(g);
  const textAnchor =
    (g.getAttribute("data-text-anchor") as TextAnchor | null) ?? defaultTextAnchor(variant);
  const textVerticalAnchor =
    (g.getAttribute("data-text-vanchor") as TextVerticalAnchor | null) ??
    defaultTextVerticalAnchor(variant);

  const innerW = Math.max(0, boxW - margins.left - margins.right);
  const wrappedLines = wrapRunsToLines(runs, innerW, fontSize, fontFamily);
  const lineFontSizes = wrappedLines.map((l) => l.maxFontSize);
  const layout = buildTspanLayout({
    x: baseX,
    y: baseY,
    w: boxW,
    h: boxH,
    lineFontSizes,
    margins,
    textAnchor,
    textVerticalAnchor,
  });

  // Find or build the existing <text> child. Preserve its
  // clip-path attribute when possible — the clipPath element's
  // id is already in the DOM tree.
  let textEl: SVGTextElement | null = null;
  for (const child of Array.from(g.children)) {
    if (child.tagName === "text") {
      textEl = child as SVGTextElement;
      break;
    }
  }
  if (!textEl) {
    textEl = document.createElementNS(SVG_NS, "text") as SVGTextElement;
    g.appendChild(textEl);
  }

  // Reset attrs + content.
  textEl.setAttribute("font-size", String(fontSize));
  textEl.setAttribute("font-family", fontFamily);
  textEl.setAttribute("fill", color);
  textEl.setAttribute("text-anchor", layout.textAnchorAttr);
  textEl.style.pointerEvents = "none";
  while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
  emitWrappedLineTspans(textEl, wrappedLines, layout);

  // Autofit (`data-text-autofit="resize"`) — grow the geometry
  // primitive's height so the run block fits inside margins +
  // bbox. Width stays fixed to match PowerPoint's "Resize shape
  // to fit text" default. The shrink mode is recorded as intent
  // only at the moment; a follow-up will scale the font-size
  // down when the text overflows.
  const autofit = g.getAttribute("data-text-autofit");
  if (autofit === "resize" && firstRect) {
    // Sum per-line heights — same scheme as `buildTspanLayout`'s
    // vertical layout, so the autofit grow-to-fit calculation
    // matches the actual painted run block exactly.
    let totalH = 0;
    for (const s of lineFontSizes) totalH += s * 1.4;
    if (totalH === 0) totalH = fontSize * 1.4;
    const requiredH = totalH + margins.top + margins.bottom;
    if (requiredH > boxH) {
      firstRect.setAttribute("height", String(requiredH));
      // Keep the clipPath in sync so the visible run block
      // doesn't get cut at the previous box bottom.
      const clipRect = g.querySelector("clipPath > rect");
      if (clipRect instanceof Element) clipRect.setAttribute("height", String(requiredH));
      // Callout outline path is built off the bg `<rect>`'s
      // current bounds — without this, an autofit grow leaves
      // the outline at the OLD bounds and the user sees a
      // residual horizontal line where the rect used to end.
      // No-op for plain / sticky / non-callout variants.
      rebuildCalloutTail(g);
      // Re-run layout once with the grown box so middle / bottom
      // anchors recompute against the new height. Recursive call
      // is safe because the autofit branch is a no-op once the
      // box is large enough.
      replaceRunsInPlace(g, runs);
    }
  }
}

/** Reverse a {@link wrapBareRectForText} promotion when the user
 *  cancels a freshly-opened text edit without typing anything.
 *  Returns the original geometry element after replacing the
 *  wrapper in its parent. Idempotent on a non-wrapper element. */
export function unwrapBareTextShape(g: SVGElement): SVGElement {
  if (g.tagName !== "g" || g.getAttribute("data-type") !== "shape") return g;
  // The first direct rect child IS the geometry primitive — the
  // clip-path's nested rect lives under `<clipPath>` and isn't a
  // direct child of `<g>`.
  let geometry: SVGElement | null = null;
  for (const child of Array.from(g.children)) {
    if (child.tagName === "rect" || child.tagName === "ellipse") {
      geometry = child as SVGElement;
      break;
    }
  }
  if (!geometry) return g;
  const parent = g.parentNode;
  if (!parent) return g;
  parent.replaceChild(geometry, g);
  return geometry;
}

/**
 * Convert an existing text-bearing shape to a different variant.
 * Preserves position, size, runs, and all metadata. Replaces the
 * old element in the DOM and returns the new element (caller must
 * update SelectionManager refs via the PropertyPanel's
 * onTargetReplaced callback).
 */
export function convertTextVariant(oldG: SVGElement, newVariant: TextVariant): SVGElement {
  const parent = oldG.parentNode;
  if (!parent) throw new Error("convertTextVariant: element is detached");
  const spec = readTextShapeSpec(oldG);
  const newG = createTextShape({ ...spec, variant: newVariant });

  // Preserve any existing transform (from previous drags) so the
  // visual position doesn't jump when the user changes variant.
  const transform = oldG.getAttribute("transform");
  if (transform) newG.setAttribute("transform", transform);

  parent.replaceChild(newG, oldG);
  return newG;
}
