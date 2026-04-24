/**
 * Scratchpad helpers — serialize a selection into a reusable SVG
 * fragment and render a PNG thumbnail for preview.
 *
 * Design choice: we DON'T wrap stored children in a <g translate(...)>
 * wrapper. Each child's own coordinate attributes are shifted so the
 * composition sits at origin. On insert, the caller shifts each
 * cloned child by (cx, cy) and appends directly to the canvas.
 *
 * Why no wrapper? Because the PropertyPanel dispatches on element
 * tagName + data-attr (rect / ellipse / line / path / g[data-type=
 * textbox] / g[data-marker]). Wrapping inserted items in a plain <g>
 * would hide the shape type from PropertyPanel, breaking "edit
 * properties of a scratchpad-inserted shape". Direct-coords is
 * shape-type-agnostic downstream and costs one little helper here.
 */

export interface SerializedSelection {
  svgMarkup: string;
  width: number;
  height: number;
}

/**
 * Shift an SVG annotation element's position by (dx, dy) by mutating
 * its coordinate attributes in place. Mirrors the logic in
 * SelectionManager#moveElement so a scratchpad insert produces the
 * same shape of DOM the editor already knows how to drag.
 */
export function translateElement(el: SVGElement, dx: number, dy: number): void {
  const tag = el.tagName;
  if (tag === "rect" || tag === "image" || tag === "text" || tag === "foreignObject") {
    el.setAttribute("x", String(Number.parseFloat(el.getAttribute("x") || "0") + dx));
    el.setAttribute("y", String(Number.parseFloat(el.getAttribute("y") || "0") + dy));
  } else if (tag === "ellipse" || tag === "circle") {
    el.setAttribute("cx", String(Number.parseFloat(el.getAttribute("cx") || "0") + dx));
    el.setAttribute("cy", String(Number.parseFloat(el.getAttribute("cy") || "0") + dy));
  } else if (tag === "line") {
    el.setAttribute("x1", String(Number.parseFloat(el.getAttribute("x1") || "0") + dx));
    el.setAttribute("y1", String(Number.parseFloat(el.getAttribute("y1") || "0") + dy));
    el.setAttribute("x2", String(Number.parseFloat(el.getAttribute("x2") || "0") + dx));
    el.setAttribute("y2", String(Number.parseFloat(el.getAttribute("y2") || "0") + dy));
  } else if (tag === "path" || tag === "g") {
    // Compose with any existing translate (e.g. counter/marker <g>s
    // often carry a transform from previous drags).
    const transform = el.getAttribute("transform") || "";
    const match = transform.match(/translate\(([\d.-]+),?\s*([\d.-]+)\)/);
    // Both capture groups are required by the regex.
    const tx = match ? Number.parseFloat(match[1]!) + dx : dx;
    const ty = match ? Number.parseFloat(match[2]!) + dy : dy;
    el.setAttribute("transform", `translate(${tx}, ${ty})`);
  }
}

/**
 * Compute an element's canvas-space bounding box by combining its
 * local getBBox() with its own `transform="translate(...)"` (if any).
 * Annotations in Annot only use translate — scale / rotate aren't
 * part of the editor vocabulary — so this simple composition is
 * sufficient.
 */
function canvasBBox(el: SVGElement): { x: number; y: number; w: number; h: number } | null {
  const g = el as SVGGraphicsElement;
  if (typeof g.getBBox !== "function") return null;
  const bb = g.getBBox();
  if (bb.width === 0 && bb.height === 0) return null;
  const transform = el.getAttribute("transform") || "";
  const match = transform.match(/translate\(([\d.-]+),?\s*([\d.-]+)\)/);
  const tx = match ? Number.parseFloat(match[1]!) : 0;
  const ty = match ? Number.parseFloat(match[2]!) : 0;
  return { x: bb.x + tx, y: bb.y + ty, w: bb.width, h: bb.height };
}

/**
 * Serialize one or more annotation elements into a standalone SVG
 * document positioned at (0, 0). Each stored child has its own
 * coordinate attributes already shifted to origin — no wrapper
 * translate group — so PropertyPanel can type-dispatch correctly
 * on insert.
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

  // Clone each selected element, shift its coords to origin, and
  // append as a direct child of <svg>. No wrapper group.
  for (const el of elements) {
    const clone = el.cloneNode(true) as SVGElement;
    translateElement(clone, -minX, -minY);
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
 * already at origin-relative coords thanks to the serializer). The
 * caller should clone them, translate by the drop point, and append
 * to the canvas annotations.
 */
export function parseStoredItem(svgMarkup: string): SVGElement[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGSVGElement;
  return Array.from(root.children) as SVGElement[];
}
