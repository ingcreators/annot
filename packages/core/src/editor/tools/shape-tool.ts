import { computeDasharray } from "../../utils/dash-utils.js";
import type { ShapeType } from "./tool-base.js";
/**
 * ShapeTool — unified tool for Rectangle / Rounded Rectangle / Ellipse.
 *
 * Replaces the three separate tools that existed before (RectTool,
 * RoundedRectTool, EllipseTool). The user picks a variant via the
 * `shapeType` property on ToolOptions; the draw gesture is otherwise
 * identical across all three. Consolidating them removes three
 * toolbar buttons worth of clutter and makes "change the shape of an
 * existing object" a property-panel operation instead of a delete-
 * and-redraw.
 */
import { ToolBase } from "./tool-base.js";

export class ShapeTool extends ToolBase {
  readonly name = "shape";

  #el: SVGElement | null = null;
  #startX = 0;
  #startY = 0;
  #drawing = false;
  #shiftHeld = false;
  #shapeType: ShapeType = "rect";

  onPointerDown(e: PointerEvent, pt: DOMPoint): void {
    this.#drawing = true;
    this.#startX = pt.x;
    this.#startY = pt.y;
    this.#shiftHeld = e.shiftKey;
    this.#shapeType = this.options.shapeType ?? "rect";

    if (this.#shapeType === "ellipse") {
      this.#el = this.createSVG("ellipse", {
        cx: String(pt.x),
        cy: String(pt.y),
        rx: "0",
        ry: "0",
        ...this.#commonAttrs(),
      });
    } else if (this.#shapeType === "highlight") {
      // Highlight rect: filled (semi-transparent) with no stroke.
      // `data-highlight="1"` marks it so toolIdForElement can map it
      // back to the Highlight tool preset, and so we can distinguish
      // it from a plain filled rect when exporting / re-editing.
      this.#el = this.createSVG("rect", {
        x: String(pt.x),
        y: String(pt.y),
        width: "0",
        height: "0",
        rx: "0",
        "data-highlight": "1",
        ...this.#highlightAttrs(),
      });
    } else {
      this.#el = this.createSVG("rect", {
        x: String(pt.x),
        y: String(pt.y),
        width: "0",
        height: "0",
        rx: this.#shapeType === "rounded" ? "12" : "0",
        ...(this.#shapeType === "rounded" ? { "data-rounded": "true" } : {}),
        ...this.#commonAttrs(),
      });
    }

    this.canvas.annotations.appendChild(this.#el);
  }

  onPointerMove(e: PointerEvent, pt: DOMPoint): void {
    if (!this.#drawing || !this.#el) return;
    this.#shiftHeld = e.shiftKey;

    if (this.#shapeType === "ellipse") {
      let rx = Math.abs(pt.x - this.#startX);
      let ry = Math.abs(pt.y - this.#startY);
      if (this.#shiftHeld) {
        const r = Math.max(rx, ry);
        rx = r;
        ry = r;
      }
      const cx = (this.#startX + pt.x) / 2;
      const cy = (this.#startY + pt.y) / 2;
      this.#el.setAttribute("cx", String(cx));
      this.#el.setAttribute("cy", String(cy));
      this.#el.setAttribute("rx", String(rx / 2));
      this.#el.setAttribute("ry", String(ry / 2));
    } else {
      let w = pt.x - this.#startX;
      let h = pt.y - this.#startY;
      if (this.#shiftHeld) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w) * size;
        h = Math.sign(h) * size;
      }
      const x = w < 0 ? this.#startX + w : this.#startX;
      const y = h < 0 ? this.#startY + h : this.#startY;
      this.#el.setAttribute("x", String(x));
      this.#el.setAttribute("y", String(y));
      this.#el.setAttribute("width", String(Math.abs(w)));
      this.#el.setAttribute("height", String(Math.abs(h)));

      if (this.#shapeType === "rounded") {
        // Match Office roundRect's 1/6-of-shorter-side default so
        // round-tripping via the Office clipboard stays visually stable.
        const rx = Math.max(2, Math.round(Math.min(Math.abs(w), Math.abs(h)) / 6));
        this.#el.setAttribute("rx", String(rx));
      }
    }
  }

  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {
    if (!this.#drawing || !this.#el) return;
    this.#drawing = false;

    let tooSmall: boolean;
    if (this.#shapeType === "ellipse") {
      const rx = Number.parseFloat(this.#el.getAttribute("rx") || "0");
      const ry = Number.parseFloat(this.#el.getAttribute("ry") || "0");
      tooSmall = rx < 3 || ry < 3;
    } else {
      const w = Number.parseFloat(this.#el.getAttribute("width") || "0");
      const h = Number.parseFloat(this.#el.getAttribute("height") || "0");
      tooSmall = w < 3 || h < 3;
      if (!tooSmall && this.#shapeType === "rounded") {
        const rx = Math.max(2, Math.round(Math.min(w, h) / 6));
        this.#el.setAttribute("rx", String(rx));
      }
    }

    if (tooSmall) {
      this.#el.remove();
      this.#el = null;
      return;
    }

    this.history.save();
    const el = this.#el;
    this.#el = null;
    this.onShapeComplete?.(el);
  }

  /** Common style attributes shared by all three variants. */
  #commonAttrs(): Record<string, string> {
    return {
      stroke: this.options.strokeColor,
      "stroke-width": String(this.options.strokeWidth),
      "stroke-dasharray": computeDasharray(this.options.strokeDasharray, this.options.strokeWidth),
      "data-dash-key": this.options.strokeDasharray,
      fill: this.options.fillColor,
      "fill-opacity": String(this.options.fillOpacity),
    };
  }

  /** Highlight-specific attributes. Always stroke-less; fill comes
   *  from `highlightColor` (falls back to yellow). Opacity defaults
   *  to 0.4 — enough to clearly mark the region while letting the
   *  underlying screenshot remain readable, matching the common
   *  highlighter-pen feel users expect from Acrobat / PDF tools. */
  #highlightAttrs(): Record<string, string> {
    const color = this.options.highlightColor || "#ffe100";
    const opacity = this.options.fillOpacity ?? 0.4;
    return {
      stroke: "none",
      "stroke-width": "0",
      fill: color,
      "fill-opacity": String(opacity),
    };
  }
}
