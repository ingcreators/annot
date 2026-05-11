/**
 * `exportDocumentPptx(doc): Blob` — multi-slide PPTX export.
 *
 * Phase 11 of `docs/plans/annot-html-document.md`. Each
 * `ImageBlock` in the document maps to one slide; the embedded
 * `<svg>` is parsed and its annotations re-emitted as OOXML via
 * the same `buildShapeXml` dispatcher the image-side export
 * (`packages/editor/src/pptx-export.ts`) uses.
 *
 * The OOXML envelope (theme / slideLayout / slideMaster /
 * presentation / content_types) is currently duplicated from
 * the editor side rather than shared via a helpers module, to
 * keep this PR focused on the new feature. A follow-up will
 * dedupe the boilerplate once both call sites are exercised
 * against shipping fixtures.
 *
 * Browser / happy-dom only — `parseSvgFromString` resolves
 * `globalThis.DOMParser` lazily, mirroring `parseDocument` in
 * `@ingcreators/annot-doc`. Pure-Node callers without happy-dom
 * get a clear error instead of a `TypeError: undefined is not a
 * constructor`.
 */

import { svgElementToAnnotationShape } from "@ingcreators/annot-core/editor/svg-to-annotation-shapes";
import { buildZip } from "@ingcreators/annot-core/zip";
import type { AnnotDocument, ImageBlock, StepBlock, StepLayout } from "@ingcreators/annot-doc";
import { buildShapeXml, px } from "../drawingml/index.js";

/** Output of {@link buildDocumentPptxFiles} — the OPC file map
 *  ready to be packed into a ZIP. Exported so the unit test can
 *  inspect individual entries without going through the
 *  `Blob` re-wrap in `exportDocumentPptx`. */
export type DocumentPptxFiles = Record<string, Uint8Array>;

/** Per-slide accumulation collected while walking
 *  `doc.blocks`. Image blocks become one entry; non-image
 *  blocks are skipped (Phase 11 doesn't ship the
 *  heading-blocks-as-title-slides option — the plan calls it
 *  "default off" so we leave it as a future extension). */
interface SlideData {
  /** 1-based slide index (used for filename `slide${n}.xml`). */
  index: number;
  /** Slide width in pixels (matches the source SVG's intrinsic
   *  dimensions; PPTX uses EMU but we compute it via `px()`). */
  width: number;
  height: number;
  /** Background screenshot bytes, or null when the SVG has no
   *  embedded `<image>` child (annotations-only export). */
  imageBytes: Uint8Array | null;
  imageExt: "png" | "jpeg";
  /** Per-shape OOXML fragments + the mosaic / blur media that
   *  rides along (each entry pre-allocates an rId so the
   *  slide rels can reference it). */
  shapes: { xml: string; id: number }[];
  mosaicMedia: {
    filename: string;
    bytes: Uint8Array;
    rid: number;
  }[];
}

/**
 * Build the OPC file map for a multi-slide PPTX export of the
 * given document. One slide per `ImageBlock`; non-image blocks
 * are silently skipped. Returns an empty file map when the
 * document carries no image blocks (callers can detect this by
 * checking for `Object.keys(files).length === 0` and surface
 * "nothing to export" feedback).
 */
