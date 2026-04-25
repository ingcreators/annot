/**
 * smart-guides — align-on-drag overlay for SelectionManager.
 *
 * The pure-math snap (`computeSnap`, `SnapInput`, `SnapResult`) lives
 * in `@ingcreators/annot-core/editor/selection-geometry` so it can be
 * unit-tested without a live DOM. This file owns the live SVG layer
 * that renders the dashed guide lines.
 */
import type { CanvasManager } from "./canvas-manager.js";

// Re-exported so existing callers can keep importing from
// `./smart-guides` and find both the math and the overlay together.
export {
  computeSnap,
  type SnapGuide,
  type SnapInput,
  type SnapResult,
} from "@ingcreators/annot-core/editor/selection-geometry";
import type { SnapResult } from "@ingcreators/annot-core/editor/selection-geometry";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Overlay layer that renders the dashed guide lines as SVG children
 *  of the canvas. The caller calls `render(guides)` on each pointer
 *  move and `clear()` when the drag ends. The layer auto-mounts on
 *  first use and lives on top of annotations. */
export class SmartGuideOverlay {
  #canvas: CanvasManager;
  #layer: SVGGElement | null = null;

  constructor(canvas: CanvasManager) {
    this.#canvas = canvas;
  }

  render(guides: SnapResult["guides"]): void {
    const layer = this.#ensureLayer();
    layer.replaceChildren();
    for (const g of guides) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(g.x1));
      line.setAttribute("y1", String(g.y1));
      line.setAttribute("x2", String(g.x2));
      line.setAttribute("y2", String(g.y2));
      line.setAttribute("stroke", "#ff00a8");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "3 3");
      line.setAttribute("pointer-events", "none");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      layer.appendChild(line);
    }
  }

  clear(): void {
    this.#layer?.replaceChildren();
  }

  #ensureLayer(): SVGGElement {
    if (this.#layer?.isConnected) return this.#layer;
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("data-role", "smart-guides");
    layer.setAttribute("pointer-events", "none");
    // Append to the SVG root AFTER annotations so guides render on top.
    this.#canvas.svg.appendChild(layer);
    this.#layer = layer;
    return layer;
  }
}
