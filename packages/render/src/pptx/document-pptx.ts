/**
 * `exportDocumentPptx(doc): Blob` — multi-slide PPTX export.
 *
 * Phase 11 of `docs/plans/_done/annot-html-document.md`. Each
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
import type {
  AnnotDocument,
  ImageBlock,
  NumberingMeta,
  PptxPalette,
  StepBlock,
  StepLayout,
} from "@ingcreators/annot-doc";
import { getTheme } from "@ingcreators/annot-doc";
import { buildShapeXml, px } from "../drawingml/index.js";

/** Output of {@link buildDocumentPptxFiles} — the OPC file map
 *  ready to be packed into a ZIP. Exported so the unit test can
 *  inspect individual entries without going through the
 *  `Blob` re-wrap in `exportDocumentPptx`. */
export type DocumentPptxFiles = Record<string, Uint8Array>;

/** Phase 6b of `docs/plans/_done/card-procedure-template.md` —
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
  // Image fills the upper 75%; bottom 25% reserved for text.
  // Bumped from 65% on user feedback — the 16:9 source maps
  // more legibly when the image takes a clear majority of the
  // slide.
  "image-top": { x: 0, y: 0, w: 1, h: 0.75 },
  // Mirror — image at bottom, text up top.
  "image-bottom": { x: 0, y: 0.25, w: 1, h: 0.75 },
  // Two-column — image left 62%, text right 38%. Bumped from
  // 55/45 so the screenshot is the obvious focus of the slide.
  "image-left": { x: 0, y: 0, w: 0.62, h: 1 },
  // Mirror — image right.
  "image-right": { x: 0.38, y: 0, w: 0.62, h: 1 },
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
  /** Phase 7d — image-group child coord origin override. When a
   *  step block carries `viewport`, we set `chOff = (vp.x, vp.y)`
   *  + `chExt = (vp.w, vp.h)` so the viewport sub-rect maps to
   *  the slide image region (vs the full SVG mapping when
   *  viewport is unset). Defaults to `(0, 0)`. */
  chOff?: { x: number; y: number };
  /** Phase 7d — picture's child-coord placement. For full-image
   *  step blocks this is `(0, 0, width, height)` (= the whole
   *  SVG coord space). For viewport-cropped blocks the picture
   *  is placed at `(vp.x, vp.y, vp.w, vp.h)` so the cropped
   *  bitmap aligns with the viewport rect inside the group. */
  imageChildOff?: { x: number; y: number };
  imageChildExt?: { w: number; h: number };
  /** Phase 7d — picture-level bitmap crop, expressed as 0.001%
   *  edge-clip values (PowerPoint's `<a:srcRect>` units). When
   *  set, the picture's `<p:blipFill>` carries an `<a:srcRect>`
   *  child clipping the bitmap to the viewport portion. */
  imageSrcRect?: { l: number; t: number; r: number; b: number };
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
  //
  // Phase 5 of `docs/plans/card-step-auto-numbering.md` — track
  // a separate `stepCounter` so badge numerals mirror the
  // CSS-counter behaviour in the standalone view (counts step
  // blocks in document order regardless of cover / image blocks
  // interleaved before / between them).
  let stepCounter = 0;
  const numbering = doc.meta.numbering;
  // Pragmatic-Phase-1 of `docs/plans/card-pptx-templates.md` —
  // resolve the active theme's `pptxPalette` once and thread it
  // through the per-step builders so the step badge colours
  // match the document's `meta.appearance.template`. Absent →
  // legacy modern-light blue baked into `buildStepBadgeXml`.
  const palette = resolvePptxPalette(doc);
  for (const block of doc.blocks) {
    if (block.kind === "image") {
      const data = buildSlideFromImageBlock(block, out.length + 1);
      if (data) out.push(data);
      continue;
    }
    // Phase 6 of `docs/plans/_done/card-procedure-template.md` — step
    // blocks become slides alongside image blocks. The image is
    // full-bleed (matches the image-block path) so annotation
    // coordinates stay in their SVG-native space; title + body
    // are emitted as overlay `<p:sp>` text shapes positioned per
    // `data-step-layout`.
    if (block.kind === "step") {
      stepCounter += 1;
      const data = buildSlideFromStepBlock(block, out.length + 1, stepCounter, numbering, palette);
      if (data) out.push(data);
    }
  }
  return out;
}

