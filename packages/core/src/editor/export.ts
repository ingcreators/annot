import type { CanvasManager } from "./canvas-manager.js";
import { createEditableImage } from "../xmp/xmp-browser.js";
import {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
  stampAnnotVersion,
} from "./svg-format.js";

export function exportSVGString(canvas: CanvasManager): string {
  const clone = canvas.svg.cloneNode(true) as SVGSVGElement;

  clone.querySelector("#ui-overlay")?.remove();

  // Flatten annotations
  flattenAnnotations(clone);

  clone.removeAttribute("style");
  clone.setAttribute("width", String(canvas.imageWidth));
  clone.setAttribute("height", String(canvas.imageHeight));

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(clone);
  svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
  return svgString;
}

/**
 * Excel-compatible SVG: only basic shapes, no defs/markers/images/xlink.
 * Arrows are converted from <line>+marker to <path> with arrowhead polygon.
 */
export function exportExcelSVG(canvas: CanvasManager): string {
  const SVG_NS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(canvas.imageWidth));
  svg.setAttribute("height", String(canvas.imageHeight));
  // Freshly-constructed SVG (not a clone of the live canvas) — stamp
  // the format version explicitly so Excel-bound exports still carry
  // the versioning contract.
  stampAnnotVersion(svg);

  // Process each annotation element
  const annos = canvas.annotations.childNodes;
  for (const node of Array.from(annos)) {
    const el = node as SVGElement;
    const tag = el.tagName;

    if (tag === "line") {
      const hasArrow = el.getAttribute("marker-end");
      if (hasArrow) {
        // Convert line+marker to path group with arrowhead
        const group = convertArrowToPath(el as SVGLineElement, SVG_NS);
        svg.appendChild(group);
      } else {
        const copy = el.cloneNode(true) as SVGElement;
        copy.removeAttribute("marker-end");
        copy.removeAttribute("marker-start");
        svg.appendChild(copy);
      }
    } else if (tag === "rect" || tag === "ellipse" || tag === "path" || tag === "text") {
      svg.appendChild(el.cloneNode(true));
    } else if (tag === "g") {
      // Marker groups (circle+text) - clone as-is, Excel handles basic groups
      const clone = el.cloneNode(true) as SVGElement;
      // Remove any image children inside the group
      for (const img of Array.from(clone.querySelectorAll("image"))) {
        img.remove();
      }
      svg.appendChild(clone);
    }
    // Skip <image> elements (mosaic, etc.) - not Excel compatible
  }

  const serializer = new XMLSerializer();
  let result = serializer.serializeToString(svg);
  // Clean up: remove xmlns:xlink if present
  result = result.replace(/\s*xmlns:xlink="[^"]*"/g, "");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + result;
}

/** Convert a <line> with marker-end into a <path> with arrowhead polygon */
function convertArrowToPath(line: SVGLineElement, SVG_NS: string): SVGElement {
  const x1 = parseFloat(line.getAttribute("x1") || "0");
  const y1 = parseFloat(line.getAttribute("y1") || "0");
  const x2 = parseFloat(line.getAttribute("x2") || "0");
  const y2 = parseFloat(line.getAttribute("y2") || "0");
  const stroke = line.getAttribute("stroke") || "#ff0000";
  const sw = parseFloat(line.getAttribute("stroke-width") || "3");

  // Direction vector
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    return document.createElementNS(SVG_NS, "g") as unknown as SVGElement;
  }
  const ux = dx / len;
  const uy = dy / len;

  // Arrowhead size proportional to stroke width
  const headLen = sw * 4;
  const headW = sw * 2.5;

  // Shorten line so it ends at arrowhead base
  const lineEndX = x2 - ux * headLen;
  const lineEndY = y2 - uy * headLen;

  // Perpendicular vector
  const px = -uy;
  const py = ux;

  // Arrowhead triangle points
  const p1x = lineEndX + px * headW;
  const p1y = lineEndY + py * headW;
  const p2x = lineEndX - px * headW;
  const p2y = lineEndY - py * headW;

  const g = document.createElementNS(SVG_NS, "g");

  // Line body
  const path = document.createElementNS(SVG_NS, "line");
  path.setAttribute("x1", String(x1));
  path.setAttribute("y1", String(y1));
  path.setAttribute("x2", String(lineEndX));
  path.setAttribute("y2", String(lineEndY));
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", String(sw));
  g.appendChild(path);

  // Arrowhead as polygon
  const arrow = document.createElementNS(SVG_NS, "polygon");
  arrow.setAttribute("points", `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`);
  arrow.setAttribute("fill", stroke);
  g.appendChild(arrow);

  return g as unknown as SVGElement;
}

