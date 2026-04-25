import {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
} from "@ingcreators/annot-core/editor/svg-format";

/**
 * Render an `ImageRecord`-like blob (original image + annotations
 * SVG + dimensions) to a `data:` URL.
 *
 * Preserves the source format: JPEG sources land back as JPEG,
 * everything else lands as PNG. Used today by the three storage
 * backends (`BrowserStore`, `DeviceStore`, `GoogleDriveStore`,
 * `GitHubStore`) for thumbnail generation, and intended as the
 * seed of the future gallery bulk-export view (select N images
 * → ZIP / multi-slide PPTX / etc.).
 *
 * No live editor session required — this is `ImageRecord` →
 * bitmap, the data-driven counterpart to the
 * `CanvasManager`-coupled `saveAsEditableImage` /
 * `downloadAsImage` exports that live in `@ingcreators/annot-editor`.
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

  svgString += "</svg>";

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