export function buildDocumentPptxFiles(doc: AnnotDocument): DocumentPptxFiles {
  const slides = collectSlides(doc);
  if (slides.length === 0) return {};

  // Aggregate flags for `[Content_Types].xml` — declare PNG /
  // JPEG `Default` extensions when ANY slide carries that
  // format (screenshot or mosaic media).
  let usesPng = false;
  let usesJpeg = false;
  for (const s of slides) {
    if (s.imageBytes) {
      if (s.imageExt === "png") usesPng = true;
      else usesJpeg = true;
    }
    for (const m of s.mosaicMedia) {
      if (m.filename.endsWith(".png")) usesPng = true;
      else if (m.filename.endsWith(".jpeg")) usesJpeg = true;
    }
  }

  // Use the first slide's dimensions for `<p:sldSz>`; PPTX
  // requires every slide to share the slide size, so we pick
  // the first slide's intrinsic dimensions and trust that the
  // rest match. (Mismatched slide sizes still render — they
  // just don't fill the slide cleanly. A future enhancement
  // could pick the max-dimension to leave letterboxing
  // instead.)
  const slideW = slides[0]!.width;
  const slideH = slides[0]!.height;

  const files: DocumentPptxFiles = {
    "[Content_Types].xml": str(contentTypes(slides.length, usesPng, usesJpeg)),
    "_rels/.rels": str(rootRels()),
    "ppt/presentation.xml": str(presentation(slideW, slideH, slides.length)),
    "ppt/_rels/presentation.xml.rels": str(presentationRels(slides.length)),
    "ppt/slideLayouts/slideLayout1.xml": str(slideLayout()),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": str(slideLayoutRels()),
    "ppt/slideMasters/slideMaster1.xml": str(slideMaster()),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": str(slideMasterRels()),
    "ppt/theme/theme1.xml": str(theme()),
    "docProps/core.xml": str(coreProps()),
    "docProps/app.xml": str(appProps(slides.length)),
  };

  for (const s of slides) {
    files[`ppt/slides/slide${s.index}.xml`] = str(
      buildSlideXml(slideW, slideH, s.shapes, s.imageBytes !== null),
    );
    files[`ppt/slides/_rels/slide${s.index}.xml.rels`] = str(
      slideRels(s.index, s.imageBytes !== null, s.imageExt, s.mosaicMedia),
    );
    if (s.imageBytes) {
      files[`ppt/media/screenshot${s.index}.${s.imageExt}`] = s.imageBytes;
    }
    for (const m of s.mosaicMedia) {
      files[`ppt/media/${m.filename}`] = m.bytes;
    }
  }

  return files;
}

/**
 * Pack the OPC file map into a `application/vnd.openxmlformats…`
 * `Blob` ready for download. Returns `null` when the document
 * has no exportable image blocks.
 */
