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

/** Build a `<{ns}:cxnSp>` for a straight `type === "line" | "arrow"`
 *  AnnotationShape, or a `<{ns}:sp>` with `<a:custGeom>` when the
 *  shape carries `arrow_curve_cx` / `arrow_curve_cy` (a quadratic
 *  Bezier control point). Straight lines already use flipH/flipV
 *  to express endpoint direction — the user-applied mirror is
 *  excluded from `xfrmAttrs` to avoid double-flipping; rotation is
 *  still layered on. Curved arrows emit explicit path coords so no
 *  flip is ever needed. */
export function buildLine(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const x1 = s.x1 ?? 0;
  const y1 = s.y1 ?? 0;
  const x2 = s.x2 ?? 0;
  const y2 = s.y2 ?? 0;
  const stroke = chex(s.stroke ?? "#ff0000");
  const sw = pt(s.stroke_width ?? 3);

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

  // Curved arrow — emit a freeform shape (`<{ns}:sp>` + `custGeom`)
  // with a quadratic-Bezier path. OOXML doesn't have a "curved line
  // with an arbitrary control point" preset (`prst="curvedConnector3"`
  // only offers a hard-coded S-bend), so `custGeom` is the only
  // faithful round-trip. Arrow-head `<a:headEnd>` / `<a:tailEnd>`
  // still work on `custGeom`.
  if (s.arrow_curve_cx != null && s.arrow_curve_cy != null) {
    const cxC = s.arrow_curve_cx;
    const cyC = s.arrow_curve_cy;
    // Bbox includes the control point — a quadratic Bezier is
    // contained in the convex hull of its 3 control points.
    const xs: number[] = [x1, cxC, x2];
    const ys: number[] = [y1, cyC, y2];
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const w = Math.max(...xs) - left || 1;
    const h = Math.max(...ys) - top || 1;
    const wEmu = px(w);
    const hEmu = px(h);
    const localX = (wx: number) => px(wx - left);
    const localY = (wy: number) => px(wy - top);
    return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="L${id}"/><${ns.cnvSp}/>${ns.nvPrSuffix}</${ns.nvShape}><${ns.spPr}><a:xfrm><a:off x="${px(left)}" y="${px(top)}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${wEmu}" b="${hEmu}"/><a:pathLst><a:path w="${wEmu}" h="${hEmu}"><a:moveTo><a:pt x="${localX(x1)}" y="${localY(y1)}"/></a:moveTo><a:quadBezTo><a:pt x="${localX(cxC)}" y="${localY(cyC)}"/><a:pt x="${localX(x2)}" y="${localY(y2)}"/></a:quadBezTo></a:path></a:pathLst></a:custGeom><a:ln w="${sw}"${cap}>${strokePaintXml(s, stroke)}${join}${dash}${head}${tail}</a:ln></${ns.spPr}></${ns.shape}>`;
  }

  // Straight line / arrow — `<{ns}:cxnSp>` + `prst="line"`.
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 1);
  const h = Math.max(Math.abs(y2 - y1), 1);
  const fh = x2 < x1 ? ' flipH="1"' : "";
  const fv = y2 < y1 ? ' flipV="1"' : "";
  const xf = xfrmAttrs(s, /* excludeFlip */ true);

  return `<${ns.connector}><${ns.nvConnector}><${ns.cnvPr} id="${id}" name="L${id}"/><${ns.cnvCxnSp}/>${ns.nvPrSuffix}</${ns.nvConnector}><${ns.spPr}><a:xfrm${fh}${fv}${xf}><a:off x="${px(left)}" y="${px(top)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${sw}"${cap}>${strokePaintXml(s, stroke)}${join}${dash}${head}${tail}</a:ln></${ns.spPr}></${ns.connector}>`;
}
