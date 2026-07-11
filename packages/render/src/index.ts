// @ingcreators/annot-render — data-driven `ImageRecord` rendering.
//
// Phase 8 of `docs/plans/three-package-split.md` — `renderImageRecord`
// landed here as the day-1 surface. Phase 11 of
// `docs/plans/_done/annot-html-document.md` added `exportDocumentPptx`
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
// `exportDocumentPptx` + `buildDocumentPptxFiles` deliberately not
// re-exported here. The multi-slide PPTX builder is heavy
// (entire OOXML envelope + slide rendering pipeline) and only
// fires on a user-driven export action; both call sites
// (`packages/web/src/app.ts:#exportDocAsPptx` and
// `packages/vscode/src/webview/main.ts`) import it dynamically
// from the deep subpath `@ingcreators/annot-render/pptx/document-pptx`
// so the bundler can split it into its own chunk. Re-exporting
// from this barrel defeats the split (the eager `toolbar.ts` /
// `editor-shell.ts` / `pptx-export.ts` static imports of the
// barrel pull the submodule into the main chunk —
// `[INEFFECTIVE_DYNAMIC_IMPORT]` Rollup warning).
export { probeRasterDims } from "./raster-dims.js";
export {
  burnRedactionsIntoBitmap,
  classifyRedact,
  type RedactKind,
} from "./redact-burn.js";
export { renderImageRecord } from "./render-image-record.js";
