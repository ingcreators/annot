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

  // Base image
  svgString += `<image href="${originalDataUrl}" width="${width}" height="${height}"/>`;

  // Annotations — parse and inject elements
  if (annotationsSvg && annotationsSvg.length > 10) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(annotationsSvg, "image/svg+xml");
    const root = doc.documentElement;
    const serializer = new XMLSerializer();
    // Extract child elements. We preserve `<defs>` content
    // (gradients via `gradient-utils`, arrow markers) so the
    // annotation's id refs — `fill="url(#grad-…)"`,
    // `marker-end="url(#…)"` — still resolve in the rendered
    // bitmap. We strip only the editor's `data-annot-fonts`
    // style block (the renderer doesn't need it; the surrounding
    // <text> elements still resolve via the canvas's default
    // font stack). Base image and `ui-overlay` chrome are
    // skipped as before.
    for (const child of Array.from(root.children)) {
      const tag = child.tagName;
      if (tag === "defs") {
        const sanitised = sanitiseRenderDefs(child);
        if (sanitised) svgString += serializer.serializeToString(sanitised);
        continue;
      }
      // Skip the base bitmap (`<image>` at SVG root with no `<g>` ancestor)
      // but NOT mosaic / blur redacts, which are also `<image>` elements
      // and become top-level after `exportAnnotationsSvgForIdb`'s
      // `flattenAnnotations` lifts them out of `<g id="annotations">`.
      // The redact attribute is the discriminator — base bitmaps never
      // carry it.
      if (tag === "image" && !child.closest("g") && !child.hasAttribute("data-redact-style"))
        continue;
      if (child.id === "ui-overlay") continue;
      if (child.id === "annotations") {
        for (const annotation of Array.from(child.children)) {
          svgString += serializer.serializeToString(annotation);
        }
        continue;
      }
      svgString += serializer.serializeToString(child);
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

/** Strip the editor's `data-annot-fonts` injection from a
 *  cloned `<defs>`. Returns `null` when the cleaned defs no
 *  longer carries content (so we don't waste bytes on an
 *  empty `<defs/>`). Mirrors the same helper in
 *  `host-ui/src/gallery/create-card-document.ts` —
 *  intentional duplication: this package can't import from
 *  `annot-host-ui` (Tier C-render vs Tier C). */
function sanitiseRenderDefs(defs: Element): Element | null {
  const clone = defs.cloneNode(true) as Element;
  for (const fontStyle of Array.from(clone.querySelectorAll("style[data-annot-fonts]"))) {
    fontStyle.remove();
  }
  if (clone.children.length === 0 && (clone.textContent ?? "").trim().length === 0) return null;
  return clone;
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
