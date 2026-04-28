/**
 * PPTX export — slide envelope + theme + content_types + ZIP
 * packaging. Per-shape OOXML construction lives in the shared
 * builder (`@ingcreators/annot-render/drawingml`); this file
 * is what's left after
 * [`_done/pptx-export-shared-builder-finish` phase 4](../../../docs/plans/_done/pptx-export-shared-builder-finish.md)
 * folded the simple emitters and the line / arrow / freehand
 * cases into the shared dispatch.
 *
 * The one PPTX-only structure that stays is the freehand
 * session group's `<p:grpSp>` wrapper — the GVML clipboard
 * side intentionally flattens, so there's nothing to share
 * for that case.
 */

import {
  svgElementToAnnotationShape,
  translateOf,
} from "@ingcreators/annot-core/editor/svg-to-annotation-shapes";
import { defaultAnnotFilenameStem } from "@ingcreators/annot-core/utils";
import { buildZip } from "@ingcreators/annot-core/zip";
import { buildShapeXml, parseSvgPath, px } from "@ingcreators/annot-render";
import type { CanvasManager } from "./canvas-manager.js";

const __pptxTextEncoder = new TextEncoder();
function strToU8(s: string): Uint8Array {
  return __pptxTextEncoder.encode(s);
}

/** Build the rotation / flip attribute string for the freehand
 *  session-group's `<a:xfrm>` open tag. PPTX-only — the GVML
 *  clipboard side flattens freehand sessions to individual shapes,
 *  so there's no equivalent in the shared builder. The
 *  shape-level rotation / flip used by every other PPTX shape
 *  goes through `xfrmAttrs(s, opts)` in
 *  `@ingcreators/annot-render/drawingml/helpers`; this helper is
 *  the SVG-element-input twin needed for the group wrapper
 *  itself. */
function freehandGroupXfrmAttrs(el: SVGElement): string {
  let rot = Number.parseFloat(el.getAttribute("data-rot") || "0") || 0;
  let out = "";
  if (rot) {
    rot = ((rot % 360) + 360) % 360;
    out += ` rot="${Math.round(rot * 60000)}"`;
  }
  if (el.getAttribute("data-flip-h") === "1") out += ` flipH="1"`;
  if (el.getAttribute("data-flip-v") === "1") out += ` flipV="1"`;
  return out;
}

interface ShapeInfo {
  xml: string;
  id: number;
}

/** One mosaic / blur image embedded in the PPTX package. The
 *  filename lands at `ppt/media/{filename}` and is referenced
 *  from `ppt/slides/_rels/slide1.xml.rels` with the matching
 *  `rId{rid}` — the per-shape `<a:blip r:embed="rId..."/>` inside
 *  the slide XML points at it. */
interface MosaicMedia {
  filename: string;
  bytes: Uint8Array;
  /** rId on the slide rels. Slide rIds: rId1 = slideLayout,
   *  rId2 = screenshot (when present), rId3+ = mosaic media in
   *  declaration order. */
  rid: number;
}

/** Result of walking the canvas annotation tree: the per-shape
 *  XML fragments plus the mosaic media files that need to be
 *  embedded alongside the slide XML. */
interface BuiltShapes {
  shapes: ShapeInfo[];
  mosaicMedia: MosaicMedia[];
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

  // Extract JPEG / PNG binary from data URI.
  const dataUrl = input.imageEl.getAttribute("href") || "";
  const imageBytes = dataUrlToUint8Array(dataUrl);
  const imageExt = dataUrl.startsWith("data:image/png") ? "png" : "jpeg";
  const hasImage = imageBytes.length > 0;

  const { shapes, mosaicMedia } = buildShapes(input, hasImage);
  const slideXml = buildSlide(w, h, shapes, hasImage);

  // Image-extension defaults for `[Content_Types].xml`. Always
  // declare both png + jpeg when ANY image is present (screenshot
  // is typically PNG; mosaic patches arrive as PNG today but
  // could be jpeg if the redact tool ever produces it).
  const usesPng =
    (hasImage && imageExt === "png") || mosaicMedia.some((m) => m.filename.endsWith(".png"));
  const usesJpeg =
    (hasImage && imageExt === "jpeg") || mosaicMedia.some((m) => m.filename.endsWith(".jpeg"));

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(usesPng, usesJpeg)),
    "_rels/.rels": strToU8(rootRels()),
    "ppt/presentation.xml": strToU8(presentation(w, h)),
    "ppt/_rels/presentation.xml.rels": strToU8(presentationRels()),
    "ppt/slides/slide1.xml": strToU8(slideXml),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(slideRels(hasImage, imageExt, mosaicMedia)),
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
  for (const media of mosaicMedia) {
    files[`ppt/media/${media.filename}`] = media.bytes;
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
  a.download = `${defaultAnnotFilenameStem()}.pptx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildShapes(input: PptxExportInput, hasImage: boolean): BuiltShapes {
  const shapes: ShapeInfo[] = [];
  const mosaicMedia: MosaicMedia[] = [];
  let id = 2; // id=1 is reserved for slide background
  // rId allocation on the slide rels:
  //   rId1 = slideLayout
  //   rId2 = screenshot (when present)
  //   rId3+ = mosaic media in declaration order
  let nextMosaicRid = hasImage ? 3 : 2;

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

    // Mosaic / blur images need an OPC media entry + an rId
    // pointing at it before the shape XML can reference the
    // image via `<a:blip r:embed="rId..."/>`. Parse the data
    // URL into bytes, allocate the next rId, accumulate the
    // media for the packager, and pass `picRid` so the shared
    // builder emits a `<p:pic>` instead of dropping the shape.
    if (shape.type === "mosaic_image" || shape.type === "blur_image") {
      const dataUrl = shape.image_data_url ?? "";
      const bytes = dataUrlToUint8Array(dataUrl);
      if (bytes.length === 0) continue; // un-parseable → skip
      const ext = dataUrl.startsWith("data:image/png") ? "png" : "jpeg";
      const filename = `mosaic_${mosaicMedia.length}.${ext}`;
      const rid = nextMosaicRid;
      nextMosaicRid += 1;
      mosaicMedia.push({ filename, bytes, rid });
      const xml = buildShapeXml(shape, { ns: "p", id, picRid: rid });
      if (xml) {
        shapes.push({ xml, id });
        id += 1;
      }
      continue;
    }

    const xml = buildShapeXml(shape, { ns: "p", id });
    if (xml) {
      shapes.push({ xml, id });
      id++;
    }
  }
  return { shapes, mosaicMedia };
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
  const grpOff = translateOf(g);
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
    <a:xfrm${freehandGroupXfrmAttrs(g)}>
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

function contentTypes(usesPng: boolean, usesJpeg: boolean): string {
  const pngDefault = usesPng ? `\n  <Default Extension="png" ContentType="image/png"/>` : "";
  const jpegDefault = usesJpeg
    ? `\n  <Default Extension="jpeg" ContentType="image/jpeg"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>${pngDefault}${jpegDefault}
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

function slideRels(
  hasImage: boolean,
  imageExt = "jpeg",
  mosaicMedia: ReadonlyArray<MosaicMedia> = [],
): string {
  const imgRel = hasImage
    ? `\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/screenshot.${imageExt}"/>`
    : "";
  const mosaicRels = mosaicMedia
    .map(
      (m) =>
        `\n  <Relationship Id="rId${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.filename}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imgRel}${mosaicRels}
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
