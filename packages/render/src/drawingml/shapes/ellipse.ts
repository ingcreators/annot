import type { AnnotationShape } from "@ingcreators/annot-core/desktop-bridge";
import {
  buildFillXml,
  capAttr,
  chex,
  dashToDrawingml,
  gradFillXml,
  joinXml,
  pt,
  px,
  strokePaintXml,
  xfrmAttrs,
} from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:sp>` for a `type === "ellipse"` AnnotationShape. */
export function buildEllipse(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const cx = s.cx ?? 0;
  const cy = s.cy ?? 0;
  const rx = s.rx ?? 0;
  const ry = s.ry ?? 0;
  const stroke = chex(s.stroke ?? "#ff0000");
  const sw = pt(s.stroke_width ?? 3);
  const fill = s.fill ?? "none";
  const opacity = s.fill_opacity ?? 1;
  const baseFill = buildFillXml(fill, opacity);
  const dash = dashToDrawingml(s.stroke_dasharray);
  const xf = xfrmAttrs(s);
  const cap = capAttr(s.stroke_linecap);
  const join = joinXml(s.stroke_linejoin);
  const fillXml = s.fill_gradient ? gradFillXml(s.fill_gradient) : baseFill;
  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="E${id}"/><${ns.cnvSp}/>${ns.nvPrSuffix}</${ns.nvShape}><${ns.spPr}><a:xfrm${xf}><a:off x="${px(cx - rx)}" y="${px(cy - ry)}"/><a:ext cx="${px(rx * 2)}" cy="${px(ry * 2)}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fillXml}<a:ln w="${sw}"${cap}>${strokePaintXml(s, stroke)}${join}${dash}</a:ln></${ns.spPr}></${ns.shape}>`;
}
