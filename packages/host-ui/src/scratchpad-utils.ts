/**
 * Scratchpad helpers — serialize a selection into a reusable SVG
 * fragment and render a PNG thumbnail for preview.
 *
 * Design choice: we DON'T wrap stored children in a `<g
 * transform="translate(...)">` wrapper. Each child's own coordinate
 * attributes are normalised to origin via the move-bakes-coordinates
 * dispatcher (`moveAnnotationElement`), so the resulting clone has
 * NO leftover wrapper transform. On insert, the same dispatcher
 * shifts the placement (cx, cy) into geometry, and the cloned
 * children are appended directly to the canvas.
 *
 * **Why bake instead of wrap.** The editor's move path
 * (`SelectionManager.#moveElement`) follows the
 * `move-bakes-coordinates.md` invariant: for unrotated shapes it
 * BAKES the drag delta into the children's geometry attrs and then
 * strips any wrapper `transform="translate(...)"` via
 * `applyTransformState`. So a scratchpad-inserted shape that relied
 * on a wrapper translate to position itself would JUMP back to its
 * source position on the user's first move — its inner geometry
 * still pointed at where the original was when saved, and the
 * wrapper translate that compensated just got dropped. The visible
 * symptoms were tspans / sticky bg rects landing far from the
 * pasted insertion point and overlapping or hiding behind unrelated
 * annotations after the next drag.
 *
 * **Why no wrapper around the stored fragment.** Because
 * PropertyPanel dispatches on element tagName + data-attr
 * (rect / ellipse / line / path / g[data-type=textbox] /
 * g[data-marker]). Wrapping inserted items in a plain `<g>` would
 * hide the shape type from PropertyPanel, breaking "edit properties
 * of a scratchpad-inserted shape". Direct-coords is shape-type-
 * agnostic downstream and costs nothing now that the move dispatcher
 * is the canonical mover.
 */

import {
  annotationBBox,
  moveAnnotationElement,
} from "@ingcreators/annot-core/editor/bake-translate";
import { freshenInternalIds } from "@ingcreators/annot-core/editor/svg-id-utils";

export interface SerializedSelection {
  svgMarkup: string;
  width: number;
  height: number;
}

/**
 * Compute an element's canvas-space bounding box. Prefers
 * `getCTM`-based composition (correct under rotation / flip / nested
 * transforms) and falls back to combining `getBBox()` with the
 * element's own `transform="translate(...)"` for environments where
 * `getCTM()` is unavailable (jsdom in some test setups).
 */
