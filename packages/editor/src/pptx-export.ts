import { svgElementToAnnotationShape } from "@ingcreators/annot-core/editor/svg-to-annotation-shapes";
import { buildZip } from "@ingcreators/annot-core/zip";
import { buildShapeXml, parseSvgPath, px } from "@ingcreators/annot-render";
import type { CanvasManager } from "./canvas-manager.js";

const __pptxTextEncoder = new TextEncoder();
function strToU8(s: string): Uint8Array {
  return __pptxTextEncoder.encode(s);
}

/**
 * Build a `<a:gradFill>` XML fragment from a gradient spec (parsed
 * from the data-*-gradient JSON attribute). OOXML uses
 * `gsLst` → `<a:gs>` children with `pos` in thousandths and colors
 * inside `<a:srgbClr>`. The angle is in 60000ths of a degree with the
 * same convention as our source (0° = left→right, CW positive).
 */
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

/**
 * Structural input for `buildPptxFiles` — the subset of
 * `CanvasManager` that PPTX export actually reads. Lets the unit
 * test feed a stub without spinning up a full editor instance.
 */
export interface PptxExportInput {
  imageWidth: number;
  imageHeight: number;
  imageEl: { getAttribute(name: string): string | null };
  annotations: { childNodes: ArrayLike<Node> };
}

/**
 * Build the PPTX OPC file map (filenames → bytes) for a given canvas
 * input. Reachable from a unit test (see `pptx-export.test.ts`); the
 * download wrapper `exportPptx` keeps the existing public entry point
 * and packs this output into a ZIP + triggers a browser download.
 */
export function buildPptxFiles(input: PptxExportInput): Record<string, Uint8Array> {
  const w = input.imageWidth;
  const h = input.imageHeight;
  const shapes = buildShapes(input);

  // Extract JPEG / PNG binary from data URI.
  const dataUrl = input.imageEl.getAttribute("href") || "";
  const imageBytes = dataUrlToUint8Array(dataUrl);
  const imageExt = dataUrl.startsWith("data:image/png") ? "png" : "jpeg";
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

  return files;
}

export function exportPptx(canvas: CanvasManager): void {
  const files = buildPptxFiles(canvas);
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

function buildShapes(input: PptxExportInput): ShapeInfo[] {
  const shapes: ShapeInfo[] = [];
  let id = 2; // id=1 is reserved for slide background

  const annos = input.annotations.childNodes;
  for (const node of Array.from(annos)) {
    if (node.nodeType !== 1) continue;
    const el = node as SVGElement;
    const tag = el.tagName;

    // Freehand session group — one `<p:grpSp>` containing one
    // `<p:sp>` per stroke. PPTX-only structure (the GVML
    // clipboard side flattens to individual freehand shapes), so
    // it stays in pptx-export.
    if (tag === "g" && el.getAttribute("data-type") === "freehand") {
      const groupXml = buildFreehandGroup(el, id);
      if (groupXml) {
        shapes.push({ xml: groupXml.xml, id });
        id = groupXml.nextId;
      }
      continue;
    }
    // Everything else routes through the shared builder — same
    // dispatcher the Office-clipboard path uses, so any new tool
    // gets PPTX support automatically once `transformOf` and the
    // shared per-shape emitter know about it.
    const shape = svgElementToAnnotationShape(el);
    if (!shape) continue;
    const xml = buildShapeXml(shape, { ns: "p", id });
    if (xml) {
      shapes.push({ xml, id });
      id++;
    }
  }
  return shapes;
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
    const pts = parseSvgPath(p.getAttribute("d") || "");
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
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
    // Each per-stroke `<p:sp>` goes through the shared builder
    // — same `freehand` emitter the Office-clipboard side uses.
    // The group wrapper (`<p:grpSp>` + group `xfrm`) stays
    // here because PPTX uses it for "select all strokes as one
    // unit" UX; GVML clipboard intentionally flattens.
    const shape = svgElementToAnnotationShape(p);
    if (!shape) continue;
    const xml = buildShapeXml(shape, { ns: "p", id: childId });
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
