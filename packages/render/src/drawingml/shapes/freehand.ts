import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import { chex, dashToDrawingml, parseSvgPath, pt, px, xfrmAttrs } from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:sp>` with `<a:custGeom>` for a
 *  `type === "freehand"` AnnotationShape. The SVG path d-string
 *  rides on `text`; we re-parse the M / L points and emit them
 *  as `<a:moveTo>` / `<a:lnTo>` in EMU coords. Returns "" when
 *  fewer than 2 points are present (no shape to render). */
export function buildFreehand(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const d = s.text ?? "";
  const stroke = chex(s.stroke ?? "#ff0000");
  const sw = pt(s.stroke_width ?? 3);

  const points = parseSvgPath(d);
  if (points.length < 2) return "";

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);

  const pathCmds = points
    .map(([x, y], i) => {
      const ex = px(x - minX);
      const ey = px(y - minY);
      if (i === 0) return `<a:moveTo><a:pt x="${ex}" y="${ey}"/></a:moveTo>`;
      return `<a:lnTo><a:pt x="${ex}" y="${ey}"/></a:lnTo>`;
    })
    .join("");

  const pw = px(bw);
  const ph = px(bh);

  const dash = dashToDrawingml(s.stroke_dasharray);
  const xf = xfrmAttrs(s);

  // Freehand strokes always use `cap="rnd"` + `<a:round/>` for
  // visual continuity at segment joins. Stroke paint is plain
  // `<a:solidFill>` (no gradient or alpha — the highlighter alpha
  // rides on `stroke_opacity_value` but freehand canvases don't
  // currently emit it through the stroke paint helper to match
  // the Rust GVML form byte-for-byte).
  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="F${id}"/><${ns.cnvSp}/>${ns.nvPrSuffix}</${ns.nvShape}><${ns.spPr}><a:xfrm${xf}><a:off x="${px(minX)}" y="${px(minY)}"/><a:ext cx="${pw}" cy="${ph}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${pw}" b="${ph}"/><a:pathLst><a:path w="${pw}" h="${ph}">${pathCmds}</a:path></a:pathLst></a:custGeom><a:noFill/><a:ln w="${sw}" cap="rnd"><a:solidFill><a:srgbClr val="${stroke}"/></a:solidFill>${dash}<a:round/></a:ln></${ns.spPr}></${ns.shape}>`;
}
