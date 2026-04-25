import type { MarkerShape } from "./tool-base.js";
import { ToolBase } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Resolve the current marker shape, honoring both the new
 *  `markerShape` field and the legacy `fillColor === "rect"` hack so
 *  older saved presets continue to work. */
function resolveMarkerShape(opts: { markerShape?: MarkerShape; fillColor?: string }): MarkerShape {
  if (opts.markerShape) return opts.markerShape;
  if (opts.fillColor === "rect") return "rect";
  return "circle";
}

export class MarkerTool extends ToolBase {
  readonly name = "marker";

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    const fontSize = this.options.fontSize;
    const r = fontSize * 0.8;
    // Standard semantics (P3-8 refactor): `fillColor` = bg interior,
    // `strokeColor` = bg border. Back-compat: if fillColor is missing
    // but the legacy `strokeColor = bg fill` value is set (old presets),
    // fall back to it so users don't lose their saved color on first
    // load after the refactor.
    const color = this.options.fillColor || this.options.strokeColor || "#ff0000";
    const shape = resolveMarkerShape(this.options);

    // Find next counter value: max of same style + 1
    const nextVal = this.#findNextCounter(color, shape, fontSize);
    const label = String(nextVal);

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("data-marker", label);
    g.setAttribute("data-shape", shape);

    // Border attrs come from the standard `strokeColor` / `strokeWidth`
    // / `strokeDasharray` preset fields. Back-compat: read from the
    // legacy `markerBorder*` fields if present (old presets). Fall
    // back to the classic white 1.5 pt ring that makes markers
    // legible against any background color.
    const borderColor =
      (this.options.fillColor ? this.options.strokeColor : this.options.markerBorderColor) ||
      "#fff";
    const borderWidth =
      (this.options.fillColor ? this.options.strokeWidth : this.options.markerBorderWidth) ?? 1.5;
    const borderDash =
      (this.options.fillColor
        ? this.options.strokeDasharray
        : this.options.markerBorderDasharray) ?? "";
    const borderAttrs: Record<string, string> = {
      stroke: borderColor,
      "stroke-width": String(borderWidth),
    };
    if (borderDash) {
      borderAttrs["stroke-dasharray"] = borderDash;
      borderAttrs["data-dash-key"] = borderDash;
    }

    let bg: SVGElement;
    if (shape === "rect" || shape === "rounded") {
      // Rounded-square (`rounded`): a rect with a generous corner
      // radius (~1/3 of side length) so it reads as distinctly
      // different from the sharp `rect` at a glance, matching the
      // Shape tool's rect / rounded distinction.
      const cornerRadius = shape === "rounded" ? r * 0.6 : 3;
      bg = this.createSVG("rect", {
        x: String(pt.x - r),
        y: String(pt.y - r),
        width: String(r * 2),
        height: String(r * 2),
        rx: String(cornerRadius),
        fill: color,
        ...borderAttrs,
      });
    } else {
      bg = this.createSVG("circle", {
        cx: String(pt.x),
        cy: String(pt.y),
        r: String(r),
        fill: color,
        ...borderAttrs,
      });
    }

    const text = this.createSVG("text", {
      x: String(pt.x),
      y: String(pt.y),
      "text-anchor": "middle",
      "dominant-baseline": "central",
      fill: "#fff",
      "font-size": String(fontSize),
      "font-weight": "bold",
      "font-family": "sans-serif",
      "pointer-events": "none",
    });
    text.textContent = label;

    g.appendChild(bg);
    g.appendChild(text);
    this.canvas.annotations.appendChild(g);
    this.history.save();
    this.onShapeComplete?.(g);
  }

  onPointerMove(_e: PointerEvent, _pt: DOMPoint): void {}
  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {}

  /** Find max counter value among markers with same color, shape, fontSize, then +1 */
  #findNextCounter(color: string, shape: string, fontSize: number): number {
    let max = 0;
    const markers = this.canvas.annotations.querySelectorAll("g[data-marker]");
    for (const g of Array.from(markers)) {
      const gShape = g.getAttribute("data-shape") || "circle";
      if (gShape !== shape) continue;

      const bgEl = g.querySelector("circle") || g.querySelector("rect");
      const bgColor = bgEl?.getAttribute("fill") || "";
      if (bgColor.toLowerCase() !== color.toLowerCase()) continue;

      const textEl = g.querySelector("text");
      const fs = Number.parseFloat(textEl?.getAttribute("font-size") || "0");
      if (Math.abs(fs - fontSize) > 1) continue;

      const val = Number.parseInt(g.getAttribute("data-marker") || "0", 10);
      if (!Number.isNaN(val) && val > max) max = val;
    }
    return max + 1;
  }
}

/** Detect the current background shape of a marker `<g>`. Reads the
 *  `data-shape` attribute (authoritative, written by MarkerTool) with
 *  a fallback to the bg tag name for legacy content missing the data
 *  attr. */
export function detectMarkerShape(g: SVGElement): MarkerShape {
  const ds = g.getAttribute("data-shape");
  if (ds === "circle" || ds === "rect" || ds === "rounded") return ds;
  const bg = g.querySelector("circle, rect");
  if (bg?.tagName === "rect") return "rect";
  return "circle";
}

/** Swap a marker's background `<circle>` / `<rect>` to a different
 *  shape. Preserves the marker's center, diameter, color, stroke
 *  settings, and the numeric label — only the shape primitive is
 *  replaced.
 *
 *  Returns the SAME outer `<g>` (the text / bg children are mutated
 *  in place). No target-replacement signal needed from callers —
 *  unlike convertShape / convertTextVariant, which produce new
 *  top-level elements, converting a marker keeps identity. */