function canvasBBox(el: SVGElement): { x: number; y: number; w: number; h: number } | null {
  const g = el as SVGGraphicsElement;

  // Live-browser path: getBBox + getCTM honors rotation / nested
  // transforms. Skip when getBBox returns zeros (e.g. happy-dom /
  // jsdom — they don't lay out — or a disconnected element) and
  // fall through to the attribute-based bbox below.
  if (typeof g.getBBox === "function") {
    let bb: DOMRect | null = null;
    try {
      bb = g.getBBox();
    } catch {
      bb = null;
    }
    if (bb && (bb.width !== 0 || bb.height !== 0)) {
      const svg = el.ownerSVGElement;
      if (svg && typeof g.getCTM === "function") {
        const ctm = g.getCTM();
        const svgCTM = svg.getCTM();
        if (ctm && svgCTM) {
          const m = svgCTM.inverse().multiply(ctm);
          const corners = [
            new DOMPoint(bb.x, bb.y).matrixTransform(m),
            new DOMPoint(bb.x + bb.width, bb.y).matrixTransform(m),
            new DOMPoint(bb.x + bb.width, bb.y + bb.height).matrixTransform(m),
            new DOMPoint(bb.x, bb.y + bb.height).matrixTransform(m),
          ];
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          for (const c of corners) {
            if (c.x < minX) minX = c.x;
            if (c.y < minY) minY = c.y;
            if (c.x > maxX) maxX = c.x;
            if (c.y > maxY) maxY = c.y;
          }
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
      }
      // No CTM available — compose with `transform="translate(...)"`
      // (best-effort for unrotated shapes).
      const transform = el.getAttribute("transform") || "";
      const match = transform.match(/translate\(([\d.-]+),?\s*([\d.-]+)\)/);
      const tx = match ? Number.parseFloat(match[1]!) : 0;
      const ty = match ? Number.parseFloat(match[2]!) : 0;
      return { x: bb.x + tx, y: bb.y + ty, w: bb.width, h: bb.height };
    }
  }

  // Geometry-based fallback — purely attribute-driven, no layout.
  // Correct for every Annot annotation in the unrotated case (the
  // dominant scratchpad use); rotated shapes lose the rotation extent
  // here, but the live-browser path above will already have caught
  // those via the matrix composition.
  return annotationBBox(el);
}

/**
 * Serialize one or more annotation elements into a standalone SVG
 * document positioned at (0, 0). Each stored child has its
 * geometry baked to origin — no wrapper translate, no leftover
 * `data-tx` / `data-ty` — so PropertyPanel can type-dispatch
 * correctly on insert and the move-bake invariant holds when the
 * user drags the inserted shape.
 */
export function serializeSelection(elements: SVGElement[]): SerializedSelection | null {
  if (elements.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    const bb = canvasBBox(el);
    if (!bb) continue;
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.w);
    maxY = Math.max(maxY, bb.y + bb.h);
  }
  if (!Number.isFinite(minX)) return null;

  const PAD = 4;
  minX -= PAD;
  minY -= PAD;
  maxX += PAD;
  maxY += PAD;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const xmlns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(xmlns, "svg");
  svg.setAttribute("xmlns", xmlns);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  // Clone each selected element, bake `(-minX, -minY)` into its
  // geometry via the move dispatcher, and append as a direct child
  // of `<svg>`. No wrapper group — see this file's header for why.
  for (const el of elements) {
    const clone = el.cloneNode(true) as SVGElement;
    moveAnnotationElement(clone, -minX, -minY);
    svg.appendChild(clone);
  }

  return {
    svgMarkup: new XMLSerializer().serializeToString(svg),
    width: w,
    height: h,
  };
}

/**
 * Render a small transparent-background PNG preview of an SVG markup
 * string. Used to give scratchpad items a glanceable thumbnail.
 *
 * The rendering goes through a Blob URL → <img> → <canvas> pipeline
 * because <canvas>.drawImage() accepts <img> elements sourced from
 * SVG data URLs / blob URLs reliably across browsers.
 */
export async function renderThumbnail(svgMarkup: string, maxSize = 80): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGSVGElement;
  const w = Number.parseFloat(root.getAttribute("width") || "80");
  const h = Number.parseFloat(root.getAttribute("height") || "80");

  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvasW = Math.max(1, Math.round(w * scale));
  const canvasH = Math.max(1, Math.round(h * scale));

  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(img, 0, 0, canvasW, canvasH);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Parse a stored scratchpad SVG and return its direct children (each
 * already at origin-relative coords thanks to the serializer). Each
 * returned child has its internal ids freshened so it can be appended
 * into a canvas that already contains the original (or any prior
 * paste of the same item) without `url(#...)` reference collisions —
 * for a sticky / text-on-shape, the wrapper's `<clipPath>` shares its
 * id with the source's clipPath, and SVG resolves duplicate ids by
 * picking the FIRST in document order. Without this rewrite the
 * pasted text would clip against the source's clip rect and visually
 * disappear (the text content is still in the DOM, just clipped out
 * by a rect that's now far from the pasted position).
 *
 * The caller should clone each child, translate by the drop point,
 * and append to the canvas annotations.
 */
export function parseStoredItem(svgMarkup: string): SVGElement[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGSVGElement;
  const children = Array.from(root.children) as SVGElement[];
  for (const child of children) {
    freshenInternalIds(child);
  }
  return children;
}
