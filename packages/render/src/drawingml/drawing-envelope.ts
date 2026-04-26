/**
 * Wrap a per-shape XML stream in the GVML lockedCanvas envelope
 * the Office clipboard expects. Mirrors the Rust
 * `build_drawing_xml` (after
 * [`_done/office-paste-abi-modernisation` phase 0](../../../../docs/plans/_done/office-paste-abi-modernisation.md)
 * extracted it from `build_gvml_zip`); the TS port lets the
 * Office-paste path stop reimplementing the per-shape OOXML on
 * the Rust side — phase 3 of
 * [`office-paste-shared-drawing-builder`](../../../../docs/plans/office-paste-shared-drawing-builder.md)
 * collapses Rust to packaging-only.
 */

import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import { buildShapeXml } from "./index.js";
import { px } from "./helpers.js";
import { buildBackgroundPic } from "./shapes/mosaic-image.js";
import { NS_GVML } from "./namespace.js";

export interface MosaicMedia {
  /** Filename (within `clipboard/media/...`) the Rust packager
   *  should write the image bytes to. */
  filename: string;
  /** Decoded image bytes (PNG or JPEG). */
  bytes: Uint8Array;
}

export interface BuildDrawingXmlOpts {
  shapes: AnnotationShape[];
  /** Canvas size in CSS pixels — used for both the background
   *  `<a:pic>` ext + the lockedCanvas group's chOff/chExt frame. */
  width: number;
  height: number;
  /** When true, prepend the `rId2`-bound screenshot `<a:pic>`. */
  hasImage: boolean;
}

export interface BuildDrawingXmlResult {
  /** The full GVML drawing XML string, suitable for the
   *  `clipboard/drawings/drawing1.xml` part. */
  drawing: string;
  /** Mosaic / blur image media files the packaging layer should
   *  write to `clipboard/media/...` and bind via additional rIds. */
  mediaFiles: MosaicMedia[];
}

/**
 * Build the full GVML drawing XML string (matching the Rust
 * `build_drawing_xml` output) plus the list of mosaic media
 * payloads the Tauri packager needs.
 *
 * `cNvPr id` values start at 2 (id=1000 reserved for the
 * background screenshot). `rId` numbering: rId1=theme, rId2=
 * screenshot (when `hasImage`), rId3+ = mosaic media (one per
 * `mosaic_image` shape that supplied a parseable data URL).
 */
export function buildDrawingXml(opts: BuildDrawingXmlOpts): BuildDrawingXmlResult {
  const { shapes, width, height, hasImage } = opts;
  const cx = px(width);
  const cy = px(height);
  const ns = NS_GVML;

  const mediaFiles: MosaicMedia[] = [];
  let nextRid = hasImage ? 3 : 2;
  let id = 2;
  let shapeXml = "";

  if (hasImage) {
    shapeXml += buildBackgroundPic({ rid: 2, width, height, ns });
  }

  for (const shape of shapes) {
    if (shape.type === "mosaic_image" || shape.type === "blur_image") {
      const dataUrl = shape.image_data_url ?? "";
      const bytes = parseDataUrlBytes(dataUrl);
      if (!bytes) continue;
      const ext = dataUrl.includes("image/png") ? "png" : "jpeg";
      const filename = `mosaic_${mediaFiles.length}.${ext}`;
      mediaFiles.push({ filename, bytes });
      const rid = nextRid;
      nextRid += 1;
      shapeXml += buildShapeXml(shape, { ns: "a", id, picRid: rid });
      id += 1;
      continue;
    }
    const piece = buildShapeXml(shape, { ns: "a", id });
    if (piece) {
      shapeXml += piece;
      id += 1;
    }
  }

  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm></a:grpSpPr>${shapeXml}</lc:lockedCanvas></a:graphicData></a:graphic>`;

  return { drawing, mediaFiles };
}

function parseDataUrlBytes(dataUrl: string): Uint8Array | null {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return null;
  const b64 = dataUrl.slice(commaIdx + 1);
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
