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

/** Phase 6b of `docs/plans/card-procedure-template.md` —
 *  globally-uniform slide canvas: PowerPoint widescreen (16:9)
 *  at 1280×720 px (= 12,192,000 × 6,858,000 EMU, the default
 *  PowerPoint applies when a user picks "Widescreen" without
 *  customising). Every slide in the deck shares this size,
 *  regardless of source-image dimensions or step layout, so
 *  the resulting `.pptx` looks consistent on every projector /
 *  display and prints cleanly at letter / A4 via PowerPoint's
 *  auto-fit. */
const SLIDE_W_PX = 1280;
const SLIDE_H_PX = 720;

/** Per-step-layout image placement inside the 16:9 slide,
 *  expressed as fractions (0..1) of the slide width / height.
 *  The image is `contain`-fitted within this rect — source
 *  aspect is preserved, letterboxing on either axis is
 *  accepted. */
const STEP_IMAGE_REGION: Record<StepLayout, { x: number; y: number; w: number; h: number }> = {
  // Image fills the upper 65%; bottom 35% reserved for text.
  "image-top": { x: 0, y: 0, w: 1, h: 0.65 },
  // Mirror — image at bottom, text up top.
  "image-bottom": { x: 0, y: 0.35, w: 1, h: 0.65 },
  // Two-column — image left 55%, text right 45%.
  "image-left": { x: 0, y: 0, w: 0.55, h: 1 },
  // Mirror — image right.
  "image-right": { x: 0.45, y: 0, w: 0.55, h: 1 },
  // Image fills entire slide; text overlays at the bottom with
  // a translucent backdrop (matches CSS image-fill).
  "image-fill": { x: 0, y: 0, w: 1, h: 1 },
};

/** Per-slide accumulation collected while walking
 *  `doc.blocks`. Image blocks become one entry; non-image
 *  blocks are skipped (Phase 11 doesn't ship the
 *  heading-blocks-as-title-slides option — the plan calls it
 *  "default off" so we leave it as a future extension). */
interface SlideData {
  /** 1-based slide index (used for filename `slide${n}.xml`). */
  index: number;
  /** The SVG's intrinsic dimensions — used as the child
   *  coordinate space for the image-group `<a:xfrm>` so
   *  annotation shapes keep their SVG-native coords. */
  width: number;
  height: number;
  /** Background screenshot bytes, or null when the SVG has no
   *  embedded `<image>` child (annotations-only export). */
  imageBytes: Uint8Array | null;
  imageExt: "png" | "jpeg";
  /** Phase 6b — image's slide-pixel rect (post-contain). The
   *  image-group `<p:grpSp>` is placed here; PowerPoint maps
   *  the child SVG coord space to this rect, automatically
   *  scaling the image + every annotation in lockstep. */
  imageRect: { x: number; y: number; w: number; h: number };
  /** Annotation shapes inside the image group, in SVG coord
   *  space (no transform — the group's `<a:xfrm>` handles
   *  scaling and translation). */
  shapes: { xml: string; id: number }[];
  /** Phase 6b — title / body text overlays positioned in slide
   *  coords (outside the image group). Empty for image blocks. */
  topLevelShapes: { xml: string; id: number }[];
  mosaicMedia: {
    filename: string;
    bytes: Uint8Array;
    rid: number;
  }[];
  /** Phase 7b — hyperlinks declared at slide-rels level. Each
   *  entry pairs a relationship id with the target URL. The URL
   *  has already been allowlist-validated upstream (the
   *  parser drops anything outside http / https / mailto). */
  hyperlinks: { rid: number; url: string }[];
  /** Phase 7c — cover-slide marker. Cover slides skip the SVG-
   *  space `<p:grpSp>` wrapping (no annotations) and place the
   *  icon directly at `imageRect` in slide coordinates. The
   *  `topLevelShapes` carry the title / description / author /
   *  step-count text. */
  coverSlide?: boolean;
}

/** Fit `src` inside `region` preserving aspect ratio (CSS
 *  `object-fit: contain` semantics). Returns the resulting
 *  rect in slide-pixel coordinates plus the uniform scale
 *  factor. `region` is expressed as fractions of the slide. */
