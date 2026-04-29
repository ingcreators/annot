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

import type { TextRun } from "../utils/tauri-bridge.js";
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
   *  `start` for legacy plain / sticky / callout (matches the
   *  pre-Phase-3 layout) and to `middle` for the Pattern A
   *  text-on-shape kinds (PowerPoint default). */
  textAnchor?: TextAnchor;
  /** Vertical alignment inside the shape box. Defaults to
   *  `top` for legacy plain / sticky / callout, `middle` for
   *  Pattern A. */
  textVerticalAnchor?: TextVerticalAnchor;
  /** Callout tail tip in canvas coordinates. If undefined and the
   *  variant is "callout", a default position (below-left of the box)
   *  is picked. */
  tailX?: number;
  tailY?: number;
}

/** Pick a sensible default horizontal anchor when the spec
 *  doesn't supply one. Legacy text variants keep their pre-anchor
 *  layout (start); Pattern A kinds default to PowerPoint's
 *  middle. */
function defaultTextAnchor(variant: string | null | undefined): TextAnchor {
  if (variant === "rect" || variant === "rounded" || variant === "ellipse") return "middle";
  return "start";
}

function defaultTextVerticalAnchor(variant: string | null | undefined): TextVerticalAnchor {
  if (variant === "rect" || variant === "rounded" || variant === "ellipse") return "middle";
  return "top";
}

/** Count the visible lines in a run array (paragraph breaks +
 *  the implicit final paragraph). */
function countLines(runs: readonly TextRun[]): number {
  if (runs.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < runs.length - 1; i++) {
    if (runs[i]!.line_break_after) n += 1;
  }
  return n;
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
  fontSize: number;
  lineCount: number;
  padLeft: number;
  padTop: number;
  textAnchor: TextAnchor;
  textVerticalAnchor: TextVerticalAnchor;
}): TspanLayout {
  const { x, y, w, h, fontSize, lineCount, padLeft, padTop, textAnchor, textVerticalAnchor } = opts;
  const lineHeight = fontSize * 1.4;

  // Horizontal — text-anchor handles the alignment, so all we
  // need is the x of the alignment reference point.
  let xForLine: number;
  if (textAnchor === "start") {
    xForLine = x + padLeft;
  } else if (textAnchor === "end") {
    xForLine = x + w - padLeft;
  } else {
    xForLine = x + w / 2;
  }

  // Vertical — SVG has no native vertical anchor; pre-compute
  // the y-origin so the run block sits in the right band of
  // the box.
  const totalH = Math.max(1, lineCount) * lineHeight;
  let firstBaselineY: number;
  if (textVerticalAnchor === "top") {
    firstBaselineY = y + fontSize + padTop;
  } else if (textVerticalAnchor === "bottom") {
    firstBaselineY = y + h - padTop - totalH + fontSize;
  } else {
    firstBaselineY = y + (h - totalH) / 2 + fontSize;
  }

  return {
    textAnchorAttr: textAnchor,
    xForLine,
    yForLine: (lineIndex: number) => firstBaselineY + lineIndex * lineHeight,
  };
}

/**
 * Returns true when the element is a unified text-bearing shape
 * (`<g data-type="shape" data-shape-kind="...">`).
 *
 * The legacy `<g data-type="textbox">` produced by older Annot
 * builds is NOT recognised — see CLAUDE.md and the
 * `rich-text-and-shape-text` plan: pre-release dumps are
 * disposable, the reader rejects legacy elements loudly so
 * stray data fails fast rather than silently degrading.
 */
export function isTextShapeElement(el: Element): boolean {
  return (
    el.tagName === "g" &&
    el.getAttribute("data-type") === "shape" &&
    el.getAttribute("data-shape-kind") != null
  );
}

/** Throws when an old `<g data-type="textbox">` element shows up
 *  in a code path that expects the unified skeleton. Used by
 *  `readTextShapeSpec` and `convertTextVariant` to surface the
 *  schema break loudly. */
