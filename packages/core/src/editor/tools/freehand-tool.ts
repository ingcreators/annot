import { computeDasharray } from "../../utils/dash-utils.js";
import type { DrawStyle } from "./tool-base.js";
/**
 * FreehandTool — unified Draw / Highlighter tool.
 *
 * The user's `drawStyle` option picks between:
 *   "pen"         → crisp opaque stroke, round caps (the classic pen)
 *   "highlighter" → thick semi-transparent stroke, flat caps — looks
 *                   like a physical highlighter; overlapping strokes
 *                   darken naturally via alpha compositing.
 *
 * Both styles produce a `<path>` element; only the stroke attributes
 * differ. That means conversion between styles (in PropertyPanel) is
 * a cheap attribute toggle, no element replacement needed.
 */
import { ToolBase } from "./tool-base.js";

/**
 * Recommended defaults for a pristine-feeling highlighter — thick,
 * translucent, flat ends. The actual stroke-width may still come from
 * the user's ToolOptions; this is just the minimum sensible width to
 * guarantee a highlighter-looking result even if the user had a skinny
 * pen width set before switching styles.
 */
const HIGHLIGHTER_MIN_WIDTH = 12;
const HIGHLIGHTER_OPACITY = 0.38;

/** Apply draw-style attributes to a freehand element. Accepts either
 *  a single `<path>` or a `<g data-type="freehand">` wrapper (in
 *  which case the style is written to every `<path>` child plus the
 *  wrapper itself, keeping the group's `data-draw-style` indicator
 *  in sync with its contents). */
export function applyDrawStyle(el: SVGElement, style: DrawStyle, strokeWidth?: number): void {
  if (isFreehandGroup(el)) {
    el.setAttribute("data-draw-style", style);
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() === "path") {
        applyDrawStyleToPath(child as SVGElement, style, strokeWidth);
      }
    }
    return;
  }
  applyDrawStyleToPath(el, style, strokeWidth);
}

function applyDrawStyleToPath(el: SVGElement, style: DrawStyle, strokeWidth?: number): void {
  el.setAttribute("data-draw-style", style);
  if (style === "highlighter") {
    // Enforce a minimum width so the highlighter always reads as one.
    const w = Math.max(
      strokeWidth ?? Number.parseFloat(el.getAttribute("stroke-width") || "0"),
      HIGHLIGHTER_MIN_WIDTH,
    );
    el.setAttribute("stroke-width", String(w));
    el.setAttribute("stroke-opacity", String(HIGHLIGHTER_OPACITY));
    el.setAttribute("stroke-linecap", "butt");
    el.setAttribute("stroke-linejoin", "miter");
  } else {
    // Pen — remove highlighter-specific attributes.
    el.removeAttribute("stroke-opacity");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    // stroke-width kept as-is; user can still adjust independently.
  }
}

export function detectDrawStyle(el: SVGElement): DrawStyle {
  if (isFreehandGroup(el)) {
    const s = el.getAttribute("data-draw-style");
    if (s === "pen" || s === "highlighter") return s;
    const first = el.querySelector("path");
    if (first) return detectDrawStyle(first as SVGElement);
    return "pen";
  }
  const tagged = el.getAttribute("data-draw-style") as DrawStyle | null;
  if (tagged) return tagged;
  // Back-compat: infer from stroke-opacity.
  return Number.parseFloat(el.getAttribute("stroke-opacity") || "1") < 0.99 ? "highlighter" : "pen";
}

/** True for the `<g data-type="freehand">` wrapper that FreehandTool
 *  produces — a session's strokes all live as `<path>` children of
 *  one such group, so the whole drawing selects / moves / deletes as
 *  one unit even when the individual strokes have different colors. */
export function isFreehandGroup(el: Element): boolean {
  return el.tagName.toLowerCase() === "g" && el.getAttribute("data-type") === "freehand";
}

/**
 * Continuous-drawing session model — matches draw.io's Freehand tool.
 * Each pen-down / pen-up cycle produces its own `<path>` element
 * (capturing the CURRENT options — color, width, dash, style — at
 * that moment), so users can pick a new pen color between strokes
 * and see it apply to the next stroke without interrupting the
 * session. All paths from one session land in history as a SINGLE
 * undo step, so the whole "drawing" reverts atomically. The session
 * ends when:
 *   - The user presses Esc.
 *   - The user clicks the "Done" button in the Tool panel.
 *   - The user switches to another tool (onDeactivate).
 *
 * Why separate paths per stroke (vs. one accumulating path with
 * multiple `M` subpaths): SVG's `stroke` attribute is element-level,
 * so a single `<path>` can only carry ONE stroke color. Multi-color
 * continuous drawing therefore requires multiple elements. Keeping
 * them as independent paths (rather than wrapping in a `<g>`) also
 * lets users select and edit individual strokes later.
 */