/** Pragmatic-Phase-1 of `docs/plans/card-pptx-templates.md` —
 *  resolve the active theme's PPTX palette from the document.
 *  Mirrors the precedence rules in
 *  `inject-styles.ts:buildStyleBlock`: `meta.appearance.template`
 *  wins; otherwise fall through to the legacy `meta.theme`
 *  mapping. Returns `undefined` when neither is set so the
 *  exporter's legacy hard-coded blue palette applies — which
 *  keeps `buildDocumentPptxFiles` byte-identical to pre-Phase-1
 *  output for documents that haven't opted into appearance. */
function resolvePptxPalette(doc: AnnotDocument): PptxPalette | undefined {
  const templateId = doc.meta.appearance?.template;
  if (templateId !== undefined) {
    return getTheme(templateId).pptxPalette;
  }
  // Defer to the legacy `meta.theme` keyword mapping. For
  // byte-equivalence with the pre-Phase-1 output we leave the
  // palette undefined when the legacy modern-light fallback
  // applies — the exporter's hard-coded blue matches. The
  // `theme === "dark"` legacy path also matches by virtue of
  // the hard-coded blue (the legacy exporter didn't theme the
  // badge by `meta.theme` either).
  return undefined;
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
      // Cover slide uses centred title / description / footer
      // — the classic "first slide" treatment vs. step blocks'
      // left-aligned reading flow.
      align: "ctr",
      anchor: "ctr",
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
        align: "ctr",
        anchor: "ctr",
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
        align: "ctr",
        anchor: "ctr",
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
  // Phase 7d-polish: annotations may live either inside a
  // `<g id="annotations">` wrapper (the canonical form the
  // card-procedure generator emits) OR as direct children of
  // the outer `<svg>` (the flattened form `exportSVGString`
  // produces after a modal annotation edit). Walk both — find
  // the group first, fall back to direct svg children with
  // the usual skips (`<defs>`, the base `<image>`, ui-overlay).
  const annotationsEl = svgEl.querySelector("[id='annotations']");
  const annotationCandidates: SVGElement[] = [];
  if (annotationsEl) {
    for (const node of Array.from(annotationsEl.childNodes)) {
      if (node.nodeType !== 1) continue;
      annotationCandidates.push(node as unknown as SVGElement);
    }
  } else {
    for (const node of Array.from(svgEl.childNodes)) {
      if (node.nodeType !== 1) continue;
      const el = node as unknown as SVGElement;
      const tag = el.tagName;
      if (tag === "defs") continue;
      if (tag === "image" && !el.hasAttribute("data-redact-style")) continue;
      if (el.id === "ui-overlay") continue;
      annotationCandidates.push(el);
    }
  }
  if (annotationCandidates.length > 0) {
    for (const el of annotationCandidates) {
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
 * Phase 6 of `docs/plans/_done/card-procedure-template.md` — build a
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
function buildSlideFromStepBlock(
  block: StepBlock,
  index: number,
  stepCounter: number,
  numbering: NumberingMeta | undefined,
  palette: PptxPalette | undefined,
): SlideData | null {
  // Phase 7a of `docs/plans/_done/card-procedure-template.md` — an empty
  // `block.svg` marks an image-less step block (text-only narrative
  // card). We bypass the image-block delegation entirely and emit
  // a slide whose only content is the title + body shapes,
  // centred on the slide.
  if (block.svg.length === 0) {
    return buildImagelessStepSlide(block, index, stepCounter, numbering, palette);
  }
  const base = buildSlideFromImageBlock({ kind: "image", id: block.id, svg: block.svg }, index);
  if (!base) return null;

  // Phase 7d — image viewport (initial-view crop). Apply BEFORE
  // recomputing the image rect so the contain-fit uses the
  // viewport aspect ratio rather than the full SVG aspect ratio.
  // The viewport modifies:
  //   - group `chOff` / `chExt` → maps vp portion of SVG coord
  //     space to the slide image region (annotations within the
  //     viewport land in the slide region; annotations outside
  //     the viewport bleed onto the slide canvas and may need
  //     filtering in a v2 follow-up).
  //   - picture `off` / `ext` → places the picture at the
  //     viewport rect in child coords.
  //   - picture `<a:srcRect>` → crops the bitmap to the viewport
  //     portion (PowerPoint stretches the cropped pixels to fill
  //     the picture's display rect).
  const svgWidth = base.width;
  const svgHeight = base.height;
  if (block.viewport) {
    const vp = block.viewport;
    // PowerPoint srcRect units: 0.001% per unit (100000 = 100%).
    // Round to integer to keep the XML compact and stable across
    // re-runs.
    base.imageSrcRect = {
      l: Math.round((vp.x / svgWidth) * 100000),
      t: Math.round((vp.y / svgHeight) * 100000),
      r: Math.round(((svgWidth - vp.x - vp.w) / svgWidth) * 100000),
      b: Math.round(((svgHeight - vp.y - vp.h) / svgHeight) * 100000),
    };
    base.chOff = { x: vp.x, y: vp.y };
    base.width = vp.w;
    base.height = vp.h;
    base.imageChildOff = { x: vp.x, y: vp.y };
    base.imageChildExt = { w: vp.w, h: vp.h };
  }

  // Phase 6b — recompute the image rect per layout. Phase 6 v1
  // delegated to `buildSlideFromImageBlock` (which fills the
  // full slide); for step blocks the image should sit in its
  // layout-specific region with the text taking the remainder.
  // Phase 7d: when viewport is set, `base.width / height` now
  // reflect the viewport dimensions so the contain-fit uses the
  // viewport's aspect ratio.
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

  // Phase 5 of `docs/plans/card-step-auto-numbering.md` — render
  // the step badge. Mirrors the CSS counterpart in
  // `injectDocumentStyles`: small accent-coloured circle in the
  // top-left corner with the step numeral (template parsed from
  // `numbering.stepLabel`). Skipped when numbering is off so
  // existing exports stay byte-identical to pre-Phase-5 output.
  if (numbering?.steps === true) {
    const badgeId = nextId++;
    base.topLevelShapes.push({
      xml: buildStepBadgeXml({
        id: badgeId,
        text: applyStepLabelTemplate(numbering.stepLabel, stepCounter),
        overlay: block.layout === "image-fill",
        accent: palette?.accent,
        accentFg: palette?.accentFg,
      }),
      id: badgeId,
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
function buildImagelessStepSlide(
  block: StepBlock,
  index: number,
  stepCounter: number,
  numbering: NumberingMeta | undefined,
  palette: PptxPalette | undefined,
): SlideData | null {
  const titleText = stripInlineHtml(block.title);
  const bodyText = stripInlineHtml(block.body);
  // A slide with neither title nor body would be visually empty
  // — skip it the same way image-bearing slides skip on parse
  // failure.
  if (titleText.length === 0 && bodyText.length === 0) {
    return null;
  }

  // Layout choice depends on whether the step is auto-
  // numbered:
  //
  // - Numbering OFF → "title-card" layout. Title in the upper
  //   third (visually emphasises the step name); body fills
  //   the middle two-thirds with comfortable margins.
  // - Numbering ON  → "compact-text card" layout matching the
  //   HTML view. Title near the top with explicit clearance
  //   from the badge (badge ends around x = 0.085 + ~1% for
  //   wider templates like `Step %n` → title.x = 0.12 leaves
  //   a comfortable gutter). Body fills the rest of the slide
  //   so badge + title + body read as a coherent column from
  //   the slide's top edge.
  //
  // The split is conditional rather than universal because
  // the title-card style looks better when there's no badge
  // anchoring the top-left corner.
  const numberingOn = numbering?.steps === true;
  const titleRect = numberingOn
    ? { x: 0.12, y: 0.06, w: 0.83, h: 0.12 }
    : { x: 0.1, y: 0.2, w: 0.8, h: 0.15 };
  const bodyRect = numberingOn
    ? { x: 0.05, y: 0.22, w: 0.9, h: 0.7 }
    : { x: 0.1, y: 0.4, w: 0.8, h: 0.45 };

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

  const hyperlinks: SlideData["hyperlinks"] = [];

  // Phase 5 of `docs/plans/card-step-auto-numbering.md` — badge
  // on an image-less slide. Same chrome as the image-bearing
  // path; uses the non-overlay style because there's no
  // screenshot underneath to compete with.
  if (numbering?.steps === true) {
    const badgeId = nextId++;
    topLevelShapes.push({
      xml: buildStepBadgeXml({
        id: badgeId,
        text: applyStepLabelTemplate(numbering.stepLabel, stepCounter),
        overlay: false,
        accent: palette?.accent,
        accentFg: palette?.accentFg,
      }),
      id: badgeId,
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

/**
 * Phase 5 of `docs/plans/card-step-auto-numbering.md` — replace
 * `%n` in the `stepLabel` template with the step counter. Mirrors
 * `stepLabelToCssContent` in `inject-styles.ts` but emits plain
 * text (no CSS counter substitution) since OOXML can't express
 * a counter at render time. The template defaults to `"%n"` —
 * bare numeral — when absent.
 */
function applyStepLabelTemplate(template: string | undefined, n: number): string {
  if (template === undefined) return String(n);
  return template.replace(/%n/g, String(n));
}

/** Phase 5 — step badge placement (slide-coordinate fractions).
 *  Top-left corner with a small inset matching the CSS
 *  `top: 0.75rem; left: 0.75rem` rule. 80x80 px at the
 *  1280x720 canvas → larger than the CSS badge proportionally,
 *  trading off PowerPoint's coarser hit-area / typography
 *  defaults vs. the browser's HiDPI rendering. */
const STEP_BADGE_RECT = { x: 0.022, y: 0.039, w: 0.0625, h: 0.111 };

interface StepBadgeOptions {
  id: number;
  text: string;
  /** image-fill layout → swap to a translucent dark backdrop +
   *  white text + soft shadow so the numeral stays legible on
   *  top of the screenshot. Other layouts get the accent-coloured
   *  pill style. */
  overlay: boolean;
  /** Pragmatic-Phase-1 of `docs/plans/card-pptx-templates.md` —
   *  badge fill + text colours sourced from the document's
   *  theme palette (`Theme.pptxPalette`). Absent → falls back
   *  to the legacy modern-light blue (`#2563EB` + white). */
  accent?: string;
  accentFg?: string;
}

/**
 * Emit one `<p:sp>` for the step badge — a small ellipse / rounded
 * rectangle carrying the step numeral in the top-left of the slide.
 * Mirrors the CSS `::before` rule emitted by `injectDocumentStyles`
 * when `meta.numbering.steps === true`.
 */
function buildStepBadgeXml(opts: StepBadgeOptions): string {
  const xPx = SLIDE_W_PX * STEP_BADGE_RECT.x;
  const yPx = SLIDE_H_PX * STEP_BADGE_RECT.y;
  const wPx = SLIDE_W_PX * STEP_BADGE_RECT.w;
  const hPx = SLIDE_H_PX * STEP_BADGE_RECT.h;
  const text = escapeOoxmlText(opts.text);
  // Accent fill: from the active theme's pptxPalette when set,
  // otherwise the legacy modern-light blue (`#2563EB`) for
  // documents that haven't opted into `meta.appearance.template`.
  // Overlay variant uses translucent black for image-fill
  // legibility regardless of theme — the screenshot underneath
  // makes accent-on-image illegible.
  const accent = opts.accent ?? "2563EB";
  const accentFg = opts.accentFg ?? "FFFFFF";
  const fillXml = opts.overlay
    ? `<a:solidFill><a:srgbClr val="000000"><a:alpha val="55000"/></a:srgbClr></a:solidFill>`
    : `<a:solidFill><a:srgbClr val="${accent}"/></a:solidFill>`;
  // Pill-shaped (roundRect with maximum corner radius). Single-
  // digit content visually reads as a circle; longer labels
  // ("Step 1") stretch into a horizontal pill. The `adj1="50000"`
  // sets the corner radius to 50% of the shorter side — same
  // visual as `border-radius: 9999px` in CSS.
  const geomXml = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>`;
  // Soft drop shadow on the non-overlay variant — matches the
  // `box-shadow: 0 4px 12px rgba(R, G, B, 0.25)` in CSS. The
  // shadow tracks the accent colour so light-accent themes (e.g.
  // minimal's black) don't end up with a phantom blue glow.
  const effectXml = opts.overlay
    ? ""
    : `<a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="${accent}"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>`;
  // Overlay variant always uses white badge text; non-overlay
  // uses the theme's accentFg (white on most themes, dark on
  // pastel themes).
  const textColor = opts.overlay ? "FFFFFF" : accentFg;
  return `<p:sp>
        <p:nvSpPr>
          <p:cNvPr id="${opts.id}" name="StepBadge"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="${px(xPx)}" y="${px(yPx)}"/>
            <a:ext cx="${px(wPx)}" cy="${px(hPx)}"/>
          </a:xfrm>
          ${geomXml}
          ${fillXml}
          <a:ln><a:noFill/></a:ln>
          ${effectXml}
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="ctr"><a:defRPr/></a:pPr>
            <a:r>
              <a:rPr lang="en-US" sz="1800" b="1">
                <a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill>
              </a:rPr>
              <a:t>${text}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;
}

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
  // Image fills upper 75% → text in bottom 25%. Title sits
  // just below the image; body wraps the remaining height.
  "image-top": {
    title: { x: 0.04, y: 0.77, w: 0.92, h: 0.06 },
    body: { x: 0.04, y: 0.83, w: 0.92, h: 0.15 },
  },
  // Image fills lower 75% → text in top 25%.
  "image-bottom": {
    title: { x: 0.04, y: 0.02, w: 0.92, h: 0.06 },
    body: { x: 0.04, y: 0.08, w: 0.92, h: 0.15 },
  },
  // Image left 62% → text right 38%. 0.65 column start gives
  // 0.03 gutter between the image and the title.
  "image-left": {
    title: { x: 0.65, y: 0.04, w: 0.33, h: 0.1 },
    body: { x: 0.65, y: 0.14, w: 0.33, h: 0.82 },
  },
  // Image right 62% → text left 38%.
  "image-right": {
    title: { x: 0.02, y: 0.04, w: 0.33, h: 0.1 },
    body: { x: 0.02, y: 0.14, w: 0.33, h: 0.82 },
  },
  // Image fills slide → text overlays at the bottom (only
  // layout where text shares pixels with the image; renders
  // with the translucent backdrop).
  //
  // Both title + body span the FULL slide width (x: 0, w: 1)
  // and the body is flush to the slide bottom — matches the
  // HTML view's `left: 0; right: 0; bottom: 0` overlay. The
  // shape's solid-fill backdrop paints the entire box, so a
  // 92%-wide shape leaves 4% gaps on either side; full-width
  // shapes form one continuous dark strip across the slide
  // bottom, which is the design intent.
  "image-fill": {
    title: { x: 0, y: 0.78, w: 1, h: 0.1 },
    body: { x: 0, y: 0.88, w: 1, h: 0.12 },
  },
};

/** Strip inline HTML to plain text. The step title / body are
 *  stored as canonical inline HTML (Phase 1) — `<strong>`,
 *  `<em>`, `<u>`, `<span style>`, etc. Phase 6 v1 flattens that
 *  to a single run; rich formatting per run is a future
 *  enhancement that needs an HTML → `TextRun[]` parser bridge.
 *
 *  User-feedback fix: preserves line breaks. `<br>` /
 *  `<br/>` / `<br />` and block-tag closings (`</div>`,
 *  `</p>`, `</li>`) become `\n` so PPTX emit can split into
 *  separate `<a:p>` paragraphs and preserve the author's
 *  intended line wrapping. */
function stripInlineHtml(html: string): string {
  return (
    html
      .replace(/<br\s*\/?\s*>/gi, "\n")
      // Block-tag OPENING marks the start of a new line —
      // contentEditable typically wraps subsequent lines in
      // `<div>`s after the first Enter, leaving the first line
      // un-wrapped (e.g. `"A<div>B</div><div>C</div>"`). Insert
      // a `\n` before each opening div/p/li so the boundary
      // gets preserved.
      .replace(/<(div|p|li)(\s[^>]*)?>/gi, "\n")
      // Closing tags get stripped (no extra `\n` to avoid
      // doubling).
      .replace(/<\/(div|p|li)\s*>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      // Final tag-shaped strip — catches anything the entity
      // decode just reintroduced (`&lt;script&gt;` → `<script>`).
      // Without this pass the function output can carry a literal
      // `<script` substring downstream into the OOXML emit step
      // (CodeQL `js/incomplete-multi-character-sanitization`).
      // The `<\/?[a-zA-Z]` anchor requires a letter after `<` so
      // literal text like `Hello < World` (space then letter) is
      // preserved.
      .replace(/<\/?[a-zA-Z][^>]*>?/g, "")
      // Collapse 3+ consecutive newlines down to 2 — a doubled
      // newline reads as a paragraph break in PowerPoint; more
      // than that just bloats the output.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
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
  /** Horizontal text alignment. Default `"l"` (left) so step
   *  titles + bodies match the HTML view's left-aligned reading
   *  flow. Cover slide call sites pass `"ctr"` because a
   *  centred title is the standard cover treatment. */
  align?: "l" | "ctr" | "r";
  /** Vertical alignment inside the shape's text body. Default
   *  `"t"` (top) for step content — title sits flush at the top
   *  of its rect, body follows below. Cover-slide call sites
   *  pass `"ctr"` because the cover slide reserves vertical
   *  space generously and wants its blocks centred. */
  anchor?: "t" | "ctr" | "b";
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
  const boldAttr = opts.bold ? ' b="1"' : "";
  // Overlay style: dark translucent backdrop + white text.
  // Region style: transparent backdrop + dark text.
  const fillXml = opts.overlay
    ? `<a:solidFill><a:srgbClr val="000000"><a:alpha val="65000"/></a:srgbClr></a:solidFill>`
    : "<a:noFill/>";
  const textColor = opts.overlay ? "FFFFFF" : "000000";
  // Alignment: left + top by default so step titles + bodies
  // match the HTML view's reading flow. Cover-slide call sites
  // override both to "ctr" for the classic centred treatment.
  const align = opts.align ?? "l";
  const anchor = opts.anchor ?? "t";
  // User-feedback fix: split on `\n` so author-inserted line
  // breaks become separate paragraphs in PowerPoint. Each line
  // emits its own `<a:p>` with the same styling. Empty lines
  // (between two consecutive `\n`s) become empty paragraphs —
  // PowerPoint renders these as visible blank lines, matching
  // the author's intent.
  const paragraphs = opts.text.split("\n").map((line) => {
    const text = escapeOoxmlText(line);
    return `<a:p>
            <a:pPr algn="${align}"><a:defRPr/></a:pPr>
            <a:r>
              <a:rPr lang="en-US" sz="${opts.fontSizeHpt}"${boldAttr}>
                <a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill>
              </a:rPr>
              <a:t>${text}</a:t>
            </a:r>
          </a:p>`;
  });
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
          <a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"/>
          <a:lstStyle/>
          ${paragraphs.join("\n          ")}
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

  // Phase 7d — resolve the picture / group child-coord placement.
  // Defaults: picture at (0, 0, svgW, svgH) child coords; group
  // chOff = (0, 0), chExt = (svgW, svgH). When a viewport is set
  // these all shift to express the viewport sub-rect.
  const chOff = slide.chOff ?? { x: 0, y: 0 };
  const imageOff = slide.imageChildOff ?? { x: 0, y: 0 };
  const imageChildExt = slide.imageChildExt ?? { w: slide.width, h: slide.height };
  const srcRectXml = slide.imageSrcRect
    ? `<a:srcRect l="${slide.imageSrcRect.l}" t="${slide.imageSrcRect.t}" r="${slide.imageSrcRect.r}" b="${slide.imageSrcRect.b}"/>`
    : "";

  // Image element inside the group, in CHILD coord space.
  const picXml = hasImage
    ? `<p:pic>
        <p:nvPicPr>
          <p:cNvPr id="1000" name="Screenshot"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId2"/>
          ${srcRectXml}
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="${px(imageOff.x)}" y="${px(imageOff.y)}"/>
            <a:ext cx="${px(imageChildExt.w)}" cy="${px(imageChildExt.h)}"/>
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
            <a:chOff x="${px(chOff.x)}" y="${px(chOff.y)}"/>
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
