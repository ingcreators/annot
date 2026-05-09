import { cssStackFor, LOGICAL_FAMILIES } from "@ingcreators/annot-core/headless";
import { defaultAnnotFilenameStem } from "@ingcreators/annot-core/utils";
import { createEditableImage } from "@ingcreators/annot-core/xmp";
import type { CanvasManager } from "./canvas-manager.js";

export function exportSVGString(canvas: CanvasManager): string {
  const clone = canvas.svg.cloneNode(true) as SVGSVGElement;

  clone.querySelector("#ui-overlay")?.remove();

  // Flatten annotations
  flattenAnnotations(clone);

  // Inline the logical font-family stacks so the saved SVG is
  // self-contained — the host's `fonts.css` won't be reachable
  // when the SVG is loaded standalone (PNG raster via `<img>`,
  // user-saved .svg opened in a different viewer, OOXML embed,
  // etc.). Phase 5 of `docs/plans/multilingual-fonts-os-stack.md`.
  injectLogicalFontStyles(clone);

  clone.removeAttribute("style");
  clone.setAttribute("width", String(canvas.imageWidth));
  clone.setAttribute("height", String(canvas.imageHeight));

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(clone);
  svgString = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
  return svgString;
}

/** Add a `<defs><style>` block to the SVG with one rule per
 *  logical Annot family token, mapping each to the per-OS family
 *  stack from `cssStackFor`. Idempotent — if a `<defs><style
 *  data-annot-fonts>` already exists, it gets replaced.
 *
 *  The CSS selector targets both `<text>` (committed annotations)
 *  and `foreignObject [data-font-family="..."]` (the contentEditable
 *  text-edit overlay) so a serialised mid-edit SVG also resolves
 *  consistently. */
function injectLogicalFontStyles(svg: SVGSVGElement): void {
  const SVG_NS = "http://www.w3.org/2000/svg";
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = svg.ownerDocument.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  // Drop any prior injection so re-export stays idempotent.
  defs.querySelector("style[data-annot-fonts]")?.remove();
  const style = svg.ownerDocument.createElementNS(SVG_NS, "style");
  style.setAttribute("data-annot-fonts", "");
  const rules: string[] = [];
  for (const family of LOGICAL_FAMILIES) {
    const stack = cssStackFor(family);
    rules.push(
      `text[font-family="${family}"], foreignObject [data-font-family="${family}"] { font-family: ${stack}; }`,
    );
  }
  style.textContent = rules.join("\n");
  defs.appendChild(style);
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
  return `${defaultAnnotFilenameStem()}.annot.${desiredExt}`;
}

/** Save full SVG (screenshot + annotations) */
export function saveToFile(canvas: CanvasManager, baseName?: string): void {
  const svgString = exportSVGString(canvas);
  downloadFile(svgString, "image/svg+xml", buildDownloadName("svg", baseName));
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

function downloadFile(content: string, _mime: string, filename: string): void {
  // Browser-style download — Electron handles the `<a download>`
  // event natively (the system save dialog), so this same code
  // path serves both the PWA and the desktop host. Phase 9 of
  // `desktop-electron-migration.md` collapsed the prior Tauri-
  // specific branch (`@tauri-apps/plugin-dialog` + `plugin-fs`).
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
  const tagsHost = window as Window & { __annot_getTags?: () => Record<string, string> };
  const tags: Record<string, string> =
    typeof tagsHost.__annot_getTags === "function" ? tagsHost.__annot_getTags() : {};

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
  // Phase 5 of `docs/plans/multilingual-fonts-os-stack.md`:
  // wait for the host document's fonts to settle before
  // rasterising. OS-only fonts make this resolve immediately,
  // but the guard defends against future web-font additions and
  // against intermittent OS-font pre-load delays on cold
  // browser profiles.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // `fonts.ready` rejecting is rare — keep rasterising even
      // if the font loader itself errored.
    }
  }
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
