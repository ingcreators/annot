import { REDACT_SOLID_COLOR } from "../../utils/constants.js";
import {
  type RedactRect,
  renderBlurRedact,
  renderMosaicRedact,
  renderSolidRedact,
} from "../redact-utils.js";
import type { RedactStyle } from "./tool-base.js";
/**
 * RedactTool — unified Mosaic / Solid / Blur redaction tool.
 *
 * Drag out a rectangle; on release, bake the redaction into a
 * self-contained SVG element chosen by the `redactStyle` option:
 *    "mosaic" → block-averaged PNG (default, classic pixelation)
 *    "solid"  → opaque colored <rect> (fastest, reversible-proof)
 *    "blur"   → gaussian-blurred PNG
 *
 * All three produce elements tagged with `data-redact-style=...` so
 * SelectionManager / PropertyPanel can treat them as redactions and
 * offer the user an in-place style-swap without redrawing.
 */
import { ToolBase } from "./tool-base.js";

export class RedactTool extends ToolBase {
  readonly name = "redact";
  #marquee: SVGRectElement | null = null;
  #startX = 0;
  #startY = 0;
  #drawing = false;

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    this.#drawing = true;
    this.#startX = pt.x;
    this.#startY = pt.y;
    // Live marquee drawn in the UI overlay (not the annotations
    // group) so it doesn't persist as an annotation if the drag is
    // canceled / too small.
    this.#marquee = this.createSVG("rect", {
      x: String(pt.x),
      y: String(pt.y),
      width: "0",
      height: "0",
      stroke: "#00d4ff",
      "stroke-width": "1",
      "stroke-dasharray": "4",
      fill: "rgba(0,212,255,0.1)",
    });
    this.canvas.uiOverlay.appendChild(this.#marquee);
  }

  onPointerMove(_e: PointerEvent, pt: DOMPoint): void {
    if (!this.#drawing || !this.#marquee) return;
    const x = Math.min(this.#startX, pt.x);
    const y = Math.min(this.#startY, pt.y);
    const w = Math.abs(pt.x - this.#startX);
    const h = Math.abs(pt.y - this.#startY);
    this.#marquee.setAttribute("x", String(x));
    this.#marquee.setAttribute("y", String(y));
    this.#marquee.setAttribute("width", String(w));
    this.#marquee.setAttribute("height", String(h));
  }

  async onPointerUp(_e: PointerEvent, _pt: DOMPoint): Promise<void> {
    if (!this.#drawing || !this.#marquee) return;
    this.#drawing = false;

    const rect: RedactRect = {
      x: Math.round(Number.parseFloat(this.#marquee.getAttribute("x")!)),
      y: Math.round(Number.parseFloat(this.#marquee.getAttribute("y")!)),
      width: Math.round(Number.parseFloat(this.#marquee.getAttribute("width")!)),
      height: Math.round(Number.parseFloat(this.#marquee.getAttribute("height")!)),
    };
    this.#marquee.remove();
    this.#marquee = null;

    if (rect.width < 5 || rect.height < 5) return;

    const style: RedactStyle = this.options.redactStyle ?? "mosaic";
    try {
      const el = await this.#render(rect, style);
      if (el) {
        this.canvas.annotations.appendChild(el);
        this.history.save();
        this.onShapeComplete?.(el);
      }
    } catch (err) {
      console.error("[redact] failed to render", style, err);
      // Fallback to solid so the user's intent (hide this region)
      // still succeeds even if the image couldn't be sampled.
      const fallback = renderSolidRedact(rect);
      this.canvas.annotations.appendChild(fallback);
      this.history.save();
      this.onShapeComplete?.(fallback);
    }
  }

  async #render(rect: RedactRect, style: RedactStyle): Promise<SVGElement | null> {
    if (style === "solid") {
      // Allow the user's fillColor preference to drive the bar color;
      // fall back to the constant if no explicit color was set.
      const color =
        this.options.fillColor && this.options.fillColor !== "none"
          ? this.options.fillColor
          : REDACT_SOLID_COLOR;
      return renderSolidRedact(rect, color);
    }
    if (style === "blur") {
      return await renderBlurRedact(rect, this.canvas);
    }
    return await renderMosaicRedact(rect, this.canvas);
  }
}