function containInRegion(
  region: { x: number; y: number; w: number; h: number },
  src: { width: number; height: number },
): { x: number; y: number; w: number; h: number; scale: number } {
  const regionPx = {
    x: region.x * SLIDE_W_PX,
    y: region.y * SLIDE_H_PX,
    w: region.w * SLIDE_W_PX,
    h: region.h * SLIDE_H_PX,
  };
  const scaleX = regionPx.w / src.width;
  const scaleY = regionPx.h / src.height;
  const scale = Math.min(scaleX, scaleY);
  const scaledW = src.width * scale;
  const scaledH = src.height * scale;
  const offsetX = regionPx.x + (regionPx.w - scaledW) / 2;
  const offsetY = regionPx.y + (regionPx.h - scaledH) / 2;
  return { x: offsetX, y: offsetY, w: scaledW, h: scaledH, scale };
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

  // Phase 6b — slide size is now globally uniform at
  // SLIDE_W_PX × SLIDE_H_PX (16:9 widescreen). Each slide's
  // own SVG dimensions live on the SlideData as the
  // image-group's child-coord space; PowerPoint scales the
  // group to fit the contained rect inside the slide.
  const files: DocumentPptxFiles = {
    "[Content_Types].xml": str(contentTypes(slides.length, usesPng, usesJpeg)),
    "_rels/.rels": str(rootRels()),
    "ppt/presentation.xml": str(presentation(SLIDE_W_PX, SLIDE_H_PX, slides.length)),
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
    files[`ppt/slides/slide${s.index}.xml`] = str(buildSlideXml(s));
    files[`ppt/slides/_rels/slide${s.index}.xml.rels`] = str(
      slideRels(s.index, s.imageBytes !== null, s.imageExt, s.mosaicMedia, s.hyperlinks),
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
  // Phase 7c — cover slide. Prepended ahead of the per-block
  // slides when `meta.header` is set. The cover always lands at
  // index 1 (when emitted) so subsequent slides shift to 2..N+1.
  const cover = buildCoverSlide(doc, 1);
  if (cover) out.push(cover);
  // Phase 7a: assign the slide index AFTER a successful build so
  // skipped blocks (image parse failure, entirely-empty image-
  // less step, etc.) don't leave a gap in the slide numbering.
  // The presentation rels / content-types / slide xml all expect
  // a contiguous 1..N sequence; a gap renders the deck unreadable
  // in PowerPoint.
  for (const block of doc.blocks) {
    if (block.kind === "image") {
      const data = buildSlideFromImageBlock(block, out.length + 1);
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
      const data = buildSlideFromStepBlock(block, out.length + 1);
      if (data) out.push(data);
    }
  }
  return out;
}

/**
 * Phase 7c — build the cover slide from `doc.meta.header`.
 * Returns `null` when no header is set (so the deck looks
 * exactly like it did pre-Phase-7c for non-card docs).
 *
 * Layout (16:9, 1280×720):
 *   - Icon: centred 160×160 px at (560, 60) when present.
 *   - Title: centred at (80, 250, 1120, 100) — large bold font.
 *   - Description: centred at (160, 360, 960, 160) — medium font.
 *   - Footer (author + step count): centred at (80, 620, 1120, 40).
 */
function buildCoverSlide(doc: AnnotDocument, index: number): SlideData | null {
  const header = doc.meta.header;
  if (!header || (!header.icon && !header.description)) return null;
  const iconInfo = header.icon ? readDataUrl(header.icon) : null;
  const stepCount = countStepBlocksInDoc(doc);

  const topLevelShapes: SlideData["topLevelShapes"] = [];
  let nextId = iconInfo ? 3 : 2; // id=1 = root group, id=2 = icon pic when present
  // Title.
  const titleId = nextId++;
  topLevelShapes.push({
    xml: buildStepTextShapeXml({
      id: titleId,
      name: "CoverTitle",
      text: doc.title,
      rect: { x: 0.0625, y: 0.347, w: 0.875, h: 0.139 }, // (80,250,1120,100)
      fontSizeHpt: 4400,
      bold: true,
      overlay: false,
    }),
    id: titleId,
  });
  if (header.description) {
    const descId = nextId++;
    topLevelShapes.push({
      xml: buildStepTextShapeXml({
        id: descId,
        name: "CoverDescription",
        text: header.description,
        rect: { x: 0.125, y: 0.5, w: 0.75, h: 0.222 }, // (160,360,960,160)
        fontSizeHpt: 2000,
        bold: false,
        overlay: false,
      }),
      id: descId,
    });
  }
  const footerParts: string[] = [];
  if (doc.meta.author) footerParts.push(`By ${doc.meta.author}`);
  if (stepCount > 0) footerParts.push(stepCount === 1 ? "1 step" : `${stepCount} steps`);
  if (footerParts.length > 0) {
    const footerId = nextId++;
    topLevelShapes.push({
      xml: buildStepTextShapeXml({
        id: footerId,
        name: "CoverFooter",
        text: footerParts.join(" · "),
        rect: { x: 0.0625, y: 0.861, w: 0.875, h: 0.056 }, // (80,620,1120,40)
        fontSizeHpt: 1400,
        bold: false,
        overlay: false,
      }),
      id: footerId,
    });
  }

  // Icon placement (when present). Centred 160x160 px at the top.
  const iconRect = iconInfo
    ? { x: 0.4375, y: 0.083, w: 0.125, h: 0.222 } // (560,60,160,160)
    : { x: 0, y: 0, w: 0, h: 0 };

  return {
    index,
    width: SLIDE_W_PX,
    height: SLIDE_H_PX,
    imageBytes: iconInfo?.bytes ?? null,
    imageExt: iconInfo?.ext ?? "png",
    imageRect: iconRect,
    shapes: [],
    topLevelShapes,
    mosaicMedia: [],
    hyperlinks: [],
    coverSlide: true,
  };
}

/** Phase 7c — count step blocks in the document; used by the
 *  cover slide footer and the standalone-view header metadata. */
function countStepBlocksInDoc(doc: AnnotDocument): number {
  let n = 0;
  for (const block of doc.blocks) {
    if (block.kind === "step") n += 1;
  }
  return n;
}

/** Decode a `data:` URL into raw bytes + format hint. Returns
 *  `null` when the URL doesn't start with `data:` or carries
 *  an unsupported MIME type. */
function readDataUrl(dataUrl: string): { bytes: Uint8Array; ext: "png" | "jpeg" } | null {
  if (!dataUrl.startsWith("data:")) return null;
  const bytes = dataUrlToUint8Array(dataUrl);
  if (bytes.length === 0) return null;
  const ext = dataUrl.startsWith("data:image/png")
    ? "png"
    : dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")
      ? "jpeg"
      : null;
  if (ext === null) return null;
  return { bytes, ext };
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

  // Phase 6b — image blocks `contain`-fit the source into the
  // full slide rect (16:9). The source aspect may not match
  // 16:9 → letterboxing on one axis is accepted. Annotation
  // shapes stay in their original SVG coords; PowerPoint
  // scales them via the image-group's `<a:xfrm>` mapping.
  const imageRect = containInRegion({ x: 0, y: 0, w: 1, h: 1 }, { width, height });

  return {
    index,
    width,
    height,
    imageBytes: imageInfo?.bytes ?? null,
    imageExt: imageInfo?.ext ?? "png",
    imageRect,
    shapes,
    topLevelShapes: [],
    mosaicMedia,
    hyperlinks: [],
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
  // Phase 7a of `docs/plans/card-procedure-template.md` — an empty
  // `block.svg` marks an image-less step block (text-only narrative
  // card). We bypass the image-block delegation entirely and emit
  // a slide whose only content is the title + body shapes,
  // centred on the slide.
  if (block.svg.length === 0) {
    return buildImagelessStepSlide(block, index);
  }
  const base = buildSlideFromImageBlock({ kind: "image", id: block.id, svg: block.svg }, index);
  if (!base) return null;

  // Phase 6b — recompute the image rect per layout. Phase 6 v1
  // delegated to `buildSlideFromImageBlock` (which fills the
  // full slide); for step blocks the image should sit in its
  // layout-specific region with the text taking the remainder.
  base.imageRect = containInRegion(STEP_IMAGE_REGION[block.layout], {
    width: base.width,
    height: base.height,
  });

  // Allocate fresh `<p:cNvPr id="..."/>` ids for the text
  // shapes. Top-level shapes use their own id sequence (the
  // annotation `<p:cNvPr id="..."/>` numbers live inside the
  // image group's own coordinate space, so they don't collide
  // with slide-level ids, but PowerPoint expects unique ids
  // across the whole `<p:spTree>` — keep the counter monotonic
  // to be safe).
  let nextId = base.shapes.reduce((m, s) => Math.max(m, s.id), 1) + 1;

  const placements = LAYOUT_PLACEMENTS[block.layout];
  const titleText = stripInlineHtml(block.title);
  const bodyText = stripInlineHtml(block.body);
  // Only the image-fill layout uses the overlay style
  // (translucent dark backdrop + white text). For the area-
  // based layouts the text region sits ALONGSIDE the image,
  // so we render plain dark-on-transparent text — matches
  // PowerPoint's default body-text appearance.
  const overlay = block.layout === "image-fill";

  // Empty title or body slots — common when the user hasn't
  // typed anything yet — are emitted as visible empty boxes
  // would be noise. Skip them.
  if (titleText.length > 0) {
    const titleId = nextId++;
    base.topLevelShapes.push({
      xml: buildStepTextShapeXml({
        id: titleId,
        name: "StepTitle",
        text: titleText,
        rect: placements.title,
        fontSizeHpt: 2400,
        bold: true,
        overlay,
      }),
      id: titleId,
    });
  }
  if (bodyText.length > 0) {
    const bodyId = nextId++;
    base.topLevelShapes.push({
      xml: buildStepTextShapeXml({
        id: bodyId,
        name: "StepBody",
        text: bodyText,
        rect: placements.body,
        fontSizeHpt: 1600,
        bold: false,
        overlay,
      }),
      id: bodyId,
    });
  }

  // Phase 7b — URL chip. Same dark-on-transparent vs translucent-
  // overlay split as the title / body shapes; the chip text is
  // wrapped in `<a:hlinkClick>` so PowerPoint opens the URL on
  // click. The chip is positioned per layout — see
  // `LINK_CHIP_PLACEMENTS`.
  if (block.link !== undefined) {
    const chipId = nextId++;
    const linkRid = allocateHyperlinkRid(base);
    base.hyperlinks.push({ rid: linkRid, url: block.link.url });
    const chipLabel = block.link.label ?? block.link.url;
    base.topLevelShapes.push({
      xml: buildStepLinkChipXml({
        id: chipId,
        text: chipLabel,
        rect: LINK_CHIP_PLACEMENTS[block.layout],
        linkRid,
        overlay,
      }),
      id: chipId,
    });
  }

  return base;
}

/**
 * Phase 7a — build a slide from an image-less step block. The
 * slide has no image group, no annotation shapes, no mosaic
 * media; just two top-level text shapes (title + body) centred
 * on the slide. Layout matches the CSS counterpart: title near
 * the top of a generous text area, body filling the rest.
 *
 * `data-step-layout` is ignored for image-less blocks — the CSS
 * collapses the grid to text-only regardless of layout, and
 * mirroring that in PPTX keeps the rendered slide consistent
 * with the standalone view.
 */
function buildImagelessStepSlide(block: StepBlock, index: number): SlideData | null {
  const titleText = stripInlineHtml(block.title);
  const bodyText = stripInlineHtml(block.body);
  // A slide with neither title nor body NOR a URL chip would be
  // visually empty — skip it the same way image-bearing slides
  // skip on parse failure. Phase 7b: a link-only step IS
  // exportable; the chip carries visible content.
  if (titleText.length === 0 && bodyText.length === 0 && block.link === undefined) {
    return null;
  }

  // Centred text card. Title occupies the upper third (visually
  // emphasises the step name); body fills the middle two-thirds
  // with comfortable margins. Coordinates expressed as fractions
  // of the slide for symmetry with `LAYOUT_PLACEMENTS`.
  const titleRect = { x: 0.1, y: 0.2, w: 0.8, h: 0.15 };
  const bodyRect = { x: 0.1, y: 0.4, w: 0.8, h: 0.45 };

  let nextId = 2;
  const topLevelShapes: SlideData["topLevelShapes"] = [];
  if (titleText.length > 0) {
    const titleId = nextId++;
    topLevelShapes.push({
      xml: buildStepTextShapeXml({
        id: titleId,
        name: "StepTitle",
        text: titleText,
        rect: titleRect,
        fontSizeHpt: 3200,
        bold: true,
        overlay: false,
      }),
      id: titleId,
    });
  }
  if (bodyText.length > 0) {
    const bodyId = nextId++;
    topLevelShapes.push({
      xml: buildStepTextShapeXml({
        id: bodyId,
        name: "StepBody",
        text: bodyText,
        rect: bodyRect,
        fontSizeHpt: 2000,
        bold: false,
        overlay: false,
      }),
      id: bodyId,
    });
  }

  // Phase 7b — URL chip on an image-less slide. Centred chip
  // below the body text region. The slide's hyperlinks rels
  // start at rId2 (no screenshot in front of them).
  const hyperlinks: SlideData["hyperlinks"] = [];
  if (block.link !== undefined) {
    const chipId = nextId++;
    const linkRid = 2; // first free rId after slideLayout (rId1).
    hyperlinks.push({ rid: linkRid, url: block.link.url });
    const chipLabel = block.link.label ?? block.link.url;
    topLevelShapes.push({
      xml: buildStepLinkChipXml({
        id: chipId,
        text: chipLabel,
        // Centred under the body region of an image-less card.
        rect: { x: 0.3, y: 0.78, w: 0.4, h: 0.06 },
        linkRid,
        overlay: false,
      }),
      id: chipId,
    });
  }

  return {
    index,
    // Width / height carried as the slide canvas size so the
    // `<a:chExt>` falls back sensibly if anything queries it; the
    // image group is skipped entirely (no image, no annotations).
    width: SLIDE_W_PX,
    height: SLIDE_H_PX,
    imageBytes: null,
    imageExt: "png",
    imageRect: { x: 0, y: 0, w: 0, h: 0 },
    shapes: [],
    topLevelShapes,
    mosaicMedia: [],
    hyperlinks,
  };
}

/** Phase 7b — allocate a fresh rId for a slide-level hyperlink.
 *  Picks the next integer above the existing rIds (slideLayout=1,
 *  screenshot=2 when present, mosaic media 3..N, hyperlinks
 *  beyond that). Pure function over the slide's current state. */
function allocateHyperlinkRid(slide: SlideData): number {
  let maxRid = 1; // slideLayout
  if (slide.imageBytes) maxRid = Math.max(maxRid, 2);
  for (const m of slide.mosaicMedia) maxRid = Math.max(maxRid, m.rid);
  for (const h of slide.hyperlinks) maxRid = Math.max(maxRid, h.rid);
  return maxRid + 1;
}

/** Phase 7b — per-layout chip placement. The chip sits in a
 *  bottom strip of the text region for the area-based layouts;
 *  for `image-fill` it overlays the bottom-right corner so the
 *  user can spot the link without scanning the full slide. */
const LINK_CHIP_PLACEMENTS: Record<StepLayout, { x: number; y: number; w: number; h: number }> = {
  "image-top": { x: 0.5, y: 0.92, w: 0.46, h: 0.06 },
  "image-bottom": { x: 0.5, y: 0.28, w: 0.46, h: 0.06 },
  "image-left": { x: 0.58, y: 0.9, w: 0.4, h: 0.06 },
  "image-right": { x: 0.02, y: 0.9, w: 0.4, h: 0.06 },
  "image-fill": { x: 0.5, y: 0.92, w: 0.46, h: 0.06 },
};

/** Phase 6b — per-layout title + body text-shape positions
 *  (slide-coordinate fractions). Coordinates pair up with the
 *  matching `STEP_IMAGE_REGION` so the text sits in the slide
 *  area NOT occupied by the image. For `image-fill` the text
 *  still overlays the image at the bottom — that's the only
 *  layout where image + text share slide pixels. */
const LAYOUT_PLACEMENTS: Record<
  StepLayout,
  {
    title: { x: number; y: number; w: number; h: number };
    body: { x: number; y: number; w: number; h: number };
  }
> = {
  // Image fills upper 65% → text in bottom 35%.
  "image-top": {
    title: { x: 0.04, y: 0.67, w: 0.92, h: 0.08 },
    body: { x: 0.04, y: 0.75, w: 0.92, h: 0.23 },
  },
  // Image fills lower 65% → text in top 35%.
  "image-bottom": {
    title: { x: 0.04, y: 0.04, w: 0.92, h: 0.08 },
    body: { x: 0.04, y: 0.12, w: 0.92, h: 0.23 },
  },
  // Image left 55% → text right 45%.
  "image-left": {
    title: { x: 0.58, y: 0.04, w: 0.4, h: 0.1 },
    body: { x: 0.58, y: 0.14, w: 0.4, h: 0.82 },
  },
  // Image right 55% → text left 45%.
  "image-right": {
    title: { x: 0.02, y: 0.04, w: 0.4, h: 0.1 },
    body: { x: 0.02, y: 0.14, w: 0.4, h: 0.82 },
  },
  // Image fills slide → text overlays at the bottom (only
  // layout where text shares pixels with the image; renders
  // with the translucent backdrop).
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
  /** Font size in hundredths of a point (PowerPoint's `sz`
   *  attribute unit). `2400` = 24 pt. */
  fontSizeHpt: number;
  bold: boolean;
  /** When `true`, render with the translucent dark backdrop +
   *  white text (image-fill style). When `false`, plain
   *  dark-on-transparent text (sits in a slide region of its
   *  own — image-top / -bottom / -left / -right). */
  overlay: boolean;
}

/**
 * Emit one `<p:sp>` for the step's title or body. Phase 6b
 * keeps the overlay style (translucent dark backdrop + white
 * text) for the `image-fill` layout where the text shares
 * pixels with the image; the other four layouts use plain
 * dark-on-transparent text in their own slide region.
 *
 * Always single-run plain text — rich `TextRun[]` formatting
 * is a Phase 7+ enhancement.
 */
function buildStepTextShapeXml(opts: OverlayTextShapeOptions): string {
  const xPx = SLIDE_W_PX * opts.rect.x;
  const yPx = SLIDE_H_PX * opts.rect.y;
  const wPx = SLIDE_W_PX * opts.rect.w;
  const hPx = SLIDE_H_PX * opts.rect.h;
  const text = escapeOoxmlText(opts.text);
  const boldAttr = opts.bold ? ' b="1"' : "";
  // Overlay style: dark translucent backdrop + white text.
  // Region style: transparent backdrop + dark text.
  const fillXml = opts.overlay
    ? `<a:solidFill><a:srgbClr val="000000"><a:alpha val="65000"/></a:srgbClr></a:solidFill>`
    : `<a:noFill/>`;
  const textColor = opts.overlay ? "FFFFFF" : "000000";
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
          ${fillXml}
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:defRPr/></a:pPr>
            <a:r>
              <a:rPr lang="en-US" sz="${opts.fontSizeHpt}"${boldAttr}>
                <a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill>
              </a:rPr>
              <a:t>${text}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;
}

interface StepLinkChipOptions {
  id: number;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  /** The slide-rels rId pointing at the hyperlink relationship. */
  linkRid: number;
  /** Use the overlay style (translucent dark backdrop + white
   *  text) for image-fill layout; transparent + accent-coloured
   *  text otherwise. */
  overlay: boolean;
}

/**
 * Phase 7b — build a `<p:sp>` for the URL chip. The text run is
 * wrapped in `<a:hlinkClick r:id="rIdN">` so PowerPoint treats
 * the chip as a hyperlink (Ctrl+Click in slide-edit mode, plain
 * click in slide-show mode). The chip's visual treatment mirrors
 * the CSS counterpart in `injectDocumentStyles`: a pill-shaped
 * accent-coloured outline with an external-link affordance. We
 * approximate the pill with a rounded-rectangle prstGeom; the
 * external-link glyph is omitted (PowerPoint text shapes can't
 * inline SVG, and shipping a media glyph for every slide would
 * bloat the deck).
 */
function buildStepLinkChipXml(opts: StepLinkChipOptions): string {
  const xPx = SLIDE_W_PX * opts.rect.x;
  const yPx = SLIDE_H_PX * opts.rect.y;
  const wPx = SLIDE_W_PX * opts.rect.w;
  const hPx = SLIDE_H_PX * opts.rect.h;
  const text = escapeOoxmlText(opts.text);
  const fillXml = opts.overlay
    ? `<a:solidFill><a:srgbClr val="000000"><a:alpha val="65000"/></a:srgbClr></a:solidFill>`
    : "<a:noFill/>";
  // Chip uses the document accent palette colour for the border
  // + text. Theme accent1 (#4472C4) is hard-coded — the theme XML
  // already pins it. Overlay style flips to white-on-dark.
  const lineColor = opts.overlay ? "FFFFFF" : "4472C4";
  const textColor = opts.overlay ? "FFFFFF" : "4472C4";
  return `<p:sp>
        <p:nvSpPr>
          <p:cNvPr id="${opts.id}" name="StepLink"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="${px(xPx)}" y="${px(yPx)}"/>
            <a:ext cx="${px(wPx)}" cy="${px(hPx)}"/>
          </a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>
          ${fillXml}
          <a:ln w="9525"><a:solidFill><a:srgbClr val="${lineColor}"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" lIns="91440" tIns="36000" rIns="91440" bIns="36000" anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:defRPr/></a:pPr>
            <a:r>
              <a:rPr lang="en-US" sz="1400" u="sng">
                <a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill>
                <a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${opts.linkRid}"/>
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

/**
 * Phase 6b — slide XML now builds a `<p:grpSp>` that wraps the
 * image + annotation shapes with an `<a:xfrm>` mapping the
 * source SVG coordinate space `(chOff=0,0 chExt=svgW,svgH)`
 * onto the contained image rect `(off=imageRect.x,y
 * ext=imageRect.w,h)`. PowerPoint applies the group transform
 * to every child, so annotations stay aligned with the image
 * without per-shape coordinate scaling.
 *
 * Top-level shapes (step block title / body text overlays)
 * sit OUTSIDE the group at slide-space positions — they don't
 * scale with the image group.
 *
 * The slide canvas itself is uniformly `SLIDE_W_PX × SLIDE_H_PX`
 * for every slide in the deck.
 */
function buildSlideXml(slide: SlideData): string {
  const annotationXml = slide.shapes.map((s) => s.xml).join("\n");
  const topLevelXml = slide.topLevelShapes.map((s) => s.xml).join("\n");
  const hasImage = slide.imageBytes !== null;
  const hasAnnotations = slide.shapes.length > 0;

  // Phase 7c — cover slides skip the SVG-space group wrap. The
  // icon (when present) sits at `slide.imageRect` in slide
  // coords directly; topLevelShapes (title / description /
  // footer) render unchanged.
  if (slide.coverSlide) {
    const iconXml = hasImage
      ? `<p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="CoverIcon"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId2"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="${px(SLIDE_W_PX * slide.imageRect.x)}" y="${px(SLIDE_H_PX * slide.imageRect.y)}"/>
            <a:ext cx="${px(SLIDE_W_PX * slide.imageRect.w)}" cy="${px(SLIDE_H_PX * slide.imageRect.h)}"/>
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
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(SLIDE_W_PX)}" cy="${px(SLIDE_H_PX)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(SLIDE_W_PX)}" cy="${px(SLIDE_H_PX)}"/></a:xfrm></p:grpSpPr>
      ${iconXml}
      ${topLevelXml}
    </p:spTree>
  </p:cSld>
</p:sld>`;
  }

  // Image element inside the group, in CHILD coord space
  // (0..svgW, 0..svgH).
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
            <a:ext cx="${px(slide.width)}" cy="${px(slide.height)}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>`
    : "";

  // Image-group `<a:xfrm>` — maps child coords to the
  // contained image rect in slide space.
  const groupXml =
    hasImage || hasAnnotations
      ? `<p:grpSp>
        <p:nvGrpSpPr>
          <p:cNvPr id="2" name="ImageGroup"/>
          <p:cNvGrpSpPr/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="${px(slide.imageRect.x)}" y="${px(slide.imageRect.y)}"/>
            <a:ext cx="${px(slide.imageRect.w)}" cy="${px(slide.imageRect.h)}"/>
            <a:chOff x="0" y="0"/>
            <a:chExt cx="${px(slide.width)}" cy="${px(slide.height)}"/>
          </a:xfrm>
        </p:grpSpPr>
        ${picXml}
        ${annotationXml}
      </p:grpSp>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(SLIDE_W_PX)}" cy="${px(SLIDE_H_PX)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(SLIDE_W_PX)}" cy="${px(SLIDE_H_PX)}"/></a:xfrm></p:grpSpPr>
      ${groupXml}
      ${topLevelXml}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function slideRels(
  slideIndex: number,
  hasImage: boolean,
  imageExt: "png" | "jpeg",
  mosaicMedia: ReadonlyArray<{ filename: string; rid: number }>,
  hyperlinks: ReadonlyArray<{ rid: number; url: string }>,
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
  // Phase 7b — hyperlink relationships. `TargetMode="External"`
  // tells PowerPoint the URL points outside the package.
  const linkRels = hyperlinks
    .map(
      (h) =>
        `\n  <Relationship Id="rId${h.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXmlAttr(h.url)}" TargetMode="External"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imgRel}${mosaicRels}${linkRels}
</Relationships>`;
}

/** Escape `&`, `<`, `>`, `"` for XML attribute values. The
 *  slide-rels `Target` attribute carries user-supplied URLs;
 *  preserve every character but quote the four XML metachars. */
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
