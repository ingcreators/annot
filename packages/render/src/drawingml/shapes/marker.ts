import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import { chex, exml, px } from "../helpers.js";
import type { NamespaceOpts } from "../namespace.js";

/** Build a `<{ns}:sp>` for a `type === "marker"` AnnotationShape.
 *  `marker_shape` selects the `prstGeom` preset:
 *    `circle` (default) → `ellipse`
 *    `rect` → `roundRect adj=10000` (small rounding)
 *    `rounded` → `roundRect adj=30000` (more rounded — matches
 *                 the SVG-side `cornerRadius = r * 0.6`). */
export function buildMarker(s: AnnotationShape, id: number, ns: NamespaceOpts): string {
  const cx = s.cx ?? 0;
  const cy = s.cy ?? 0;
  const fs = s.font_size ?? 13;
  const r = fs * 0.8;
  const fill = chex(s.fill ?? "#ff0000");
  const label = s.label ?? "";
  const ptVal = Math.round(fs * 75);
  const shape = s.marker_shape;
  const geom =
    shape === "rect"
      ? '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>'
      : shape === "rounded"
        ? '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>'
        : '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
  // bodyPr: zero insets so text fits in small shapes; <a:normAutofit/>
  // shrinks text to fit.
  return `<${ns.shape}><${ns.nvShape}><${ns.cnvPr} id="${id}" name="M${id}"/><${ns.cnvSp}/></${ns.nvShape}><a:spPr><a:xfrm><a:off x="${px(cx - r)}" y="${px(cy - r)}"/><a:ext cx="${px(r * 2)}" cy="${px(r * 2)}"/></a:xfrm>${geom}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="14288"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></a:spPr>${ns.txBodyOpen}<a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0" wrap="none"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${ptVal}" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${exml(label)}</a:t></a:r></a:p>${ns.txBodyClose}</${ns.shape}>`;
}