export class FreehandTool extends ToolBase {
  readonly name = "freehand";
  /** The `<g data-type="freehand">` wrapper that collects the
   *  session's strokes. Built on the first pen-down, torn down on
   *  session end. Null between sessions. */
  #sessionGroup: SVGGElement | null = null;
  /** Path being drawn RIGHT NOW (pen-down → pen-up). Lives as a
   *  child of `#sessionGroup`. */
  #currentPath: SVGPathElement | null = null;
  /** Raw points of the current stroke for RDP simplification. */
  #points: { x: number; y: number }[] = [];
  /** True between pen-down and pen-up. */
  #drawing = false;

  /** Host-provided callback fired when the session ends. */
  onSessionEnd?: () => void;

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    this.#drawing = true;
    this.#points = [{ x: pt.x, y: pt.y }];

    // Lazy-build the session group on the first stroke. After that,
    // every subsequent stroke goes into the SAME group so the whole
    // session ends up as one selectable unit.
    if (!this.#sessionGroup) {
      this.#sessionGroup = this.createSVG("g", {
        "data-type": "freehand",
        "data-draw-style": this.options.drawStyle ?? "pen",
      });
      this.canvas.annotations.appendChild(this.#sessionGroup);
    } else {
      // Update the group's draw-style indicator so the most recent
      // stroke's style is reflected at the group level too (used by
      // detectDrawStyle on the group). Individual children retain
      // their own per-stroke style attrs.
      this.#sessionGroup.setAttribute("data-draw-style", this.options.drawStyle ?? "pen");
    }

    // Build a fresh `<path>` for THIS stroke with the CURRENT options,
    // so mid-session color / width / dash changes take effect on the
    // next stroke. Each stroke snapshots its own style at pen-down.
    const style: DrawStyle = this.options.drawStyle ?? "pen";
    const path = this.createSVG("path", {
      d: `M ${pt.x},${pt.y}`,
      stroke: this.options.strokeColor,
      "stroke-width": String(this.options.strokeWidth),
      "stroke-dasharray": computeDasharray(this.options.strokeDasharray, this.options.strokeWidth),
      "data-dash-key": this.options.strokeDasharray,
      fill: "none",
    });
    applyDrawStyleToPath(path, style, this.options.strokeWidth);
    this.#sessionGroup.appendChild(path);
    this.#currentPath = path;
  }

  onPointerMove(_e: PointerEvent, pt: DOMPoint): void {
    if (!this.#drawing || !this.#currentPath) return;
    this.#points.push({ x: pt.x, y: pt.y });
    this.#currentPath.setAttribute(
      "d",
      `${this.#currentPath.getAttribute("d") || ""} L ${pt.x},${pt.y}`,
    );
  }

  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {
    if (!this.#drawing || !this.#currentPath) return;
    this.#drawing = false;

    if (this.#points.length >= 3) {
      const simplified = this.#simplify(this.#points, 1.5);
      let d = `M ${simplified[0].x},${simplified[0].y}`;
      for (let i = 1; i < simplified.length; i++) {
        d += ` L ${simplified[i].x},${simplified[i].y}`;
      }
      this.#currentPath.setAttribute("d", d);
    } else {
      // Degenerate tap — drop this stroke. Doesn't end the session.
      this.#currentPath.remove();
    }
    this.#currentPath = null;
    this.#points = [];
  }

  /** End the current drawing session: commit the group to history
   *  as ONE undo step. Idempotent. */
  endSession(): void {
    if (!this.#sessionGroup) {
      this.onSessionEnd?.();
      return;
    }
    // Capture + clear state BEFORE firing callbacks. `onShapeComplete`
    // switches the toolbar to Select mode, which deactivates THIS
    // tool — and `onDeactivate` calls `endSession` again. Clearing
    // first makes the nested call a no-op.
    const group = this.#sessionGroup;
    this.#sessionGroup = null;
    this.#currentPath = null;
    this.#points = [];
    this.#drawing = false;

    // Count <path> children (the only visible strokes). A group with
    // no paths (user entered / exited without drawing) is scrapped.
    const pathChildren = group.querySelectorAll(":scope > path");
    if (pathChildren.length === 0) {
      group.remove();
    } else {
      this.history.save();
      this.onShapeComplete?.(group);
    }
    this.onSessionEnd?.();
  }

  /** Commit any active session when the tool is deactivated. */
  onDeactivate(): void {
    this.endSession();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.endSession();
      e.preventDefault();
    }
  }

  /** True when a session is open. */
  hasActiveSession(): boolean {
    return this.#sessionGroup !== null;
  }

  // Ramer-Douglas-Peucker simplification
  #simplify(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const dist = this.#perpDist(points[i], start, end);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      const left = this.#simplify(points.slice(0, maxIdx + 1), epsilon);
      const right = this.#simplify(points.slice(maxIdx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [start, end];
  }

  #perpDist(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  }
}
