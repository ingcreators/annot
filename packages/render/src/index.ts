// @ingcreators/annot-render — data-driven `ImageRecord` rendering.
//
// Phase 8 of `docs/plans/three-package-split.md` — `renderImageRecord`
// landed here as the day-1 surface. Future gallery bulk-export
// functions (`exportZip`, `exportMultiSlidePptx`, etc.) and the
// eventual ImageRecord-driven `pptx-export` migration land here too.
//
// **Architectural invariant**: this package depends on
// `@ingcreators/annot-core` only. It MUST NOT depend on
// `@ingcreators/annot-editor` — the split exists so storage
// backends and the future gallery bulk-export view can pull
// rendering without dragging the live editor into their bundle.

export { renderImageRecord } from "./render-image-record.js";
export {
  burnRedactionsIntoBitmap,
  classifyRedact,
  type RedactKind,
} from "./redact-burn.js";
export { cropBitmap } from "./crop-bitmap.js";
export {
  buildBackgroundPic,
  buildFillXml,
  type BuildShapeOpts,
  buildShapeXml,
  capAttr,
  chex,
  dashToDrawingml,
  endXml,
  exml,
  gradFillXml,
  joinXml,
  type Namespace,
  type NamespaceOpts,
  namespaceFor,
  parseRgba,
  parseSvgPath,
  pt,
  PT_EMU,
  px,
  PX_EMU,
  strokePaintXml,
  xfrmAttrs,
} from "./drawingml/index.js";
export {
  type BuildDrawingXmlOpts,
  type BuildDrawingXmlResult,
  buildDrawingXml,
  type MosaicMedia,
} from "./drawingml/drawing-envelope.js";
