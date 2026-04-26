import { createEditableImage } from "@ingcreators/annot-core/xmp";
import type { CanvasManager } from "./canvas-manager.js";
import { stampAnnotVersion } from "@ingcreators/annot-core/editor/svg-format";

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
  svgString = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
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

    if (tag === "rect" || tag === "ellipse" || tag === "path" || tag === "text") {
      svg.appendChild(el.cloneNode(true));
    } else if (tag === "g") {
      // Marker / textbox / arrow groups — clone as-is, Excel handles
      // basic groups.
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
  return `<?xml version="1.0" encoding="UTF-8"?>\n${result}`;
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

/**
 * Derive the download filename. If the host passes the currently-open
 * image's filename (via `baseName` on each export call), we preserve
 * its root stem and swap only the trailing extension — so editing
 * `aaa.png` and saving as SVG produces `aaa.svg`, editing
 * `foo.annot.png` and saving as JPG produces `foo.annot.jpg`, and
 * so on. The `.annot.` marker carries through verbatim when present
 * because we only strip the last dot-segment. With no baseName we
 * fall back to an annot-native default (`annot-<ts>.annot.<ext>`).
 */
function buildDownloadName(desiredExt: string, baseName?: string): string {
  if (baseName) {
    const dot = baseName.lastIndexOf(".");
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    return `${stem}.${desiredExt}`;
  }
  return `annot-${Date.now()}.annot.${desiredExt}`;
}

/** Save full SVG (screenshot + annotations) */
export function saveToFile(canvas: CanvasManager, baseName?: string): void {
  const svgString = exportSVGString(canvas);
  downloadFile(svgString, "image/svg+xml", buildDownloadName("svg", baseName));
}

/** Save as re-editable JPEG or PNG with XMP metadata */
export async function saveAsEditableImage(
  canvas: CanvasManager,
  format: "jpg" | "png",
  baseName?: string,
): Promise<void> {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  if (!isTauri) return;

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { saveWithXmp } = await import("@ingcreators/annot-core/tauri-bridge");

    const ext = format === "jpg" ? "jpg" : "png";
    const filterName = format === "jpg" ? "JPEG" : "PNG";
    const path = await save({
      defaultPath: buildDownloadName(ext, baseName),
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (!path) return;

    // Render the full image as PNG (Rust converts to JPEG if needed)
    const renderedDataUrl = await getPngDataUrl(canvas);
    // `getPngDataUrl` always returns a well-formed data URL; the
    // comma-split has two parts. Default to "" so a malformed URL
    // short-circuits later in `saveWithXmp` rather than crashing.
    const renderedB64 = renderedDataUrl.split(",")[1] ?? "";

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
  const pngBlob = await rasterizeSVG(
    exportSVGString(canvas),
    canvas.imageWidth,
    canvas.imageHeight,
  );
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(pngBlob);
  });
}

/** Copy: PNG (full) */
export async function copyAsImage(canvas: CanvasManager): Promise<void> {
  const pngBlob = await rasterizeSVG(
    exportSVGString(canvas),
    canvas.imageWidth,
    canvas.imageHeight,
  );
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

/** Copy: annotations only as transparent PNG */
export async function copyAnnotationsAsImage(canvas: CanvasManager): Promise<void> {
  const annoSvg = exportExcelSVG(canvas);
  const pngBlob = await rasterizeSVG(annoSvg, canvas.imageWidth, canvas.imageHeight);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

/** Download as re-editable PNG or JPEG with XMP metadata (browser) */
export async function downloadAsImage(
  canvas: CanvasManager,
  format: "png" | "jpg",
  baseName?: string,
): Promise<void> {
  // Render the full image (screenshot + annotations) as PNG blob
  const svgString = exportSVGString(canvas);
  const renderedBlob = await rasterizeSVG(svgString, canvas.imageWidth, canvas.imageHeight);

  // Original capture image (without annotations)
  const originalDataUrl = canvas.imageEl.getAttribute("href") || "";

  // Annotations-only SVG
  const annotationsSvg = exportAnnotationsSVGString(canvas);

  // Get current tags from editor
  const tags: Record<string, string> =
    typeof (window as any).__anno_getTags === "function" ? (window as any).__anno_getTags() : {};

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
  a.download = buildDownloadName(ext, baseName);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
