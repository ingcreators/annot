import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import {
  capAttr,
  chex,
  dashToDrawingml,
  endXml,
  joinXml,
  pt,
  px,
  strokePaintXml,
  xfrmAttrs,
} from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:cxnSp>` for a `type === "line" | "arrow"`
 *  AnnotationShape. Lines already use flipH/flipV to express
 *  endpoint direction — the user-applied mirror is excluded
 *  from `xfrmAttrs` to avoid double-flipping; rotation is still
 *  layered on. */
export function buildLine(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const x1 = s.x1 ?? 0;
  const y1 = s.y1 ?? 0;
  const x2 = s.x2 ?? 0;
  const y2 = s.y2 ?? 0;
  const stroke = chex(s.stroke ?? "#ff0000");
  const sw = pt(s.stroke_width ?? 3);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 1);
  const h = Math.max(Math.abs(y2 - y1), 1);
  const fh = x2 < x1 ? ' flipH="1"' : "";
  const fv = y2 < y1 ? ' flipV="1"' : "";

  // Per-end arrows with independent width / length.
  const head = endXml(
    "headEnd",
    s.arrow_shape_start,
    s.arrow_width_start,
    s.arrow_length_start,
  );
  const tail = s.arrow_shape_end
    ? endXml("tailEnd", s.arrow_shape_end, s.arrow_width_end, s.arrow_length_end)
    : s.has_arrow
      ? '<a:tailEnd type="triangle" w="med" len="med"/>'
      : "";

  const dash = dashToDrawingml(s.stroke_dasharray);
  const cap = capAttr(s.stroke_linecap);
  const join = joinXml(s.stroke_linejoin);
  const xf = xfrmAttrs(s, /* excludeFlip */ true);

  return `<${ns.connector}><${ns.nvConnector}><${ns.cnvPr} id="${id}" name="L${id}"/><${ns.cnvCxnSp}/></${ns.nvConnector}><a:spPr><a:xfrm${fh}${fv}${xf}><a:off x="${px(left)}" y="${px(top)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${sw}"${cap}>${strokePaintXml(s, stroke)}${join}${dash}${head}${tail}</a:ln></a:spPr></${ns.connector}>`;
}