export function exportDocumentPptx(doc: AnnotDocument): Blob | null {
  const files = buildDocumentPptxFiles(doc);
  if (Object.keys(files).length === 0) return null;
  const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
  const zipBlob = buildZip(entries);
  return new Blob([zipBlob], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

// ---- Slide collection ----------------------------------------------------

function collectSlides(doc: AnnotDocument): SlideData[] {
  const out: SlideData[] = [];
  let slideIndex = 0;
  for (const block of doc.blocks) {
    if (block.kind === "image") {
      slideIndex += 1;
      const data = buildSlideFromImageBlock(block, slideIndex);
      if (data) out.push(data);
      continue;
    }
    // Phase 6 of `docs/plans/card-procedure-template.md` — step
    // blocks become slides alongside image blocks. The image is
    // full-bleed (matches the image-block path) so annotation
    // coordinates stay in their SVG-native space; title + body
    // are emitted as overlay `<p:sp>` text shapes positioned per
    // `data-step-layout`.
    if (block.kind === "step") {
      slideIndex += 1;
      const data = buildSlideFromStepBlock(block, slideIndex);
      if (data) out.push(data);
    }
  }
  return out;
}

function buildSlideFromImageBlock(block: ImageBlock, index: number): SlideData | null {
  const svgEl = parseSvgFromString(block.svg);
  if (!svgEl) return null;

  const { width, height } = readSvgDimensions(svgEl);
  if (width <= 0 || height <= 0) return null;

  const imageInfo = readBackgroundImage(svgEl);

  // Allocate rIds in the same order the editor side does:
  //   rId1 = slideLayout
  //   rId2 = screenshot (when present)
  //   rId3+ = mosaic media in declaration order
  let nextMosaicRid = imageInfo ? 3 : 2;

  const shapes: SlideData["shapes"] = [];
  const mosaicMedia: SlideData["mosaicMedia"] = [];

  let id = 2; // id=1 reserved for slide background group
  const annotationsEl = svgEl.querySelector("[id='annotations']");
  if (annotationsEl) {
    for (const node of Array.from(annotationsEl.childNodes)) {
      if (node.nodeType !== 1) continue;
      const el = node as unknown as SVGElement;
      const shape = svgElementToAnnotationShape(el);
      if (!shape) continue;

      // Mosaic / blur image shapes need an OPC media entry
      // before the per-shape XML can reference the embedded
      // image via `<a:blip r:embed="rIdN"/>`.
      if (shape.type === "mosaic_image" || shape.type === "blur_image") {
        const dataUrl = shape.image_data_url ?? "";
        const bytes = dataUrlToUint8Array(dataUrl);
        if (bytes.length === 0) continue;
        const ext = dataUrl.startsWith("data:image/png") ? "png" : "jpeg";
        const filename = `mosaic_${index}_${mosaicMedia.length}.${ext}`;
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
        id += 1;
      }
    }
  }

  return {
    index,
    width,
    height,
    imageBytes: imageInfo?.bytes ?? null,
    imageExt: imageInfo?.ext ?? "png",
    shapes,
    mosaicMedia,
  };
}

/**
 * Phase 6 of `docs/plans/card-procedure-template.md` — build a
 * slide from a `step` block. The step block's SVG carries the
 * same shape as an image block's SVG (background `<image>` +
 * `<g id="annotations">` tree), so we delegate to
 * `buildSlideFromImageBlock` against a synthesised stand-in,
 * then append the layout-positioned title + body overlay
 * `<p:sp>` shapes.
 *
 * The image stays full-bleed across every `data-step-layout`
 * value — annotation coordinates remain in their SVG-native
 * space, no transform required. The layout choice controls
 * WHERE the title + body text overlay sits on top of the image:
 *
 *   - `image-top`     → text at the bottom (CSS counterpart:
 *                       image visually top, text below it).
 *   - `image-bottom`  → text at the top (mirror).
 *   - `image-left`    → text on the right (image left → text
 *                       right).
 *   - `image-right`   → text on the left.
 *   - `image-fill`    → text at the bottom (the CSS default
 *                       overlay position; matches the
 *                       in-editor render).
 *
 * Every overlay carries a translucent dark backdrop + white
 * text so the title + body stay legible against any
 * screenshot. Future enhancement: parse `block.title` /
 * `block.body` rich-text HTML and emit per-run formatting
 * (bold / italic / underline). Phase 6 v1 strips inline tags
 * to plain text for the overlay — keeps the OOXML emit terse
 * and visually consistent across layouts.
 */
function buildSlideFromStepBlock(block: StepBlock, index: number): SlideData | null {
  const base = buildSlideFromImageBlock({ kind: "image", id: block.id, svg: block.svg }, index);
  if (!base) return null;

  // Allocate fresh `<p:cNvPr id="..."/>` ids for the text
  // shapes. `buildSlideFromImageBlock` started at 2 and
  // incremented per annotation; pick up from there.
  let nextId = base.shapes.reduce((m, s) => Math.max(m, s.id), 1) + 1;

  const placements = LAYOUT_PLACEMENTS[block.layout];
  const titleText = stripInlineHtml(block.title);
  const bodyText = stripInlineHtml(block.body);

  // Empty title or body slots — common when the user hasn't
  // typed anything yet — are emitted as visible empty boxes
  // would be noise. Skip them.
  if (titleText.length > 0) {
    const titleId = nextId++;
    base.shapes.push({
      xml: buildOverlayTextShapeXml({
        id: titleId,
        name: "StepTitle",
        text: titleText,
        rect: placements.title,
        slideW: base.width,
        slideH: base.height,
        fontSizeHpt: 2400,
        bold: true,
      }),
      id: titleId,
    });
  }
  if (bodyText.length > 0) {
    const bodyId = nextId++;
    base.shapes.push({
      xml: buildOverlayTextShapeXml({
        id: bodyId,
        name: "StepBody",
        text: bodyText,
        rect: placements.body,
        slideW: base.width,
        slideH: base.height,
        fontSizeHpt: 1600,
        bold: false,
      }),
      id: bodyId,
    });
  }

  return base;
}

/** Per-layout rectangles (as fractions of slide width / height)
 *  for the step block's title + body overlay. Mirrors the CSS
 *  layout's "text region" position: text sits where the body
 *  sits in the in-editor card render. */
const LAYOUT_PLACEMENTS: Record<
  StepLayout,
  {
    title: { x: number; y: number; w: number; h: number };
    body: { x: number; y: number; w: number; h: number };
  }
> = {
  // CSS: image top, text bottom — PPTX puts text at slide bottom.
  "image-top": {
    title: { x: 0.04, y: 0.72, w: 0.92, h: 0.08 },
    body: { x: 0.04, y: 0.8, w: 0.92, h: 0.16 },
  },
  // CSS: image bottom, text top — PPTX puts text at slide top.
  "image-bottom": {
    title: { x: 0.04, y: 0.04, w: 0.92, h: 0.08 },
    body: { x: 0.04, y: 0.12, w: 0.92, h: 0.16 },
  },
  // CSS: image left, text right — PPTX puts text on right side.
  "image-left": {
    title: { x: 0.56, y: 0.06, w: 0.4, h: 0.1 },
    body: { x: 0.56, y: 0.16, w: 0.4, h: 0.78 },
  },
  // CSS: image right, text left — PPTX puts text on left side.
  "image-right": {
    title: { x: 0.04, y: 0.06, w: 0.4, h: 0.1 },
    body: { x: 0.04, y: 0.16, w: 0.4, h: 0.78 },
  },
  // CSS: image fill + text bottom overlay — PPTX matches.
  "image-fill": {
    title: { x: 0.04, y: 0.78, w: 0.92, h: 0.08 },
    body: { x: 0.04, y: 0.86, w: 0.92, h: 0.1 },
  },
};

/** Strip inline HTML to plain text. The step title / body are
 *  stored as canonical inline HTML (Phase 1) — `<strong>`,
 *  `<em>`, `<u>`, `<span style>`, etc. Phase 6 v1 flattens that
 *  to a single run; rich formatting per run is a future
 *  enhancement that needs an HTML → `TextRun[]` parser bridge. */
function stripInlineHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

/** Escape characters that have special meaning inside OOXML
 *  text content. Matches the canonicaliser the format spec
 *  uses for `<a:t>` text. */
function escapeOoxmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface OverlayTextShapeOptions {
  id: number;
  name: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  slideW: number;
  slideH: number;
  /** Font size in hundredths of a point (PowerPoint's `sz`
   *  attribute unit). `2400` = 24 pt. */
  fontSizeHpt: number;
  bold: boolean;
}

/**
 * Emit one `<p:sp>` for the step's title or body overlay.
 * The shape draws a translucent dark backdrop (`alpha 65%`)
 * with white text on top so the overlay stays readable
 * against any screenshot. Phase 6 v1 — single-run plain text.
 */
function buildOverlayTextShapeXml(opts: OverlayTextShapeOptions): string {
  const xPx = opts.slideW * opts.rect.x;
  const yPx = opts.slideH * opts.rect.y;
  const wPx = opts.slideW * opts.rect.w;
  const hPx = opts.slideH * opts.rect.h;
  const text = escapeOoxmlText(opts.text);
  const boldAttr = opts.bold ? ' b="1"' : "";
  return `<p:sp>
        <p:nvSpPr>
          <p:cNvPr id="${opts.id}" name="${opts.name}"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="${px(xPx)}" y="${px(yPx)}"/>
            <a:ext cx="${px(wPx)}" cy="${px(hPx)}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="000000"><a:alpha val="65000"/></a:srgbClr></a:solidFill>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:defRPr/></a:pPr>
            <a:r>
              <a:rPr lang="en-US" sz="${opts.fontSizeHpt}"${boldAttr}>
                <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
              </a:rPr>
              <a:t>${text}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;
}

// ---- SVG helpers ---------------------------------------------------------

/**
 * Lazily resolve `globalThis.DOMParser` and parse the supplied
 * SVG string. Returns the root `<svg>` element, or `null` on
 * parse failure / missing DOMParser. The deliberate `null`
 * fallback (rather than throw) means a single malformed image
 * block doesn't abort the whole export — it just produces a
 * slide-less result for that block.
 */
function parseSvgFromString(svg: string): Element | null {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) return null;
  try {
    const parser = new Parser();
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    // Some DOMParser shims set `documentElement` to a
    // `<parsererror>` element on malformed input. Treat that
    // as a parse failure.
    if (root.tagName.toLowerCase() === "parsererror") return null;
    if (root.tagName.toLowerCase() !== "svg") return null;
    return root;
  } catch {
    return null;
  }
}

function readSvgDimensions(svgEl: Element): { width: number; height: number } {
  const widthAttr = Number.parseFloat(svgEl.getAttribute("width") ?? "");
  const heightAttr = Number.parseFloat(svgEl.getAttribute("height") ?? "");
  if (
    Number.isFinite(widthAttr) &&
    Number.isFinite(heightAttr) &&
    widthAttr > 0 &&
    heightAttr > 0
  ) {
    return { width: widthAttr, height: heightAttr };
  }
  // Fall back to viewBox if width / height attrs absent —
  // canonical Annot SVGs always carry both, but defensive
  // parsing keeps a malformed source from crashing the export.
  const viewBox = (svgEl.getAttribute("viewBox") ?? "").trim().split(/\s+/);
  if (viewBox.length === 4) {
    const w = Number.parseFloat(viewBox[2] ?? "");
    const h = Number.parseFloat(viewBox[3] ?? "");
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return { width: 0, height: 0 };
}

function readBackgroundImage(svgEl: Element): { bytes: Uint8Array; ext: "png" | "jpeg" } | null {
  const imageEl = svgEl.querySelector("image");
  if (!imageEl) return null;
  const href = imageEl.getAttribute("href") ?? imageEl.getAttribute("xlink:href") ?? "";
  if (!href.startsWith("data:")) return null;
  const bytes = dataUrlToUint8Array(href);
  if (bytes.length === 0) return null;
  const ext = href.startsWith("data:image/png") ? "png" : "jpeg";
  return { bytes, ext };
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  if (!dataUrl?.startsWith("data:")) return new Uint8Array(0);
  const base64 = dataUrl.split(",")[1];
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- OOXML envelope ------------------------------------------------------
//
// The boilerplate below mirrors `packages/editor/src/pptx-export.ts`'s
// generators, generalised to support N slides instead of 1. A
// future cleanup can dedupe the editor side onto these helpers
// (the editor's path is single-slide; passing N=1 produces
// equivalent output bytes).

const __encoder = new TextEncoder();
function str(s: string): Uint8Array {
  return __encoder.encode(s);
}

function contentTypes(slideCount: number, usesPng: boolean, usesJpeg: boolean): string {
  const pngDefault = usesPng ? `\n  <Default Extension="png" ContentType="image/png"/>` : "";
  const jpegDefault = usesJpeg ? `\n  <Default Extension="jpeg" ContentType="image/jpeg"/>` : "";
  const slideOverrides = Array.from({ length: slideCount }, (_, i) => i + 1)
    .map(
      (n) =>
        `\n  <Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>${pngDefault}${jpegDefault}
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideOverrides}
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
  <dc:title>Annot</dc:title>
  <dc:creator>Annot</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appProps(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Annot</Application>
  <Slides>${slideCount}</Slides>
</Properties>`;
}

function presentation(w: number, h: number, slideCount: number): string {
  // Slide IDs start at 256 (PPTX convention) and increment by 1
  // per slide. The `r:id="rId{N+1}"` correlates with the
  // matching presentation.rels entry (rId1 = slideMaster,
  // rId2..N+1 = slides).
  const slideIds = Array.from({ length: slideCount }, (_, i) => i)
    .map((i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="${px(w)}" cy="${px(h)}" type="custom"/>
  <p:notesSz cx="${px(w)}" cy="${px(h)}"/>
</p:presentation>`;
}

function presentationRels(slideCount: number): string {
  // rId1 = slideMaster, rId2..N+1 = slides, theme rId is N+2.
  const slideRelsXml = Array.from({ length: slideCount }, (_, i) => i + 1)
    .map(
      (n) =>
        `\n  <Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`,
    )
    .join("");
  const themeRid = slideCount + 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRelsXml}
  <Relationship Id="rId${themeRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

function buildSlideXml(
  w: number,
  h: number,
  shapes: { xml: string; id: number }[],
  hasImage: boolean,
): string {
  const shapeXml = shapes.map((s) => s.xml).join("\n");
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
  slideIndex: number,
  hasImage: boolean,
  imageExt: "png" | "jpeg",
  mosaicMedia: ReadonlyArray<{ filename: string; rid: number }>,
): string {
  const imgRel = hasImage
    ? `\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/screenshot${slideIndex}.${imageExt}"/>`
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
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Annot">
  <a:themeElements>
    <a:clrScheme name="Annot">
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
    <a:fontScheme name="Annot">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Annot">
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
