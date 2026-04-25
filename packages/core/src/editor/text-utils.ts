/**
 * Text family utilities — render, detect, and convert between the
 * three Text variants (plain / sticky / callout).
 *
 * All three share the same DOM skeleton so SelectionManager#moveElement
 * and #resizeElement can handle them uniformly:
 *
 *   <g data-type="textbox" data-text-variant="VARIANT" …metadata>
 *     <rect>          ← background (invisible for "plain")
 *     [<path>]        ← callout tail (only for "callout")
 *     <clipPath>      ← clips text to the box
 *     <text>          ← user text
 *   </g>
 *
 * Metadata stored on the <g> (all preserved across variant changes):
 *   data-text          raw user text (preserves newlines / spacing)
 *   data-font-size     numeric, px
 *   data-font-family   CSS family string (e.g. "sans-serif")
 *   data-color         text color (also used as sticky bg hue)
 *   data-tail-x        callout only — tail tip x (canvas coords)
 *   data-tail-y        callout only — tail tip y (canvas coords)
 */

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

export interface TextBoxSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  variant: TextVariant;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  /** Callout tail tip in canvas coordinates. If undefined and the
   *  variant is "callout", a default position (below-left of the box)
   *  is picked. */
  tailX?: number;
  tailY?: number;
}

export function detectTextVariant(g: SVGElement): TextVariant {
  const v = g.getAttribute("data-text-variant") as TextVariant | null;
  if (v) return v;
  // Back-compat: textboxes created before the variant system are
  // sticky (they always had a <rect> bg).
  return "sticky";
}

/**
 * Read the spec off an existing textbox group. Used when converting
 * variant or re-rendering after an edit.
 */
export function readTextBoxSpec(g: SVGElement): TextBoxSpec {
  const bg = g.querySelector("rect");
  const x = Number.parseFloat(bg?.getAttribute("x") || "0");
  const y = Number.parseFloat(bg?.getAttribute("y") || "0");
  const w = Number.parseFloat(bg?.getAttribute("width") || "200");
  const h = Number.parseFloat(bg?.getAttribute("height") || "80");
  const text = g.getAttribute("data-text") || g.querySelector("text")?.textContent || "";
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
    text,
    fontSize,
    fontFamily,
    color,
    tailX: tailXRaw != null ? Number.parseFloat(tailXRaw) : undefined,
    tailY: tailYRaw != null ? Number.parseFloat(tailYRaw) : undefined,
  };
}

/**
 * Construct a fresh textbox group element that matches the spec.
 * Does NOT insert it into the DOM; caller is responsible.
 */
export function createTextBox(spec: TextBoxSpec): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-type", "textbox");
  g.setAttribute("data-text-variant", spec.variant);
  g.setAttribute("data-font-size", String(spec.fontSize));
  g.setAttribute("data-font-family", spec.fontFamily);
  g.setAttribute("data-color", spec.color);
  g.setAttribute("data-text", spec.text);

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
  const clipId = `clip-textbox-${Math.random().toString(36).slice(2, 9)}`;
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.id = clipId;
  const clipRect = document.createElementNS(SVG_NS, "rect");
  clipRect.setAttribute("x", String(spec.x));
  clipRect.setAttribute("y", String(spec.y));
  clipRect.setAttribute("width", String(spec.w));
  clipRect.setAttribute("height", String(spec.h));
  clipPath.appendChild(clipRect);
  g.appendChild(clipPath);

  // Text content — one <tspan> per line, laid out vertically.
  const lines = spec.text.split("\n");
  const lineHeight = spec.fontSize * 1.4;
  const padLeft = spec.variant === "plain" ? 2 : 10;
  const padTop = spec.variant === "plain" ? 0 : 8;
  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("font-size", String(spec.fontSize));
  textEl.setAttribute("fill", spec.color);
  textEl.setAttribute("font-family", spec.fontFamily);
  textEl.setAttribute("clip-path", `url(#${clipId})`);
  textEl.style.pointerEvents = "none";
  lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", String(spec.x + padLeft));
    tspan.setAttribute("y", String(spec.y + spec.fontSize + padTop + i * lineHeight));
    tspan.textContent = line;
    textEl.appendChild(tspan);
  });
  g.appendChild(textEl);

  return g;
}

/**
 * Rebuild the callout tail <path> off the current bg <rect> bounds and
 * the stored data-tail-x / data-tail-y. Call after any change that
 * affects either input — resize (bg rect changed) or tail-tip drag
 * (data-tail-* changed) — to keep the visual consistent.
 *
 * No-op for non-callout textboxes (or callouts missing the tail path).
 */
export function rebuildCalloutTail(g: SVGElement): void {
  if (g.getAttribute("data-text-variant") !== "callout") return;
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
 * Convert an existing textbox to a different variant. Preserves
 * position, size, and all metadata. Replaces the old element in the
 * DOM and returns the new element (caller must update SelectionManager
 * refs via the PropertyPanel's onTargetReplaced callback).
 */
export function convertTextVariant(oldG: SVGElement, newVariant: TextVariant): SVGElement {
  const parent = oldG.parentNode;
  if (!parent) throw new Error("convertTextVariant: element is detached");
  const spec = readTextBoxSpec(oldG);
  const newG = createTextBox({ ...spec, variant: newVariant });

  // Preserve any existing transform (from previous drags) so the
  // visual position doesn't jump when the user changes variant.
  const transform = oldG.getAttribute("transform");
  if (transform) newG.setAttribute("transform", transform);

  parent.replaceChild(newG, oldG);
  return newG;
}