function rejectLegacyTextbox(el: Element): void {
  if (el.tagName === "g" && el.getAttribute("data-type") === "textbox") {
    throw new Error(
      'Legacy <g data-type="textbox"> is not supported. ' +
        "Pre-rich-text Annot dumps must be re-created — see " +
        "docs/plans/_done/rich-text-and-shape-text.md.",
    );
  }
}

export function detectTextVariant(g: SVGElement): TextVariant {
  rejectLegacyTextbox(g);
  const v = g.getAttribute("data-shape-kind") as TextVariant | null;
  if (v === "plain" || v === "sticky" || v === "callout") return v;
  // Defensive default — same as before the rename. Keeps
  // unrecognised future kinds (Phase 3 rect / rounded / ellipse)
  // from crashing the variant picker; callers that need to
  // discriminate the broader union should branch on the raw attr.
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

/**
 * Read the spec off an existing text-bearing shape. Used when
 * converting variant or re-rendering after an edit. Throws on
 * the legacy `<g data-type="textbox">` skeleton.
 */
export function readTextShapeSpec(g: SVGElement): TextShapeSpec {
  rejectLegacyTextbox(g);
  const bg = g.querySelector("rect");
  const x = Number.parseFloat(bg?.getAttribute("x") || "0");
  const y = Number.parseFloat(bg?.getAttribute("y") || "0");
  const w = Number.parseFloat(bg?.getAttribute("width") || "200");
  const h = Number.parseFloat(bg?.getAttribute("height") || "80");
  const fontSize = Number.parseFloat(g.getAttribute("data-font-size") || "16");
  const fontFamily = g.getAttribute("data-font-family") || "sans-serif";
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
    // callout
    bg.setAttribute("rx", "8");
    bg.setAttribute("fill", stickyBgFor(spec.color));
    bg.setAttribute("stroke", "rgba(0,0,0,0.25)");
    bg.setAttribute("stroke-width", "1");
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
  // text-on-rect).
  const padLeft = spec.variant === "plain" ? 2 : 10;
  const padTop = spec.variant === "plain" ? 0 : 8;
  const layout = buildTspanLayout({
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    fontSize: spec.fontSize,
    lineCount: countLines(spec.runs),
    padLeft,
    padTop,
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

  let lineIndex = 0;
  let isStartOfLine = true;
  for (const run of spec.runs) {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    if (isStartOfLine) {
      tspan.setAttribute("x", String(layout.xForLine));
      tspan.setAttribute("y", String(layout.yForLine(lineIndex)));
    }
    if (run.bold) tspan.setAttribute("font-weight", "bold");
    if (run.italic) tspan.setAttribute("font-style", "italic");
    if (run.underline) tspan.setAttribute("text-decoration", "underline");
    if (run.font_size != null) tspan.setAttribute("font-size", String(run.font_size));
    if (run.font_family != null) tspan.setAttribute("font-family", run.font_family);
    if (run.color != null) tspan.setAttribute("fill", run.color);
    tspan.textContent = run.text;
    textEl.appendChild(tspan);

    if (run.line_break_after) {
      lineIndex += 1;
      isStartOfLine = true;
    } else {
      isStartOfLine = false;
    }
  }
  g.appendChild(textEl);

  return g;
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
  const tailX = Number.parseFloat(g.getAttribute("data-tail-x") || String(x - 30));
  const tailY = Number.parseFloat(g.getAttribute("data-tail-y") || String(y + h + 40));

  // Pick the closest edge midpoint as the base. The tail looks most
  // natural when it grows from the side facing the tip — bottom edge
  // for tips below the box, top for tips above, etc.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = tailX - cx;
  const dy = tailY - cy;
  const horizontal = Math.abs(dx) > Math.abs(dy);

  let baseX1: number;
  let baseY1: number;
  let baseX2: number;
  let baseY2: number;
  if (horizontal) {
    // Tail exits the left or right edge, base spans vertically.
    const baseX = dx > 0 ? x + w : x;
    const half = Math.min(16, h * 0.2);
    baseX1 = baseX;
    baseY1 = cy - half;
    baseX2 = baseX;
    baseY2 = cy + half;
  } else {
    // Tail exits the top or bottom edge, base spans horizontally.
    const baseY = dy > 0 ? y + h : y;
    const half = Math.min(16, w * 0.2);
    baseX1 = cx - half;
    baseY1 = baseY;
    baseX2 = cx + half;
    baseY2 = baseY;
  }
  tail.setAttribute("d", `M ${baseX1} ${baseY1} L ${tailX} ${tailY} L ${baseX2} ${baseY2} Z`);
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
 *  Pattern A entry path — Phase 3 of
 *  `docs/plans/rich-text-and-shape-text.md`. The wrapper REPLACES
 *  the original element in its parent; the caller should reassign
 *  any selection / undo state to the returned `<g>`.
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
  g.setAttribute("data-font-family", "sans-serif");
  g.setAttribute("data-color", "#000000");
  // Pattern A defaults to PowerPoint-style centered text inside
  // the shape geometry. The user can change either anchor via the
  // PropertyPanel after the shape is promoted.
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
  textEl.setAttribute("font-family", "sans-serif");
  textEl.setAttribute("fill", g.getAttribute("data-color") || "#000000");
  textEl.setAttribute("clip-path", `url(#${clipId})`);
  textEl.style.pointerEvents = "none";
  g.appendChild(textEl);

  return g;
}

/** Replace the `<text>` content of an existing text-bearing shape
 *  in-place — used by Pattern A (text-on-shape) where the
 *  geometry primitive is the user's bare rect, not the bg
 *  generated by `createTextShape`. The wrapper's other children
 *  (geometry, clipPath, callout tail) are left untouched.
 *
 *  Tspan layout follows the same anchor / line-height rules as
 *  `createTextShape`. Layout reads its origin from the FIRST
 *  `<rect>` direct child (the geometry primitive). */
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
  const fontFamily = g.getAttribute("data-font-family") || "sans-serif";
  const color = g.getAttribute("data-color") || "#000000";

  // Padding mirrors `createTextShape` — `plain` insets to 2px so
  // text hugs the box edge; every other kind insets ~10px to
  // leave breathing room from the bg / border. Pattern A uses the
  // 10px inset since the user's geometry IS a deliberate visible
  // box.
  const variant = g.getAttribute("data-shape-kind");
  const padLeft = variant === "plain" ? 2 : 10;
  const padTop = variant === "plain" ? 0 : 8;
  const textAnchor =
    (g.getAttribute("data-text-anchor") as TextAnchor | null) ?? defaultTextAnchor(variant);
  const textVerticalAnchor =
    (g.getAttribute("data-text-vanchor") as TextVerticalAnchor | null) ??
    defaultTextVerticalAnchor(variant);

  const layout = buildTspanLayout({
    x: baseX,
    y: baseY,
    w: boxW,
    h: boxH,
    fontSize,
    lineCount: countLines(runs),
    padLeft,
    padTop,
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

  let lineIndex = 0;
  let isStartOfLine = true;
  for (const run of runs) {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    if (isStartOfLine) {
      tspan.setAttribute("x", String(layout.xForLine));
      tspan.setAttribute("y", String(layout.yForLine(lineIndex)));
    }
    if (run.bold) tspan.setAttribute("font-weight", "bold");
    if (run.italic) tspan.setAttribute("font-style", "italic");
    if (run.underline) tspan.setAttribute("text-decoration", "underline");
    if (run.font_size != null) tspan.setAttribute("font-size", String(run.font_size));
    if (run.font_family != null) tspan.setAttribute("font-family", run.font_family);
    if (run.color != null) tspan.setAttribute("fill", run.color);
    tspan.textContent = run.text;
    textEl.appendChild(tspan);

    if (run.line_break_after) {
      lineIndex += 1;
      isStartOfLine = true;
    } else {
      isStartOfLine = false;
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
  rejectLegacyTextbox(oldG);
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
