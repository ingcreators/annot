// @ingcreators/annot-render — data-driven `ImageRecord` rendering.
//
// Phase 8 of `docs/plans/three-package-split.md` — `renderImageRecord`
// landed here as the day-1 surface. Phase 11 of
// `docs/plans/annot-html-document.md` added `exportDocumentPptx`
// for multi-slide PPTX export of `.annot.html` documents.
//
// **Architectural invariant**: this package depends on
// `@ingcreators/annot-core` + `@ingcreators/annot-doc` (both
// Tier A). It MUST NOT depend on `@ingcreators/annot-editor` —
// the split exists so storage backends and the future gallery
// bulk-export view can pull rendering without dragging the
// live editor into their bundle.

export { cropBitmap } from "./crop-bitmap.js";
export {
  type BuildDrawingXmlOpts,
  type BuildDrawingXmlResult,
  buildDrawingXml,
  type MosaicMedia,
} from "./drawingml/drawing-envelope.js";
export {
  type BuildShapeOpts,
  buildBackgroundPic,
  buildFillXml,
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
  PT_EMU,
  PX_EMU,
  parseRgba,
  parseSvgPath,
  pt,
  px,
  strokePaintXml,
  xfrmAttrs,
} from "./drawingml/index.js";
export {
  buildDocumentPptxFiles,
  type DocumentPptxFiles,
  exportDocumentPptx,
} from "./pptx/document-pptx.js";
export {
  burnRedactionsIntoBitmap,
  classifyRedact,
  type RedactKind,
} from "./redact-burn.js";
export { renderImageRecord } from "./render-image-record.js";