function flattenAnnotations(svg: SVGSVGElement): void {
  const annoGroup = svg.querySelector("#annotations");
  if (annoGroup) {
    const parent = annoGroup.parentNode!;
    while (annoGroup.firstChild) {
      parent.insertBefore(annoGroup.firstChild, annoGroup);
    }
    annoGroup.remove();
  }
}

/** Save full SVG (screenshot + annotations) */
export function saveToFile(canvas: CanvasManager): void {
  const svgString = exportSVGString(canvas);
  downloadFile(svgString, "image/svg+xml", `anno-${Date.now()}.svg`);
}

/** Save as re-editable JPEG or PNG with XMP metadata */
export async function saveAsEditableImage(canvas: CanvasManager, format: "jpg" | "png"): Promise<void> {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  if (!isTauri) return;

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { saveWithXmp } = await import("../utils/tauri-bridge.js");

    const ext = format === "jpg" ? "jpg" : "png";
    const filterName = format === "jpg" ? "JPEG" : "PNG";
    const path = await save({
      defaultPath: `anno-${Date.now()}.anno.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (!path) return;

    // Render the full image as PNG (Rust converts to JPEG if needed)
    const renderedDataUrl = await getPngDataUrl(canvas);
    const renderedB64 = renderedDataUrl.split(",")[1];

    // Get original capture image (without annotations)
    const originalDataUrl = canvas.imageEl.getAttribute("href") || "";
    const originalB64 = originalDataUrl.split(",")[1] || "";

    // Get annotations SVG (without the base image)
    const annotationsSvg = exportAnnotationsSVGString(canvas);

    await saveWithXmp(
      renderedB64,
      originalB64,
      annotationsSvg,
      canvas.imageWidth,
      canvas.imageHeight,
      path,
    );
  } catch (e) {
    console.error("Save failed:", e);
  }
}

/** Export annotations only as SVG string (no base image). Public alias for IDB save. */
export function exportAnnotationsSvgForIdb(canvas: CanvasManager): string {
  return exportAnnotationsSVGString(canvas);
}

/** Export annotations only as SVG string (no base image) */
function exportAnnotationsSVGString(canvas: CanvasManager): string {
  const clone = canvas.svg.cloneNode(true) as SVGSVGElement;
  clone.querySelector("#ui-overlay")?.remove();

  // Remove base image
  const baseImg = clone.querySelector(":scope > image");
  if (baseImg) baseImg.remove();

  // Flatten annotations
  const annoGroup = clone.querySelector("#annotations");
  if (annoGroup) {
    const parent = annoGroup.parentNode!;
    while (annoGroup.firstChild) {
      parent.insertBefore(annoGroup.firstChild, annoGroup);
    }
    annoGroup.remove();
  }

  clone.removeAttribute("style");
  clone.setAttribute("width", String(canvas.imageWidth));
  clone.setAttribute("height", String(canvas.imageHeight));

  return new XMLSerializer().serializeToString(clone);
}


async function downloadFile(content: string, _mime: string, filename: string): Promise<void> {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

  if (isTauri) {
    // Use Tauri save dialog
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        defaultPath: filename,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (path) {
        await writeTextFile(path, content);
      }
    } catch (e) {
      console.error("Save failed:", e);
    }
  } else {
    // Browser fallback
    const blob = new Blob([content], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/** Get full screenshot + annotations as PNG data URL */
export async function getPngDataUrl(canvas: CanvasManager): Promise<string> {
  const pngBlob = await rasterizeSVG(exportSVGString(canvas), canvas.imageWidth, canvas.imageHeight);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(pngBlob);
  });
}

/** Copy: PNG (full) */
export async function copyAsImage(canvas: CanvasManager): Promise<void> {
  const pngBlob = await rasterizeSVG(exportSVGString(canvas), canvas.imageWidth, canvas.imageHeight);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": pngBlob }),
  ]);
}

/** Copy: annotations only as transparent PNG */
export async function copyAnnotationsAsImage(canvas: CanvasManager): Promise<void> {
  const annoSvg = exportExcelSVG(canvas);
  const pngBlob = await rasterizeSVG(annoSvg, canvas.imageWidth, canvas.imageHeight);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": pngBlob }),
  ]);
}

/** Download as re-editable PNG or JPEG with XMP metadata (browser) */
export async function downloadAsImage(canvas: CanvasManager, format: "png" | "jpg"): Promise<void> {
  // Render the full image (screenshot + annotations) as PNG blob
  const svgString = exportSVGString(canvas);
  const renderedBlob = await rasterizeSVG(svgString, canvas.imageWidth, canvas.imageHeight);

  // Original capture image (without annotations)
  const originalDataUrl = canvas.imageEl.getAttribute("href") || "";

  // Annotations-only SVG
  const annotationsSvg = exportAnnotationsSVGString(canvas);

  // Get current tags from editor
  const tags: Record<string, string> = typeof (window as any).__anno_getTags === "function"
    ? (window as any).__anno_getTags()
    : {};

  // Embed XMP metadata for re-editing
  const editableBlob = await createEditableImage({
    renderedBlob,
    originalDataUrl,
    annotationsSvg,
    width: canvas.imageWidth,
    height: canvas.imageHeight,
    format,
    tags,
  });

  const ext = format === "jpg" ? "jpg" : "png";
  const url = URL.createObjectURL(editableBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `anno-${Date.now()}.anno.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Render an ImageRecord (original image + annotations SVG) to a data URL.
 * Preserves original format (JPEG→JPEG, PNG→PNG).
 * Used for batch download — no live canvas/editor needed.
 */
export async function renderImageRecord(
  originalDataUrl: string,
  annotationsSvg: string,
  width: number,
  height: number,
): Promise<string> {
  const isJpeg = originalDataUrl.startsWith("data:image/jpeg");

  // Build a full SVG with embedded base image + annotations
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";

  // String-constructed SVG — include the Annot version stamp inline
  // so this re-rasterization path stays consistent with the live
  // editor's writes (see svg-format.ts).
  let svgString = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK}" ${ANNOT_SVG_VERSION_ATTR}="${ANNOT_SVG_VERSION}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  // Arrowhead marker def
  svgString += `<defs><marker id="anno-arrowhead" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 12 4, 0 8" fill="context-stroke"/></marker></defs>`;

  // Base image
  svgString += `<image href="${originalDataUrl}" width="${width}" height="${height}"/>`;

  // Annotations — parse and inject elements
  if (annotationsSvg && annotationsSvg.length > 10) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(annotationsSvg, "image/svg+xml");
    const root = doc.documentElement;
    // Extract child elements (skip defs, base image, ui-overlay)
    for (const child of Array.from(root.children)) {
      const tag = child.tagName;
      if (tag === "defs") continue;
      if (tag === "image" && !child.closest("g")) continue;
      if (child.id === "ui-overlay") continue;
      if (child.id === "annotations") {
        for (const anno of Array.from(child.children)) {
          svgString += new XMLSerializer().serializeToString(anno);
        }
        continue;
      }
      svgString += new XMLSerializer().serializeToString(child);
    }
  }

  svgString += `</svg>`;

  const pngBlob = await rasterizeSVG(svgString, width, height);

  if (isJpeg) {
    // Convert PNG to JPEG via canvas
    const pngUrl = URL.createObjectURL(pngBlob);
    const tmpImg = new Image();
    await new Promise<void>((resolve, reject) => {
      tmpImg.onload = () => resolve();
      tmpImg.onerror = reject;
      tmpImg.src = pngUrl;
    });
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(tmpImg, 0, 0);
    URL.revokeObjectURL(pngUrl);
    return c.toDataURL("image/jpeg", 0.92);
  }

  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(pngBlob);
  });
}

async function rasterizeSVG(svgString: string, width: number, height: number): Promise<Blob> {
  const img = new Image();
  const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  return new Promise<Blob>((resolve) => {
    c.toBlob((b) => resolve(b!), "image/png");
  });
}