export function convertMarkerShape(g: SVGElement, newShape: MarkerShape): SVGElement {
  const current = detectMarkerShape(g);
  if (current === newShape) return g;

  const bgEl = g.querySelector("circle, rect");
  if (!bgEl) return g;

  // Derive center + half-side (radius) from whichever primitive is
  // present.
  let cx: number;
  let cy: number;
  let r: number;
  if (bgEl.tagName === "circle") {
    cx = Number.parseFloat(bgEl.getAttribute("cx") || "0");
    cy = Number.parseFloat(bgEl.getAttribute("cy") || "0");
    r = Number.parseFloat(bgEl.getAttribute("r") || "12");
  } else {
    const x = Number.parseFloat(bgEl.getAttribute("x") || "0");
    const y = Number.parseFloat(bgEl.getAttribute("y") || "0");
    const w = Number.parseFloat(bgEl.getAttribute("width") || "24");
    const h = Number.parseFloat(bgEl.getAttribute("height") || "24");
    cx = x + w / 2;
    cy = y + h / 2;
    r = Math.min(w, h) / 2;
  }

  // Preserve fill / stroke / stroke-width from the old bg — these
  // are style attrs the user may have tweaked and shouldn't reset
  // on shape swap.
  const fill = bgEl.getAttribute("fill") || "#ff0000";
  const stroke = bgEl.getAttribute("stroke") || "#fff";
  const strokeWidth = bgEl.getAttribute("stroke-width") || "1.5";

  const SVG_NS = "http://www.w3.org/2000/svg";
  let newBg: SVGElement;
  if (newShape === "circle") {
    newBg = document.createElementNS(SVG_NS, "circle");
    newBg.setAttribute("cx", String(cx));
    newBg.setAttribute("cy", String(cy));
    newBg.setAttribute("r", String(r));
  } else {
    // rect or rounded — same rect primitive, differing only in rx.
    // Matches MarkerTool's creation logic (rounded uses rx = r*0.6
    // for a pronounced roundness that reads distinct from sharp).
    const cornerRadius = newShape === "rounded" ? r * 0.6 : 3;
    newBg = document.createElementNS(SVG_NS, "rect");
    newBg.setAttribute("x", String(cx - r));
    newBg.setAttribute("y", String(cy - r));
    newBg.setAttribute("width", String(r * 2));
    newBg.setAttribute("height", String(r * 2));
    newBg.setAttribute("rx", String(cornerRadius));
  }
  newBg.setAttribute("fill", fill);
  newBg.setAttribute("stroke", stroke);
  newBg.setAttribute("stroke-width", strokeWidth);

  // Swap in the new bg (order matters: bg must stay BEFORE the <text>
  // so the number draws on top).
  bgEl.replaceWith(newBg);

  // Update the outer `<g>`'s shape marker so detectMarkerShape()
  // and preset routing agree with the new primitive.
  g.setAttribute("data-shape", newShape);

  return g;
}

/** Resize an existing marker in place to match a new font size.
 *  The counter's overall size is proportional to its text's font-size
 *  (bg radius = fontSize × 0.8, matching MarkerTool's creation
 *  logic), so changing Size must scale BOTH the text AND the bg
 *  primitive; otherwise only the digit shrinks/grows while the ring
 *  stays the same, producing an awkward "tiny label in a big bubble"
 *  or vice versa. The bg is recentered around its current midpoint
 *  so the counter's visual anchor doesn't drift when the user tweaks
 *  Size.
 *
 *  Mutates `g` in place. No target-replacement is produced — the
 *  <g> + children keep identity. */
export function resizeMarker(g: SVGElement, newFontSize: number): void {
  const bgEl = g.querySelector("circle, rect");
  if (!bgEl) return;

  // Current center (so we can re-place the bg around the same point).
  let cx: number;
  let cy: number;
  if (bgEl.tagName === "circle") {
    cx = Number.parseFloat(bgEl.getAttribute("cx") || "0");
    cy = Number.parseFloat(bgEl.getAttribute("cy") || "0");
  } else {
    const x = Number.parseFloat(bgEl.getAttribute("x") || "0");
    const y = Number.parseFloat(bgEl.getAttribute("y") || "0");
    const w = Number.parseFloat(bgEl.getAttribute("width") || "24");
    const h = Number.parseFloat(bgEl.getAttribute("height") || "24");
    cx = x + w / 2;
    cy = y + h / 2;
  }

  const r = newFontSize * 0.8;

  if (bgEl.tagName === "circle") {
    bgEl.setAttribute("cx", String(cx));
    bgEl.setAttribute("cy", String(cy));
    bgEl.setAttribute("r", String(r));
  } else {
    // Rect / rounded: recompute the box + preserve the rounded-vs-
    // sharp distinction. Matches MarkerTool.onPointerDown's cornerRadius
    // rule: rounded uses r*0.6 (scales with the counter), sharp uses 3.
    const shape = g.getAttribute("data-shape");
    const cornerRadius = shape === "rounded" ? r * 0.6 : 3;
    bgEl.setAttribute("x", String(cx - r));
    bgEl.setAttribute("y", String(cy - r));
    bgEl.setAttribute("width", String(r * 2));
    bgEl.setAttribute("height", String(r * 2));
    bgEl.setAttribute("rx", String(cornerRadius));
  }

  // Update the <text> child: font-size + the data-font-size marker
  // that the property panel / presets read back.
  const text = g.querySelector("text");
  if (text) {
    text.setAttribute("font-size", String(newFontSize));
    text.setAttribute("x", String(cx));
    text.setAttribute("y", String(cy));
  }
  g.setAttribute("data-font-size", String(newFontSize));
}
