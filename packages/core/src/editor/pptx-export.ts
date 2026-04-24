import { buildZip } from "../zip/zip-builder.js";
import type { CanvasManager } from "./canvas-manager.js";
import { getEffectiveLineEndpoints } from "./transform-utils.js";

const __pptxTextEncoder = new TextEncoder();
function strToU8(s: string): Uint8Array {
  return __pptxTextEncoder.encode(s);
}

/** Convert a point value into EMU. OOXML line widths (`<a:ln w="…"/>`)
 *  are in EMU where 1pt = 12,700 EMU, NOT in the 9,525-EMU-per-pixel
 *  scale used by `px(…)` elsewhere. Using the wrong conversion made a
 *  stroke-width of "6" become a 4.5pt line in PowerPoint instead of
 *  6pt. The editor's width input is labelled "pt", so we treat SVG
 *  stroke-width as points at export time. */
const PT_TO_EMU = 12700;
function ptToEMU(v: number): number {
  return Math.round(v * PT_TO_EMU);
}

// EMU conversion: 1 pixel at 96 DPI = 9525 EMU
const PX_TO_EMU = 9525;

function px(v: number): number {
  return Math.round(v * PX_TO_EMU);
}

function colorHex(color: string): string {
  // Defend against `url(#...)` gradient refs sneaking in: `<a:srgbClr>`
  // requires a 6-hex digit value, so fall back to black (000000) for
  // non-hex inputs rather than emitting malformed XML that PowerPoint
  // refuses to open. (Callers that actually need gradient output
  // should emit <a:gradFill> directly.)
  if (!color) return "000000";
  const trimmed = color.trim();
  if (trimmed.startsWith("url(") || trimmed === "none") return "000000";
  const hex = trimmed.replace("#", "").toUpperCase();
  // If it isn't 3 or 6 hex digits, something else (rgb(), named color,
  // etc.) slipped through — again, fall back rather than break the file.
  if (!/^[0-9A-F]{6}$/.test(hex) && !/^[0-9A-F]{3}$/.test(hex)) return "000000";
  return hex.length === 3
    ? hex
        .split("")
        .map((c) => c + c)
        .join("")
    : hex;
}

/**
 * Build the OOXML attrs that go on `<a:xfrm rot="..." flipH="1" flipV="1">`
 * from an SVG element's data-* transform state. OOXML rotation is in
 * 60,000ths of a degree, normalized to [0, 21,600,000).
 *
 * `excludeFlip` is for line/connector shapes whose own logic already
 * uses flipH/flipV to express endpoint direction — combining that with
 * a user-applied mirror would be incorrect. The xfrm here only carries
 * rotation in that case.
 */
/**
 * Translate an SVG arrow-shape name into the matching OOXML
 * `<a:headEnd>` / `<a:tailEnd>` element. The SVG shape set is now
 * aligned 1:1 with OOXML's six preset types; legacy names are
 * remapped for content produced before that alignment. Width and
 * length are passed through separately (OOXML's native model).
 */
function endOOXML(
  which: "headEnd" | "tailEnd",
  svgShape: string | null,
  svgWidth: string,
  svgLength: string,
): string {
  if (!svgShape || svgShape === "none") return "";
  const mapType: Record<string, string> = {
    arrow: "arrow",
    triangle: "triangle",
    stealth: "stealth",
    diamond: "diamond",
    oval: "oval",
    // Legacy fallbacks for pre-alignment content.
    "triangle-open": "arrow",
    tbar: "stealth",
    reverse: "arrow",
  };
  const mapSize: Record<string, string> = { sm: "sm", md: "med", lg: "lg" };
  const type = mapType[svgShape] || "triangle";
  const w = mapSize[svgWidth] || "med";
  const len = mapSize[svgLength] || "med";
  return `<a:${which} type="${type}" w="${w}" len="${len}"/>`;
}

/**
 * Build a `<a:gradFill>` XML fragment from a gradient spec (parsed
 * from the data-*-gradient JSON attribute). OOXML uses
 * `gsLst` → `<a:gs>` children with `pos` in thousandths and colors
 * inside `<a:srgbClr>`. The angle is in 60000ths of a degree with the
 * same convention as our source (0° = left→right, CW positive).
 */
