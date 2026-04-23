import { ToolBase } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export class CropTool extends ToolBase {
  readonly name = "crop";
  #rect: SVGRectElement | null = null;
  #overlay: SVGRectElement | null = null;
  #startX = 0;
  #startY = 0;
  #drawing = false;
  #confirmHint: SVGTextElement | null = null;

  onActivate(): void {
    // Show instruction
    this.#confirmHint = document.createElementNS(SVG_NS, "text") as SVGTextElement;
    this.#confirmHint.setAttribute("x", "10");
    this.#confirmHint.setAttribute("y", "30");
    this.#confirmHint.setAttribute("fill", "#00d4ff");
    this.#confirmHint.setAttribute("font-size", "16");
    this.#confirmHint.setAttribute("font-family", "sans-serif");
    this.#confirmHint.textContent = "Draw crop area, then press Enter to confirm or Escape to cancel";
    this.canvas.uiOverlay.appendChild(this.#confirmHint);
  }

  onDeactivate(): void {
    this.#cleanup();
  }

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    // Clear previous crop rect
    this.#rect?.remove();
    this.#overlay?.remove();

    this.#drawing = true;
    this.#startX = pt.x;
    this.#startY = pt.y;

    this.#overlay = this.createSVG("rect", {
      x: "0",
      y: "0",
      width: String(this.canvas.imageWidth),
      height: String(this.canvas.imageHeight),
      fill: "rgba(0,0,0,0.5)",
      "pointer-events": "none",
    });
    this.canvas.uiOverlay.appendChild(this.#overlay);

    this.#rect = this.createSVG("rect", {
      x: String(pt.x),
      y: String(pt.y),
      width: "0",
      height: "0",
      stroke: "#00d4ff",
      "stroke-width": "2",
      fill: "rgba(0,0,0,0)",
      "stroke-dasharray": "6",
    });
    this.canvas.uiOverlay.appendChild(this.#rect);
  }

  onPointerMove(_e: PointerEvent, pt: DOMPoint): void {
    if (!this.#drawing || !this.#rect) return;
    const x = Math.min(this.#startX, pt.x);
    const y = Math.min(this.#startY, pt.y);
    const w = Math.abs(pt.x - this.#startX);
    const h = Math.abs(pt.y - this.#startY);
    this.#rect.setAttribute("x", String(x));
    this.#rect.setAttribute("y", String(y));
    this.#rect.setAttribute("width", String(w));
    this.#rect.setAttribute("height", String(h));

    // Update overlay clip to show crop area clearly
    if (this.#overlay) {
      // Use clip-path to punch a hole
      const clipId = "anno-crop-clip";
      let clipPath = this.canvas.defs.querySelector(`#${clipId}`);
      if (!clipPath) {
        clipPath = document.createElementNS(SVG_NS, "clipPath");
        clipPath.id = clipId;
        this.canvas.defs.appendChild(clipPath);
      }
      clipPath.innerHTML = "";

      // Full rect minus crop area (use fill-rule evenodd)
      const outerRect = document.createElementNS(SVG_NS, "rect");
      outerRect.setAttribute("x", "0");
      outerRect.setAttribute("y", "0");
      outerRect.setAttribute("width", String(this.canvas.imageWidth));
      outerRect.setAttribute("height", String(this.canvas.imageHeight));
      clipPath.appendChild(outerRect);

      this.#overlay.setAttribute("clip-path", "none");
      this.#overlay.setAttribute("x", "0");
      this.#overlay.setAttribute("y", "0");
    }
  }

  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {
    this.#drawing = false;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && this.#rect) {
      this.#applyCrop();
    } else if (e.key === "Escape") {
      this.#cleanup();
    }
  }

  #applyCrop(): void {
    if (!this.#rect) return;

    const x = parseFloat(this.#rect.getAttribute("x")!);
    const y = parseFloat(this.#rect.getAttribute("y")!);
    const w = parseFloat(this.#rect.getAttribute("width")!);
    const h = parseFloat(this.#rect.getAttribute("height")!);

    if (w < 10 || h < 10) {
      this.#cleanup();
      return;
    }

    // Update viewBox to crop area
    this.canvas.updateViewBox(x, y, w, h);
    this.canvas.setZoom(1);
    this.canvas.fitToView();

    this.#cleanup();
    this.history.save();
  }

  #cleanup(): void {
    this.#rect?.remove();
    this.#rect = null;
    this.#overlay?.remove();
    this.#overlay = null;
    this.#confirmHint?.remove();
    this.#confirmHint = null;
    this.canvas.defs.querySelector("#anno-crop-clip")?.remove();
  }
}
