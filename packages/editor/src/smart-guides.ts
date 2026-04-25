/**
 * smart-guides — align-on-drag helpers for SelectionManager.
 *
 * During a drag, each selected element's proposed bounding box is
 * compared against every OTHER (unselected) element's bbox. When a
 * pair of edges (or centers) comes within `threshold` world-units,
 * the drag delta is nudged so the edges coincide, and a horizontal
 * or vertical dashed guide line is drawn through both. The effect
 * mirrors Figma / Illustrator / Keynote's "smart guides".
 *
 * Snap candidates per axis (for each dragged bbox edge):
 *   - left   ↔ other's left, center-x, right
 *   - centerX ↔ same three
 *   - right  ↔ same three
 * Same six comparisons on Y. That's 18 candidate offsets per
 * (dragged, other) pair; we keep the smallest absolute delta per
 * axis, breaking ties by edge-similarity (left↔left before
 * left↔right) to pick the most intuitive alignment.
 */
import type { CanvasManager } from "@ingcreators/annot-core/editor/canvas-manager";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface SnapResult {
  /** Adjusted drag delta in world units — what the caller should
   *  apply instead of the raw pointer delta. */
  dx: number;
  dy: number;
  /** World-space line segments to render as dashed guides. Each
   *  guide is an axis-aligned line through the snap point. */
  guides: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface SnapInput {
  /** Bounding boxes of the dragged (selected) elements in world
   *  space, computed BEFORE applying the current delta. */
  draggedBoxes: DOMRect[];
  /** Raw pointer delta the caller wants to apply. */
  dx: number;
  dy: number;
  /** Bounding boxes of NON-dragged elements to snap against. */
  otherBoxes: DOMRect[];
  /** Snap activation radius in world units. Typically 4-6 px. */
  threshold: number;
}

/** Compute a snapped drag delta and the guide lines to render.
 *  Returns the raw dx/dy unmodified when no snap candidate is in
 *  range. */
export function computeSnap(input: SnapInput): SnapResult {
  const { draggedBoxes, dx, dy, otherBoxes, threshold } = input;
  if (draggedBoxes.length === 0 || otherBoxes.length === 0) {
    return { dx, dy, guides: [] };
  }
  // Union bbox of the dragged group after the proposed move — we
  // snap the group's leading/center/trailing edges, not each
  // individual dragged element. This makes multi-select drag feel
  // like moving a single bigger object.
  const unionBefore = unionRect(draggedBoxes);
  const proposed = {
    left: unionBefore.x + dx,
    right: unionBefore.x + unionBefore.width + dx,
    centerX: unionBefore.x + unionBefore.width / 2 + dx,
    top: unionBefore.y + dy,
    bottom: unionBefore.y + unionBefore.height + dy,
    centerY: unionBefore.y + unionBefore.height / 2 + dy,
  };

  // Best (smallest) offset for each axis.
  let bestX: { delta: number; guide: { x1: number; y1: number; x2: number; y2: number } } | null =
    null;
  let bestY: { delta: number; guide: { x1: number; y1: number; x2: number; y2: number } } | null =
    null;

  for (const other of otherBoxes) {
    const oEdges = {
      left: other.x,
      right: other.x + other.width,
      centerX: other.x + other.width / 2,
      top: other.y,
      bottom: other.y + other.height,
      centerY: other.y + other.height / 2,
    };
    // --- X axis ---
    for (const [proposedEdge, pv] of Object.entries({
      left: proposed.left,
      centerX: proposed.centerX,
      right: proposed.right,
    })) {
      for (const [otherEdge, ov] of Object.entries({
        left: oEdges.left,
        centerX: oEdges.centerX,
        right: oEdges.right,
      })) {
        const diff = ov - pv;
        if (Math.abs(diff) <= threshold) {
          if (!bestX || Math.abs(diff) < Math.abs(bestX.delta)) {
            // Guide runs vertically through the aligned x, spanning
            // the union of both bboxes in y so it visually ties them.
            const x = ov;
            const y1 = Math.min(unionBefore.y + dy, other.y);
            const y2 = Math.max(unionBefore.y + dy + unionBefore.height, other.y + other.height);
            bestX = { delta: diff, guide: { x1: x, y1, x2: x, y2 } };
          }
          // Note: we don't break — keep looking for a BETTER (smaller)
          // candidate across all edge pairs. Tiny perf cost, cleaner
          // result.
          void proposedEdge;
          void otherEdge;
        }
      }
    }
    // --- Y axis ---
    for (const [, pv] of Object.entries({
      top: proposed.top,
      centerY: proposed.centerY,
      bottom: proposed.bottom,
    })) {
      for (const [, ov] of Object.entries({
        top: oEdges.top,
        centerY: oEdges.centerY,
        bottom: oEdges.bottom,
      })) {
        const diff = ov - pv;
        if (Math.abs(diff) <= threshold) {
          if (!bestY || Math.abs(diff) < Math.abs(bestY.delta)) {
            const y = ov;
            const x1 = Math.min(unionBefore.x + dx, other.x);
            const x2 = Math.max(unionBefore.x + dx + unionBefore.width, other.x + other.width);
            bestY = { delta: diff, guide: { x1, y1: y, x2, y2: y } };
          }
        }
      }
    }
  }

  const guides: SnapResult["guides"] = [];
  let adjDx = dx;
  let adjDy = dy;
  if (bestX) {
    adjDx += bestX.delta;
    guides.push(bestX.guide);
  }
  if (bestY) {
    adjDy += bestY.delta;
    guides.push(bestY.guide);
  }
  return { dx: adjDx, dy: adjDy, guides };
}

function unionRect(rects: DOMRect[]): DOMRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}

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
