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
  /** Callout tail tip in canvas coordinates. If undefined and the
   *  variant is "callout", a default position (below-left of the box)
   *  is picked. */
  tailX?: number;
  tailY?: number;
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
  const tailXRaw = g.getAttribute("data-tail-x");
  const tailYRaw = g.getAttribute("data-tail-y");
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
  // by one line height. Phase 1 emits one run per line (no inline
  // styled runs), but the layout below already supports the
  // multi-run-per-paragraph case Phase 2 introduces.
  const padLeft = spec.variant === "plain" ? 2 : 10;
  const padTop = spec.variant === "plain" ? 0 : 8;
  const lineHeight = spec.fontSize * 1.4;
  const baseX = spec.x + padLeft;
  const firstY = spec.y + spec.fontSize + padTop;

  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("font-size", String(spec.fontSize));
  textEl.setAttribute("fill", spec.color);
  textEl.setAttribute("font-family", spec.fontFamily);
  textEl.setAttribute("clip-path", `url(#${clipId})`);
  textEl.style.pointerEvents = "none";

  let lineIndex = 0;
  let isStartOfLine = true;
  for (const run of spec.runs) {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    if (isStartOfLine) {
      tspan.setAttribute("x", String(baseX));
      tspan.setAttribute("y", String(firstY + lineIndex * lineHeight));
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
