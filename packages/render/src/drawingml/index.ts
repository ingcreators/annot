/**
 * Shared OOXML DrawingML builder used by both PPTX export
 * (`packages/editor/src/pptx-export.ts`) and the Office-clipboard
 * GVML path (TS-side construction since
 * [`office-paste-shared-drawing-builder phase 3`](../../../docs/plans/office-paste-shared-drawing-builder.md)).
 *
 * `buildShapeXml(shape, opts)` dispatches on `shape.type`:
 *
 *    type="rect"                        → buildRect
 *    type="ellipse"                     → buildEllipse
 *    type="line" | "arrow"              → buildLine
 *    type="marker"                      → buildMarker
 *    type="text"                        → buildText (with callout
 *                                         tail when present)
 *    type="freehand"                    → buildFreehand
 *    type="mosaic_image" | "blur_image" → buildMosaicPic
 *                                         (caller supplies rId)
 *
 *  Unknown / unsupported `type` values produce an empty string
 *  instead of throwing — callers can tolerate stale records
 *  this way without losing the whole drawing.
 */

import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import type { Namespace, NamespaceOpts } from "./namespace.js";
import { namespaceFor } from "./namespace.js";
import { buildEllipse } from "./shapes/ellipse.js";
import { buildFreehand } from "./shapes/freehand.js";
import { buildLine } from "./shapes/line.js";
import { buildMarker } from "./shapes/marker.js";
import { buildMosaicPic } from "./shapes/mosaic-image.js";
import { buildRect } from "./shapes/rect.js";
import { buildText } from "./shapes/text.js";

export interface BuildShapeOpts {
  /** OOXML wrapper-element prefix. `"a"` for the GVML
   *  lockedCanvas form (Office clipboard); `"p"` for PPTX
   *  slide content. */
  ns: Namespace;
  /** OOXML shape id. Caller-managed monotonic counter (the OPC
   *  package's `<a:cNvPr id="…">` must be unique within the
   *  drawing). */
  id: number;
  /** For mosaic / blur picture shapes: the OPC relationship Id
   *  binding the `<a:blip>` to the embedded image. Caller-
   *  managed. Ignored for non-picture shape types. */
  picRid?: number;
}

/** Build the per-shape OOXML XML fragment for one `AnnotationShape`. */
export function buildShapeXml(shape: AnnotationShape, opts: BuildShapeOpts): string {
  const ns = namespaceFor(opts.ns);
  switch (shape.type) {
    case "rect":
      return buildRect(shape, opts.id, ns);
    case "ellipse":
      return buildEllipse(shape, opts.id, ns);
    case "line":
    case "arrow":
      return buildLine(shape, opts.id, ns);
    case "marker":
      return buildMarker(shape, opts.id, ns);
    case "text":
      return buildText(shape, opts.id, ns);
    case "freehand":
      return buildFreehand(shape, opts.id, ns);
    case "mosaic_image":
    case "blur_image": {
      if (opts.picRid == null) return "";
      return buildMosaicPic(shape, opts.id, opts.picRid, ns);
    }
    default:
      return "";
  }
}

export { buildBackgroundPic } from "./shapes/mosaic-image.js";
export type { Namespace, NamespaceOpts };
export { namespaceFor };
