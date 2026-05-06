import type { AnnotationShape } from "@ingcreators/annot-core/desktop-bridge";
import { px, xfrmAttrs } from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:pic>` for a `type === "mosaic_image"` (or
 *  `"blur_image"`) AnnotationShape. The `rid` parameter binds the
 *  picture to its OPC relationship entry — the caller decides the
 *  numbering and supplies the matching `<a:blip>`-referenceable
 *  rId. */
export function buildMosaicPic(
  s: AnnotationShape,
  id: number,
  rid: number,
  ns: NamespaceOpts,
): string {
  const x = px(s.x ?? 0);
  const y = px(s.y ?? 0);
  const w = px(s.width ?? 0);
  const h = px(s.height ?? 0);
  const xf = xfrmAttrs(s);
  return `<${ns.pic}><${ns.nvPic}><${ns.cnvPr} id="${id}" name="Mosaic${id}"/><${ns.cnvPic}><a:picLocks noChangeAspect="1"/></${ns.cnvPic}>${ns.nvPrSuffix}</${ns.nvPic}><${ns.blipFill}><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${rid}"/><a:stretch><a:fillRect/></a:stretch></${ns.blipFill}><${ns.spPr}><a:xfrm${xf}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></${ns.spPr}></${ns.pic}>`;
}

/** Build the full-canvas background `<{ns}:pic>` element for the
 *  screenshot image (rId2-bound by convention). Used by both PPTX
 *  export (slide background) and GVML export (background pic
 *  prepended to the locked-canvas shape list). */
export function buildBackgroundPic(opts: {
  rid: number;
  width: number;
  height: number;
  ns: NamespaceOpts;
  cNvPrId?: number;
  name?: string;
}): string {
  const { rid, width, height, ns } = opts;
  const cnvId = opts.cNvPrId ?? 1000;
  const name = opts.name ?? "Screenshot";
  return `<${ns.pic}><${ns.nvPic}><${ns.cnvPr} id="${cnvId}" name="${name}"/><${ns.cnvPic}><a:picLocks noChangeAspect="1"/></${ns.cnvPic}>${ns.nvPrSuffix}</${ns.nvPic}><${ns.blipFill}><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${rid}"/><a:stretch><a:fillRect/></a:stretch></${ns.blipFill}><${ns.spPr}><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(width)}" cy="${px(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></${ns.spPr}></${ns.pic}>`;
}