function gradFillXml(gRaw: string | null): string {
  if (!gRaw) return "";
  let spec: { angle: number; stops: Array<{ color: string; offset: number; opacity?: number }> };
  try {
    spec = JSON.parse(gRaw);
  } catch {
    return "";
  }
  if (!spec?.stops || !Array.isArray(spec.stops)) return "";
  const rotNorm = (((spec.angle || 0) % 360) + 360) % 360;
  const ang = Math.round(rotNorm * 60000);
  const gs = spec.stops
    .map((s) => {
      const pos = Math.round((s.offset ?? 0) * 100000);
      const alpha =
        s.opacity != null && s.opacity < 1
          ? `<a:alpha val="${Math.round(s.opacity * 100000)}"/>`
          : "";
      return `<a:gs pos="${pos}"><a:srgbClr val="${colorHex(s.color)}">${alpha}</a:srgbClr></a:gs>`;
    })
    .join("");
  return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${gs}</a:gsLst><a:lin ang="${ang}" scaled="1"/></a:gradFill>`;
}

/**
 * Build the <a:ln> line description including stroke color (or
 * gradient), opacity alpha, cap, and join. Used by every shape/line
 * builder so the style features stay consistent across element types.
 */
function _lnXml(
  el: SVGElement,
  swPx: number,
  fallbackStroke: string,
  dashXml: string,
  arrowXml: string,
): string {
  const grad = el.getAttribute("data-stroke-gradient");
  // strokeOpacity() checks both `opacity` (preferred for <line> so
  // markers fade with the stroke) and `stroke-opacity` (for shapes).
  const opacity = strokeOpacity(el);
  const stroke = el.getAttribute("stroke") || fallbackStroke;
  let paint: string;
  if (grad) {
    paint = gradFillXml(grad);
  } else {
    const alpha = opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : "";
    paint = `<a:solidFill><a:srgbClr val="${colorHex(stroke)}">${alpha}</a:srgbClr></a:solidFill>`;
  }
  const capAttr = capOOXML(el.getAttribute("stroke-linecap"));
  const joinXml = joinOOXML(el.getAttribute("stroke-linejoin"));
  const capStr = capAttr ? ` cap="${capAttr}"` : "";
  return `<a:ln w="${ptToEMU(swPx)}"${capStr}>${paint}${joinXml}${dashXml}${arrowXml}</a:ln>`;
}

/**
 * Read the effective stroke opacity for an element. For <line> the
 * canonical attribute is `opacity` (so the marker fades with the
 * line); other shapes use `stroke-opacity`. Both are accepted in
 * either case so legacy content and new content both round-trip.
 */
function strokeOpacity(el: SVGElement): number {
  const o = el.getAttribute("opacity");
  if (o != null && o !== "") return Number.parseFloat(o);
  const so = el.getAttribute("stroke-opacity");
  if (so != null && so !== "") return Number.parseFloat(so);
  return 1;
}

/**
 * Build a `<a:solidFill>` / `<a:gradFill>` / `<a:noFill/>` fragment
 * for any element's stroke or fill. Centralizes the defensive handling
 * so `url(#...)` gradient refs NEVER end up inside `<a:srgbClr>`.
 */
function paintXml(el: SVGElement, value: string, which: "stroke" | "fill"): string {
  const gradRaw = el.getAttribute(`data-${which}-gradient`);
  if (gradRaw) return gradFillXml(gradRaw);
  if (value === "none" || !value) return "<a:noFill/>";
  if (/^url\(#.+\)$/i.test(value.trim())) {
    // Fallback — an SVG defs gradient reference without a stored
    // spec. Emit a sane solid color rather than breaking the file.
    return `<a:solidFill><a:srgbClr val="000000"/></a:solidFill>`;
  }
  const op =
    which === "stroke"
      ? strokeOpacity(el)
      : Number.parseFloat(el.getAttribute("fill-opacity") || "1");
  const alpha = op < 1 ? `<a:alpha val="${Math.round(op * 100000)}"/>` : "";
  return `<a:solidFill><a:srgbClr val="${colorHex(value)}">${alpha}</a:srgbClr></a:solidFill>`;
}

/**
 * Build the full `<a:ln>` fragment for a line-like element, handling
 * gradient strokes, stroke opacity, linecap, linejoin, and arrow
 * heads in one place. Critically: when the SVG `stroke` attribute is
 * a `url(#...)` gradient reference, we MUST emit a `<a:gradFill>`
 * inside the `<a:ln>` — passing the url(...) through `colorHex` as if
 * it were a #rrggbb color produces garbage like `URL(GRAD-...)` which
 * PowerPoint rejects as a malformed color value.
 */
function lineLnXml(el: SVGElement, swPx: number, strokeAttr: string, arrowXml: string): string {
  const dashXml = ""; // line builder currently doesn't pass dash; arrows are the usual decoration
  const capAttr = capOOXML(el.getAttribute("stroke-linecap"));
  const joinXml = joinOOXML(el.getAttribute("stroke-linejoin"));
  const capStr = capAttr ? ` cap="${capAttr}"` : "";

  const gradRaw = el.getAttribute("data-stroke-gradient");
  const strokeIsUrl = /^url\(#.+\)$/i.test(strokeAttr.trim());
  let paint: string;
  if (gradRaw) {
    // Gradient spec recorded on the element — authoritative source.
    paint = gradFillXml(gradRaw);
  } else if (strokeIsUrl) {
    // url(...) reference without a matching data-*-gradient — the
    // element points at a gradient defined in SVG defs. Fall back to
    // the underlying first stop color so the line still renders in
    // PowerPoint (instead of triggering the malformed-color error).
    paint = `<a:solidFill><a:srgbClr val="000000"/></a:solidFill>`;
  } else {
    const opacity = strokeOpacity(el);
    const alpha = opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : "";
    paint = `<a:solidFill><a:srgbClr val="${colorHex(strokeAttr)}">${alpha}</a:srgbClr></a:solidFill>`;
  }
  return `<a:ln w="${ptToEMU(swPx)}"${capStr}>${paint}${joinXml}${dashXml}${arrowXml}</a:ln>`;
}

function capOOXML(cap: string | null): string {
  if (cap === "butt") return "flat";
  if (cap === "square") return "sq";
  if (cap === "round") return "rnd";
  return "";
}
function joinOOXML(join: string | null): string {
  if (join === "round") return "<a:round/>";
  if (join === "bevel") return "<a:bevel/>";
  if (join === "miter") return `<a:miter lim="800000"/>`;
  return "";
}

/** Read the pending `data-tx` / `data-ty` translation on an element.
 *  For path / group elements, `#moveElement` (used by drag / align /
 *  nudge) stores the translation here rather than baking it into the
 *  element's geometry. Every PPTX shape's `<a:off>` needs to add this
 *  so exports reflect the element's actual on-canvas position —
 *  without it, elements show up at their pre-move location. */
function offsetFromTransform(el: SVGElement): { tx: number; ty: number } {
  const tx = Number.parseFloat(el.getAttribute("data-tx") || "0") || 0;
  const ty = Number.parseFloat(el.getAttribute("data-ty") || "0") || 0;
  return { tx, ty };
}

function xfrmAttrs(el: SVGElement, opts?: { excludeFlip?: boolean }): string {
  let rot = Number.parseFloat(el.getAttribute("data-rot") || "0") || 0;
  if (rot) {
    rot = ((rot % 360) + 360) % 360;
    const ooxmlRot = Math.round(rot * 60000);
    let out = ` rot="${ooxmlRot}"`;
    if (!opts?.excludeFlip) {
      if (el.getAttribute("data-flip-h") === "1") out += ` flipH="1"`;
      if (el.getAttribute("data-flip-v") === "1") out += ` flipV="1"`;
    }
    return out;
  }
  if (!opts?.excludeFlip) {
    let out = "";
    if (el.getAttribute("data-flip-h") === "1") out += ` flipH="1"`;
    if (el.getAttribute("data-flip-v") === "1") out += ` flipV="1"`;
    return out;
  }
  return "";
}

interface ShapeInfo {
  xml: string;
  id: number;
}

export function exportPptx(canvas: CanvasManager): void {
  const w = canvas.imageWidth;
  const h = canvas.imageHeight;
  const shapes = buildShapes(canvas);

  // Extract JPEG binary from data URI
  const dataUrl = canvas.imageEl.getAttribute("href") || "";
  const imageBytes = dataUrlToUint8Array(dataUrl);
  const imageExt = dataUrl.startsWith("data:image/png") ? "png" : "jpeg";
  const _imageMime = imageExt === "png" ? "image/png" : "image/jpeg";
  const hasImage = imageBytes.length > 0;

  const slideXml = buildSlide(w, h, shapes, hasImage);

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(hasImage, imageExt)),
    "_rels/.rels": strToU8(rootRels()),
    "ppt/presentation.xml": strToU8(presentation(w, h)),
    "ppt/_rels/presentation.xml.rels": strToU8(presentationRels()),
    "ppt/slides/slide1.xml": strToU8(slideXml),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(slideRels(hasImage, imageExt)),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(slideLayout()),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(slideLayoutRels()),
    "ppt/slideMasters/slideMaster1.xml": strToU8(slideMaster()),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(slideMasterRels()),
    "ppt/theme/theme1.xml": strToU8(theme()),
    "docProps/core.xml": strToU8(coreProps()),
    "docProps/app.xml": strToU8(appProps()),
  };

  if (hasImage) {
    files[`ppt/media/screenshot.${imageExt}`] = imageBytes;
  }

  const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
  const zipBlob = buildZip(entries);
  // Re-wrap with the PPTX MIME type (buildZip emits a generic application/zip).
  const blob = new Blob([zipBlob], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `anno-${Date.now()}.pptx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildShapes(canvas: CanvasManager): ShapeInfo[] {
  const shapes: ShapeInfo[] = [];
  let id = 2; // id=1 is reserved for slide background

  const annos = canvas.annotations.childNodes;
  for (const node of Array.from(annos)) {
    const el = node as SVGElement;
    const tag = el.tagName;

    if (tag === "line") {
      shapes.push({ xml: buildLine(el as SVGLineElement, id), id });
      id++;
    } else if (tag === "rect") {
      shapes.push({ xml: buildRect(el as SVGRectElement, id), id });
      id++;
    } else if (tag === "ellipse") {
      shapes.push({ xml: buildEllipse(el as SVGEllipseElement, id), id });
      id++;
    } else if (tag === "text") {
      shapes.push({ xml: buildText(el as SVGTextElement, id), id });
      id++;
    } else if (tag === "path") {
      shapes.push({ xml: buildFreehand(el as SVGPathElement, id), id });
      id++;
    } else if (tag === "g") {
      const gType = el.getAttribute("data-type");
      // Arrow group — ArrowTool's output since the move away from SVG
      // markers. Same XML shape as the legacy <line> form; the helper
      // just reads endpoints from data-x1/y1/x2/y2 and arrow spec
      // from the data-arrow-*-* attrs.
      if (gType === "arrow") {
        shapes.push({ xml: buildLine(el, id), id });
        id++;
      } else if (gType === "freehand") {
        // Freehand session group — one <path> per stroke. Wrap all
        // strokes in an OOXML `<p:grpSp>` so PowerPoint opens them
        // as a single selectable group (mirroring Annot's one-object
        // UX). Each child <path> still becomes its own `<p:sp>` so
        // per-stroke color / width / style is preserved; the group
        // just organizes them visually.
        const groupXml = buildFreehandGroup(el, id);
        if (groupXml) {
          shapes.push({ xml: groupXml.xml, id });
          id = groupXml.nextId;
        }
      } else {
        // Numbered marker: circle/rect/rounded + text. Pass the outer
        // <g> so buildMarker can inspect `data-shape` and dispatch to
        // the correct OOXML prstGeom (`ellipse` / `rect` / `roundRect`).
        const text = el.querySelector("text");
        const bg = el.querySelector("circle, rect");
        if (bg && text) {
          shapes.push({ xml: buildMarker(el, bg, text, id), id });
          id++;
        }
      }
    }
  }
  return shapes;
}

function buildLine(el: SVGElement, id: number): string {
  // Endpoints come from `x1/y1/x2/y2` (legacy `<line>`) or `data-x1/…`
  // (arrow `<g>`). getEffectiveLineEndpoints handles both shapes AND
  // applies any lingering data-rot/flip/tx,ty state so we always get
  // the "what the user sees" endpoints in world space. Going through
  // this helper is what lets us skip `rot=` / `flipH=` / `flipV=` in
  // the OOXML `<a:xfrm>` below — the endpoints already encode all
  // orientation. Without this step, a legacy arrow that still carries
  // a `data-rot` attribute would be rotated TWICE (once via the
  // pre-rotation endpoints, once via the OOXML rot attr), landing in
  // a completely different position than the Annot canvas shows.
  const { x1, y1, x2, y2, cx, cy } = getEffectiveLineEndpoints(el);
  const stroke = el.getAttribute("stroke") || "#ff0000";
  const sw = Number.parseFloat(el.getAttribute("stroke-width") || "3");
  const isCurved = cx != null && cy != null;

  // Bounding box includes the control point for curved arrows — a
  // quadratic Bézier is contained in the convex hull of its 3 control
  // points, so (min/max of {x1,cx,x2}) × (min/max of {y1,cy,y2}) is a
  // tight and correct bbox. Without this, the control point could sit
  // outside the bbox and PowerPoint would clip the curve.
  const xs = isCurved ? [x1, cx!, x2] : [x1, x2];
  const ys = isCurved ? [y1, cy!, y2] : [y1, y2];
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const w = Math.max(...xs) - left || 1;
  const h = Math.max(...ys) - top || 1;

  // Flip flags only apply to the straight `prst="line"` form — they
  // select which diagonal of the bbox the line traces. For curves we
  // emit explicit path coords so no flip is ever needed.
  const flipH = !isCurved && x2 < x1 ? ' flipH="1"' : "";
  const flipV = !isCurved && y2 < y1 ? ' flipV="1"' : "";

  // Per-end head config — translate SVG shape names into OOXML preset
  // types. Fall back to the legacy marker-end attribute so pre-refactor
  // arrows ("any marker-end present" → triangle) still look right.
  const startShape = el.getAttribute("data-arrow-start-shape");
  const endShape = el.getAttribute("data-arrow-end-shape");
  // Read width & length separately (new schema). Fall back through
  // the legacy single-size attr for content created before the split.
  const startW =
    el.getAttribute("data-arrow-start-width") || el.getAttribute("data-arrow-start-size") || "md";
  const startL =
    el.getAttribute("data-arrow-start-length") || el.getAttribute("data-arrow-start-size") || "md";
  const endW =
    el.getAttribute("data-arrow-end-width") || el.getAttribute("data-arrow-end-size") || "md";
  const endL =
    el.getAttribute("data-arrow-end-length") || el.getAttribute("data-arrow-end-size") || "md";
  const legacyEnd = !!el.getAttribute("marker-end");

  const head = endOOXML("headEnd", startShape, startW, startL);
  const tail =
    endShape != null
      ? endOOXML("tailEnd", endShape, endW, endL)
      : legacyEnd
        ? `<a:tailEnd type="triangle" w="med" len="med"/>`
        : "";
  // Legacy single-var for downstream insertion below.
  const tailEnd = head + tail;

  if (isCurved) {
    // Curved arrow — emit a freeform shape (p:sp + custGeom) with a
    // quadratic-Bézier path. OOXML doesn't have a "curved line with
    // an arbitrary control point" preset, and prst="curvedConnector3"
    // only offers a single hard-coded S-bend — so custGeom is the
    // only faithful round-trip. Arrow-head `<a:headEnd>` /
    // `<a:tailEnd>` still work on custGeom.
    //
    // Path coordinates: OOXML's `<a:path w=.. h=..>` defines a LOCAL
    // coordinate system (in EMU). By setting w/h to the bbox's EMU
    // size we can write path points as (worldX - left, worldY - top)
    // in EMU with no additional scaling.
    const wEmu = px(w);
    const hEmu = px(h);
    const localX = (wx: number) => px(wx - left);
    const localY = (wy: number) => px(wy - top);
    return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="CurvedArrow ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${px(left)}" y="${px(top)}"/>
      <a:ext cx="${wEmu}" cy="${hEmu}"/>
    </a:xfrm>
    <a:custGeom>
      <a:avLst/>
      <a:gdLst/>
      <a:ahLst/>
      <a:cxnLst/>
      <a:rect l="0" t="0" r="${wEmu}" b="${hEmu}"/>
      <a:pathLst>
        <a:path w="${wEmu}" h="${hEmu}">
          <a:moveTo><a:pt x="${localX(x1)}" y="${localY(y1)}"/></a:moveTo>
          <a:quadBezTo>
            <a:pt x="${localX(cx!)}" y="${localY(cy!)}"/>
            <a:pt x="${localX(x2)}" y="${localY(y2)}"/>
          </a:quadBezTo>
        </a:path>
      </a:pathLst>
    </a:custGeom>
    ${lineLnXml(el, sw, stroke, tailEnd)}
  </p:spPr>
</p:sp>`;
  }

  return `<p:cxnSp>
  <p:nvCxnSpPr>
    <p:cNvPr id="${id}" name="Line ${id}"/>
    <p:cNvCxnSpPr/>
    <p:nvPr/>
  </p:nvCxnSpPr>
  <p:spPr>
    <a:xfrm${flipH}${flipV}>
      <a:off x="${px(left)}" y="${px(top)}"/>
      <a:ext cx="${px(w)}" cy="${px(h)}"/>
    </a:xfrm>
    <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
    ${lineLnXml(el, sw, stroke, tailEnd)}
  </p:spPr>
</p:cxnSp>`;
}

function buildRect(el: SVGRectElement, id: number): string {
  const x = Number.parseFloat(el.getAttribute("x") || "0");
  const y = Number.parseFloat(el.getAttribute("y") || "0");
  const w = Number.parseFloat(el.getAttribute("width") || "0");
  const h = Number.parseFloat(el.getAttribute("height") || "0");
  const stroke = el.getAttribute("stroke") || "#ff0000";
  const sw = Number.parseFloat(el.getAttribute("stroke-width") || "3");
  const fill = el.getAttribute("fill") || "none";
  const fillXml = paintXml(el, fill, "fill");

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="Rect ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm${xfrmAttrs(el)}>
      <a:off x="${px(x)}" y="${px(y)}"/>
      <a:ext cx="${px(w)}" cy="${px(h)}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    ${fillXml}
    <a:ln w="${ptToEMU(sw)}">
      ${paintXml(el, stroke, "stroke")}
    </a:ln>
  </p:spPr>
</p:sp>`;
}

function buildEllipse(el: SVGEllipseElement, id: number): string {
  const cx = Number.parseFloat(el.getAttribute("cx") || "0");
  const cy = Number.parseFloat(el.getAttribute("cy") || "0");
  const rx = Number.parseFloat(el.getAttribute("rx") || "0");
  const ry = Number.parseFloat(el.getAttribute("ry") || "0");
  const stroke = el.getAttribute("stroke") || "#ff0000";
  const sw = Number.parseFloat(el.getAttribute("stroke-width") || "3");
  const fill = el.getAttribute("fill") || "none";

  const fillXml = paintXml(el, fill, "fill");

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="Ellipse ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm${xfrmAttrs(el)}>
      <a:off x="${px(cx - rx)}" y="${px(cy - ry)}"/>
      <a:ext cx="${px(rx * 2)}" cy="${px(ry * 2)}"/>
    </a:xfrm>
    <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
    ${fillXml}
    <a:ln w="${ptToEMU(sw)}">
      ${paintXml(el, stroke, "stroke")}
    </a:ln>
  </p:spPr>
</p:sp>`;
}

function buildText(el: SVGTextElement, id: number): string {
  const x = Number.parseFloat(el.getAttribute("x") || "0");
  const y = Number.parseFloat(el.getAttribute("y") || "0");
  const fontSize = Number.parseFloat(el.getAttribute("font-size") || "24");
  const fill = el.getAttribute("fill") || "#ff0000";

  // Collect text from tspans or direct text
  const tspans = el.querySelectorAll("tspan");
  let textContent = "";
  if (tspans.length > 0) {
    const lines: string[] = [];
    tspans.forEach((ts) => lines.push(ts.textContent || ""));
    textContent = lines.join("\n");
  } else {
    textContent = el.textContent || "";
  }

  // Font size in hundredths of a point: 24px ≈ 18pt = 1800
  const ptSize = Math.round(fontSize * 0.75 * 100);

  const paragraphs = textContent
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="ja-JP" sz="${ptSize}" dirty="0">
      <a:solidFill><a:srgbClr val="${colorHex(fill)}"/></a:solidFill>
    </a:rPr><a:t>${escXml(line)}</a:t></a:r></a:p>`,
    )
    .join("");

  // Estimate text box size
  const boxW = Math.max(200, textContent.length * fontSize * 0.6);
  const boxH = fontSize * 1.5 * textContent.split("\n").length;

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="Text ${id}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm${xfrmAttrs(el)}>
      <a:off x="${px(x)}" y="${px(y - fontSize)}"/>
      <a:ext cx="${px(boxW)}" cy="${px(boxH)}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="none" rtlCol="0"/>
    <a:lstStyle/>
    ${paragraphs}
  </p:txBody>
</p:sp>`;
}

function buildFreehand(el: SVGPathElement, id: number): string {
  const d = el.getAttribute("d") || "";
  const stroke = el.getAttribute("stroke") || "#ff0000";
  const sw = Number.parseFloat(el.getAttribute("stroke-width") || "3");

  // Parse SVG path to get bounding box and relative points
  const points = parseSVGPath(d);
  if (points.length < 2) return "";

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  // Include the element's pending translation (set by drag / align /
  // nudge on the path directly, or inherited from a freehand <g>
  // parent via the caller passing the group's offset).
  const pathOff = offsetFromTransform(el);
  const offX = minX + pathOff.tx;
  const offY = minY + pathOff.ty;

  // Convert to DrawingML path (coordinates in EMU relative to shape origin)
  const pathPoints = points
    .map((p, i) => {
      const ex = px(p.x - minX);
      const ey = px(p.y - minY);
      return i === 0
        ? `<a:moveTo><a:pt x="${ex}" y="${ey}"/></a:moveTo>`
        : `<a:lnTo><a:pt x="${ex}" y="${ey}"/></a:lnTo>`;
    })
    .join("");

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="Freehand ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm${xfrmAttrs(el)}>
      <a:off x="${px(offX)}" y="${px(offY)}"/>
      <a:ext cx="${px(bw)}" cy="${px(bh)}"/>
    </a:xfrm>
    <a:custGeom>
      <a:avLst/>
      <a:gdLst/>
      <a:ahLst/>
      <a:cxnLst/>
      <a:rect l="0" t="0" r="${px(bw)}" b="${px(bh)}"/>
      <a:pathLst>
        <a:path w="${px(bw)}" h="${px(bh)}">
          ${pathPoints}
        </a:path>
      </a:pathLst>
    </a:custGeom>
    <a:noFill/>
    <a:ln w="${ptToEMU(sw)}" cap="rnd">
      ${paintXml(el, stroke, "stroke")}
      <a:round/>
    </a:ln>
  </p:spPr>
</p:sp>`;
}

/** Wrap a freehand session `<g>` as an OOXML group shape (`<p:grpSp>`)
 *  so PowerPoint opens the strokes as a single selectable unit.
 *  Each child `<path>` is emitted as a `<p:sp>` via `buildFreehand`,
 *  preserving per-stroke color / width / style. The group's xfrm
 *  uses slide-native child coordinates (chOff/chExt = off/ext) so
 *  children's existing `<a:xfrm>` slide-position values land in the
 *  right place without additional translation.
 *
 *  Returns `{ xml, nextId }` — `nextId` is the id counter after
 *  consuming the group id + all child ids, so the caller can keep
 *  its id sequence monotonic. Returns `null` if the group has no
 *  path children to wrap. */
function buildFreehandGroup(
  g: SVGElement,
  startId: number,
): { xml: string; nextId: number } | null {
  const paths = g.querySelectorAll<SVGPathElement>(":scope > path");
  if (paths.length === 0) return null;

  // Compute the collective bbox so the group's xfrm knows its extent.
  // PowerPoint uses this for selection highlight + as the reference
  // frame when the user subsequently moves the group.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of Array.from(paths)) {
    const pts = parseSVGPath(p.getAttribute("d") || "");
    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  // Bake the freehand group's pending translation into BOTH the
  // group's offset AND its child-coord offset (so inner paths land
  // at the right place inside the group). Without this, aligning /
  // nudging a freehand drawing leaves the PPTX export at the old
  // spot.
  const grpOff = offsetFromTransform(g);
  const offX = minX + grpOff.tx;
  const offY = minY + grpOff.ty;

  const groupId = startId;
  let childId = startId + 1;
  const childXml: string[] = [];
  for (const p of Array.from(paths)) {
    const xml = buildFreehand(p, childId);
    if (xml) {
      childXml.push(xml);
      childId++;
    }
  }

  const xml = `<p:grpSp>
  <p:nvGrpSpPr>
    <p:cNvPr id="${groupId}" name="Freehand group ${groupId}"/>
    <p:cNvGrpSpPr/>
    <p:nvPr/>
  </p:nvGrpSpPr>
  <p:grpSpPr>
    <a:xfrm${xfrmAttrs(g)}>
      <a:off x="${px(offX)}" y="${px(offY)}"/>
      <a:ext cx="${px(bw)}" cy="${px(bh)}"/>
      <a:chOff x="${px(minX)}" y="${px(minY)}"/>
      <a:chExt cx="${px(bw)}" cy="${px(bh)}"/>
    </a:xfrm>
  </p:grpSpPr>
  ${childXml.join("\n  ")}
</p:grpSp>`;

  return { xml, nextId: childId };
}

function buildMarker(g: SVGElement, bg: Element, text: SVGTextElement, id: number): string {
  // Geometry is taken from whichever SVG primitive backs the marker
  // (circle or rect). Shape routing comes from `data-shape` on the
  // outer <g> (authoritative — written by MarkerTool) with a fallback
  // to the bg tag in case data-shape is missing (legacy content).
  const declaredShape = g.getAttribute("data-shape");
  const isRectLike =
    declaredShape === "rect" || declaredShape === "rounded" || bg.tagName === "rect";
  const isRounded = declaredShape === "rounded";

  let offX: number;
  let offY: number;
  let extCx: number;
  let extCy: number;
  if (isRectLike) {
    offX = Number.parseFloat(bg.getAttribute("x") || "0");
    offY = Number.parseFloat(bg.getAttribute("y") || "0");
    extCx = Number.parseFloat(bg.getAttribute("width") || "36");
    extCy = Number.parseFloat(bg.getAttribute("height") || "36");
  } else {
    const cx = Number.parseFloat(bg.getAttribute("cx") || "0");
    const cy = Number.parseFloat(bg.getAttribute("cy") || "0");
    const r = Number.parseFloat(bg.getAttribute("r") || "18");
    offX = cx - r;
    offY = cy - r;
    extCx = r * 2;
    extCy = r * 2;
  }
  // The outer <g> may carry a data-tx/data-ty translation (from
  // drag / align / nudge via #moveElement → nudgeTranslate). Bake
  // it into the export offset so aligned / moved markers land where
  // the user sees them, not where their child geometry was before
  // the move.
  const off = offsetFromTransform(g);
  offX += off.tx;
  offY += off.ty;

  const fill = bg.getAttribute("fill") || "#ff0000";
  const label = text.textContent || "";
  const fontSize = Number.parseFloat(text.getAttribute("font-size") || "16");
  const ptSize = Math.round(fontSize * 0.75 * 100);

  // OOXML preset geometry selector. `roundRect` uses an adjustment
  // value in `avLst` — we map the SVG rx (relative to half the shorter
  // side) onto OOXML's 0–50000 permille scale so the rounding matches
  // the on-canvas look.
  let prstGeomXml: string;
  if (isRounded) {
    const rx = Number.parseFloat(bg.getAttribute("rx") || "0");
    const halfMin = Math.max(1, Math.min(extCx, extCy) / 2);
    const adj = Math.round(Math.max(0, Math.min(1, rx / halfMin)) * 50000);
    prstGeomXml = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
  } else if (isRectLike) {
    prstGeomXml = `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  } else {
    prstGeomXml = `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>`;
  }

  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="Marker ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${px(offX)}" y="${px(offY)}"/>
      <a:ext cx="${px(extCx)}" cy="${px(extCy)}"/>
    </a:xfrm>
    ${prstGeomXml}
    <a:solidFill><a:srgbClr val="${colorHex(fill)}"/></a:solidFill>
    <a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
  </p:spPr>
  <p:txBody>
    <a:bodyPr anchor="ctr"/>
    <a:lstStyle/>
    <a:p>
      <a:pPr algn="ctr"/>
      <a:r>
        <a:rPr lang="en-US" sz="${ptSize}" b="1">
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        </a:rPr>
        <a:t>${escXml(label)}</a:t>
      </a:r>
    </a:p>
  </p:txBody>
</p:sp>`;
}

// --- Data URI to binary ---

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  if (!dataUrl?.startsWith("data:")) return new Uint8Array(0);
  const base64 = dataUrl.split(",")[1];
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- SVG path parser (basic M/L commands) ---

function parseSVGPath(d: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const re = /([ML])\s*([\d.-]+)[,\s]+([\d.-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    // Both capture groups (x and y) are required by the regex.
    points.push({ x: Number.parseFloat(m[2]!), y: Number.parseFloat(m[3]!) });
  }
  return points;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- OOXML boilerplate ---

function contentTypes(hasImage: boolean, imageExt: string): string {
  const imgDefault = hasImage
    ? `\n  <Default Extension="${imageExt}" ContentType="image/${imageExt === "png" ? "png" : "jpeg"}"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>${imgDefault}
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function coreProps(): string {
  const now = new Date().toISOString().replace(/\.\d+Z/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>SVGShot</dc:title>
  <dc:creator>SVGShot</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appProps(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SVGShot</Application>
  <Slides>1</Slides>
</Properties>`;
}

function presentation(w: number, h: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="${px(w)}" cy="${px(h)}" type="custom"/>
  <p:notesSz cx="${px(w)}" cy="${px(h)}"/>
</p:presentation>`;
}

function presentationRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

function buildSlide(w: number, h: number, shapes: ShapeInfo[], hasImage: boolean): string {
  const shapeXml = shapes.map((s) => s.xml).join("\n");
  // Screenshot as a picture shape, placed behind annotations
  const picXml = hasImage
    ? `<p:pic>
      <p:nvPicPr>
        <p:cNvPr id="1000" name="Screenshot"/>
        <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
        <p:nvPr/>
      </p:nvPicPr>
      <p:blipFill>
        <a:blip r:embed="rId2"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${px(w)}" cy="${px(h)}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:pic>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(w)}" cy="${px(h)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(w)}" cy="${px(h)}"/></a:xfrm></p:grpSpPr>
      ${picXml}
      ${shapeXml}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function slideRels(hasImage: boolean, imageExt = "jpeg"): string {
  const imgRel = hasImage
    ? `\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/screenshot.${imageExt}"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imgRel}
</Relationships>`;
}

function slideLayout(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`;
}

function slideLayoutRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

function slideMaster(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;
}

function slideMasterRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function theme(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SVGShot">
  <a:themeElements>
    <a:clrScheme name="SVGShot">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="SVGShot">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="SVGShot">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}
