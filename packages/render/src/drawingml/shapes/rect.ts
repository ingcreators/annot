import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
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

/** Build a `<{ns}:sp>` for a `type === "rect"` AnnotationShape.
 *  Branches on `corner_radius > 0` for the `roundRect` preset and
 *  on `redact_style === "solid"` for the no-outline solid-bar
 *  redaction. */
export function buildRect(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const x = px(s.x ?? 0);
  const y = px(s.y ?? 0);
  const w = px(s.width ?? 0);
  const h = px(s.height ?? 0);
  const stroke = chex(s.stroke ?? "#ff0000");
  const sw = pt(s.stroke_width ?? 3);
  const fill = s.fill ?? "none";
  const opacity = s.fill_opacity ?? 1;
  const baseFill = buildFillXml(fill, opacity);
  const isRounded = (s.corner_radius ?? 0) > 0;
  const geom = isRounded
    ? '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'
    : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const dash = dashToDrawingml(s.stroke_dasharray);
  const xf = xfrmAttrs(s);
  const cap = capAttr(s.stroke_linecap);
  const join = joinXml(s.stroke_linejoin);
  const fillXml = s.fill_gradient ? gradFillXml(s.fill_gradient) : baseFill;
  const line =
    s.redact_style === "solid"
      ? "<a:ln><a:noFill/></a:ln>"
      : `<a:ln w="${sw}"${cap}>${strokePaintXml(s, stroke)}${join}${dash}</a:ln>`;
  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="R${id}"/><${ns.cnvSp}/>${ns.nvPrSuffix}</${ns.nvShape}><${ns.spPr}><a:xfrm${xf}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${geom}${fillXml}${line}</${ns.spPr}></${ns.shape}>`;
}
