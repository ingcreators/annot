/**
 * Browser-side XMP metadata embedding for re-editable images.
 *
 * Wraps the Tier-A `xmp-bytes` primitives with Blob input / Blob output
 * and adds the JPEG output path, which needs an Image + <canvas> pipeline
 * to transcode the rendered PNG to JPEG.
 *
 * For Node / non-browser callers, import the Tier-A primitives
 * directly:
 *
 *     import { createEditablePngBytes, readEditableImage }
 *       from "@ingcreators/annot-core/xmp-bytes";
 *
 * Re-exports of Tier-A symbols below keep existing
 * `@ingcreators/annot-core/xmp` consumers working unchanged.
 */

import {
  buildXmp,
  createEditablePngBytes,
  dataUrlToUint8Array,
  writeJpegWithMetadata,
  type XmpProvenance,
} from "./xmp-bytes.js";

// Re-export Tier-A surface so existing `/xmp` consumers stay working.
export {
  ANNOT_XMP_VERSION,
  type AnnotMetadata,
  type BuildXmpOptions,
  type CreateEditablePngBytesOptions,
  createEditablePngBytes,
  dataUrlToUint8Array,
  readEditableImage,
  readEditablePngBytes,
  WELL_KNOWN_TAG_KEYS,
  writePngWithTagsOnly,
  type XmpProvenance,
} from "./xmp-bytes.js";

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

export interface EditableImageOptions extends XmpProvenance {
  /** Rendered image (screenshot + annotations) as Blob */
  renderedBlob: Blob;
  /** Original capture image data URL (without annotations) */
  originalDataUrl: string;
  /** Annotations-only SVG string */
  annotationsSvg: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Output format */
  format: "jpg" | "png";
  /** Key-value tags */
  tags?: Record<string, string>;
}

/**
 * Create a re-editable image with XMP metadata embedded.
 * Returns a Blob ready for download.
 */
export async function createEditableImage(opts: EditableImageOptions): Promise<Blob> {
  const originalBytes = dataUrlToUint8Array(opts.originalDataUrl);

  if (opts.format === "png") {
    const pngData = await blobToUint8Array(opts.renderedBlob);
    const result = createEditablePngBytes({
      renderedPng: pngData,
      originalImage: originalBytes,
      annotationsSvg: opts.annotationsSvg,
      width: opts.width,
      height: opts.height,
      tags: opts.tags,
      sourceUrl: opts.sourceUrl,
      createdAt: opts.createdAt,
      producer: opts.producer,
      dpr: opts.dpr,
    });
    return new Blob([result as BlobPart], { type: "image/png" });
  }

  // JPEG output — transcode the rendered PNG via Image + <canvas>,
  // then call the Tier-A JPEG writer.
  const jpegBlob = await pngBlobToJpegBlob(opts.renderedBlob, opts.width, opts.height);
  const jpegData = await blobToUint8Array(jpegBlob);
  const xmpBytes = new TextEncoder().encode(
    buildXmp({
      annotationsSvg: opts.annotationsSvg,
      width: opts.width,
      height: opts.height,
      tags: opts.tags,
      sourceUrl: opts.sourceUrl,
      createdAt: opts.createdAt,
      producer: opts.producer,
      dpr: opts.dpr,
    }),
  );
  const result = writeJpegWithMetadata(jpegData, xmpBytes, originalBytes);
  return new Blob([result as BlobPart], { type: "image/jpeg" });
}

async function pngBlobToJpegBlob(pngBlob: Blob, width: number, height: number): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(pngBlob);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  return new Promise<Blob>((resolve) => {
    c.toBlob((b) => resolve(b!), "image/jpeg", 0.92);
  });
}
