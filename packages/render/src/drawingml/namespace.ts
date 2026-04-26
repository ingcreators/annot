/**
 * Namespace prefix selector for the OOXML wrapper elements.
 *
 * GVML lockedCanvas (Office clipboard) emits `<a:sp>` /
 * `<a:cxnSp>` / `<a:pic>` because the shapes live inside an
 * `<a:graphic>` envelope.
 * PPTX slide content uses `<p:sp>` / `<p:cxnSp>` / `<p:pic>`
 * because they live inside a slide's `<p:spTree>`.
 *
 * Only the outermost shape wrapper differs — every per-shape
 * DrawingML primitive (`<a:prstGeom>`, `<a:ln>`, `<a:solidFill>`,
 * `<a:txBody>`) keeps the `a:` prefix in both worlds. So the
 * shared builder takes a single `ns: "a" | "p"` flag and routes
 * the wrapper element name through this small set of constants.
 */

export interface NamespaceOpts {
  /** Shape wrapper: `<a:sp>` (GVML) vs `<p:sp>` (PPTX). */
  shape: "a:sp" | "p:sp";
  /** Connector wrapper: `<a:cxnSp>` (GVML) vs `<p:cxnSp>` (PPTX). */
  connector: "a:cxnSp" | "p:cxnSp";
  /** Picture wrapper: `<a:pic>` (GVML) vs `<p:pic>` (PPTX). */
  pic: "a:pic" | "p:pic";
  /** Non-visual shape props open tag. */
  nvShape: "a:nvSpPr" | "p:nvSpPr";
  /** Non-visual connector props open tag. */
  nvConnector: "a:nvCxnSpPr" | "p:nvCxnSpPr";
  /** Non-visual picture props open tag. */
  nvPic: "a:nvPicPr" | "p:nvPicPr";
  /** `<{ns}:cNvPr>` open tag. */
  cnvPr: "a:cNvPr" | "p:cNvPr";
  /** `<{ns}:cNvSpPr/>` self-closing element. */
  cnvSp: "a:cNvSpPr" | "p:cNvSpPr";
  /** `<{ns}:cNvCxnSpPr/>` self-closing element. */
  cnvCxnSp: "a:cNvCxnSpPr" | "p:cNvCxnSpPr";
  /** `<{ns}:cNvPicPr>` open tag. */
  cnvPic: "a:cNvPicPr" | "p:cNvPicPr";
  /** Open tag(s) for the text-body wrapper inside a shape.
   *  GVML wraps text in `<a:txSp><a:txBody>` (the locked-canvas
   *  text primitive); PPTX puts `<p:txBody>` directly under
   *  `<p:sp>`. Both ultimately contain `<a:bodyPr/>`, `<a:lstStyle/>`,
   *  and one or more `<a:p>` runs — only the wrapper differs. */
  txBodyOpen: "<a:txSp><a:txBody>" | "<p:txBody>";
  /** Matching close tag(s) for `txBodyOpen`. */
  txBodyClose: "</a:txBody><a:useSpRect/></a:txSp>" | "</p:txBody>";
  /** Suffix appended inside the non-visual property container
   *  (`<{ns}:nvSpPr>` / `<{ns}:nvCxnSpPr>` / `<{ns}:nvPicPr>`)
   *  after `<{ns}:cNvSpPr/>` / `<{ns}:cNvCxnSpPr/>` / `<{ns}:cNvPicPr/>`.
   *
   *  PPTX's `CT_ShapeNonVisual` / `CT_ConnectorNonVisual` /
   *  `CT_PictureNonVisual` schemas REQUIRE `<p:nvPr/>` as the
   *  third child (after `cNvPr` and `cNv{type}Pr`); PowerPoint
   *  refuses to open files where it's missing. The GVML
   *  lockedCanvas equivalents (`CT_GvmlShapeNonVisual` etc) do
   *  NOT have an `nvPr` element — emitting it there is a schema
   *  violation in the opposite direction. So the suffix is
   *  conditionally `<p:nvPr/>` for PPTX and empty for GVML. */
  nvPrSuffix: "" | "<p:nvPr/>";
}

export const NS_GVML: NamespaceOpts = {
  shape: "a:sp",
  connector: "a:cxnSp",
  pic: "a:pic",
  nvShape: "a:nvSpPr",
  nvConnector: "a:nvCxnSpPr",
  nvPic: "a:nvPicPr",
  cnvPr: "a:cNvPr",
  cnvSp: "a:cNvSpPr",
  cnvCxnSp: "a:cNvCxnSpPr",
  cnvPic: "a:cNvPicPr",
  txBodyOpen: "<a:txSp><a:txBody>",
  txBodyClose: "</a:txBody><a:useSpRect/></a:txSp>",
  nvPrSuffix: "",
};

export const NS_PPTX: NamespaceOpts = {
  shape: "p:sp",
  connector: "p:cxnSp",
  pic: "p:pic",
  nvShape: "p:nvSpPr",
  nvConnector: "p:nvCxnSpPr",
  nvPic: "p:nvPicPr",
  cnvPr: "p:cNvPr",
  cnvSp: "p:cNvSpPr",
  cnvCxnSp: "p:cNvCxnSpPr",
  cnvPic: "p:cNvPicPr",
  txBodyOpen: "<p:txBody>",
  txBodyClose: "</p:txBody>",
  nvPrSuffix: "<p:nvPr/>",
};

export type Namespace = "a" | "p";

export function namespaceFor(ns: Namespace): NamespaceOpts {
  return ns === "a" ? NS_GVML : NS_PPTX;
}
